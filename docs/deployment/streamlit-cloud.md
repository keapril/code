# Streamlit Cloud 部署指南

## 前置條件
- GitHub repository: https://github.com/keapril/code
- Streamlit Cloud 帳號
- Firebase service account key

## 部署步驟

### 1. 連接 GitHub
1. 登入 [Streamlit Cloud](https://share.streamlit.io/)
2. 點擊「New app」
3. 選擇 repository: `keapril/code`
4. 設定主程式路徑: `src/app.py`
5. 選擇 branch: `main`

### 2. 設定 Secrets
在 Streamlit Cloud → Settings → Secrets 加入：

```toml
[firebase]
type = "service_account"
project_id = "你的專案ID"
private_key_id = "..."
private_key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
client_email = "..."
client_id = "..."
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "..."
```

> ⚠️ **注意**：`private_key` 中的換行符號要用 `\n` 表示

### 3. 部署
點擊「Deploy」按鈕，等待部署完成。

### 4. 驗證
1. 開啟應用程式 URL
2. 測試 Firebase 連接
3. 測試查詢功能
4. 測試資料上傳（密碼：197）

## 本地測試 Secrets

### 方法一：使用 .streamlit/secrets.toml
在專案根目錄建立 `.streamlit/secrets.toml`：

```toml
[firebase]
type = "service_account"
project_id = "..."
# ... 其他設定
```

> ⚠️ 此檔案已加入 `.gitignore`，不會上傳到 GitHub

### 方法二：使用環境變數
```bash
export FIREBASE_CONFIG='{"type":"service_account",...}'
streamlit run src/app.py
```

## 常見問題

### Q1: Firebase 初始化失敗
**錯誤訊息**：`Firebase 初始化失敗: ...`

**解決方法**：
1. 檢查 Secrets 格式是否正確
2. 確認 `private_key` 的換行符號是 `\n`
3. 確認所有欄位都有填寫

### Q2: 資料上傳失敗
**錯誤訊息**：`儲存到 Firebase 失敗: ...`

**解決方法**：
1. 檢查 Firebase 權限設定
2. 確認 Firestore 已啟用
3. 檢查網路連線

### Q3: 快取問題
**現象**：資料更新後仍顯示舊資料

**解決方法**：
1. 等待 5 分鐘（快取過期時間）
2. 或在 Settings 清除資料庫後重新上傳

## 更新部署

### 方法一：Git Push（推薦）
```bash
git add .
git commit -m "更新功能"
git push origin main
```
Streamlit Cloud 會自動重新部署。

### 方法二：手動重啟
在 Streamlit Cloud Dashboard → Manage app → Reboot

## 效能優化

### 1. 快取設定
```python
@st.cache_data(ttl=300, show_spinner=False)  # 快取 5 分鐘
def load_data_from_firebase(_db):
    ...
```

### 2. 資料量建議
- 建議單次上傳不超過 10,000 筆
- 總資料量建議不超過 100,000 筆

### 3. 查詢優化
- 使用「搜尋用字串」欄位加速查詢
- 避免過於模糊的關鍵字

## 安全性

### 1. 密碼保護
- 資料上傳密碼：197
- Admin 模式密碼：163

### 2. Firebase 安全規則
建議在 Firestore 設定以下規則：

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /medical_products/{document} {
      allow read: if true;  // 公開讀取
      allow write: if false;  // 僅透過 Admin SDK 寫入
    }
  }
}
```

## 監控與維護

### 1. 檢查應用程式狀態
- Streamlit Cloud Dashboard → Logs
- 查看錯誤訊息和使用情況

### 2. Firebase 使用量
- Firebase Console → Usage
- 監控讀寫次數和儲存空間

### 3. 定期備份
建議定期匯出 Firestore 資料備份。

## 相關連結
- Streamlit Cloud: https://share.streamlit.io/
- GitHub Repository: https://github.com/keapril/code
- Firebase Console: https://console.firebase.google.com/
