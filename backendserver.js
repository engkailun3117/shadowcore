import express from "express";
import multer from "multer";
import OpenAI from "openai";
import { TavilyClient } from "tavily";
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();

// Enable CORS for frontend
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files
app.use(express.static('.'));

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
//    合約存儲管理函數
// =========================

const CONTRACTS_DB = './contracts.json';

/**
 * 計算文件 hash (用於檢測重複)
 */
function calculateFileHash(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

/**
 * 讀取所有合約
 */
function getAllContracts() {
  if (!fs.existsSync(CONTRACTS_DB)) {
    return [];
  }
  const data = fs.readFileSync(CONTRACTS_DB, 'utf8');
  return JSON.parse(data);
}

/**
 * 保存所有合約
 */
function saveAllContracts(contracts) {
  fs.writeFileSync(CONTRACTS_DB, JSON.stringify(contracts, null, 2));
}

/**
 * 根據 hash 查找合約
 */
function findContractByHash(fileHash) {
  const contracts = getAllContracts();
  return contracts.find(c => c.file_hash === fileHash);
}

/**
 * 根據 ID 查找合約
 */
function findContractById(contractId) {
  const contracts = getAllContracts();
  return contracts.find(c => c.contract_id === contractId);
}

/**
 * 保存合約分析結果
 */
function saveContract(contractData) {
  const contracts = getAllContracts();
  const existingIndex = contracts.findIndex(c => c.contract_id === contractData.contract_id);

  if (existingIndex >= 0) {
    // 更新現有合約
    contracts[existingIndex] = contractData;
  } else {
    // 新增合約
    contracts.push(contractData);
  }

  saveAllContracts(contracts);
  return contractData;
}

// =========================
//    合約分析輔助函數
// =========================

/**
 * 計算健康評分（基於所有條款的風險分數平均值）
 * @param {Array} clauses - 所有條款分析結果陣列
 * @returns {number} 健康評分 (0-100)
 */
function calculateHealthScore(clauses) {
  if (!clauses || clauses.length === 0) {
    return 50; // 預設中性分數
  }

  // 計算所有條款的風險分數平均值
  const totalScore = clauses.reduce((sum, clause) => {
    return sum + (clause.risk_score ?? 50);
  }, 0);

  return Math.round(totalScore / clauses.length);
}

/**
 * 修復常見的 JSON 格式問題
 * @param {string} jsonStr - JSON 字串
 * @returns {string} 修復後的 JSON 字串
 */
function fixCommonJSONIssues(jsonStr) {
  // 移除尾隨逗號（trailing commas）
  let fixed = jsonStr.replace(/,(\s*[}\]])/g, "$1");

  // 處理單引號（替換為雙引號）
  // 注意：這是簡化處理，可能不適用所有情況
  // fixed = fixed.replace(/'/g, '"');

  // 移除 JSON 中的註解（// 和 /* */）
  fixed = fixed.replace(/\/\/.*$/gm, "");
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, "");

  return fixed;
}

/**
 * 從 OpenAI 回應中提取 JSON
 * 處理可能包含 markdown code blocks 或額外文字的情況
 * @param {string} text - OpenAI 回應文字
 * @returns {Object} 解析後的 JSON 物件
 */
function extractJSON(text) {
  // 嘗試直接解析
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log("直接解析失敗，嘗試其他方法...");

    // 嘗試提取 markdown code block 中的 JSON
    let jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (e2) {
        console.log("從 markdown 提取失敗，嘗試修復 JSON...");
        try {
          const fixed = fixCommonJSONIssues(jsonMatch[1]);
          return JSON.parse(fixed);
        } catch (e3) {
          console.error("修復失敗:", e3.message);
        }
      }
    }

    // 嘗試找到第一個 { 和最後一個 }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = text.substring(firstBrace, lastBrace + 1);

      // 先嘗試直接解析
      try {
        return JSON.parse(jsonStr);
      } catch (e2) {
        console.log("提取的 JSON 解析失敗，嘗試修復...");
        // 嘗試修復常見問題後再解析
        try {
          const fixed = fixCommonJSONIssues(jsonStr);
          console.log("修復後的 JSON:", fixed.substring(0, 200) + "...");
          return JSON.parse(fixed);
        } catch (e3) {
          console.error("修復後仍失敗:", e3.message);
          throw new Error(`無法解析 JSON，即使修復後仍失敗。原始錯誤: ${e3.message}\n提取的 JSON: ${jsonStr.substring(0, 500)}`);
        }
      }
    }

    // 如果都失敗，拋出詳細錯誤
    throw new Error(`無法從回應中提取 JSON。原始錯誤: ${e.message}\n完整回應: ${text.substring(0, 1000)}`);
  }
}

// =========================
//    PDF 上傳 + AI 分析
// =========================
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const pdfPath = req.file.path;
    // Fix encoding issue for non-ASCII filenames (Chinese characters, etc.)
    const originalFilename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    // 1. 計算文件 hash 檢測重複
    const fileHash = calculateFileHash(pdfPath);
    const existingContract = findContractByHash(fileHash);

    if (existingContract) {
      // 發現重複文件
      fs.unlinkSync(pdfPath); // 刪除臨時文件
      return res.json({
        success: true,
        duplicate: true,
        existing_contract: existingContract,
        message: "此合約已存在於系統中"
      });
    }

    // 2. 上傳 PDF 至 Files API
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
              text: `你是一個資深合約談判專家和法律顧問。請仔細分析這份合約文件，識別並分析所有重要的合約條款。

CRITICAL: 你必須只回傳純 JSON，不要包含任何其他文字、說明或 markdown 格式。

分析任務：

1. **基本資訊提取**：
   - 文件類型（合約/報價單）
   - 乙方公司名稱

2. **識別所有關鍵條款**：
   請找出合約中的所有重要條款，包括但不限於：
   - 付款條件 (Payment Terms)
   - 責任上限 (Liability Cap)
   - 合約總價 (Total Price)
   - 交付期限 (Delivery Terms)
   - 終止條款 (Termination Clause)
   - 智慧財產權 (IP Rights)
   - 保密條款 (Confidentiality)
   - 保固/維護 (Warranty/Maintenance)
   - 違約罰則 (Penalties)
   - 爭議解決 (Dispute Resolution)
   - 其他任何重要的商業條款

3. **每個條款的專業風險評估**：
   - clause_name: 條款名稱（例如：付款條件、責任上限等）
   - clause_icon: 適合的 emoji 圖示（例如：💰、⚖️、📅、🔒等）
   - raw_text: 原文摘錄
   - contract_value: 合約中的具體內容（簡潔描述）
   - reference_value: 行業標準或參考值（如適用）
   - status: "DISPUTE"（高風險，建議重新協商）/ "WARNING"（需注意）/ "OPPORTUNITY"（有利條款）/ "MATCH"（符合最佳實踐）/ "UNKNOWN"（無法判斷）
   - risk_score: 0-100 分（0=極高風險，100=無風險/有利）
   - message: 專業建議（50-150字，說明為什麼這個條款有利/不利，以及建議如何處理）

回傳格式（純 JSON）：
{
  "document_type": "合約",
  "seller_company": "公司名稱",
  "clauses": [
    {
      "clause_name": "付款條件",
      "clause_icon": "💰",
      "raw_text": "Net 30 days from invoice date",
      "contract_value": "Net 30 天",
      "reference_value": "一般建議 Net 45-60 天",
      "status": "DISPUTE",
      "risk_score": 40,
      "message": "付款期限 Net 30 天相對較短，可能對買方現金流造成壓力。建議協商延長至 Net 60 天，這是行業標準，可以提供更靈活的資金調度空間。"
    },
    {
      "clause_name": "責任上限",
      "clause_icon": "⚖️",
      "raw_text": "Seller's liability shall not exceed 100% of fees paid",
      "contract_value": "合約金額的 100%",
      "reference_value": "建議 150-200% 或 $2-3M",
      "status": "WARNING",
      "risk_score": 45,
      "message": "責任上限僅為合約金額的 100%，低於行業標準的 150-200%。如果發生重大問題，賠償可能不足以覆蓋實際損失。建議要求提高至至少 200% 或 $3M。"
    },
    {
      "clause_name": "合約總價",
      "clause_icon": "💵",
      "raw_text": "NT$52,500 元整（含稅）",
      "contract_value": "NT$52,500",
      "reference_value": "一般政府部門助理薪資範圍合理定價",
      "status": "MATCH",
      "risk_score": 100,
      "message": "價格在合理範圍內，與市場行情相符。合約含稅，條款清晰明確。"
    }
  ]
}

注意事項：
- 請識別並列出合約中的所有重要條款，不要遺漏任何關鍵內容
- 每個條款都必須包含風險評估和專業建議
- status 必須是: DISPUTE, WARNING, OPPORTUNITY, MATCH, UNKNOWN 之一
- risk_score 必須是 0-100 的整數
- message 要具體、專業、可執行
- clause_icon 請選擇合適的 emoji 來代表該條款類型
- 保持原始貨幣和單位，不要轉換
- 不要使用尾隨逗號
- 只回傳 JSON，不要 markdown code blocks`,
            },
            {
              type: "input_file",
              file_id: uploaded.id,
            },
          ],
        },
      ],
    });

    // 記錄原始回應以供調試
    console.log("OpenAI 原始回應:", response.output_text.substring(0, 500) + "...");

    // 使用強健的 JSON 提取函數，處理可能包含 markdown 或額外文字的回應
    let result;
    try {
      result = extractJSON(response.output_text);
      console.log("成功解析 JSON，提取的資料:", JSON.stringify(result, null, 2));
    } catch (parseError) {
      console.error("JSON 解析失敗:", parseError.message);
      console.error("完整回應:", response.output_text);
      return res.status(500).json({
        success: false,
        error: "AI 回應格式錯誤",
        details: parseError.message,
      });
    }

    const documentType = result.document_type;
    const sellerCompany = result.seller_company;

    if (documentType === "不確定" || !sellerCompany) {
      return res.json({
        success: false,
        message: "無法確定文件類型或找不到乙方公司名稱",
      });
    }

    // 3. 計算健康評分（基於所有條款的平均風險分數）
    const healthScore = calculateHealthScore(result.clauses || []);

    // 4. 用 Tavily 搜尋公司資料（使用 answer 功能獲取繁體中文回應）
    const companyProfile = await tavily.search({
      query: `關於「${sellerCompany}」的公司簡介、業務概況、公司背景。請用繁體中文回答。`,
      max_results: 3,
      include_answer: true,
    });

    const customsInfo = await tavily.search({
      query: `關於「${sellerCompany}」的海關進出口記錄、貿易數據、進出口業務。請用繁體中文回答。`,
      max_results: 3,
      include_answer: true,
    });

    const legalInfo = await tavily.search({
      query: `關於「${sellerCompany}」的法律合規狀況、訴訟記錄、法規遵循情況。請用繁體中文回答。`,
      max_results: 3,
      include_answer: true,
    });

    // Clean up uploaded file
    fs.unlinkSync(pdfPath);

    // 5. 保存合約分析結果到數據庫
    const contractId = crypto.randomBytes(16).toString('hex');
    const contractData = {
      contract_id: contractId,
      file_hash: fileHash,
      filename: originalFilename,
      upload_date: new Date().toISOString(),
      health_score: healthScore,
      document_type: documentType,
      seller_company: sellerCompany,
      contract_analysis: {
        clauses: result.clauses || []
      },
      raw_data: result,
      company_data: {
        profile: companyProfile,
        customs: customsInfo,
        legal: legalInfo,
      },
    };

    saveContract(contractData);

    // 返回完整分析結果
    res.json({
      contract_id: contractId,
      success: true,
      health_score: healthScore,
      document_type: documentType,
      seller_company: sellerCompany,
      contract_analysis: {
        clauses: result.clauses || []
      },
      raw_data: result,
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

// =========================
//    合約管理 API
// =========================

// 獲取所有合約列表
app.get("/contracts", (req, res) => {
  try {
    const contracts = getAllContracts();
    // 只返回列表需要的基本資訊
    const contractsList = contracts.map(c => ({
      contract_id: c.contract_id,
      filename: c.filename,
      seller_company: c.seller_company,
      health_score: c.health_score,
      upload_date: c.upload_date,
      document_type: c.document_type,
    }));
    res.json({ success: true, contracts: contractsList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 獲取特定合約詳情
app.get("/contracts/:id", (req, res) => {
  try {
    const contract = findContractById(req.params.id);
    if (!contract) {
      return res.status(404).json({ error: "合約不存在" });
    }
    res.json({ success: true, contract });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 替換現有合約
app.post("/contracts/:id/replace", upload.single("file"), async (req, res) => {
  try {
    const existingContract = findContractById(req.params.id);
    if (!existingContract) {
      return res.status(404).json({ error: "合約不存在" });
    }

    // 刪除舊合約，處理新文件（重用上傳邏輯）
    // 簡化：讓前端重新上傳即可，這裡主要是刪除舊記錄
    const contracts = getAllContracts();
    const filtered = contracts.filter(c => c.contract_id !== req.params.id);
    saveAllContracts(filtered);

    res.json({ success: true, message: "合約已刪除，請重新上傳" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 刪除合約
app.delete("/contracts/:id", (req, res) => {
  try {
    const contracts = getAllContracts();
    const filtered = contracts.filter(c => c.contract_id !== req.params.id);

    if (contracts.length === filtered.length) {
      return res.status(404).json({ error: "合約不存在" });
    }

    saveAllContracts(filtered);
    res.json({ success: true, message: "合約已刪除" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 啟動伺服器
app.listen(3000, () => console.log("Server running on port 3000"));