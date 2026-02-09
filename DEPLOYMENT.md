# TGSA 合約引擎部署指南

## 部署到 Ubuntu Linux Server

### 前置需求
- Ubuntu 20.04+ 伺服器
- Root 或 sudo 權限
- 開放 Port 3000（或使用 Nginx 代理到 80/443）

---

## 步驟 1: 連接到伺服器

```bash
ssh root@172.233.90.64
```

---

## 步驟 2: 安裝 Node.js 20.x

```bash
# 更新系統套件
apt update && apt upgrade -y

# 安裝 Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 確認安裝
node -v  # 應該顯示 v20.x.x
npm -v   # 應該顯示 10.x.x
```

---

## 步驟 3: 安裝 Git 並克隆專案

```bash
# 安裝 Git
apt install -y git

# 建立應用程式目錄
mkdir -p /var/www
cd /var/www

# 克隆專案（替換為你的 Git 倉庫 URL）
git clone <your-repo-url> shadowcore
cd shadowcore

# 或者使用 SCP 從本地上傳
# scp -r /path/to/shadowcore root@172.233.90.64:/var/www/
```

---

## 步驟 4: 設定環境變數

```bash
# 建立 .env 文件
cat > /var/www/shadowcore/.env << 'EOF'
OPENAI_API_KEY=your_openai_api_key_here
TAVILY_API_KEY=your_tavily_api_key_here
EOF

# 設定權限（保護 API 金鑰）
chmod 600 /var/www/shadowcore/.env
```

---

## 步驟 5: 安裝依賴套件

```bash
cd /var/www/shadowcore
npm install
```

---

## 步驟 6: 建立上傳目錄

```bash
mkdir -p /var/www/shadowcore/uploads
chmod 755 /var/www/shadowcore/uploads
```

---

## 步驟 7: 測試運行

```bash
cd /var/www/shadowcore
node backendserver.js

# 應該看到: Server running on port 3000
# 按 Ctrl+C 停止
```

---

## 步驟 8: 安裝 PM2（程序管理器）

PM2 可以讓應用程式在背景運行，並在崩潰時自動重啟。

```bash
# 全局安裝 PM2
npm install -g pm2

# 使用 PM2 啟動應用程式
cd /var/www/shadowcore
pm2 start backendserver.js --name "tgsa-contract-engine"

# 設定開機自動啟動
pm2 startup
pm2 save

# 常用 PM2 指令
pm2 status          # 查看狀態
pm2 logs            # 查看日誌
pm2 restart all     # 重啟所有應用
pm2 stop all        # 停止所有應用
```

---

## 步驟 9: 設定防火牆

```bash
# 安裝 UFW（如果尚未安裝）
apt install -y ufw

# 允許 SSH
ufw allow 22

# 允許 HTTP/HTTPS
ufw allow 80
ufw allow 443

# 允許 Node.js 端口（如果不使用 Nginx）
ufw allow 3000

# 啟用防火牆
ufw enable
```

---

## 步驟 10: 設定 Nginx 反向代理（推薦）

使用 Nginx 可以：
- 使用標準 80/443 端口
- 設定 SSL/HTTPS
- 更好的安全性和效能

```bash
# 安裝 Nginx
apt install -y nginx

# 建立站點配置
cat > /etc/nginx/sites-available/tgsa << 'EOF'
server {
    listen 80;
    server_name 172.233.90.64;  # 或替換為你的域名

    # 增加上傳文件大小限制
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;

        # 增加超時時間（合約分析可能需要較長時間）
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_read_timeout 300;
    }
}
EOF

# 啟用站點
ln -s /etc/nginx/sites-available/tgsa /etc/nginx/sites-enabled/

# 移除預設站點
rm -f /etc/nginx/sites-enabled/default

# 測試配置
nginx -t

# 重啟 Nginx
systemctl restart nginx
systemctl enable nginx
```

---

## 步驟 11: 設定 SSL/HTTPS（可選但推薦）

使用 Let's Encrypt 免費 SSL 憑證（需要域名）：

```bash
# 安裝 Certbot
apt install -y certbot python3-certbot-nginx

# 取得憑證（替換為你的域名）
certbot --nginx -d yourdomain.com

# 自動續約測試
certbot renew --dry-run
```

---

## 完成！

應用程式現在應該可以透過以下方式訪問：

- **直接訪問**: `http://172.233.90.64:3000`
- **透過 Nginx**: `http://172.233.90.64`
- **透過域名**: `https://yourdomain.com`（如果已設定）

---

## 常見問題排解

### 1. 端口被佔用
```bash
# 查看端口使用情況
lsof -i :3000
netstat -tlnp | grep 3000

# 結束佔用端口的程序
kill -9 <PID>
```

### 2. PM2 應用程式崩潰
```bash
# 查看錯誤日誌
pm2 logs tgsa-contract-engine --lines 100

# 重啟應用
pm2 restart tgsa-contract-engine
```

### 3. Nginx 502 Bad Gateway
```bash
# 確認 Node.js 應用正在運行
pm2 status

# 檢查 Nginx 錯誤日誌
tail -f /var/log/nginx/error.log
```

### 4. 上傳文件失敗
```bash
# 確認 uploads 目錄權限
ls -la /var/www/shadowcore/uploads
chmod 755 /var/www/shadowcore/uploads
```

### 5. API 金鑰錯誤
```bash
# 確認 .env 文件內容
cat /var/www/shadowcore/.env

# 重啟應用以載入新配置
pm2 restart tgsa-contract-engine
```

---

## 快速部署腳本

將以下腳本保存為 `deploy.sh` 並執行：

```bash
#!/bin/bash

# TGSA 合約引擎快速部署腳本
set -e

echo "=== TGSA Contract Engine Deployment ==="

# 更新系統
echo ">>> Updating system..."
apt update && apt upgrade -y

# 安裝 Node.js 20.x
echo ">>> Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git nginx

# 安裝 PM2
echo ">>> Installing PM2..."
npm install -g pm2

# 建立目錄
echo ">>> Setting up directories..."
mkdir -p /var/www/shadowcore/uploads

# 提示用戶上傳代碼
echo ""
echo ">>> Please upload your project files to /var/www/shadowcore/"
echo ">>> Then create /var/www/shadowcore/.env with your API keys"
echo ""
echo "After uploading, run:"
echo "  cd /var/www/shadowcore"
echo "  npm install"
echo "  pm2 start backendserver.js --name tgsa-contract-engine"
echo "  pm2 save && pm2 startup"
echo ""
echo "=== Deployment preparation complete ==="
```

執行：
```bash
chmod +x deploy.sh
./deploy.sh
```
