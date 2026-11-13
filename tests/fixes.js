// node tests/fixes.js — v2.5 修正項目的回歸測試（面內的島、配賦分層、復原圖資、8K 紙張方向、防呆…）
const path = require('path');
const ROOT = path.join(__dirname, '..');
(async () => {
  const b = await require('./launch')();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; let fail = 0, dialogs = [];
  pg.on('pageerror', e => errs.push(e.message));
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  pg.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  const ok = (c, name, info) => { console.log((c ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? ' ' + JSON.stringify(info) : '')); if (!c) fail++; };
  await pg.goto('file://' + path.join(ROOT, 'app', 'index.html'));
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} window.print = () => {}; });
  await pg.waitForTimeout(300);
  const imp = async (files) => {
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
    await fc.setFiles(files.map(f => path.join(ROOT, 'samples', f))); await pg.waitForTimeout(1200);
  };
  const mapPt = (dx, dy) => pg.evaluate(([dx, dy]) => { const m = App.P.elements.find(e => e.type === 'map'), r = document.querySelector('#svg').getBoundingClientRect(); return { x: r.left + (m.x + m.w / 2 + dx - App.view.ox) * App.view.z, y: r.top + (m.y + m.h / 2 + dy - App.view.oy) * App.view.z }; }, [dx, dy]);

  // 面內的島要扣掉
  let r = await pg.evaluate(() => {
    const sq = (x, y, s) => [[x, y, x + s, y], [x + s, y, x + s, y + s], [x + s, y + s, x, y + s], [x, y + s, x, y]];
    const f1 = Geom.faceAt(sq(0, 0, 10).concat(sq(4, 4, 2)), [1, 1], 0.002);
    const s2 = sq(0, 0, 20).concat(sq(4, 4, 8), sq(6, 6, 2), [[8, 4, 8, 12]]), f2 = Geom.faceAt(s2, [1, 1], 0.002), f3 = Geom.faceAt(s2, [5, 5], 0.002);
    const lp = Geom.labelPoint(f1, f1.holes);
    return [Geom.areaNet(f1, f1.holes), Geom.areaNet(f2, f2.holes), Geom.areaNet(f3, f3.holes), Geom.inPolyNet(lp, f1, f1.holes)];
  });
  ok(r[0] === 96 && r[1] === 336 && r[2] === 28 && r[3], '點選成面扣掉面內的島（含島中島）', r);

  await imp(['486.dxf']);
  // 重新匯入（取代）時，舊的線段／地號選取不會讓畫面當掉
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); App.api.selectFn({ kind: 'seg', idx: ['6000'], mapId: m.id }); });
  dialogs = []; await imp(['KC1117.DXF']);
  ok(!errs.length && !dialogs.some(d => /匯入失敗/.test(d)), '選著線段時重新匯入不報錯', { errs: errs.splice(0), n: await pg.evaluate(() => App.cad.lines.length) });
  // 復原匯入：圖資跟著退回
  await pg.waitForTimeout(500); await imp(['486.dxf']); await pg.waitForTimeout(500);
  r = await pg.evaluate(() => { const a = App.cad.lines.length; document.querySelector('[data-cmd=undo]').click(); const b = App.cad.lines.length; document.querySelector('[data-cmd=redo]').click(); return [a, b, App.cad.lines.length]; });
  ok(r[0] === 6810 && r[1] === 33 && r[2] === 6810, '復原／重做「匯入 DXF」時圖資一起切換', r);

  // 現況與分割可用同一塊；配賦只算一層、不動空白列
  r = await pg.evaluate(() => {
    const m = App.P.elements.find(e => e.type === 'map'); m.cx = 221031.88057; m.cy = 2706879.24196;
    const v = Render.mapView(m), segs = [];
    App.cad.lines.forEach(l => { const c = Geom.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1); if (c) segs.push(c); });
    const faces = Geom.buildFaces(segs, 0.002), fa = faces.find(f => Geom.area(f).toFixed(2) === '96.63'), fb = faces.find(f => Geom.area(f).toFixed(2) === '104.84');
    App.P.activeOv = 'case'; App.api.addFaceAt(m, Geom.labelPoint(fa)); App.api.addFaceAt(m, Geom.labelPoint(fb)); App.api.addFaceAt(m, Geom.labelPoint(fa));
    const nCase = App.P.features.length;
    App.P.activeOv = 'split'; App.api.addFaceAt(m, Geom.labelPoint(fa));
    App.P.features.push({ id: 'blank1', ov: 'case', code: 'X', pts: [], label: true, tableOnly: true });
    App.P.activeOv = 'case';
    document.querySelector('[data-tab=feat]').click(); document.querySelector('#regArea').value = '300'; document.querySelector('[data-act=distribute]').click();
    return { nCase, feats: App.P.features.map(f => (f.ov || 'case') + ':' + f.code + '=' + (f.areaOverride == null ? '' : f.areaOverride)) };
  });
  ok(r.nCase === 2 && r.feats.join() === 'case:A=143.89,case:B=156.11,split:甲=,case:X=', '同一塊可分屬現況與分割；配賦只算目前這一層', r);
  // 空白列勾「顯示編號」後，在略圖內點選不報錯
  errs.length = 0; await pg.evaluate(() => App.api.setTool('select'));
  let p = await mapPt(40, 40); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(200);
  ok(!errs.length, '空白列顯示編號時點略圖不報錯', errs.splice(0));
  // 標號選取、方向鍵
  await pg.evaluate(() => App.api.setTool('mark')); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(200); await pg.keyboard.press('ArrowLeft'); await pg.waitForTimeout(100);
  ok(!errs.length, '標號選取與方向鍵微調不報錯', errs.splice(0));
  // 數字欄清空、比例尺 0 不會寫入
  await pg.evaluate(() => { App.api.setTool('select'); App.folds.geo = true; const m = App.P.elements.find(e => e.type === 'map'); App.api.selectFn({ kind: 'el', id: m.id }); });
  await pg.fill('#props [data-k=scale]', ''); await pg.fill('#props [data-k=scale]', '0'); await pg.fill('#props [data-k=x]', ''); await pg.waitForTimeout(200);
  r = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); return [m.scale, m.x]; });
  ok(r[0] === 500 && r[1] === 168.4 && !errs.length, '數字欄清空或填 0 時保留原值', { r, errs: errs.splice(0) });
  // ＋／－以畫面中心縮放
  r = await pg.evaluate(() => { const st = document.querySelector('#stage').getBoundingClientRect(), c = () => [App.view.ox + st.width / App.view.z / 2, App.view.oy + st.height / App.view.z / 2]; const a = c(); document.querySelector('[data-cmd=zin]').click(); const b = c(); App.api.fitView(); return Math.hypot(a[0] - b[0], a[1] - b[1]); });
  ok(r < 0.01, '工具列縮放以畫面中心為基準', r);
  // 8K：預設範本自動框選 → 自動改橫式；真的放不下會提醒
  r = await pg.evaluate(() => { document.querySelector('[data-tab=out]').click(); document.querySelector('[data-act=regionAuto]').click(); const pgk = Printer.k8Page(App.P), o = App.P.output.k8; return { pgk, need: [o.region.w + o.offX, o.region.h + o.offY], status: document.querySelector('#k8Status').textContent }; });
  ok(!r.pgk.swapped && r.pgk.fits && r.pgk.w === 388 && r.pgk.h === 267 && r.need[0] <= 388 && r.need[1] <= 267 && /放得下/.test(r.status), '8K 預設橫放 388×267，自動框選放得下', r);
  r = await pg.evaluate(() => { const d = JSON.parse(JSON.stringify(App.api.fileData())); d.project.output.k8.w = 267; d.project.output.k8.h = 388; App.api.loadData(d); const o = App.P.output.k8; App.P.fields.note1 = '1'; return [o.w, o.h]; });
  await pg.waitForTimeout(500);
  ok(r[0] === 388 && r[1] === 267, '舊專案的 8K 直式設定開啟時改成橫式', r);
  dialogs = [];
  r = await pg.evaluate(() => { let n = 0; window.print = () => { n++; }; const o = App.P.output.k8, keep = JSON.stringify(o.region); o.region = { x: 0, y: 0, w: 420, h: 297 }; document.querySelector('#toolbar [data-cmd=print8k]').click(); o.region = JSON.parse(keep); return new Promise(res => setTimeout(() => res(n), 200)); });
  ok(dialogs.some(d => /超出/.test(d)), '8K 範圍比紙張大時先提醒', dialogs.map(d => d.slice(0, 30)));
  // 清冊 CSV：25-4 不會被 Excel 當成日期
  r = await pg.evaluate(() => { const f = App.P.features[0]; f.inRegister = true; f.landNo = '25-4'; const s = Printer.registerCSV(App.P, App.P.elements.find(e => e.type === 'ftable')); f.inRegister = false; return s; });
  ok(r.indexOf('"=""25-4"""') > 0, '清冊 CSV 的地號以文字輸出');
  // 未儲存記號
  await pg.waitForTimeout(700);
  r = await pg.evaluate(() => [App.dirty, document.title.indexOf('●') === 0, document.querySelector('#fileName').textContent]);
  ok(r[0] && r[1], '有修改時標題顯示未儲存記號', r);
  // 量距 → Enter 標註；右鍵完成畫線；Ctrl+C / Ctrl+V
  await pg.evaluate(() => { App.P.annos = []; App.P.userLines = []; App.api.setTool('measure'); });
  let a = await mapPt(-70, -70), c = await mapPt(-30, -70);
  await pg.mouse.click(a.x, a.y); await pg.mouse.move(c.x, c.y); await pg.mouse.click(c.x, c.y); await pg.keyboard.press('Enter'); await pg.waitForTimeout(150);
  r = await pg.evaluate(() => App.P.annos.map(x => x.text));
  ok(r.length === 1 && Math.abs(parseFloat(r[0]) - 20) < 1.5, '量距後按 Enter 標註距離（40mm＠1/500≈20m）', r);
  await pg.evaluate(() => App.api.setTool('line'));
  await pg.mouse.click(a.x, a.y + 20); await pg.mouse.move(c.x, c.y + 20); await pg.mouse.click(c.x, c.y + 20); await pg.mouse.click(c.x, c.y + 30, { button: 'right' }); await pg.waitForTimeout(150);
  r = await pg.evaluate(() => [App.P.userLines.length, !!App.draw, document.querySelector('#ctx').hidden]);
  ok(r[0] === 1 && !r[1] && r[2], '畫線時按右鍵完成', r);
  r = await pg.evaluate(() => { App.api.setTool('select'); const n = App.P.elements.length, t = App.P.elements.find(e => e.name === '主任'); App.api.selectFn({ kind: 'el', id: t.id }); return n; });
  await pg.keyboard.press('Control+c'); await pg.keyboard.press('Control+v'); await pg.waitForTimeout(150);
  ok(await pg.evaluate(n => App.P.elements.length === n + 1, r), 'Ctrl+C／Ctrl+V 複製貼上元件');
  // 存檔往返後島仍在、面積不變
  r = await pg.evaluate(() => { App.P.features[0].holes = [[[0, 0], [1, 0], [1, 1], [0, 1]]]; const before = Render.featureArea(App.P.features[0], 2); App.P.features[0].areaOverride = null; const a1 = Render.featureArea(App.P.features[0], 2); App.api.loadData(JSON.parse(JSON.stringify(App.api.fileData()))); return [a1, Render.featureArea(App.P.features[0], 2), App.dirty]; });
  ok(r[0] === '95.63' && r[1] === '95.63' && r[2] === false, '島隨專案檔保存；載入後不算未儲存', r);
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); process.exit(fail || errs.length ? 1 : 0);
})();
