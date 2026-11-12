// node tests/case641.js [輸出資料夾] — 重現中溝 641 方案三：1/2000、16 筆分割範圍、所有權人欄、面積配賦
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2];
(async () => {
  const b = await require('./launch')();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) errs.push(n); };
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await pg.evaluate(() => { window.print = () => {}; });
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
  await fc.setFiles(path.join(__dirname, '..', 'samples', '641', 'plan3_1140822.dxf'));
  await pg.waitForFunction(() => App.cad && App.cad.lines.length > 9000);
  // 只有分割線的 DXF：匯入後自動切到分割；就算手動切回現況，點選成面也會用分割線
  const ov0 = await pg.evaluate(() => App.P.activeOv);
  check('只有分割線 → 自動切換編輯層為分割 (' + ov0 + ')', ov0 === 'split');
  const a0 = await pg.evaluate(() => {
    const m = App.P.elements.find(e => e.type === 'map'); m.scale = 2000; App.api.centerMap(m, 'auto');
    App.P.activeOv = 'case';
    const t = App.cad.texts.find(t => t.layer === 'PAR_2' && t.text === '641');
    App.api.addFaceAt(m, [t.x, t.y]); const a = Render.featureArea(App.P.features[0], 2);
    App.P.features = []; App.P.activeOv = 'split'; return a;
  });
  check('編輯層停在現況時點選成面仍用分割線 (' + a0 + ')', a0 === '2117.49');
  // 標號：只有編號、不算面積
  await pg.keyboard.press('m');
  const mk = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); const r = document.getElementById('svg').getBoundingClientRect(); return [r.left + (m.x + m.w * 0.2 - App.view.ox) * App.view.z, r.top + (m.y + m.h * 0.2 - App.view.oy) * App.view.z]; });
  await pg.mouse.click(mk[0], mk[1]); await pg.waitForTimeout(150);
  const mkr = await pg.evaluate(() => { const f = App.P.features[0]; const ft = App.P.elements.find(e => e.type === 'ftable'); const tm = Render.tableModel(ft, App.P); const c = tm.cells.find(c => c.fid === f.id && c.c === 1); const svg = document.querySelector('#content').innerHTML.indexOf('>' + f.code + '<') >= 0; return { code: f.code, pt: !!f.pt, area: c && c.text, svg }; });
  check('標號 ' + JSON.stringify(mkr), mkr.pt && mkr.code === '甲' && mkr.area === '' && mkr.svg);
  await pg.evaluate(() => { App.P.features = []; App.api.render(); });
  await pg.keyboard.press('v');
  const official = { A: 2117.49, B: 2229.36, C: 3713.67, D: 2610.87, E: 3914.43, F1: 1867.13, G: 1572.06, H: 1142.36, I: 1713.54, J: 5711.80, K: 7259.97, L: 1893.86, F2: 573.59, M: 3157.94, N: 702.58, O: 944.29 };
  const res = await pg.evaluate((official) => {
    const P = App.P, m = P.elements.find(e => e.type === 'map');
    Object.assign(P.fields, { office: '苗栗縣通霄地政事務所', title: '土地複丈成果圖 ({plan})', county: '苗栗縣', town: '苑裡鎮', section: '中溝段', section: '中溝', landNo: '641、643、646' });
    P.plans[0].name = '方案三';
    P.activeOv = 'split'; m.scale = 2000; m.tsFeat = 0.5; m.tsTarget = 0.5; m.tsParcel = 0.3; App.api.centerMap(m, 'auto');
    const codes = Object.keys(official);
    App.cad.texts.filter(t => t.layer === 'PAR_2').forEach((t, i) => { App.api.addFaceAt(m, [t.x, t.y]); });
    P.features.forEach((f, i) => { f.code = codes[i]; f.owner = '所有權人' + (i + 1); f.landNo = ''; });
    const ft = P.elements.find(e => e.type === 'ftable');
    App.api.selectFn({ kind: 'el', id: ft.id });
    return P.features.map(f => [f.code, Render.featureArea(f, 2)]);
  }, official);
  console.log(res.map(r => r.join('=')).join(' '));
  const exact = res.filter(([c, a]) => Math.abs(+a - official[c]) < 0.001).length;
  check(`computed areas: ${exact}/16 equal official before 配賦 (others differ by 0.01)`, exact >= 13 && res.every(([c, a]) => Math.abs(+a - official[c]) <= 0.0101));
  await pg.selectOption('[data-act-sel=tstyle]', 'owner');
  await pg.click('.tabs [data-tab=feat]');
  await pg.evaluate(() => document.querySelectorAll('#tab-feat details').forEach(d => d.open = true));
  await pg.fill('#regArea', '41124.94'); await pg.dispatchEvent('#regArea', 'change');
  await pg.click('[data-act=distribute]');
  const sum = await pg.evaluate(() => App.P.features.reduce((a, f) => a + parseFloat(Render.featureArea(f, 2)), 0).toFixed(2));
  check('配賦後合計 = 登記面積 41124.94 (' + sum + ')', sum === '41124.94');
  // Shift 併入：A 併 B
  const u = await pg.evaluate(() => {
    const P = App.P, m = P.elements.find(e => e.type === 'map'); const A = P.features[0], B = P.features[1];
    const pb = Geom.labelPoint(B.pts); App.api.selectFn({ kind: 'feature', id: A.id, mapId: m.id }); App.api.addFaceAt(m, pb, true);
    const r = Geom.area(A.pts).toFixed(2); return r;
  });
  check('Shift 併入 A+B = 4346.85 (' + u + ')', Math.abs(u - (2117.49 + 2229.36)) < 0.02);
  await pg.evaluate(() => { App.P.features.splice(1, 1); App.api.selectFn(null); App.api.render(); });
  await pg.waitForTimeout(300);
  // 非本案地號不壓在本案範圍（說明項目）上
  const inside = await pg.evaluate(() => {
    const m = App.P.elements.find(e => e.type === 'map'), ly = Render.layoutLabels(m, App.P, App.cad), out = [];
    Object.keys(ly.text).forEach(k => {
      const t = App.cad.texts[k]; if (Render.roleOf(App.P, t.layer, 'text') !== 'parcelNo') return;
      const p = ly.text[k], inF = q => App.P.features.some(f => Geom.pointInPoly(q, f.pts));
      if (inF(p) && !inF([t.x, t.y])) out.push(t.text);   // 原本在外面卻被移進本案範圍
    });
    return out;
  });
  check('非本案地號不會被移進本案範圍 (' + inside.join(',') + ')', inside.length === 0);
  // 左上角：苗栗縣 → 「苗栗」＋「縣／市」
  const cty = await pg.evaluate(() => { const f = Render.fieldsOf(App.P); return [f.countyName, f.townName, f.sectionName].join('|'); });
  check('縣市名稱去字尾 ' + cty, cty === '苗栗|苑裡|中溝');
  if (OUT) {
    await pg.screenshot({ path: path.join(OUT, 'case641.png') });
    await pg.evaluate(() => { document.getElementById('printArea').innerHTML = '<div class="printPage" style="width:420mm;height:297mm">' + Printer.sheetSVG(App.P, App.cad) + '</div>'; });
    await pg.emulateMedia({ media: 'print' });
    await pg.pdf({ path: path.join(OUT, 'case641.pdf'), preferCSSPageSize: true, printBackground: true });
  }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); if (errs.length) process.exit(1);
})();
