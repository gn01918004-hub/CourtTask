// node tests/e2e.js — 以 Chromium 實際操作：匯入 DXF、點選成面、輸出 A3/8K PDF
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} window.print = () => {}; window.confirm = () => true; });
  await pg.waitForTimeout(300);
  // 匯入 DXF（透過檔案選擇）
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
  await fc.setFiles([path.join(__dirname, '..', 'samples', '486.dxf')]);
  await pg.waitForTimeout(800);
  // 填案件資料
  await pg.evaluate(() => {
    Object.assign(App.P.fields, { office: '苗栗縣通霄地政事務所', county: '苗栗', town: '通霄', section: '城北', landNo: '486',
      courtDoc: '臺灣苗栗地方法院115年10月05日苗院科民信115苗簡674字第1159008815號函。', matter: '115年度苗簡字第674號○○○與○○○等間塗銷地上權等事件。',
      recvY: '115', recvM: '10', recvD: '29', recvWord: '通數土', recvNo: '54800', surveyY: '115', surveyM: '10', surveyD: '30' });
  });
  // 依 486f 範例裁切框置中
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); m.cx = 221031.88057; m.cy = 2706879.24196; });
  // 點選成面：A~I 範例中心點（世界座標）
  const expect = ['96.63','104.84','103.16','107.11','212.02','110.20','88.04','90.81','75.51'];
  const areas = await pg.evaluate((expect) => {
    const m = App.P.elements.find(e => e.type === 'map'), v = Render.mapView(m), segs = [];
    App.cad.lines.forEach(l => { const c = Geom.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1); if (c) segs.push(c); });
    const faces = Geom.buildFaces(segs, 0.002);
    expect.forEach(a => { const f = faces.find(f => Geom.area(f).toFixed(2) === a); if (f) App.api.addFaceAt(m, Geom.labelPoint(f)); });
    const notes = ['79號之2','79號之1','79號','78號之1','78號及76號','77號之2','倉庫','倉庫','倉庫'];
    App.P.features.forEach((f, i) => f.note = notes[i]);
    return App.P.features.map(f => f.code + '=' + Geom.area(f.pts).toFixed(2));
  }, expect);
  console.log('features:', areas.join(' '));
  if (areas.length !== 9) errs.push('expected 9 features');
  await pg.evaluate(() => { App.api.selectFn(null); App.api.render(); });
  await pg.waitForTimeout(400);
  await pg.screenshot({ path: path.join(OUT, 'editor.png') });
  // 選取表格，拖拉格線
  // A3 PDF
  await pg.evaluate(() => { document.getElementById('pageStyle').textContent = '@page{size:420mm 297mm;margin:0}'; document.getElementById('printArea').innerHTML = '<div class="printPage" style="width:420mm;height:297mm">' + Printer.sheetSVG(App.P, App.cad) + '</div>'; });
  await pg.emulateMedia({ media: 'print' });
  await pg.pdf({ path: path.join(OUT, 'a3.pdf'), preferCSSPageSize: true, printBackground: true });
  await pg.emulateMedia({ media: 'screen' });
  // 8K
  await pg.evaluate(() => {
    const ft = App.P.elements.find(e => e.type === 'ftable'); const b = Render.bounds(ft, App.P);
    App.P.output.k8.region = { x: b.x - 1, y: 40, w: b.w + 2, h: b.y + b.h + 1 - 40 };
    const o = App.P.output.k8;
    document.getElementById('pageStyle').textContent = '@page{size:' + o.w + 'mm ' + o.h + 'mm;margin:0}';
    document.getElementById('printArea').innerHTML = '<div class="printPage" style="width:' + o.w + 'mm;height:' + o.h + 'mm">' + Printer.regionSVG(App.P, App.cad) + '</div>';
  });
  await pg.emulateMedia({ media: 'print' });
  await pg.pdf({ path: path.join(OUT, '8k.pdf'), preferCSSPageSize: true, printBackground: true });
  // 存檔/讀檔往返
  const ok = await pg.evaluate(() => { const d = JSON.stringify(App.api.fileData()); App.api.loadData(JSON.parse(d)); return App.P.features.length + ' features, ' + App.cad.lines.length + ' lines, size ' + d.length; });
  console.log('roundtrip:', ok);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
  if (errs.length) process.exit(1);
})();
