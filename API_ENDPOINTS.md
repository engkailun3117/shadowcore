# TGSA 合約引擎 API 端點文檔

## 概述

本文檔描述 TGSA 企業合約引擎的所有 REST API 端點。

**Base URL**: `http://localhost:3000`

---

## 端點列表

| 方法 | 端點 | 描述 |
|------|------|------|
| POST | `/upload` | 上傳並分析合約文件 |
| GET | `/contracts` | 獲取所有合約列表 |
| GET | `/contracts/:id` | 獲取特定合約詳情 |
| POST | `/contracts/:id/replace` | 替換現有合約 |
| DELETE | `/contracts/:id` | 刪除合約 |
| PUT | `/contracts/:id/update-company` | 更新公司名稱並重新評估 |

---

## 1. 上傳並分析合約

### `POST /upload`

上傳合約文件（PDF 或 DOCX），系統將自動執行：
1. 重複文件檢測
2. 提取乙方公司名稱
3. Tavily 背景調查
4. AI 四維度評分（MAD/MAO/MAA/MAP）
5. 計算健康評分

#### 請求

**Content-Type**: `multipart/form-data`

| 參數 | 類型 | 必填 | 描述 |
|------|------|------|------|
| `file` | File | 是 | 合約文件（.pdf, .docx, .doc） |

#### 成功回應 (200)

```json
{
  "success": true,
  "contract_id": "a1b2c3d4e5f6...",
  "health_score": 85,
  "health_tier": "A",
  "health_tier_label": "優質",
  "score_breakdown": {
    "safetyScore": 58.2,
    "valueScore": 25.1,
    "bonusPoints": 5
  },
  "health_dimensions": {
    "mad": 3,
    "mao": 78,
    "maa": 60,
    "map": 50
  },
  "dimension_explanations": {
    "mad": "本合約風險極低...",
    "mao": "營收效益良好...",
    "maa": "承諾程度適中...",
    "map": "具有一定戰略價值..."
  },
  "overall_recommendation": "建議簽署此合約...",
  "document_type": "合約",
  "seller_company": "ABC 股份有限公司",
  "company_data": {
    "profile": { "answer": "..." },
    "customs": { "answer": "..." },
    "legal": { "answer": "..." },
    "responsible_person": { "answer": "..." },
    "responsible_person_legal": { "answer": "..." }
  }
}
```

#### 重複文件回應 (200)

```json
{
  "success": true,
  "duplicate": true,
  "existing_contract": { ... },
  "message": "此合約已存在於系統中"
}
```

#### 錯誤回應

```json
{
  "success": false,
  "error": "錯誤訊息",
  "details": "詳細資訊（可選）"
}
```

#### cURL 範例

```bash
curl -X POST http://localhost:3000/upload \
  -F "file=@/path/to/contract.pdf"
```

---

## 2. 獲取所有合約列表

### `GET /contracts`

獲取系統中所有已分析的合約列表（簡要資訊）。

#### 請求

無參數

#### 成功回應 (200)

```json
{
  "success": true,
  "contracts": [
    {
      "contract_id": "a1b2c3d4e5f6...",
      "filename": "服務合約_ABC公司.pdf",
      "seller_company": "ABC 股份有限公司",
      "health_score": 85,
      "health_tier": "A",
      "health_tier_label": "優質",
      "health_dimensions": {
        "mad": 3,
        "mao": 78,
        "maa": 60,
        "map": 50
      },
      "upload_date": "2025-12-24T10:30:00.000Z",
      "document_type": "合約"
    },
    ...
  ]
}
```

#### cURL 範例

```bash
curl http://localhost:3000/contracts
```

---

## 3. 獲取特定合約詳情

### `GET /contracts/:id`

獲取特定合約的完整詳情，包含所有分析結果。

#### 請求

| 參數 | 類型 | 描述 |
|------|------|------|
| `id` | Path | 合約 ID |

#### 成功回應 (200)

```json
{
  "success": true,
  "contract": {
    "contract_id": "a1b2c3d4e5f6...",
    "file_hash": "sha256hash...",
    "file_id": "openai_file_id",
    "filename": "服務合約_ABC公司.pdf",
    "upload_date": "2025-12-24T10:30:00.000Z",
    "health_score": 85,
    "health_tier": "A",
    "health_tier_label": "優質",
    "score_breakdown": {
      "safetyScore": 58.2,
      "valueScore": 25.1,
      "bonusPoints": 5
    },
    "health_dimensions": {
      "mad": 3,
      "mao": 78,
      "maa": 60,
      "map": 50
    },
    "dimension_explanations": {
      "mad": "...",
      "mao": "...",
      "maa": "...",
      "map": "..."
    },
    "overall_recommendation": "...",
    "document_type": "合約",
    "seller_company": "ABC 股份有限公司",
    "company_data": {
      "profile": { ... },
      "customs": { ... },
      "legal": { ... },
      "responsible_person": { ... },
      "responsible_person_legal": { ... }
    },
    "raw_data": { ... }
  }
}
```

#### 錯誤回應 (404)

```json
{
  "error": "合約不存在"
}
```

#### cURL 範例

```bash
curl http://localhost:3000/contracts/a1b2c3d4e5f6
```

---

## 4. 替換現有合約

### `POST /contracts/:id/replace`

刪除現有合約記錄，準備替換為新文件。

> **注意**: 此端點只刪除舊記錄，需要再次調用 `/upload` 上傳新文件。

#### 請求

| 參數 | 類型 | 描述 |
|------|------|------|
| `id` | Path | 合約 ID |

#### 成功回應 (200)

```json
{
  "success": true,
  "message": "合約已刪除，請重新上傳"
}
```

#### 錯誤回應 (404)

```json
{
  "error": "合約不存在"
}
```

#### cURL 範例

```bash
curl -X POST http://localhost:3000/contracts/a1b2c3d4e5f6/replace
```

---

## 5. 刪除合約

### `DELETE /contracts/:id`

永久刪除指定的合約記錄。

#### 請求

| 參數 | 類型 | 描述 |
|------|------|------|
| `id` | Path | 合約 ID |

#### 成功回應 (200)

```json
{
  "success": true,
  "message": "合約已刪除"
}
```

#### 錯誤回應 (404)

```json
{
  "error": "合約不存在"
}
```

#### cURL 範例

```bash
curl -X DELETE http://localhost:3000/contracts/a1b2c3d4e5f6
```

---

## 6. 更新公司名稱並重新評估

### `PUT /contracts/:id/update-company`

更新合約的乙方公司名稱，並重新執行：
1. Tavily 背景調查（使用新公司名稱）
2. AI 重新評估四維度分數
3. 重新計算健康評分
4. 自動保存更新結果

> **注意**: 此操作會自動保存，無需額外調用儲存 API。

#### 請求

**Content-Type**: `application/json`

| 參數 | 類型 | 必填 | 描述 |
|------|------|------|------|
| `id` | Path | 是 | 合約 ID |
| `new_company_name` | Body | 是 | 新的公司名稱 |

```json
{
  "new_company_name": "新公司名稱股份有限公司"
}
```

#### 成功回應 (200)

```json
{
  "success": true,
  "message": "公司名稱已更新，合約已重新評估",
  "contract": {
    "contract_id": "a1b2c3d4e5f6...",
    "seller_company": "新公司名稱股份有限公司",
    "health_score": 82,
    "health_tier": "A",
    "health_dimensions": { ... },
    "company_data": { ... },
    "last_updated": "2025-12-25T14:30:00.000Z",
    ...
  }
}
```

#### 無 file_id 時的回應 (200)

如果原合約沒有保存 file_id（舊版合約或 DOCX 文件），只會更新背景調查，維度評分保持不變：

```json
{
  "success": true,
  "message": "公司名稱已更新，背景調查已重新執行（維度評分未改變，因為舊合約缺少文件資料）",
  "contract": { ... }
}
```

#### 錯誤回應

```json
{
  "error": "公司名稱不能為空"
}
```

```json
{
  "error": "合約不存在"
}
```

#### cURL 範例

```bash
curl -X PUT http://localhost:3000/contracts/a1b2c3d4e5f6/update-company \
  -H "Content-Type: application/json" \
  -d '{"new_company_name": "新公司名稱股份有限公司"}'
```

#### JavaScript 範例

```javascript
const response = await fetch(`http://localhost:3000/contracts/${contractId}/update-company`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    new_company_name: '新公司名稱股份有限公司'
  })
});

const data = await response.json();
if (data.success) {
  console.log('更新成功:', data.contract);
}
```

---

## 資料結構

### 健康維度 (health_dimensions)

| 欄位 | 類型 | 範圍 | 描述 |
|------|------|------|------|
| `mad` | Number | 0-100 | 生存風險指標（越高越危險） |
| `mao` | Number | 0-100 | 互利營收指標（越高越好） |
| `maa` | Number | 0-100 | 承諾深度指標（越高約束越深） |
| `map` | Number | 0-100 | 戰略潛力指標（越高越好） |

### 健康等級 (health_tier)

| 等級 | 分數範圍 | 標籤 | 說明 |
|------|---------|------|------|
| S | 90-100 | 王者 | 獨角獸級合約 |
| A | 80-89 | 優質 | 核心營收（主力） |
| B | 70-79 | 標準 | 備份選項 |
| C | 60-69 | 觀察 | 改進區 |
| D | < 60 | 淘汰 | 拒絕往來 |

### 公司背景調查 (company_data)

| 欄位 | 描述 |
|------|------|
| `profile` | 公司簡介 |
| `customs` | 海關進出口記錄 |
| `legal` | 法律合規狀況 |
| `responsible_person` | 負責人資訊 |
| `responsible_person_legal` | 負責人法律狀況 |

---

## 錯誤處理

### HTTP 狀態碼

| 狀態碼 | 描述 |
|--------|------|
| 200 | 成功 |
| 400 | 請求參數錯誤 |
| 404 | 資源不存在 |
| 500 | 伺服器內部錯誤 |

### 錯誤回應格式

```json
{
  "error": "錯誤訊息",
  "details": "詳細資訊（可選）"
}
```

或

```json
{
  "success": false,
  "error": "錯誤訊息",
  "message": "使用者友好訊息（可選）"
}
```

---

## 版本歷史

| 版本 | 日期 | 變更 |
|------|------|------|
| 1.0.0 | 2025-12-19 | 初始版本 |
| 1.1.0 | 2025-12-24 | 新增 `health_dimensions` 到 GET /contracts 回應 |
