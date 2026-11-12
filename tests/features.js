// node tests/features.js [截圖資料夾] — 斷線、線型、標籤避線、方案、分割線圖層
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
const SM = p => path.join(__dirname, '..', 'samples', p);
(async () => {
  const b = await require('./launch')();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text()); });
  const check = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) errs.push(name); };
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  let confirmAns = true, promptAns = '方案2';
  await pg.exposeFunction('__ans', () => [confirmAns, promptAns]);
  await pg.evaluate(() => { window.print = () => {}; });
  pg.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAns) : d.type() === 'confirm' ? (confirmAns ? d.accept() : d.dismiss()) : d.accept());
  const importFiles = async (files) => {
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
    await fc.setFiles(files); await pg.waitForFunction(() => document.getElementById('toast').textContent.indexOf('已匯入') >= 0, null, { timeout: 15000 }); await pg.evaluate(() => { document.getElementById('toast').textContent = ''; });
  };
  const toScreen = (x, y) => pg.evaluate(([x, y]) => { const r = document.getElementById('svg').getBoundingClientRect(); return [r.left + (x - App.view.ox) * App.view.z, r.top + (y - App.view.oy) * App.view.z]; }, [x, y]);
  const w2s = async (X, Y) => { const p = await pg.evaluate(([X, Y]) => { const m = App.P.elements.find(e => e.type === 'map'); return Render.mapView(m).toP(X, Y); }, [X, Y]); return toScreen(p[0], p[1]); };

  await importFiles([SM('486.dxf')]);
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); m.cx = 221031.88057; m.cy = 2706879.24196; App.api.render(); });
  // 標籤避線：本案地號 486
  const lab = await pg.evaluate(() => {
    const m = App.P.elements.find(e => e.type === 'map'); const ly = Render.layoutLabels(m, App.P, App.cad);
    const i = App.cad.texts.findIndex(t => t.layer === 'PAR_2'); const t = App.cad.texts[i];
    return { orig: [t.x, t.y], now: ly.text[i], moved: Object.keys(ly.text).filter(k => { const t = App.cad.texts[k]; return Math.hypot(t.x - ly.text[k][0], t.y - ly.text[k][1]) > 0.01; }).length, total: Object.keys(ly.text).length };
  });
  const d = Math.hypot(lab.now[0] - lab.orig[0], lab.now[1] - lab.orig[1]);
  check(`auto-avoid: 486 moved ${d.toFixed(2)} m (max ~3.4m); ${lab.moved}/${lab.total} labels adjusted`, d > 0 && d < 3.5);
  // 斷線：在 REF_LINE0 上點一下
  const seg = await pg.evaluate(() => { const i = App.cad.lines.findIndex(l => l.layer === 'REF_LINE0' && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 15 && l.x1 > 221000 && l.x1 < 221060 && l.y1 > 2706840 && l.y1 < 2706920); const l = App.cad.lines[i]; return { i, mid: [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2] }; });
  await pg.keyboard.press('b');
  let p = await w2s(seg.mid[0], seg.mid[1]); await pg.mouse.click(p[0], p[1]);
  const sp = await pg.evaluate((i) => ({ splits: App.P.splits[i], sel: App.sel }), seg.i);
  check('break line -> 2 pieces ' + JSON.stringify(sp.splits), sp.splits && sp.splits.length === 1 && sp.sel && sp.sel.kind === 'seg');
  await pg.selectOption('#props [data-k=dash]', 'dashDot'); await pg.waitForTimeout(100);
  const dashed = await pg.evaluate(() => document.querySelectorAll('#content line[stroke-dasharray]').length);
  check('one piece dash-dot rendered (' + dashed + ')', dashed >= 1);
  // 圖層鎖定：地籍線預設鎖定 → 斷線工具點地籍線無效；解除後才可斷
  const lin = await pg.evaluate(() => { const i = App.cad.lines.findIndex(l => l.layer === 'LIN' && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 20 && l.x1 > 221000 && l.x1 < 221070 && l.y1 > 2706840 && l.y1 < 2706920); const l = App.cad.lines[i]; return { i, mid: [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2] }; });
  await pg.keyboard.press('b');
  p = await w2s(lin.mid[0], lin.mid[1]); await pg.mouse.click(p[0], p[1]);
  const lk1 = await pg.evaluate((i) => !!App.P.splits[i], lin.i);
  await pg.click('#lockBar [data-lockq=parcel]');
  await pg.mouse.click(p[0], p[1]);
  const lk2 = await pg.evaluate((i) => !!App.P.splits[i], lin.i);
  check('地籍線鎖定時點不到，解除後可斷線 (' + lk1 + ',' + lk2 + ')', lk1 === false && lk2 === true);
  await pg.click('#lockBar [data-lockq=parcel]'); await pg.keyboard.press('Escape');
  // 方案：複製成方案2，在方案2 匯入 641 的 DXF
  await pg.click('.plan .ddbtn'); await pg.click('[data-cmd=planAdd]'); await pg.waitForTimeout(300);
  check('plan2 created', await pg.evaluate(() => App.P.plans.length === 2 && App.P.planIdx === 1));
  await importFiles([SM('641/plan3_1140822.dxf')]);
  const r641 = await pg.evaluate(() => ({ lines: App.cad.lines.length, l0: App.cad.lines.filter(l => l.layer === '0').length, split: App.cad.lines.filter(l => l.layer === 'SPLIT').length, role: Render.roleOf(App.P, 'SPLIT', 'line') }));
  console.log(JSON.stringify(r641)); check('641 import: dedup layer-0 duplicates (layer0=' + r641.l0 + ', SPLIT=' + r641.split + ', role=' + r641.role + ')', r641.l0 === 0 && r641.split === 54 && r641.role === 'split');
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); m.scale = 1000; m.w = 230; m.h = 200; App.P.features = []; App.api.centerMap(m, 'case'); App.P.fields.landNo = '641'; App.api.render(); });
  await pg.waitForTimeout(300);
  if (OUT) await pg.screenshot({ path: path.join(OUT, 'f641.png') });
  await pg.selectOption('#planSel', '0'); await pg.waitForTimeout(200);
  const back = await pg.evaluate(() => ({ lines: App.cad.lines.length, feats: App.P.features.length, splits: Object.keys(App.P.splits).length }));
  check('switch back to plan1 keeps its data ' + JSON.stringify(back), back.lines === 6810 && back.feats === 0 && back.splits === 2);
  // 存檔往返
  const rt = await pg.evaluate(() => { const d = JSON.parse(JSON.stringify(App.api.fileData())); App.api.loadData(d); return { plans: App.P.plans.length, cads: d.cads.length, c0: App.planCads[0].lines.length, c1: App.planCads[1].lines.length }; });
  check('roundtrip 2 plans ' + JSON.stringify(rt), rt.plans === 2 && rt.cads === 2 && rt.c1 > 9000);
  // 說明表欄位預設：2 欄
  await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable'); App.api.selectFn({ kind: 'el', id: ft.id }); });
  const tn0 = await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable'); return [ft.titleH, ft.notesH]; });
  await pg.selectOption('[data-act-sel=tstyle]', 'code2');
  const cols = await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable'); return [ft.columns.map(c => c.key).join(','), ft.titleH, ft.notesH]; });
  check('表格樣式下拉：編號/坐落面積，標題與附註保留 ' + JSON.stringify(cols), cols[0] === 'code,area' && cols[1] === tn0[0] && cols[2] === tn0[1] && cols[1] > 0);
  // 說明表列高自動配合文字
  const rh = await pg.evaluate(() => {
    const ft = App.P.elements.find(e => e.type === 'ftable'), m = App.P.elements.find(e => e.type === 'map');
    App.P.features = [{ id: 'x1', ov: 'case', code: 'A', pts: [[0, 0], [10, 0], [10, 10], [0, 10]], landNo: '486', note: '這是一段很長的備註文字需要換行顯示' }];
    ft.columns = [{ key: 'code', header: '編號' }, { key: 'area', header: '面積' }, { key: 'note', header: '備註' }]; ft.cols = [15, 20, 20]; ft.ov = '';
    const dr = () => { const tm = Render.tableModel(ft, App.P); return tm.rows[tm.kinds.indexOf('x1')]; };
    ft.autoRowH = false; const h0 = dr(); ft.autoRowH = true;
    const h1 = dr(); App.P.features = []; return [h0, h1];
  });
  check('說明表列高自動 ' + rh.join(' → '), rh[1] > rh[0]);
  // 預設值：機關、縣市；改過鄉鎮後新案件自動帶入
  const df0 = await pg.evaluate(() => [App.P.fields.office, App.P.fields.county].join('|'));
  check('預設機關與縣市 ' + df0, df0 === '苗栗縣通霄地政事務所|苗栗縣');
  await pg.click('.tabs [data-tab=case]');
  await pg.fill('#tab-case [data-k=town]', '苑裡鎮'); await pg.dispatchEvent('#tab-case [data-k=town]', 'change');
  const dl = await pg.evaluate(() => Array.from(document.querySelectorAll('#dl-town option')).map(o => o.value).join(','));
  check('鄉鎮下拉選項 ' + dl, /通霄鎮/.test(dl) && /苑裡鎮/.test(dl));
  // 甲乙丙
  await pg.evaluate(() => { App.P.settings.codeScheme = 'stem'; });
  const codes = await pg.evaluate(() => [0, 1, 9, 10].map(i => Model.codeAt(i, 'stem')).join(''));
  check('stem codes ' + codes, codes === '甲乙癸甲1');
  // 635 高院補繪（現況+分割）
  confirmAns = true;
  await importFiles([SM('635/1130412.dxf')]);
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); m.scale = 500; m.w = 200; m.h = 200; App.api.centerMap(m, 'target'); App.api.render(); });
  await pg.waitForTimeout(300);
  if (OUT) await pg.screenshot({ path: path.join(OUT, 'f635.png') });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); if (errs.length) process.exit(1);
})();
