# CourtTask 作業規則（給 Claude / Fable 等 AI 助理）

這個專案會由不同的 AI 對話、不同的分支輪流修改。每次開始工作前，請照下面的規則做。

## 1. 先找最新版本，再動手改（最重要）

1. `git fetch --all --prune`，抓下**所有**遠端分支。
2. 每個分支都要看：
   - 最後一次提交的時間與訊息：`git log -1 --format='%h %ci %s' <分支>`
   - `dist/` 裡的版本號：`git ls-tree --name-only <分支> dist/`（例如 `CourtTask_v2.6.zip`）
   - README 裡最新的版本說明章節（例如「## v2.6：…」）
3. 找出版本號最大、時間最新的分支，**以它為基礎**接著改。如果你被指定在別的分支工作，先把最新版本合併進來（`git merge origin/<最新分支>`），不要從舊版本改起。
4. 如果有兩個分支各自改了不同的東西、版本號一樣或分不出先後，**先問使用者要以哪個為準**，不要自行判斷後覆蓋。
5. 開始改之前，先用一句話告訴使用者：「目前最新是 vX.Y，在 ○○ 分支」。

## 2. 版本與打包

- 每次交付都把版本號加一（例如 v2.6 → v2.7），並在 README 的版本說明區（「## 介面（v1.2）」之後，新的放在最上面）加一個「## vX.Y：…」章節，寫下這次改了什麼。
- 打包：`python3 tools/build.py X.Y`，會產生 `dist/CourtTask_vX.Y.zip`（內含單檔版 `CourtTask.html`、多檔版 `app/`、`README.txt`）。
- 只保留最新的 zip，舊版用 `git rm` 刪掉。
- 交付時把 zip 傳給使用者。

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
- 列印必須是 1:1 實際尺寸（A3、8K 267×388mm）。

## 5. 資料與隱私

- `.m02` 舊檔與成果 PDF 內有當事人姓名等案件資料，**不要放進儲存庫**。測試用的 m02 放在暫存資料夾，執行時用 `M02_DIR=... bash tests/run_all.sh` 指定。
- `samples/` 只放 DXF（只有座標和地號）。

## 6. 和使用者溝通

- 使用者是地政事務所的測量人員，用繁體中文溝通，說明要白話、以操作為主，少講程式細節。
- 介面要精簡、人性化，功能太多會讓同仁不想用；少用的功能要收起來，需要時再開。
- 需要使用者在內網確認的事項（字型、印表機、Chrome 管理政策等），交付時要列成清單。
