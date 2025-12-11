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
//    合約分析輔助函數
// =========================

/**
 * 分析付款條件
 * @param {Object} paymentTerms - AI 提取的付款條件
 * @param {number} targetNetDays - 目標付款天數
 * @returns {Object} 分析結果
 */
function analyzePaymentTerms(paymentTerms, targetNetDays) {
  if (!paymentTerms || !paymentTerms.net_days) {
    return {
      status: "UNKNOWN",
      message: "無法提取付款條件",
      raw_text: null,
      contract_value: null,
      target_value: `Net ${targetNetDays} days`,
      risk_score: 50, // 中性分數
    };
  }

  const contractDays = paymentTerms.net_days;
  const difference = targetNetDays - contractDays;

  let status, message, riskScore;

  if (contractDays === targetNetDays) {
    status = "MATCH";
    message = "付款條件符合目標";
    riskScore = 100;
  } else if (contractDays < targetNetDays) {
    status = "DISPUTE";
    message = `付款期限較短 ${difference} 天，現金流壓力較大`;
    riskScore = Math.max(0, 100 - Math.abs(difference) * 2);
  } else {
    status = "OPPORTUNITY";
    message = `付款期限較長 ${Math.abs(difference)} 天，有利於現金流`;
    riskScore = 100;
  }

  return {
    status,
    message,
    raw_text: paymentTerms.raw_text,
    contract_value: `Net ${contractDays} days`,
    target_value: `Net ${targetNetDays} days`,
    difference_days: difference,
    risk_score: riskScore,
  };
}

/**
 * 分析責任上限
 * @param {Object} liabilityCap - AI 提取的責任上限
 * @param {Object} totalPrice - 合約總價
 * @param {number} standardMultiplier - 標準倍數（如 2.0 代表 200%）
 * @returns {Object} 分析結果
 */
function analyzeLiabilityCap(liabilityCap, totalPrice, standardMultiplier) {
  if (!liabilityCap || !liabilityCap.amount_million) {
    return {
      status: "UNKNOWN",
      message: "無法提取責任上限",
      raw_text: null,
      contract_value: null,
      standard_value: null,
      risk_score: 50,
    };
  }

  const capAmount = liabilityCap.amount_million;
  const contractPrice = totalPrice?.amount_million || 1.15; // 預設值
  const standardCap = Math.max(contractPrice * standardMultiplier, 3.0); // 至少 $3M

  let status, message, riskScore;

  const capPercentage = (capAmount / contractPrice) * 100;

  if (capAmount >= standardCap) {
    status = "MATCH";
    message = "責任上限符合標準";
    riskScore = 100;
  } else if (capAmount >= contractPrice) {
    status = "WARNING";
    message = `責任上限僅為合約金額的 ${capPercentage.toFixed(
      0
    )}%，低於標準 ${standardMultiplier * 100}% 或 $3M`;
    riskScore = Math.max(30, (capAmount / standardCap) * 100);
  } else {
    status = "DISPUTE";
    message = `責任上限過低（${capPercentage.toFixed(
      0
    )}% 合約金額），風險極高`;
    riskScore = Math.max(0, (capAmount / standardCap) * 100);
  }

  return {
    status,
    message,
    raw_text: liabilityCap.raw_text,
    contract_value: `$${capAmount}M (${capPercentage.toFixed(0)}% of fees)`,
    standard_value: `$${standardCap}M or ${standardMultiplier * 100}%`,
    cap_amount_million: capAmount,
    standard_amount_million: standardCap,
    risk_score: riskScore,
  };
}

/**
 * 分析總價
 * @param {Object} totalPrice - AI 提取的總價
 * @param {number} targetPrice - 目標價格（百萬美元）
 * @returns {Object} 分析結果
 */
function analyzeTotalPrice(totalPrice, targetPrice) {
  if (!totalPrice || !totalPrice.amount_million) {
    return {
      status: "UNKNOWN",
      message: "無法提取合約總價",
      raw_text: null,
      contract_value: null,
      target_value: `$${targetPrice}M`,
      risk_score: 50,
    };
  }

  const contractPrice = totalPrice.amount_million;
  const difference = targetPrice - contractPrice;
  const percentageDiff = ((difference / targetPrice) * 100).toFixed(1);

  let status, message, riskScore;

  if (Math.abs(difference) < 0.01) {
    // 差異小於 $10K
    status = "MATCH";
    message = "價格符合目標";
    riskScore = 100;
  } else if (contractPrice < targetPrice) {
    status = "OPPORTUNITY";
    message = `價格低於目標 ${percentageDiff}%，具成本優勢`;
    riskScore = 100;
  } else {
    status = "WARNING";
    message = `價格高於目標 ${Math.abs(percentageDiff)}%`;
    riskScore = Math.max(0, 100 - Math.abs(parseFloat(percentageDiff)));
  }

  return {
    status,
    message,
    raw_text: totalPrice.raw_text,
    contract_value: `$${contractPrice}M`,
    target_value: `$${targetPrice}M`,
    difference_million: difference,
    percentage_difference: percentageDiff,
    risk_score: riskScore,
  };
}

/**
 * 計算健康評分
 * @param {Array} analyses - 各項分析結果
 * @returns {number} 健康評分 (0-100)
 */
function calculateHealthScore(analyses) {
  const validAnalyses = analyses.filter((a) => a && a.risk_score !== undefined);

  if (validAnalyses.length === 0) return 50;

  const totalScore = validAnalyses.reduce((sum, a) => sum + a.risk_score, 0);
  const avgScore = totalScore / validAnalyses.length;

  return Math.round(avgScore);
}

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
你是一個專業合約分析系統。請仔細分析這份合約文件，並提取以下關鍵資訊：

任務：

1. **文件類型**：判斷這份文件是 "合約" 還是 "報價單"。若無法判斷請回答 "不確定"。

2. **乙方公司名稱**：從合約中找出賣方/供應商/乙方的公司名稱。

3. **付款條件 (Payment Terms)**：
   - 提取付款天數，例如 "Net 30 days", "Net 60 days", "Net 45 days" 等
   - 如果是百分比付款，請提取百分比和時間點
   - 若找不到，回答 null

4. **責任上限 (Liability Cap)**：
   - 提取賠償責任或損害賠償的上限金額
   - 可能以固定金額（如 "$1.5M", "$3M"）或百分比形式（如 "100% of fees", "200% of contract value"）表示
   - 若找不到，回答 null

5. **總價 (Total Price)**：
   - 提取合約總金額
   - 以美元金額表示（如 "$1.08M", "$1,080,000"）
   - 若找不到，回答 null

6. **保固期限 (Warranty Period)**：
   - 提取保固或維護期限（如 "1 Year", "2 Years", "3 Years"）
   - 若找不到，回答 null

請用以下 JSON 格式回覆（所有金額請統一使用百萬美元格式，如 1.08 代表 $1.08M）：
{
  "document_type": "",
  "seller_company": "",
  "payment_terms": {
    "raw_text": "",
    "net_days": 0
  },
  "liability_cap": {
    "raw_text": "",
    "amount_million": 0,
    "type": "fixed_amount or percentage"
  },
  "total_price": {
    "raw_text": "",
    "amount_million": 0
  },
  "warranty_period": {
    "raw_text": "",
    "years": 0
  }
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

    // 3. 合約條款分析 - 設定目標值（可從前端傳入，這裡先用預設值）
    const targets = {
      payment_net_days: 60, // Net 60 天
      warranty_years: 3, // 3 年保固
      target_price_million: 1.08, // 目標價格 $1.08M
      liability_cap_standard: 2.0, // 標準為合約價值的 200% 或 $3M
    };

    // 分析付款條件 (Payment Terms)
    const paymentAnalysis = analyzePaymentTerms(
      result.payment_terms,
      targets.payment_net_days
    );

    // 分析責任上限 (Liability Cap)
    const liabilityAnalysis = analyzeLiabilityCap(
      result.liability_cap,
      result.total_price,
      targets.liability_cap_standard
    );

    // 分析總價 (Total Price)
    const priceAnalysis = analyzeTotalPrice(
      result.total_price,
      targets.target_price_million
    );

    // 計算健康評分 (Health Score)
    const healthScore = calculateHealthScore([
      paymentAnalysis,
      liabilityAnalysis,
      priceAnalysis,
    ]);

    // 4. 用 Tavily 搜尋公司資料（保留原有功能）
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

    // 返回完整分析結果
    res.json({
      success: true,
      health_score: healthScore,
      document_type: documentType,
      seller_company: sellerCompany,
      contract_analysis: {
        payment_terms: paymentAnalysis,
        liability_cap: liabilityAnalysis,
        total_price: priceAnalysis,
        warranty: result.warranty_period,
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

// 啟動伺服器
app.listen(3000, () => console.log("Server running on port 3000"));