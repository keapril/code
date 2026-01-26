# 院內碼查詢系統

醫療產品院內碼查詢系統，支援多醫院、多關鍵字搜尋。

## 專案結構
- `docs/` - 文件與部署指南
- `src/` - 程式碼
- `config/` - 設定檔（不上傳 Git）
- `_archive/` - 舊版本封存

## 技術棧
- Streamlit
- Firebase Firestore
- Python 3.9+

## 快速開始

### 本地開發
```bash
cd src
pip install -r requirements.txt
streamlit run app.py
```

### 部署
詳見 [Streamlit Cloud 部署指南](docs/deployment/streamlit-cloud.md)

## GitHub
https://github.com/keapril/code

## 功能特色
- 🏥 多醫院支援（南區醫院 + Admin 模式）
- 🔍 複合搜尋（醫院、院內碼、型號、產品名）
- 📊 Firebase Firestore 資料儲存
- 🔐 權限管理（公開/Admin 模式）
- 📤 Excel/CSV 資料上傳

## 開發者
四月實驗室
