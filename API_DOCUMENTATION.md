# TGSA 合約分析 API 文檔

## 概述

本 API 提供智能合約分析功能，可自動提取和評估合約中的關鍵條款，包括：

1. **付款條件 (Payment Terms)** - 評估付款期限是否合理
2. **責任上限 (Liability Cap)** - 評估賠償責任風險
3. **總價分析 (Total Price)** - 比較合約價格與目標價格

## API 端點

### POST /upload

上傳並分析合約 PDF 文件

#### 請求格式

- **Content-Type**: `multipart/form-data`
- **參數**:
  - `file` (required): PDF 格式的合約文件

#### 回應格式

```json
{
  "success": true,
  "health_score": 82,
  "document_type": "合約",
  "seller_company": "TGSA Corp",
  "contract_analysis": {
    "payment_terms": {
      "status": "DISPUTE",
      "message": "付款期限較短 30 天，現金流壓力較大",
      "raw_text": "Net 30 days from invoice date",
      "contract_value": "Net 30 days",
      "target_value": "Net 60 days",
      "difference_days": 30,
      "risk_score": 40
    },
    "liability_cap": {
      "status": "WARNING",
      "message": "責任上限僅為合約金額的 100%，低於標準 200% 或 $3M",
      "raw_text": "Seller's liability shall not exceed 100% of fees paid",
      "contract_value": "$1.15M (100% of fees)",
      "standard_value": "$3M or 200%",
      "cap_amount_million": 1.15,
      "standard_amount_million": 3.0,
      "risk_score": 38
    },
    "total_price": {
      "status": "OPPORTUNITY",
      "message": "價格低於目標 6.0%，具成本優勢",
      "raw_text": "Total contract value: $1,080,000",
      "contract_value": "$1.08M",
      "target_value": "$1.08M",
      "difference_million": 0,
      "percentage_difference": "0.0",
      "risk_score": 100
    },
    "warranty": {
      "raw_text": "3 Years warranty period",
      "years": 3
    }
  },
  "raw_data": {
    "document_type": "合約",
    "seller_company": "TGSA Corp",
    "payment_terms": { ... },
    "liability_cap": { ... },
    "total_price": { ... },
    "warranty_period": { ... }
  },
  "company_data": {
    "profile": [ ... ],
    "customs": [ ... ],
    "legal": [ ... ]
  }
}
```

## 狀態碼說明

### 分析狀態 (Status)

- **MATCH** ✅ - 條款符合目標或標準
- **OPPORTUNITY** 🟢 - 條款優於目標，對我方有利
- **WARNING** ⚠️ - 條款需要注意，可能存在風險
- **DISPUTE** 🔴 - 條款不符合期望，建議重新協商
- **UNKNOWN** ❓ - 無法提取相關資訊

### 健康評分等級 (Health Score Tiers) - Elite Strategy Distribution

基於 **Elite Strategy Distribution** 的新策略，我們重新定義了合約等級，讓 **A 級成為主力部隊（40%）**：

| 等級 | 分數範圍 | 目標比例 | 名稱 | 說明 |
|------|---------|---------|------|------|
| **S 級** | 90-100 | **10%** | **獨角獸 (Unicorns)** | 你的公司擁有絕對議價權。客戶求著你做，利潤極高，條款完全配合 M.A.X. 標準。這是公司的「招牌案例」。 |
| **A 級** | 80-89 | **40%** | **核心營收 (Core Revenue)** 【主力部隊】 | 優質合約是我們的標準配備。生存底線極低 (MAD < 5)，營收效益高 (MAO > 75)。心態轉變：以前 74 分不錯，現在 74 分「不夠好」。 |
| **B 級** | 70-79 | **30%** | **備份選項 (Backup Options)** | 食之無味，棄之可惜。安全但平庸。只有在 A 級訂單接不完時才接，用來填產能、養基本開銷 (Overhead)。 |
| **C 級** | 60-69 | **15%** | **改進區 (Improvement Zone)** | 不合格的草約。系統標記為「需談判」。業務必須利用 M.A.X. 建議（如：拿保固換價格）把它變成 B 級或 A 級，否則不簽。 |
| **D 級** | < 60 | **5%** | **拒絕往來 (Rejected)** | 劇毒合約。生存風險超標 (MAD > 35) 或賠錢生意。系統直接熔斷，禁止簽核。 |

**核心理念**: A 級合約是業務的主力目標，系統設計更加重視營收 (MAO) 並給予達標合約獎勵加分，推動整體合約組合向高質量方向發展。

## M.A.X. 四維度評分系統

### 四個維度

#### 🛡️ MAD (Mutually Assured Destruction - 生存風險指標)
**問題**: "這份合約會不會殺死我？"

衡量條款對公司生存造成的威脅程度（0-100 分，**越高越危險**）

- **0-5 分** (極安全): Elite 標準，符合 A/S 級要求
- **6-20 分** (安全): 標準商業條款（如：一般保固責任、合理違約金）
- **21-35 分** (注意): 風險偏高需注意（如：付款期超過 120 天、匯率風險由我方承擔）
- **36-100 分** (危險): **觸發熔斷**，總分強制不超過 59 分（如：無限賠償責任、單方解約權）

**MAD 在評分中的權重**: 60%（安全性得分）

---

#### 💰 MAO (Mutual Advantage Optimization - 互利營收指標)
**問題**: "這份合約現在能為公司創造多少實質收益？"

衡量條款帶來的直接經濟利益與資源獲取（0-100 分，**越高越好**）

| 分數範圍 | 等級 | 說明 | 範例 |
|---------|------|------|------|
| **0-40** | 基本交易 | 市價、無優勢 | 標準採購價、無折扣 |
| **41-60** | 優於市場 | 價格、付款期、穩定性 | 價格低於市價 5-10%、付款期優於同業 |
| **61-80** | 顯著獲利 | 獨家、保證量、預付款、槓桿效應 | 獨家供應權、保證採購量、預付款 |
| **81-100** | 壟斷級優勢 | 免費 IP、對方承擔成本、高度槓桿 | 取得專利授權、對方承擔開發成本 |

可評估「以小博大」、「成功報酬」、「資金槓桿」等設計。

**MAO 在評分中的權重**: 約 13.3%（在價值得分中與 MAA、MAP 平均分配）

**重要**: MAO 是 Elite Strategy 的核心指標，A 級要求 MAO > 75，S 級要求 MAO > 85。

---

#### 🤝 MAA (Mutual Assured Attrition - 承諾深度指標)
**問題**: "雙方為這段關係押了多少不可撤銷的資源？"

衡量合約對雙方的約束力與承諾程度（0-100 分，**越高約束越深**）

⚠️ **MAA 是加分項，不得因行政流程或人工操作而扣分。**

評估重點是「財務鎖定、時間承諾、成效綁定」，而非麻不麻煩。

| 分數範圍 | 等級 | 說明 | 範例 |
|---------|------|------|------|
| **0-40** | 流動式交易 | 無低消、無訂金、隨用隨棄 | 單次交易、無長期承諾 |
| **41-65** | 預約制維護 | 訂金、預付款、定期會議、指定窗口 | 有框架協議、定期合作 |
| **66-87** | 硬性鎖定 | 保證採購、沈沒成本、高額解約金、利潤綁定 | 長期合作協議、違約金條款 |
| **88-100** | 共生／排他 | 獨家條款、股權互持、核心命脈託管 | 排他性協議、深度綁定 |

**MAA 在評分中的權重**: 約 13.3%（在價值得分中與 MAO、MAP 平均分配）

---

#### 🚀 MAP (Mutual Assured Potential - 戰略潛力指標)
**問題**: "這份合約是否成為公司未來的跳板？"

衡量合約的長期戰略價值與未來潛力（0-100 分，**越高越好**）

⚠️ **標準行政作業（人工驗收、文件審查、例行會議）= 0 分影響（綠區）**
不得因『非數位化』或『有人工作業』而扣分。

| 分數範圍 | 等級 | 說明 | 範例 |
|---------|------|------|------|
| **0** | 無法執行 | 無法開單、無法履約 | 缺乏基本商業條件 |
| **1-40** | 純交易里程碑 | 能做生意 | 完成開戶審核、具備基本商業條款 |
| **41-65** | 功能性賦能 | 資質取得、效率提升、履歷背書 | ISO 認證、專利授權、案例背書 |
| **66-80** | 戰略槓桿 | 政府資源、金融槓桿、知識轉移 | 補助、授信、估值提升、Success Fee |
| **81-100** | 生態系共生 | 獨家排他、深度共享、品牌光環 | 世界級品牌合作、競爭門檻建立 |

**功能性賦能 (41-65) 包含**:
- 資質取得（ISO、專利、合規）
- 效率提升（外包非核心）
- 履歷背書（案例、Portfolio）

**戰略槓桿 (66-80) 包含**:
- 政府／政策資源
- 金融槓桿（補助、授信、估值）
- 知識轉移、風險共擔（Success Fee）

**生態系共生 (81-100) 包含**:
- 獨家／排他
- 憲章高度對齊、深度資料共享
- 世界級品牌光環
- 建立競爭門檻

**MAP 在評分中的權重**: 約 13.3%（在價值得分中與 MAO、MAA 平均分配）

---

## Elite Strategy Distribution 計算公式

### 總分計算

```
安全性得分 (Safety Score) = (100 - MAD) × 60%
價值性得分 (Value Score)  = [(MAO + MAA + MAP) / 3] × 40%
原始總分 = 安全性得分 + 價值性得分
```

**說明**: 三個價值維度（MAO、MAA、MAP）採用簡單平均，不再有個別權重差異。

### 獎勵機制（推動 A 級主力化）

```
獎勵分 = 0

如果 MAD < 5 且 MAO > 75:
    獎勵分 += 5  (A 級加速器)

如果 MAD < 5 且 MAO > 85:
    獎勵分 += 3  (S 級加速器，累計 +8)

最終總分 = 原始總分 + 獎勵分
```

### 熔斷機制

```
如果 MAD > 35 (風險過高區):
    最終總分 = min(最終總分, 59)  // 強制降至 D 級
```

### 評分範圍

```
最終總分限制在 [0, 100] 範圍內
```

---

## 計算範例

### 範例 1: Elite A 級合約（核心營收）

**維度分數**:
- MAD = 3（極安全）
- MAO = 78（高營收）
- MAA = 60（中等約束）
- MAP = 50（常態交易）

**計算過程**:
```
安全性得分 = (100 - 3) × 60% = 58.2
價值性得分 = [(78 + 60 + 50) / 3] × 40%
           = [188 / 3] × 40%
           = 62.67 × 40% = 25.07
原始總分 = 58.2 + 25.07 = 83.27

獎勵分 = 5 (符合 MAD < 5 且 MAO > 75)
最終總分 = 83.27 + 5 = 88.27 ≈ 88 分
```

**結果**: **A 級 - 核心營收** ✅

---

### 範例 2: Elite S 級合約（獨角獸）

**維度分數**:
- MAD = 2（極安全）
- MAO = 90（壟斷級優勢）
- MAA = 85（強約束）
- MAP = 75（戰略夥伴）

**計算過程**:
```
安全性得分 = (100 - 2) × 60% = 58.8
價值性得分 = [(90 + 85 + 75) / 3] × 40%
           = [250 / 3] × 40%
           = 83.33 × 40% = 33.33
原始總分 = 58.8 + 33.33 = 92.13

獎勵分 = 5 + 3 = 8 (符合 A 級和 S 級加速器)
最終總分 = 92.13 + 8 = 100.13 → 100 分 (上限)
```

**結果**: **S 級 - 獨角獸** 🦄

---

### 範例 3: 熔斷機制觸發（D 級 - 拒絕往來）

**維度分數**:
- MAD = 45（高風險）
- MAO = 80（高營收）
- MAA = 50
- MAP = 40

**計算過程**:
```
安全性得分 = (100 - 45) × 60% = 33
價值性得分 = [(80 + 50 + 40) / 3] × 40%
           = [170 / 3] × 40%
           = 56.67 × 40% = 22.67
原始總分 = 33 + 22.67 = 55.67

⚠️ 熔斷觸發: MAD = 45 > 35
最終總分 = min(55.67, 59) = 55.67 ≈ 56 分
```

**結果**: **D 級 - 拒絕往來** ⛔ （即使 MAO 很高，但 MAD 過高觸發熔斷）

---

## 關鍵差異：舊版 vs. Elite Strategy

| 項目 | 舊版 | Elite Strategy |
|------|------|----------------|
| **安全權重** | 70% | 60% ⬇️ |
| **價值權重** | 30% | 40% ⬆️ |
| **MAO/MAA/MAP** | 各有不同權重 | 簡單平均（各佔 1/3）|
| **獎勵機制** | 無 | A級 +5分，S級 +8分 ✨ |
| **A 級目標** | ~20% | **40%（主力）** 🚀 |
| **理念** | 安全優先 | 平衡安全與營收 |

## 分析邏輯 (舊版，保留以供參考)

### 1. 付款條件分析

- **目標**: Net 60 天
- **評分邏輯**:
  - 完全符合: 100 分
  - 每短 1 天: -2 分
  - 超過目標天數: 100 分（對現金流有利）

### 2. 責任上限分析

- **標準**: 合約金額的 200% 或 $3M（取較大值）
- **評分邏輯**:
  - ≥ 標準: 100 分
  - 100%-200% 之間: 30-100 分（按比例）
  - < 100%: 極高風險

### 3. 總價分析

- **目標**: $1.08M
- **評分邏輯**:
  - 低於或等於目標: 100 分
  - 高於目標: 每高 1% 減 1 分

## 使用範例

### cURL 範例

```bash
curl -X POST http://localhost:3000/upload \
  -F "file=@/path/to/contract.pdf"
```

### JavaScript 範例

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

fetch('http://localhost:3000/upload', {
  method: 'POST',
  body: formData
})
  .then(response => response.json())
  .then(data => {
    console.log('健康評分:', data.health_score);
    console.log('付款條件:', data.contract_analysis.payment_terms);
    console.log('責任上限:', data.contract_analysis.liability_cap);
    console.log('總價分析:', data.contract_analysis.total_price);
  });
```

### Python 範例

```python
import requests

url = 'http://localhost:3000/upload'
files = {'file': open('contract.pdf', 'rb')}

response = requests.post(url, files=files)
result = response.json()

print(f"健康評分: {result['health_score']}")
print(f"付款條件狀態: {result['contract_analysis']['payment_terms']['status']}")
print(f"責任上限狀態: {result['contract_analysis']['liability_cap']['status']}")
print(f"總價狀態: {result['contract_analysis']['total_price']['status']}")
```

## 自訂目標值

目前目標值在後端代碼中設定（`backendserver.js` 第 126-131 行）：

```javascript
const targets = {
  payment_net_days: 60,          // Net 60 天
  warranty_years: 3,              // 3 年保固
  target_price_million: 1.08,     // 目標價格 $1.08M
  liability_cap_standard: 2.0,    // 標準為合約價值的 200%
};
```

**未來增強**: 可以考慮從請求參數中傳入目標值，使其更加靈活。

## 錯誤處理

### 錯誤回應格式

```json
{
  "success": false,
  "message": "無法確定文件類型或找不到乙方公司名稱"
}
```

或

```json
{
  "error": "Error message details"
}
```

## 技術架構

- **AI 模型**: OpenAI GPT-4.1
- **文件處理**: OpenAI Files API
- **背景調查**: Tavily Search API
- **檔案上傳**: Multer

## 環境變數

需要在 `.env` 文件中設定：

```env
OPENAI_API_KEY=your_openai_api_key
TAVILY_API_KEY=your_tavily_api_key
```

## 啟動服務

```bash
# 安裝依賴
npm install

# 啟動服務
node backendserver.js
```

服務將在 `http://localhost:3000` 啟動。

## 限制與注意事項

1. 僅支援 PDF 格式的合約文件
2. AI 提取準確度依賴合約文件的清晰度和標準化程度
3. 分析結果僅供參考，重要決策仍需人工審核
4. 上傳的文件會在分析完成後自動刪除

## 版本歷史

### v2.1.0 (2026-02-05) - 文檔修正
- 📚 **文檔修正**: 更新 API 文檔以匹配實際後端邏輯
- 🔧 修正評分權重說明：安全 60%，價值 40%
- 🔧 修正價值得分計算：MAO、MAA、MAP 採用簡單平均（各佔 1/3）
- 🔧 更新計算範例以反映正確公式

### v2.0.0 (2025-12-19) - Elite Strategy Distribution
- 🚀 **重大更新**: 實施 Elite Strategy Distribution 評分系統
- ✨ 重新調整評分權重：安全 60%（↓ 從 70%），價值 40%（↑ 從 30%）
- ✨ MAO、MAA、MAP 三個維度採用簡單平均計算價值得分
- ✨ 新增獎勵機制：
  - A 級加速器：MAD < 5 且 MAO > 75 → +5 分
  - S 級加速器：MAD < 5 且 MAO > 85 → 額外 +3 分（共 +8 分）
- ✨ 更新合約等級定義與目標分佈：
  - S 級（獨角獸）：10% 目標
  - A 級（核心營收）：**40% 目標 - 主力部隊**
  - B 級（備份選項）：30% 目標
  - C 級（改進區）：15% 目標
  - D 級（拒絕往來）：5% 目標
- 📚 完整更新 API 文檔，包含詳細計算範例與對比說明
- 🎨 更新前端界面，使用新的等級命名（獨角獸、核心營收等）
- 🎨 為四個維度分析卡片添加不同顏色邊框（MAD 紅、MAO 綠、MAA 橙、MAP 藍）
- 🐛 修復編輯按鈕定位問題（使用 inline-flex 代替 flex）
- 🐛 支援 .docx 文件上傳（使用 mammoth 庫提取文字）

### v1.1.0 (2025-12-11)
- ✨ 新增三大合約分析功能：付款條件、責任上限、總價分析
- ✨ 新增健康評分計算
- ✨ 新增風險評估邏輯
- 🔧 改進 AI 提示詞以提取更多結構化資料

### v1.0.0 (初始版本)
- 基本文件上傳功能
- 文件類型識別
- 公司背景調查
