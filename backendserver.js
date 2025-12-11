import express from "express";
import multer from "multer";
import OpenAI from "openai";
import { TavilyClient } from "tavily";
import "dotenv/config";
import fs from "fs";
import path from "path";

const app = express();

// Configure multer to preserve file extension
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const tavily = new TavilyClient({
  apiKey: process.env.TAVILY_API_KEY,
});

// =========================
//    PDF 上傳 + AI 分析
// =========================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const pdfPath = req.file.path;

    // 1. 上傳 PDF 至 Files API
    const uploaded = await openai.files.create({
      file: fs.createReadStream(pdfPath),
      purpose: "assistants",
    });

    // 2. 呼叫 Responses API
    const response = await openai.responses.create({
      model: "gpt-4.1",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
你是一個專業法律文件識別系統。

任務：

1. 判斷這份文件類型（"合約" or "報價單"）。若無法判斷請回答 "不確定"。
2. 從裡面抽取「乙方公司名稱」。若找不到請回答 null。

請用 JSON 回覆：
{
  "document_type": "",
  "seller_company": ""
}
              `,
            },
            {
              type: "input_file",
              file_id: uploaded.id,
            },
          ],
        },
      ],
    });

    const result = JSON.parse(response.output_text);

    const documentType = result.document_type;
    const sellerCompany = result.seller_company;

    if (documentType === "不確定" || !sellerCompany) {
      return res.json({
        success: false,
        message: "無法確定文件類型或找不到乙方公司名稱",
      });
    }

    // 3. 用 Tavily 搜尋公司資料
    const companyProfile = await tavily.search({
      query: `${sellerCompany} 公司簡介 business profile`,
      max_results: 5,
    });

    const customsInfo = await tavily.search({
      query: `${sellerCompany} 海關 進出口 customs import export`,
      max_results: 5,
    });

    const legalInfo = await tavily.search({
      query: `${sellerCompany} 法律 合規 legal compliance`,
      max_results: 5,
    });

    // Clean up uploaded file
    fs.unlinkSync(pdfPath);

    res.json({
      success: true,
      document_type: documentType,
      seller_company: sellerCompany,
      company_data: {
        profile: companyProfile,
        customs: customsInfo,
        legal: legalInfo,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 啟動伺服器
app.listen(3000, () => console.log("Server running on port 3000"));