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
 * 計算合約健康評分 (Safety-First Weighted Scoring)
 *
 * 這個函數使用 M.A.X. 的四維度模型來評估合約的整體健康度：
 *
 * 四個維度：
 * - MAD (Mutually Assured Destruction - 生存風險指標): 0-100, 越高越危險
 * - MAO (Mutual Advantage Optimization - 互利營收指標): 0-100, 越高越好
 * - MAA (Mutual Assured Attrition - 互相保證消耗): 0-100, 越高代表綁定越深/越穩定
 * - MAP (Mutual Assured Potential - 戰略潛力指標): 0-100, 越高越好
 *
 * Safety-First Weighted Scoring 公式：
 * 總分 = [(100 - MAD) × 60%] + [(MAO + MAA + MAP)/3 × 40%]
 *
 * 我們將分為兩個部分：
 * - 安全性得分 (Safety Score): (100 - MAD) × 60% - 佔 60% 權重
 * - 價值性得分 (Value Score): (MAO + MAA + MAP)/3 × 40% - 佔 40% 權重
 *
 * 熔斷機制：
 * - 若 MAD > 35: 總分強制不得超過 59 分（不及格）
 *
 * 等級劃分：
 * - S 級 (90-100): 完美合約 - MAD<5, Value>85
 * - A 級 (80-89): 高價值合約
 * - B 級 (70-79): 穩健合約
 * - C 級 (60-69): 雞肋合約 - 需要交換條款
 * - D 級 (<60): 劇毒合約 - 系統鎖死，禁止簽核
 *
 * @param {Object} overallDimensions - 整體維度分數 { mad, mao, maa, map }
 * @returns {Object} { score: 健康評分 (0-100), dimensions: { mad, mao, maa, map }, tier: 等級 }
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

  // 計算安全性得分 (Safety Score) - 60% 權重
  const safetyScore = (100 - mad) * 0.6;

  // 計算價值性得分 (Value Score) - 40% 權重
  // 取 MAO、MAA、MAP 的平均值
  const valueAverage = (mao + maa + map) / 3;
  const valueScore = valueAverage * 0.4;

  // 計算原始總分
  let rawScore = safetyScore + valueScore;

  // 🔴 熔斷機制：MAD > 35 (風險過高區)
  // 只要生存風險超過 35 分，無論利潤多高，總分強制不得超過 59 分（不及格）
  if (mad > 35) {
    rawScore = Math.min(rawScore, 59);
    console.log(`⚠️ 風險熔斷觸發！MAD = ${mad} > 35，健康評分上限鎖定為 59 分`);
  }

  // 限制在 0-100 範圍內
  const finalScore = Math.round(Math.min(100, Math.max(0, rawScore)));

  // 判斷等級
  let tier = 'D';
  let tierLabel = '淘汰';
  if (finalScore >= 90) {
    tier = 'S';
    tierLabel = '王者';
  } else if (finalScore >= 80) {
    tier = 'A';
    tierLabel = '優質';
  } else if (finalScore >= 70) {
    tier = 'B';
    tierLabel = '標準';
  } else if (finalScore >= 60) {
    tier = 'C';
    tierLabel = '觀察';
  }

  console.log(`計算詳情: 安全分(${safetyScore.toFixed(1)}) + 價值分(${valueScore.toFixed(1)}) = ${finalScore} 分 [${tier}級-${tierLabel}]`);

  return {
    score: finalScore,
    dimensions: dimensions,
    tier: tier,
    tierLabel: tierLabel,
    breakdown: {
      safetyScore: Math.round(safetyScore * 10) / 10,
      valueScore: Math.round(valueScore * 10) / 10
    }
  };
}

/**
 * 修復常見的 JSON 格式問題（增強版）
 * @param {string} jsonStr - JSON 字串
 * @returns {string} 修復後的 JSON 字串
 */
function fixCommonJSONIssues(jsonStr) {
  let fixed = jsonStr;

  // 移除 JSON 中的註解（// 和 /* */）
  fixed = fixed.replace(/\/\/.*$/gm, "");
  fixed = fixed.replace(/\/\*[\s\S]*?\*\//g, "");

  // 移除尾隨逗號（trailing commas）- 多次運行以處理嵌套情況
  for (let i = 0; i < 3; i++) {
    fixed = fixed.replace(/,(\s*[}\]])/g, "$1");
  }

  return fixed;
}

/**
 * 嘗試修復 OpenAI 常見的 JSON 結構錯誤
 * 特別處理 overall_recommendation 被錯誤嵌套在 dimension_explanations 中的情況
 * @param {string} jsonStr - 可能有結構問題的 JSON 字串
 * @returns {string} 修復後的 JSON 字串
 */
function fixJSONStructure(jsonStr) {
  // 檢測 overall_recommendation 是否緊跟在 "map" 後面（說明嵌套錯誤）
  const overallRecommendationIndex = jsonStr.indexOf('"overall_recommendation"');

  if (overallRecommendationIndex === -1) {
    return jsonStr; // 沒有找到 overall_recommendation，不需要修復
  }

  // 查找 overall_recommendation 之前最後一個 "map" 的位置
  const mapIndex = jsonStr.lastIndexOf('"map"', overallRecommendationIndex);

  if (mapIndex === -1) {
    return jsonStr; // 沒有找到 map，不需要修復
  }

  // 檢查 map 和 overall_recommendation 之間是否缺少 dimension_explanations 的閉合括號
  const betweenText = jsonStr.substring(mapIndex, overallRecommendationIndex);

  // 如果兩者之間只有一個引號結束、逗號和空白，說明結構有問題
  if (betweenText.match(/"[^"]*",\s*$/) && !betweenText.includes('},')) {
    console.log("檢測到 overall_recommendation 嵌套錯誤，正在修復...");

    // 在 overall_recommendation 之前插入缺少的閉合括號
    // 找到 overall_recommendation 前面的逗號
    const commaBeforeOverall = jsonStr.lastIndexOf(',', overallRecommendationIndex);

    if (commaBeforeOverall > mapIndex) {
      // 在逗號之後、overall_recommendation 之前插入 }\n
      const before = jsonStr.substring(0, commaBeforeOverall);
      const after = jsonStr.substring(commaBeforeOverall);

      // 移除那個多餘的逗號，並插入閉合括號
      jsonStr = before + '\n  },\n  ' + after.substring(1).trim();
    }
  }

  return jsonStr;
}

/**
 * 從 OpenAI 回應中提取 JSON（增強版，支援結構修復）
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
          let fixed = fixJSONStructure(jsonMatch[1]);
          fixed = fixCommonJSONIssues(fixed);
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
        // 嘗試修復結構和常見問題後再解析
        try {
          let fixed = fixJSONStructure(jsonStr);
          fixed = fixCommonJSONIssues(fixed);
          console.log("修復後的 JSON:", fixed.substring(0, 200) + "...");
          return JSON.parse(fixed);
        } catch (e3) {
          console.error("修復後仍失敗:", e3.message);
          console.error("嘗試的修復 JSON:", fixed.substring(0, 1000));
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

    // ========================================
    // 階段 1: 快速提取公司名稱
    // ========================================
    console.log("階段 1: 提取基本資訊...");
    const basicInfoResponse = await openai.responses.create({
      model: "gpt-5.2",
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `請快速分析這份PDF文件，只提取以下基本資訊：

1. 文件類型（合約/報價單）
2. 乙方公司名稱（對方公司的完整名稱）

CRITICAL: 只回傳 JSON 格式，不要其他文字：
{
  "document_type": "合約",
  "seller_company": "公司名稱"
}`,
            },
            {
              type: "input_file",
              file_id: uploaded.id,
            },
          ],
        },
      ],
    });

    let basicInfo;
    try {
      basicInfo = extractJSON(basicInfoResponse.output_text);
      console.log("基本資訊:", basicInfo);
    } catch (e) {
      console.error("無法提取基本資訊:", e);
      fs.unlinkSync(pdfPath);
      return res.status(500).json({
        success: false,
        error: "無法提取合約基本資訊"
      });
    }

    const documentType = basicInfo.document_type;
    const sellerCompany = basicInfo.seller_company;

    if (!sellerCompany || sellerCompany === "未知") {
      fs.unlinkSync(pdfPath);
      return res.json({
        success: false,
        message: "無法確定乙方公司名稱"
      });
    }

    // ========================================
    // 階段 2: Tavily 背景調查
    // ========================================
    console.log(`階段 2: 對「${sellerCompany}」進行背景調查...`);

    const [companyProfile, customsInfo, legalInfo, responsiblePersonInfo, responsiblePersonLegal] = await Promise.all([
      tavily.search({
        query: `關於「${sellerCompany}」的公司簡介。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `關於「${sellerCompany}」的海關進出口記錄、貿易數據、進出口業務。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `關於「${sellerCompany}」的法律合規狀況、訴訟記錄、破產紀錄、詐欺前科、法規遵循。如果沒有相關公司記錄，請堅決說無記錄，避免發生錯誤信息引起法律糾紛。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `「${sellerCompany}」的公司負責人是誰？董事長、總經理、代表人姓名。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `「${sellerCompany}」公司負責人的法律問題、訴訟記錄、違法紀錄、司法案件、限制出境、欠稅。如果沒有相關公司記錄，請堅決說無記錄，避免發生錯誤信息引起法律糾紛。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      })
    ]);

    const companyData = {
      profile: companyProfile,
      customs: customsInfo,
      legal: legalInfo,
      responsible_person: responsiblePersonInfo,
      responsible_person_legal: responsiblePersonLegal,
    };

    console.log("背景調查完成，準備傳遞給 OpenAI 進行評估...");

    // ========================================
    // 階段 3: 完整合約評分（包含背景調查結果）
    // ========================================
    console.log("階段 3: 進行完整合約評分...");

    const backgroundContext = `
## 公司背景調查結果

**公司名稱**: ${sellerCompany}

**公司簡介**: ${companyProfile.answer || '未找到相關資訊'}

**海關進出口記錄**: ${customsInfo.answer || '未找到相關資訊'}

**法律合規狀況**: ${legalInfo.answer || '未找到相關資訊'}

**公司負責人**: ${responsiblePersonInfo.answer || '未找到相關資訊'}

**負責人法律狀況**: ${responsiblePersonLegal.answer || '未找到相關資訊'}

**重要提示**:
請仔細審查上述背景調查結果，特別注意：
- 如發現破產記錄、詐欺前科、負責人限制出境或欠稅大戶等致命風險，MAD 應直接給 90+ 分觸發熔斷
- 如發現勞資糾紛、民事訴訟等警告級別風險，請在 MAD 評分時適度考慮
- 注意區分否定表述（如"無限制出境"表示安全）和實際風險（"限制出境"表示危險）
- 5年以上的舊案可視為背景雜訊，僅輕微調整 MAD 分數
`;

    // 3. 呼叫 Responses API 進行完整評分 (with JSON mode enforced)
    const response = await openai.responses.create({
      model: "gpt-5.2",
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `你是一個資深合約談判專家和法律顧問。請仔細分析這份合約文件，進行整體評估。

${backgroundContext}

CRITICAL:
你必須只回傳「純 JSON」，不得包含任何其他文字、說明、標題或 markdown 格式。
不得在 JSON 之外輸出任何內容，否則視為系統錯誤。

你的角色：
你是一名「深度合約談判專家與法律顧問 Agent」，任務不是評論合約，而是依照以下【不可違反的演算法規則】進行評分。
你的評分必須可回測、可重現，且與商業決策一致。

────────────────────
【總體評估任務】
────────────────────

你必須對整份合約進行四個維度的整體評分，並提供每一維度的專業解釋：

1 MAD — 生存風險指標（唯一扣分項）
2 MAO — 互利營收指標
3 MAA — 互相保證消耗／承諾深度（正向指標）
4 MAP — 戰略潛力與憲章指標

────────────────────
【MAD：生存風險指標（0–100，越高越危險）】
核心問題：「這份合約會不會殺死公司？」

⚠️ MAD 是唯一的風險扣分項，不得因 MAO、MAA、MAP 高分而抵銷致命風險。

【風險分層過濾（強制規則）】

🔴 致命傷（直接 100 分，觸發熔斷，不可被抵銷）：
- 破產紀錄
- 詐欺前科
- 負責人限制出境
- 欠稅大戶
→ 命中任一項，MAD 必須 = 100

🟡 背景雜訊（僅可扣 5–10 分，不得擴大解讀）：
- 5 年前的勞資糾紛
- 單純商業民事訴訟（非被告或金額小）
→ 若合約最終仍被簽署，代表此為可接受雜訊，模型必須忽略放大解讀

【IP 權利灰階評分（強制套用）】
- IP 完全歸我方／乙方：MAD +0
- IP 共有／另案協議：約定但不確定：MAD +5～10
- IP 完全歸對方：MAD +60～80（重傷，原則上不建議簽）

【司法管轄權（V3.1 規則）】
- 我方所在地法院：MAD +0
- 對方所在地法院，且對方為付費者：MAD +0（僅提醒，不扣分）
- 國內異地（非雙方所在地）：不得算入 MAD
- 海外／第三地法院：MAD +40（司法阻斷，高風險）

────────────────────
【MAO：互利營收指標（0–100，越高越好）】
核心問題：「這份合約現在能為公司創造多少實質收益？」

- 0–20：基本交易（市價、無優勢）
- 21–60：優於市場（價格、付款期、穩定性）
- 61–80：顯著獲利（獨家、保證量、預付款、槓桿效應）
- 81–100：壟斷級優勢（免費 IP、對方承擔成本、高度槓桿）

可評估「以小博大」、「成功報酬」、「資金槓桿」等設計。

────────────────────
【MAA：互相保證消耗／承諾深度（0–100，正向指標）】
核心問題：「雙方為這段關係押了多少不可撤銷的資源？」

⚠️ MAA 是加分項，不得因行政流程或人工操作而扣分。

- 0–20 流動式交易：無低消、無訂金、隨用隨棄
- 21–50 預約制維護：訂金、預付款、定期會議、指定窗口
- 51–80 硬性鎖定：保證採購、沈沒成本、高額解約金、利潤綁定
- 81–100 共生／排他：獨家條款、股權互持、核心命脈託管

評估重點是「財務鎖定、時間承諾、成效綁定」，而非麻不麻煩。

────────────────────
【MAP：戰略潛力與憲章指標（0–100，越高越好）】
核心問題：「這份合約是否成為公司未來的跳板？」

⚠️ 標準行政作業（人工驗收、文件審查、例行會議）= 0 分（綠區）
不得因『非數位化』或『有人工作業』而扣分。

- 0 分：無法執行（無法開單、無法履約）
- 1–20：純交易里程碑（能做生意）
- 21–50：功能性賦能
  - 資質取得（ISO、專利、合規）
  - 效率提升（外包非核心）
  - 履歷背書（案例、Portfolio）
- 51–80：戰略槓桿
  - 政府／政策資源
  - 金融槓桿（補助、授信、估值）
  - 知識轉移、風險共擔（Success Fee）
- 81–100：生態系共生
  - 獨家／排他
  - 憲章高度對齊、深度資料共享
  - 世界級品牌光環
  - 建立競爭門檻


⚠️ 嚴禁：
- 使用模糊語言
- 將行政成本誤判為風險
- 將背景雜訊誤判為致命傷
- 在 JSON 外輸出任何內容
────────────────────
【輸出格式（嚴格遵守）】

{
  "dimensions": {
    "mad": 0-100,
    "mao": 0-100,
    "maa": 0-100,
    "map": 0-100
  },
  "dimension_explanations": {
    "mad": "100–200 字，引用具體條款，說明風險是否為致命或雜訊",
    "mao": "100–200 字，說明營收結構與槓桿",
    "maa": "100–200 字，說明雙方承諾與鎖定程度",
    "map": "100–200 字，說明是否構成跳板或戰略資產"
  },
  "overall_recommendation": "150–250 字，明確給出是否建議簽署、風險邊界、談判優化點"
}`,
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
    console.log("OpenAI 完整回應結構:", JSON.stringify(response, null, 2));
    console.log("OpenAI 原始回應:", response.output_text ? response.output_text.substring(0, 500) + "..." : "無 output_text");

    // 使用強健的 JSON 提取函數，處理可能包含 markdown 或額外文字的回應
    let result;
    try {
      if (!response.output_text) {
        throw new Error("回應中沒有 output_text 欄位");
      }
      result = extractJSON(response.output_text);
      console.log("成功解析 JSON，提取的資料:", JSON.stringify(result, null, 2));
    } catch (parseError) {
      console.error("JSON 解析失敗:", parseError.message);
      console.error("完整回應:", response.output_text || "無回應內容");
      console.error("回應物件:", JSON.stringify(response, null, 2));
      return res.status(500).json({
        success: false,
        error: "AI 回應格式錯誤",
        details: parseError.message,
        response_structure: Object.keys(response),
      });
    }

    // Validate dimensions object
    if (!result.dimensions || typeof result.dimensions !== 'object') {
      console.error("維度資料缺失或格式錯誤:", result.dimensions);
      return res.status(500).json({
        success: false,
        error: "AI 回應缺少維度評估資料",
        details: "dimensions 欄位缺失或格式不正確",
      });
    }

    // Ensure all dimension scores are valid numbers
    const requiredDimensions = ['mad', 'mao', 'maa', 'map'];
    for (const dim of requiredDimensions) {
      if (typeof result.dimensions[dim] !== 'number' ||
          isNaN(result.dimensions[dim]) ||
          result.dimensions[dim] < 0 ||
          result.dimensions[dim] > 100) {
        console.error(`維度 ${dim} 的值無效:`, result.dimensions[dim]);
        return res.status(500).json({
          success: false,
          error: "AI 回應的維度評分無效",
          details: `${dim} 的值必須是 0-100 之間的數字`,
        });
      }
    }

    // ========================================
    // 階段 4: 計算健康評分並保存結果
    // ========================================
    const healthScoreResult = calculateHealthScore(result.dimensions);
    const healthScore = healthScoreResult.score;
    const healthDimensions = healthScoreResult.dimensions;
    const healthTier = healthScoreResult.tier;
    const healthTierLabel = healthScoreResult.tierLabel;
    const scoreBreakdown = healthScoreResult.breakdown;
    const dimensionExplanations = result.dimension_explanations || {};
    const overallRecommendation = result.overall_recommendation || '';

    // Clean up uploaded file
    fs.unlinkSync(pdfPath);

    // 保存合約分析結果到數據庫
    const contractId = crypto.randomBytes(16).toString('hex');
    const savedContractData = {
      contract_id: contractId,
      file_hash: fileHash,
      file_id: uploaded.id,  // 保存 OpenAI file_id 供後續重新評估使用
      filename: originalFilename,
      upload_date: new Date().toISOString(),
      health_score: healthScore,
      health_tier: healthTier,
      health_tier_label: healthTierLabel,
      score_breakdown: scoreBreakdown,
      health_dimensions: healthDimensions,
      dimension_explanations: dimensionExplanations,
      overall_recommendation: overallRecommendation,
      document_type: documentType,
      seller_company: sellerCompany,
      raw_data: result,
      company_data: companyData, // Tavily 背景調查原始結果
    };

    saveContract(savedContractData);

    console.log(`✅ 合約分析完成！ID: ${contractId}, 健康評分: ${healthScore} 分 [${healthTier}級-${healthTierLabel}]`);

    // 返回完整分析結果
    res.json({
      contract_id: contractId,
      success: true,
      health_score: healthScore,
      health_tier: healthTier,
      health_tier_label: healthTierLabel,
      score_breakdown: scoreBreakdown,
      health_dimensions: healthDimensions,
      dimension_explanations: dimensionExplanations,
      overall_recommendation: overallRecommendation,
      document_type: documentType,
      seller_company: sellerCompany,
      raw_data: result,
      company_data: companyData, // Tavily 背景調查原始結果
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
      health_tier: c.health_tier,
      health_tier_label: c.health_tier_label,
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

// 更新公司名稱並重新評估合約
app.put("/contracts/:id/update-company", express.json(), async (req, res) => {
  try {
    const contractId = req.params.id;
    const { new_company_name } = req.body;

    if (!new_company_name || new_company_name.trim() === "") {
      return res.status(400).json({ error: "公司名稱不能為空" });
    }

    const existingContract = findContractById(contractId);
    if (!existingContract) {
      return res.status(404).json({ error: "合約不存在" });
    }

    console.log(`\n🔄 更新合約 ${contractId} 的公司名稱: ${existingContract.seller_company} → ${new_company_name}`);

    // ========================================
    // 階段 1: Tavily 背景調查（使用新公司名稱）
    // ========================================
    console.log(`階段 1: 對「${new_company_name}」進行背景調查...`);

    const [companyProfile, customsInfo, legalInfo, responsiblePersonInfo, responsiblePersonLegal] = await Promise.all([
      tavily.search({
        query: `關於「${sellerCompany}」的公司簡介。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `關於「${new_company_name}」的海關進出口記錄、貿易數據、進出口業務。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `關於「${new_company_name}」的法律合規狀況、訴訟記錄、破產紀錄、詐欺前科、法規遵循。如果沒有相關公司記錄，請堅決說無記錄，避免發生錯誤信息引起法律糾紛。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `「${new_company_name}」的公司負責人是誰？董事長、總經理、代表人姓名。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      }),
      tavily.search({
        query: `「${new_company_name}」公司負責人的法律問題、訴訟記錄、違法紀錄、司法案件、限制出境、欠稅。如果沒有相關公司記錄，請堅決說無記錄，避免發生錯誤信息引起法律糾紛。請用繁體中文回答。`,
        max_results: 3,
        include_answer: true,
      })
    ]);

    const companyData = {
      profile: companyProfile,
      customs: customsInfo,
      legal: legalInfo,
      responsible_person: responsiblePersonInfo,
      responsible_person_legal: responsiblePersonLegal
    };

    // ========================================
    // 階段 2: 重新評估合約維度（使用新公司背景）
    // ========================================
    console.log("階段 2: 使用新公司背景重新評估合約...");

    // 檢查是否有保存的 file_id
    if (!existingContract.file_id) {
      // 舊合約沒有 file_id，無法重新分析，僅更新公司背景
      console.warn("警告: 此合約沒有保存 file_id，無法重新分析維度。僅更新背景調查資料。");

      const healthScoreResult = calculateHealthScore(existingContract.health_dimensions);
      const updatedContract = {
        ...existingContract,
        seller_company: new_company_name,
        company_data: companyData,
        health_score: healthScoreResult.score,
        health_tier: healthScoreResult.tier,
        health_tier_label: healthScoreResult.tierLabel,
        score_breakdown: healthScoreResult.breakdown,
        last_updated: new Date().toISOString(),
      };

      saveContract(updatedContract);

      return res.json({
        success: true,
        message: "公司名稱已更新，背景調查已重新執行（維度評分未改變，因為舊合約缺少文件資料）",
        contract: updatedContract
      });
    }

    // 構建新的背景調查上下文
    const backgroundContext = `
────────────────────
【背景調查結果】
────────────────────
你已經針對「${new_company_name}」進行了深入的背景調查，結果如下：

**公司簡介**: ${companyProfile.answer || '未找到相關資訊'}

**海關進出口記錄**: ${customsInfo.answer || '未找到相關資訊'}

**法律合規狀況**: ${legalInfo.answer || '未找到相關資訊'}

**公司負責人**: ${responsiblePersonInfo.answer || '未找到相關資訊'}

**負責人法律狀況**: ${responsiblePersonLegal.answer || '未找到相關資訊'}

**重要提示**:
請仔細審查上述背景調查結果，特別注意：
- 如發現破產記錄、詐欺前科、負責人限制出境或欠稅大戶等致命風險，MAD 應直接給 90+ 分觸發熔斷
- 如發現勞資糾紛、民事訴訟等警告級別風險，請在 MAD 評分時適度考慮
- 注意區分否定表述（如"無限制出境"表示安全）和實際風險（"限制出境"表示危險）
- 5年以上的舊案可視為背景雜訊，僅輕微調整 MAD 分數
`;

    // 重新呼叫 OpenAI API 進行維度評估
    const response = await openai.responses.create({
      model: "gpt-5.2",
      text: {
        format: {
          type: "json_object"
        }
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `你是一個資深合約談判專家和法律顧問。請仔細分析這份合約文件，進行整體評估。

${backgroundContext}

CRITICAL:
你必須只回傳「純 JSON」，不得包含任何其他文字、說明、標題或 markdown 格式。
不得在 JSON 之外輸出任何內容，否則視為系統錯誤。

你的角色：
你是一名「深度合約談判專家與法律顧問 Agent」，任務不是評論合約，而是依照以下【不可違反的演算法規則】進行評分。
你的評分必須可回測、可重現，且與商業決策一致。

────────────────────
【總體評估任務】
────────────────────

你必須對整份合約進行四個維度的整體評分，並提供每一維度的專業解釋：

1 MAD — 生存風險指標（唯一扣分項）
2 MAO — 互利營收指標
3 MAA — 互相保證消耗／承諾深度（正向指標）
4 MAP — 戰略潛力與憲章指標

────────────────────
【MAD：生存風險指標（0–100，越高越危險）】
核心問題：「這份合約會不會殺死公司？」

⚠️ MAD 是唯一的風險扣分項，不得因 MAO、MAA、MAP 高分而抵銷致命風險。

【風險分層過濾（強制規則）】

🔴 致命傷（直接 100 分，觸發熔斷，不可被抵銷）：
- 破產紀錄
- 詐欺前科
- 負責人限制出境
- 欠稅大戶
→ 命中任一項，MAD 必須 = 100

🟡 背景雜訊（僅可扣 5–10 分，不得擴大解讀）：
- 5 年前的勞資糾紛
- 單純商業民事訴訟（非被告或金額小）
→ 若合約最終仍被簽署，代表此為可接受雜訊，模型必須忽略放大解讀

【IP 權利灰階評分（強制套用）】
- IP 完全歸我方／乙方：MAD +0
- IP 共有／另案協議：約定但不確定：MAD +5～10
- IP 完全歸對方：MAD +60～80（重傷，原則上不建議簽）

【司法管轄權（V3.1 規則）】
- 我方所在地法院：MAD +0
- 對方所在地法院，且對方為付費者：MAD +0（僅提醒，不扣分）
- 國內異地（非雙方所在地）：不得算入 MAD
- 海外／第三地法院：MAD +40（司法阻斷，高風險）

────────────────────
【MAO：互利營收指標（0–100，越高越好）】
核心問題：「這份合約現在能為公司創造多少實質收益？」

- 0–20：基本交易（市價、無優勢）
- 21–60：優於市場（價格、付款期、穩定性）
- 61–80：顯著獲利（獨家、保證量、預付款、槓桿效應）
- 81–100：壟斷級優勢（免費 IP、對方承擔成本、高度槓桿）

可評估「以小博大」、「成功報酬」、「資金槓桿」等設計。

────────────────────
【MAA：互相保證消耗／承諾深度（0–100，正向指標）】
核心問題：「雙方為這段關係押了多少不可撤銷的資源？」

⚠️ MAA 是加分項，不得因行政流程或人工操作而扣分。

- 0–20 流動式交易：無低消、無訂金、隨用隨棄
- 21–50 預約制維護：訂金、預付款、定期會議、指定窗口
- 51–80 硬性鎖定：保證採購、沈沒成本、高額解約金、利潤綁定
- 81–100 共生／排他：獨家條款、股權互持、核心命脈託管

評估重點是「財務鎖定、時間承諾、成效綁定」，而非麻不麻煩。

────────────────────
【MAP：戰略潛力與憲章指標（0–100，越高越好）】
核心問題：「這份合約是否成為公司未來的跳板？」

⚠️ 標準行政作業（人工驗收、文件審查、例行會議）= 0 分（綠區）
不得因『非數位化』或『有人工作業』而扣分。

- 0 分：無法執行（無法開單、無法履約）
- 1–20：純交易里程碑（能做生意）
- 21–50：功能性賦能
  - 資質取得（ISO、專利、合規）
  - 效率提升（外包非核心）
  - 履歷背書（案例、Portfolio）
- 51–80：戰略槓桿
  - 政府／政策資源
  - 金融槓桿（補助、授信、估值）
  - 知識轉移、風險共擔（Success Fee）
- 81–100：生態系共生
  - 獨家／排他
  - 憲章高度對齊、深度資料共享
  - 世界級品牌光環
  - 建立競爭門檻


⚠️ 嚴禁：
- 使用模糊語言
- 將行政成本誤判為風險
- 將背景雜訊誤判為致命傷
- 在 JSON 外輸出任何內容
────────────────────
【輸出格式（嚴格遵守）】

{
  "dimensions": {
    "mad": 0-100,
    "mao": 0-100,
    "maa": 0-100,
    "map": 0-100
  },
  "dimension_explanations": {
    "mad": "100–200 字，引用具體條款，說明風險是否為致命或雜訊",
    "mao": "100–200 字，說明營收結構與槓桿",
    "maa": "100–200 字，說明雙方承諾與鎖定程度",
    "map": "100–200 字，說明是否構成跳板或戰略資產"
  },
  "overall_recommendation": "150–250 字，明確給出是否建議簽署、風險邊界、談判優化點"
}`,
            },
            {
              type: "input_file",
              file_id: existingContract.file_id,
            },
          ],
        },
      ],
    });

    // 解析 AI 回應
    let result;
    try {
      result = extractJSON(response.output_text);
    } catch (e) {
      console.error("無法解析 AI 回應:", e);
      throw new Error("AI 回應格式錯誤: " + e.message);
    }

    // 計算新的健康評分
    const healthScoreResult = calculateHealthScore(result.dimensions);
    const healthScore = healthScoreResult.score;
    const healthDimensions = healthScoreResult.dimensions;
    const healthTier = healthScoreResult.tier;
    const healthTierLabel = healthScoreResult.tierLabel;
    const scoreBreakdown = healthScoreResult.breakdown;
    const dimensionExplanations = result.dimension_explanations || {};
    const overallRecommendation = result.overall_recommendation || '';

    // 更新合約資料
    const updatedContract = {
      ...existingContract,
      seller_company: new_company_name,
      company_data: companyData,
      health_score: healthScore,
      health_tier: healthTier,
      health_tier_label: healthTierLabel,
      score_breakdown: scoreBreakdown,
      health_dimensions: healthDimensions,
      dimension_explanations: dimensionExplanations,
      overall_recommendation: overallRecommendation,
      raw_data: result,
      last_updated: new Date().toISOString(),
    };

    saveContract(updatedContract);

    console.log(`✅ 合約更新完成！新公司名稱: ${new_company_name}, 健康評分: ${healthScore} 分 [${healthTier}級-${healthTierLabel}]`);
    console.log(`   維度更新: MAD=${healthDimensions.mad}, MAO=${healthDimensions.mao}, MAA=${healthDimensions.maa}, MAP=${healthDimensions.map}`);

    // 返回更新後的合約資料
    res.json({
      success: true,
      message: "公司名稱已更新，合約已重新評估",
      contract: updatedContract
    });

  } catch (err) {
    console.error("更新合約失敗:", err);
    res.status(500).json({ error: err.message });
  }
});

// 啟動伺服器
app.listen(3000, () => console.log("Server running on port 3000"));



