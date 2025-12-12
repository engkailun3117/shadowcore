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

### 健康評分 (Health Score)

- **90-100** 🟢 優秀 - 合約條款良好
- **70-89** 🟡 良好 - 合約可接受，有少量風險
- **50-69** 🟠 一般 - 存在明顯風險，需要注意
- **30-49** 🔴 較差 - 多項條款不利，建議重新協商
- **0-29** ⛔ 危險 - 合約風險極高

## 分析邏輯

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

### v1.1.0 (2025-12-11)
- ✨ 新增三大合約分析功能：付款條件、責任上限、總價分析
- ✨ 新增健康評分計算
- ✨ 新增風險評估邏輯
- 🔧 改進 AI 提示詞以提取更多結構化資料

### v1.0.0 (初始版本)
- 基本文件上傳功能
- 文件類型識別
- 公司背景調查
