// node tests/m02.js <m02 資料夾> [截圖資料夾] — 開啟舊系統 .m02（檔案含案件資料，不放在儲存庫）
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const DIR = process.argv[2], OUT = process.argv[3];
if (!DIR || !fs.existsSync(DIR)) { console.log('請指定 .m02 範例資料夾'); process.exit(0); }
(async () => {
  const b = await require('./launch')();
  const errs = [];
  for (const f of fs.readdirSync(DIR).filter(f => /\.m02$/i.test(f))) {
    const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
    pg.on('pageerror', e => errs.push(f + ': ' + e.message));
    pg.on('dialog', d => d.accept());
    await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
    await pg.evaluate(() => { window.print = () => {}; });
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnOpen')]);
    await fc.setFiles(path.join(DIR, f));
    await pg.waitForFunction(() => /已開啟舊檔/.test(document.getElementById('toast').textContent), null, { timeout: 15000 });
    const r = await pg.evaluate(() => ({ els: App.P.elements.length, maps: App.P.elements.filter(e => e.type === 'map').length, tables: App.P.elements.filter(e => e.type === 'table').length, lines: App.cad ? App.cad.lines.length : 0, svg: document.querySelectorAll('#content text').length }));
    const ok = r.maps >= 1 && r.tables >= 1 && r.lines > 0 && r.svg > 10;
    console.log((ok ? 'PASS ' : 'FAIL ') + f + ' ' + JSON.stringify(r));
    if (!ok) errs.push(f);
    if (OUT) {
      await pg.waitForTimeout(300);
      await pg.screenshot({ path: path.join(OUT, 'm02_' + f.replace(/\.m02$/i, '') + '.png') });
      await pg.evaluate(() => { document.getElementById('printArea').innerHTML = '<div class="printPage" style="width:420mm;height:297mm">' + Printer.sheetSVG(App.P, App.cad) + '</div>'; });
      await pg.emulateMedia({ media: 'print' });
      await pg.pdf({ path: path.join(OUT, 'm02_' + f.replace(/\.m02$/i, '') + '.pdf'), preferCSSPageSize: true, printBackground: true });
    }
    await pg.close();
  }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); process.exit(errs.length ? 1 : 0);
})();
