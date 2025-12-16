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
 * 計算健康評分（基於四個維度的多維度分析）
 *
 * 四個維度：
 * - MAD (生存風險指標): 0-100, 越高越危險, 最高權重
 * - MAO (互利營收指標): 0-100, 越高越好, 代表收益
 * - MAA (行政內耗指標): 0-100, 越高越差, 代表隱藏成本
 * - MAP (戰略潛力指標): 0-100, 越高越好, 代表長期價值
 *
 * 計算邏輯：
 * 1. 淨值 = MAO - MAA (收益減去內耗成本)
 * 2. 生存風險調整 (MAD >= 91 觸發熔斷機制)
 * 3. 戰略潛力加成 (MAP 提供長期價值加成)
 *
 * @param {Object} overallDimensions - 整體維度分數 { mad, mao, maa, map }
 * @returns {Object} { score: 健康評分 (0-100), dimensions: { mad, mao, maa, map } }
 */
function calculateHealthScore(overallDimensions) {
  // 預設值
  const dimensions = {
    mad: overallDimensions?.mad || 0,
    mao: overallDimensions?.mao || 50,
    maa: overallDimensions?.maa || 50,
    map: overallDimensions?.map || 0
  };

  const { mad, mao, maa, map } = dimensions;

  // 🔴 熔斷機制：MAD >= 91 (致命風險區)
  if (mad >= 91) {
    const fatalScore = Math.round(5 + (100 - mad)); // 0-14 分範圍
    return {
      score: fatalScore,
      dimensions: dimensions
    };
  }

  // 步驟 1: 計算淨營運價值 (MAO - MAA)
  // 代表扣除行政內耗後的實際收益
  const netValue = mao - maa; // 範圍: -100 到 100

  // 步驟 2: 標準化淨值到 0-100 區間
  const normalizedNet = (netValue + 100) / 2; // 範圍: 0 到 100

  // 步驟 3: 應用生存風險係數
  // MAD 越高，存活係數越低
  // MAD=0 (安全) -> 係數=1.0
  // MAD=50 (中度風險) -> 係數=0.5
  // MAD=90 (重傷) -> 係數=0.1
  const survivalMultiplier = (100 - mad) / 100;

  // 步驟 4: 計算基礎分數
  const baseScore = normalizedNet * survivalMultiplier;

  // 步驟 5: 應用戰略潛力加成
  // MAP 為長期關係提供價值加成（最高 20% 加成）
  // MAP=0 -> 無加成
  // MAP=50 -> 10% 加成
  // MAP=100 -> 20% 加成
  const strategicBonus = (map / 100) * baseScore * 0.2;

  // 步驟 6: 計算最終分數
  const finalScore = baseScore + strategicBonus;

  return {
    score: Math.round(Math.min(100, Math.max(0, finalScore))),
    dimensions: dimensions
  };
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
              text: `你是一個資深合約談判專家和法律顧問。請仔細分析這份合約文件，進行整體評估。

CRITICAL: 你必須只回傳純 JSON，不要包含任何其他文字、說明或 markdown 格式。

分析任務：

1. **基本資訊提取**：
   - 文件類型（合約/報價單）
   - 乙方公司名稱

2. **整體合約四維度評估**：

   請綜合評估整份合約，提供四個維度的整體分數和詳細說明：

   🔴 **MAD (生存風險指標)** - "這份合約會不會殺死公司？" (0-100，越高越危險)
   - 0-20 分 (綠區-安全): 標準商業條款，無重大風險
   - 21-60 分 (黃區-擦傷): 風險偏高需注意（如：付款期超過 120 天、匯率風險由我方全額承擔）
   - 61-90 分 (橘區-重傷): 嚴重損害利益（如：無償授權核心 IP、賠償無上限但有排除條款）
   - 91-100 分 (紅區-致命): 觸發熔斷（如：單方無條件解約權、無限連帶責任、放棄法律管轄權）

   🟢 **MAO (互利營收指標)** - "這份合約現在能賺多少？" (0-100，越高越好)
   - 0-20 分 (低標): 基本交易（如：市價採購、無折扣）
   - 21-60 分 (中標): 優於市場（如：價格低於市價 5%、付款期優於同業）
   - 61-80 分 (高標): 顯著獲利（如：獨家供應權、保證採購量、預付款機制）
   - 81-100 分 (頂標): 壟斷級優勢（如：取得對方專利免費授權、對方承擔所有物流與關稅成本）

   🟠 **MAA (行政內耗指標)** - "執行這份合約的成本？" (0-100，越高越差)
   - 0-20 分 (數位化/無感): API 自動對接、電子簽章、無需人工介入
   - 21-50 分 (標準行政): 每月一次月報、正常的驗收流程
   - 51-80 分 (官僚地獄): 需每週紙本查核、跨國實體會議、需養專人伺候對方視察
   - 81-100 分 (癱瘓級內耗): 逐筆訂單人工審批、極度複雜的合規證明（需數月準備）、朝令夕改的規格變更

   🚀 **MAP (戰略潛力與憲章指標)** - "以 MAO 為目標的長期原則框架" (0-100，越高越好)
   - 0 分 (無法執行): 缺乏基礎商業條款，無法開立訂單或建立供應商代碼
   - 1-40 分 (純交易里程碑): 能做生意。雙方已完成開戶審核，合約具備明確交付與付款條件
   - 41-70 分 (反覆常態交易): 穩定生意。合約架構支持重複性下單與常態化驗收
   - 71-100 分 (緊密合作夥伴): 共生生意。合約包含數據共享機制（API 對接/即時庫存可視）、強化合規性要求（符合 TGSA 憲章/ESG 標準）

3. **每個維度的詳細說明**：
   為每個維度提供 100-200 字的專業分析，說明為什麼給這個分數，引用合約中的具體條款作為依據。

4. **整體建議**：
   基於四個維度的綜合評估，提供 150-250 字的專業建議，包括：
   - 是否建議簽署此合約
   - 主要關注點和風險
   - 具體的改善建議或協商重點

回傳格式（純 JSON）：
{
  "document_type": "合約",
  "seller_company": "公司名稱",
  "dimensions": {
    "mad": 25,
    "mao": 55,
    "maa": 30,
    "map": 45
  },
  "dimension_explanations": {
    "mad": "本合約的生存風險屬於黃區（25分）。主要風險來自付款條件為 Net 30 天，略短於行業標準的 Net 60 天，可能對現金流造成壓力。責任上限設定為合約金額的 100%，低於建議的 150-200%。但合約未包含致命條款如無限連帶責任或放棄管轄權，因此整體風險可控。",
    "mao": "本合約的營收指標屬於中標（55分）。合約總價 NT$52,500 符合市場行情，定價合理。付款條件雖然較緊但仍在可接受範圍。未包含獨家供應、保證採購量等高價值條款，但也沒有明顯不利的價格條款，屬於標準商業交易。",
    "maa": "本合約的行政內耗屬於標準行政（30分）。合約條款清晰明確，未要求複雜的合規證明或頻繁的人工審批。預期需要正常的驗收流程和月報，人力成本在可控範圍內。未見需要專人伺候或跨國實體會議等高內耗要求。",
    "map": "本合約的戰略潛力屬於純交易里程碑（45分）。合約具備基本的商業條款框架，包含明確的交付條件和付款方式，可以建立供應商關係並開展業務。但未包含支持重複性下單的架構、數據共享機制或 ESG 合規要求，不具備發展為長期戰略夥伴的基礎。"
  },
  "overall_recommendation": "綜合評估：本合約屬於可接受的標準商業合約（健康評分 65 分）。生存風險處於可控範圍，無致命條款，但建議在簽署前協商以下事項：1) 爭取將付款期限從 Net 30 延長至 Net 60 天，改善現金流壓力；2) 要求提高責任上限至合約金額的 150-200%，增加保障。營收條件符合市場標準，行政成本可控。若能成功協商上述兩點，建議簽署。此為短期交易型合約，不建議作為長期戰略合作夥伴。"
}

注意事項：
- dimensions 必須包含四個整數分數（mad, mao, maa, map），代表整份合約的綜合評估
- dimension_explanations 必須包含四個詳細說明，每個 100-200 字
- overall_recommendation 必須包含具體的行動建議，150-250 字
- 說明要具體、專業、引用合約中的實際條款
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

    // 3. 計算健康評分（基於四個維度的多維度分析）
    const healthScoreResult = calculateHealthScore(result.dimensions);
    const healthScore = healthScoreResult.score;
    const healthDimensions = healthScoreResult.dimensions;
    const dimensionExplanations = result.dimension_explanations || {};
    const overallRecommendation = result.overall_recommendation || '';

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

    // 5. 搜尋公司負責人資訊
    const responsiblePersonInfo = await tavily.search({
      query: `「${sellerCompany}」的公司負責人是誰？董事長、總經理、代表人姓名。請用繁體中文回答。`,
      max_results: 3,
      include_answer: true,
    });

    const responsiblePersonLegal = await tavily.search({
      query: `「${sellerCompany}」公司負責人的法律問題、訴訟記錄、違法紀錄、司法案件。請用繁體中文回答。`,
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
      health_dimensions: healthDimensions,
      dimension_explanations: dimensionExplanations,
      overall_recommendation: overallRecommendation,
      document_type: documentType,
      seller_company: sellerCompany,
      raw_data: result,
      company_data: {
        profile: companyProfile,
        customs: customsInfo,
        legal: legalInfo,
        responsible_person: responsiblePersonInfo,
        responsible_person_legal: responsiblePersonLegal,
      },
    };

    saveContract(contractData);

    // 返回完整分析結果
    res.json({
      contract_id: contractId,
      success: true,
      health_score: healthScore,
      health_dimensions: healthDimensions,
      dimension_explanations: dimensionExplanations,
      overall_recommendation: overallRecommendation,
      document_type: documentType,
      seller_company: sellerCompany,
      raw_data: result,
      company_data: {
        profile: companyProfile,
        customs: customsInfo,
        legal: legalInfo,
        responsible_person: responsiblePersonInfo,
        responsible_person_legal: responsiblePersonLegal,
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