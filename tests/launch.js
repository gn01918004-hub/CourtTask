// 共用的瀏覽器啟動設定。
// 預設用 Playwright 內建的 Chromium；設定 CHROME_PATH 可改用指定版本（例如與內網相同的 Chrome 147）：
//   CHROME_PATH=/path/to/chromium node tests/e2e.js
const { chromium } = require('playwright');
module.exports = function launch() {
  const p = process.env.CHROME_PATH;
  if (!p) return chromium.launch();
  return chromium.launch({
    executablePath: p,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });
};
