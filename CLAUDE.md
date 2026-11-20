# CourtTask 作業規則（給 Claude / Fable 等 AI 助理）

這個專案會由不同的 AI 對話、不同的分支輪流修改。每次開始工作前，請照下面的規則做。

## 1. 先找最新版本，再動手改（最重要）

1. `git fetch --all --prune`，抓下**所有**遠端分支。
2. 每個分支都要看：
   - 最後一次提交的時間與訊息：`git log -1 --format='%h %ci %s' <分支>`
   - 程式裡的版本號：`git show <分支>:app/js/version.js | grep APP_VERSION`（例如 `'2.12'`）
   - 已發布的最新 Release（GitHub MCP 的 `get_latest_release`）
   - README 裡最新的版本說明章節（例如「## v2.6：…」）
3. 找出版本號最大、時間最新的分支，**以它為基礎**接著改。如果你被指定在別的分支工作，先把最新版本合併進來（`git merge origin/<最新分支>`），不要從舊版本改起。
4. 如果有兩個分支各自改了不同的東西、版本號一樣或分不出先後，**先問使用者要以哪個為準**，不要自行判斷後覆蓋。
   `main` 是穩定版：交付後經使用者同意，把最新版本合併回 `main`，讓之後從 `main` 開始的對話也能拿到最新版與這份規則。
5. 開始改之前，先用一句話告訴使用者：「目前最新是 vX.Y，在 ○○ 分支」。

## 2. 版本與發布（GitHub Releases）

- 版本號**只寫在 `app/js/version.js`**（`window.APP_VERSION = 'X.Y'`）。每次交付加一（例如 2.12 → 2.13），畫面左上角會自動顯示。
- 在 README 的版本說明區（「## 介面（v1.2）」之後，新的放在最上面）加一個「## vX.Y：…」章節，寫下這次改了什麼；Release 說明就從這段擷取，沒寫打包會失敗。
- 打包：`python3 tools/build.py`，產生 `dist/CourtTask.html`（單檔版）與 `dist/release_notes.md`。`dist/` 不進版控，儲存庫不放 zip。
- 發布：經使用者同意合併到 `main` 後，GitHub Actions（`.github/workflows/release.yml`）自動建立 Release「法院略圖繪製系統 vX.Y」（tag `vX.Y`），附件檔名固定為 `CourtTask.html`，不含版本號。
  - 最新版下載網址永遠是 `https://github.com/gn01918004-hub/CourtTask/releases/latest/download/CourtTask.html`。
  - 版本號沒變的話不會重發；要重傳附件就手動執行該 workflow。
- 交付時把 `dist/CourtTask.html` 傳給使用者，並附上 Release 的連結。

## 3. 測試（交付前必做）

- 全部測試：`bash tests/run_all.sh`
- 內網用的是 **Chrome 147**，交付前要用 147 跑過：
  - `npm install @sparticuz/chromium@147.0.2`（安裝在暫存資料夾）
  - `node -e "import('@sparticuz/chromium').then(async m => console.log(await m.default.executablePath()))"`
  - `CHROME_PATH=<上一步印出的路徑> bash tests/run_all.sh`
- 新功能要在 `tests/` 裡補上對應的測試。
- 散發版一定要通過 `tests/dist.js`（斷網環境、不能有任何對外連線）。

## 4. 系統限制（內網環境）

- 內網電腦**不能連網**：不能使用任何 CDN 或外部資源，所有程式都要放在 `app/` 裡，用 `file://` 直接開啟。
- script 只能用一般的 `<script src>`，不能用 ES module（`file://` 下不能載入）。
- 字型使用 Windows 內建的標楷體（DFKai-SB）與 Arial。
- 列印必須是 1:1 實際尺寸：A3 成果圖為橫式 420×297mm；套印紙張 8K 為**橫放 寬 388 × 高 267mm**（紙夾標示 267×388，v2.5 起預設橫放），也可選 A3 橫式。

## 5. 資料與隱私

- `.m02` 舊檔與成果 PDF 內有當事人姓名等案件資料，**不要放進儲存庫**。測試用的 m02 放在暫存資料夾，執行時用 `M02_DIR=... bash tests/run_all.sh` 指定。
- `samples/` 只放 DXF（只有座標和地號）。

## 6. 和使用者溝通

- 使用者是地政事務所的測量人員，用繁體中文溝通，說明要白話、以操作為主，少講程式細節。
- 介面要精簡、人性化，功能太多會讓同仁不想用；少用的功能要收起來，需要時再開。
- 需要使用者在內網確認的事項（字型、印表機、Chrome 管理政策等），交付時要列成清單。
