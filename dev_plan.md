# 開發計畫與進度記錄

## 📅 2026-04-10 完成項目

### ✅ 修正 Next.js 部署細節

1. **本地 Build 驗證**
   - 在本地執行 `npm run build`，確認程式碼無 TypeScript 錯誤，build 乾淨通過。

2. **修正 `layout.tsx`**
   - 移除 create-next-app 預設的 Geist 字型（重複，已用 Noto Serif TC）。
   - 更新網頁標題為「院內碼查詢系統」。
   - 更新 meta description 為中文版本。
   - 設定語言為 `zh-Hant`。

3. **修正 `globals.css` CSS @import 順序**
   - 將 Google Fonts `@import` 移至 `@import "tailwindcss"` 之前，消除 build warning。

4. **清理雜檔**
   - 刪除 `WHERE_AM_I.txt` 測試檔案。

5. **推送更新**
   - 已推送至 GitHub `main` 分支（版本 `6e1bbff`）。
   - Cloudflare Pages 應已觸發自動重新部署。

### 🗂️ 2026-04-10 Git 提交記錄

```text
6e1bbff - fix: 修正 layout 標題與 CSS import 順序，清理測試雜檔
```

### ⏳ 下一步待確認
- [ ] 登入 Cloudflare Pages Dashboard，確認 `6e1bbff` 版本部署成功
- [ ] 點開 `.pages.dev` 網址確認 UI 正常顯示
- [ ] 在舊版 Streamlit 上傳一次資料，讓 Python 產生 `medical_products.json` 並寫入 R2
- [ ] 回到新版網頁確認資料能正常讀取

---

## 📅 2026-04-09 完成項目 (重大里程碑：遷移至 Next.js)

### ✅ 實作「院內碼查詢系統」Next.js 版

1. **問題分析**
   - Streamlit Cloud 的休眠機制導致使用者需要手動點擊「Wake up」，影響查詢效率。
   - UptimeRobot 等防休眠手段因平台限制逐漸失效。

2. **架構決定**
   - **前端**：使用 Next.js + TypeScript 並部署至 Cloudflare Pages，達成「零休眠」。
   - **資料**：維持使用 R2，但由原本的 Parquet 加存一份 JSON 檔以優化 JS 讀取效能。

3. **實作內容**
   - **正名**：全系統正式更名為「院內碼查詢系統」。
   - **UI 升級**：日系極簡美學，森林綠配色，Noto Serif TC 字體，行動裝置優先設計。
   - **API 介面**：實作 Edge Runtime API Route 抓取 R2 資料。
   - **搜尋邏輯**：完整移植並優化 Python 版的智慧關鍵字過濾演算法。

4. **後續步驟**
   - 使用者需在舊版系統上傳資料以生成 JSON 檔案。
   - 在 Cloudflare Pages 設定 R2 環境變數。

---

## 📅 2026-04-09 下午 — Cloudflare Pages 部署排錯紀錄

### 🔧 今日作戰情報（留存給明天繼續）

#### 已完成的部分
- [x] 修正 `.gitignore`：新增 `!web/*.json` / `!web/**/*.json` 例外，並排除 `web/node_modules/` 與 `web/.next/`
- [x] 強制推送所有 Next.js 必要源碼（`s3.ts`、`route.ts`、`page.tsx`、`layout.tsx`、`globals.css`、`package.json`、`tsconfig.json` 等），版本號：`5a66d9e`
- [x] 確認 GitHub 上的 `main` 分支已包含完整的 `web/` 目錄結構
- [x] 在 Cloudflare 建立全新的 **Pages 專案**（非 Worker），已設定：
  - **Root directory**: `/web`
  - **Build command**: `npm run build`
  - **Build output directory**: `.next`
  - **NODE_VERSION**: `20`
  - **R2 環境變數**：ACCESS_KEY、SECRET_KEY、ENDPOINT_URL、BUCKET_NAME 均已設定

#### 踩到的坑（教訓紀錄）
1. **舊 Worker 專案鬼打牆**：原有的 `code` Worker 專案被 Cloudflare 快取死鎖，不論推送幾次都固定抓取 `4528f52` 舊版。**解法**：刪除舊專案，改走 `Pages` 流程重建。
2. **`*.json` 被 .gitignore 排除**：原有規則把所有 JSON 包含 `package.json` 都過濾掉，導致 Cloudflare 找不到依賴清單而報錯。**解法**：補上 `!web/*.json` 例外。
3. **`web/node_modules/` 差點被推上去**：執行 `git add -f web/` 時誤把 `node_modules` 的幾萬個檔案加入暫存區。**解法**：`git reset HEAD web/node_modules/` 移除。
4. **`s3.ts` 等源碼未被追蹤**：因 `.gitignore` 規則的副作用，`web/src/` 下的 TypeScript 檔案未被 Git 追蹤。**解法**：逐一 `git add -f` 強制加入。

#### 明天待辦事項
- [x] **確認最新部署是否成功**：本地 `npm run build` 通過（v6e1bbff），CSS warning 已修正
- [ ] **確認 Cloudflare Pages 部署**：上 Cloudflare Dashboard 查看 `6e1bbff` 的部署日誌是否通過
- [ ] **若部署成功**：點開 `.pages.dev` 網址，確認網頁顯示，並在舊版 Streamlit 上傳資料以生成 R2 的 JSON 檔案
- [x] **清理雜檔**：已刪除 `WHERE_AM_I.txt`

---


## 📅 2026-04-07 完成項目

### ✅ 修正檔案上傳型別錯誤 (float is not iterable)

1. **問題分析**
   - 使用者在 `Settings` 頁面更新資料庫時發生 `處理錯誤: argument of type 'float' is not iterable`。
   - 原因是 Excel 中含有空值 (NaN) 或非字串型別，導致程式在進行 `in` 比對時崩潰。

2. **解決方案**
   - **強化轉型**：在 `src/app.py` 將 `astype(str)` 改為 `fillna('').astype(str)`，徹底確保所有內容均為字串，排除 NaN 干擾。
   - **安全比對**：將 `apply(lambda x: '型號' in x)` 替換為 `str.contains('型號', na=False)`，提升標題列偵測的穩定性。
   - **防禦性程式碼**：在醫院白名單比對處增加 `str()` 強制轉換，防止異常資料儲存格導致迴圈中斷。

3. **自動部署**
   - 已將修正後的程式碼推送到 GitHub `main` 分支。
   - Streamlit Cloud 已自動完成部署，使用者可重新執行檔案上傳驗證。

### 🗂️ 2026-04-07 Git 提交記錄

```text
4528f52 - fix(upload): 修正檔案上傳時 float is not iterable 的錯誤
```

---

## 📅 2026-04-01 完成項目

### ✅ 修復搜尋功能 (Pandas 版本相容性)

1. **問題分析**
   - 使用者反應搜尋功能故障，畫面顯示 `AttributeError`。
   - 經檢查為新版 Pandas (2.1.0+) 將 `Styler.applymap` 棄用，並在 2.2.0 中移除。
   - 導致 Streamlit 在嘗試渲染查詢結果 DataFrame 時崩潰。

2. **解決方案**
   - 將 `src/app.py` 中的 `Styler.applymap` 語法修正為全域通用的 `Styler.map`。
   - 優化顏色標註邏輯，確保與 CSS 變數 `--accent-color` (#6D8B74) 保持一致。

3. **自動部署**
   - 已將修正後的程式碼推送到 GitHub `main` 分支。
   - Streamlit Cloud 已自動偵測並完成重新部署。
   - ✅ 經驗證搜尋功能已回復正常。

### 🗂️ 2026-04-01 Git 提交記錄

```text
f3d4fad - fix(search): 將 Styler.applymap 修正為 Styler.map 以相容新版 Pandas
```

---

## 📅 2026-03-26 完成項目

### ✅ 解決 Streamlit Cloud 休眠問題

1. **問題分析**
   - Streamlit Cloud 免費版在閒置後會進入休眠，需手動按「Yes, get this app back up!」才能喚醒
   - 先前嘗試使用 GitHub Actions 每 5 分鐘 curl 心跳，但 `curl` 無法建立真實 WebSocket 連線，對 Streamlit 無效

2. **嘗試 GitHub Actions + Selenium（最終放棄）**
   - 建立 `.github/scripts/keep_alive.py`：使用 Selenium 模擬瀏覽器真實開啟網頁並點擊喚醒按鈕
   - 建立 `.github/workflows/heartbeat.yml`：排程每天執行並附截圖存檔供除錯
   - **根本問題**：原本排程為每 5 分鐘一次，導致一個月累積 900+ 次執行，GitHub 系統將此 Repo 的 Actions 標記為疑似濫用並永久封鎖（`Repository access blocked`）
   - 移除曾加入的 `keepalive-workflow` 第三方套件（該套件需要 write 權限 push commit，是封鎖的直接觸發點）
   - 最終決策：從 Repo 完全移除所有 Actions 相關檔案

3. **最終解法：UptimeRobot（成功）**
   - 使用 [uptimerobot.com](https://uptimerobot.com) 免費服務
   - 設定每 5 分鐘 HTTP(s) Ping `https://southcode.streamlit.app/`
   - 免費版提供 50 個監控名額，無隱藏限制，不需要信用卡
   - ✅ 已成功設定並啟用

### 🗂️ 2026-03-26 Git 提交記錄

```text
7f61f28 - 移除 GitHub Actions 心跳腳本，改由 UptimeRobot 負責防休眠
2430cf2 - 移除 keepalive-workflow 解決 Repository access blocked
277b530 - 給予 heartbeat.yml actions 和 contents 寫入權限（最終放棄此路線）
3d3a49b - 把截圖檔加上 upload-artifact 方便觀察
70c6563 - 強化 Selenium 按鈕尋找邏輯並新增截圖
0510e35 - 更新 Streamlit 心跳喚醒腳本與排程
```

### 📌 目前防休眠架構

| 任務             | 工具            | 頻率      |
|------------------|-----------------|-----------|
| Streamlit 防休眠 | **UptimeRobot** | 每 5 分鐘 |
| GitHub Actions   | 已全數移除      | —         |

---

## 📅 2026-01-27 完成項目

### ✅ 已完成的修正與優化

1. **R2 上傳頁面閃爍問題修復**
   - 增加「🚀 確認更新資料庫」按鈕，打斷 Streamlit 的無限 Rerun 迴圈
   - 優化資料載入邏輯為惰性載入（Lazy Loading）
   - 減少不必要的 R2 請求，提升操作流暢度

2. **檔案版本顯示功能**
   - 在 R2 中繼資料中存儲原始檔名
   - 在左側 Sidebar 顯示「Version: H_PX 20260123.xlsx」
   - 方便追蹤當前使用的資料版本

3. **高醫 Agilis NxT 院內碼重複問題修復**
   - 增強日期正則表達式，支援空格與橫線（如 `113 / 8 / 7`）
   - 實作區塊化解析，確保日期能正確歸屬於對應的院內碼
   - 透過日期優先邏輯排除舊的院內碼

4. **中國體系 610132/610133 配對問題修復**
   - 實作智慧括號配對邏輯 V2
   - 只有當括號內容完全吻合產品型號時才啟用精確配對
   - 確保 `#1809411(610132)` 只配對 610132，`#1809412(610133)` 只配對 610133

5. **分組日期優先邏輯**
   - 根據括號內容分組後再進行日期優先選擇
   - 不同括號內容代表不同產品，不應互相排除
   - 解決日期優先邏輯錯誤導致的院內碼消失問題

6. **全域日期優先去重邏輯**
   - 在 final_item 中加入日期資訊
   - 在去重前按日期降序排序
   - 根據「醫院+產品+型號」去重，保留日期最新的院內碼
   - 確保高醫等醫院不會顯示舊的院內碼

7. **requirements.txt 補齊**
   - 建立 `requirements.txt` 並補齊 `s3fs`、`pyarrow` 等必要套件
   - 解決 Streamlit Cloud 部署時的 ModuleNotFoundError

### 🛠️ 技術改進

- **日期解析增強**：支援 `113/8/7`、`113 / 8 / 7`、`113.8.7`、`113-8-7` 等多種格式
- **區塊化解析**：以 `#` 為分界點，確保每個院內碼的上下文完整
- **智慧配對**：根據產品型號清單動態判斷是否啟用精確配對
- **多層去重**：分組去重 + 全域去重，雙重保障資料正確性

---

## 🎯 下次開發的 3 件優先事項

### 1. 完整驗證與測試

- [ ] 重新上傳最新的 Excel 資料到系統
- [ ] 測試高醫 Agilis NxT：確認只顯示 `21869302`，無舊碼
- [ ] 測試中國體系 Angio Seal：確認 `610132 → 1809411`，`610133 → 1809412`
- [ ] 測試其他醫院的產品，確認無重複或消失問題
- [ ] 驗證檔案版本顯示功能是否正常

### 2. UI/UX 優化

- [ ] 優化初次載入速度（如有需要）
- [ ] 考慮增加「最近更新記錄」功能，顯示最近 5 次上傳的檔案版本
- [ ] 評估是否需要增加「院內碼歷史記錄」功能

### 3. 資料處理邏輯強化（視測試結果而定）

- [ ] 如發現其他特殊格式，調整解析邏輯
- [ ] 考慮增加「資料驗證報告」，上傳後自動檢查潛在問題
- [ ] 評估是否需要支援批次匯出功能

---

## 📝 已知問題與待確認事項

### 目前狀態

- ✅ R2 上傳閃爍問題已修復
- ✅ 高醫 Agilis NxT 重複問題已修復
- ✅ 中國體系 610132/610133 配對問題已修復
- ⏳ 等待使用者驗證最新部署結果

### 需要使用者確認

1. **最新部署驗證**
   - 確認高醫和中國體系的院內碼是否都正確
   - 確認檔案版本顯示功能是否正常
   - 確認上傳流程是否順暢（無閃爍）

---

## 🔧 技術細節記錄

### 關鍵修改的檔案

- `src/app.py` - 主程式邏輯（多次優化）
- `requirements.txt` - 新增套件依賴
- `.gitignore` - 排除敏感檔案

### 🗂️ 2026-01-27 Git 提交記錄

```
d4cbd4d - 修復高醫重複問題：實作全域日期優先去重邏輯
7d5cfcb - 修復 610132 消失問題：實作分組日期優先邏輯
4fd36e6 - 實作智慧括號配對邏輯 V2，修復中國體系院內碼配對錯誤
8625cc0 - 移除括號型號精確配對邏輯，修復中國體系 610132 消失問題
294028d - 修復高醫 Agilis NxT 院內碼重複、增加檔案版本記錄與修復 R2 上傳閃爍問題
f13b9cd - 建立 requirements.txt 並補齊 s3fs, pyarrow 等依賴
```

### 部署環境

- **平台**：Streamlit Cloud
- **儲存**：Cloudflare R2（Parquet 格式）
- **GitHub**：<https://github.com/keapril/code>
- **網址**：<https://southcode.streamlit.app/>

---

## 📅 2026-01-26 完成項目

### ✅ 已完成的修正與優化

1. **醫院白名單更新**
   - 根據 `H-list.txt` 更新 `PUBLIC_HOSPITALS` 清單
   - 確保所有南區醫院都在白名單中

2. **院內碼日期過濾邏輯修復**
   - 支援民國年格式（如 `113/01/15` → `2024/01/15`）
   - 優先選擇有日期且日期最新的院內碼
   - 解決高醫 Agilis NxT 等產品的院內碼判斷錯誤

3. **多型號組合搜尋修復**
   - 支援分號、逗號、換行拆分型號（如 `407449;407439;407441`）
   - 每個型號都能被單獨精準搜尋
   - 修復搜尋引擎的正則表達式問題（`regex=False`）

4. **括號內型號與院內碼配對邏輯**
   - 正確解析 `#1809411(610132)(祐新)` 格式
   - 將括號內的型號（如 `610132`）與對應院內碼配對
   - 支援一物一碼的查詢需求

5. **院內碼重複顯示問題修復**
   - 當院內碼有額外型號時，只建立一筆資料
   - 避免與產品型號交叉組合導致重複

6. **Git 倉庫初始化與部署**
   - 完成 Git 初始化與 GitHub 關連
   - 成功推送所有修正到 GitHub
   - Streamlit Cloud 自動部署設定完成

7. **資料儲存遷移**
   - 從 Firebase 遷移至 Cloudflare R2
   - 使用 Parquet 格式優化儲存效率
   - 解決 Firebase 流量限制問題

---

## 💡 備註

- 所有程式碼修正都已推送到 GitHub main 分支
- Streamlit Cloud 會自動偵測 GitHub 更新並重新部署（約 1-2 分鐘）
- 如果部署失敗，請檢查 Streamlit Cloud 的 Logs 查看錯誤訊息
- 記得定期備份 R2 的資料（Parquet 檔案）
- API 額度有限，修改前請先確認邏輯無誤再部署

---

**最後更新時間**：2026-04-10 11:34
