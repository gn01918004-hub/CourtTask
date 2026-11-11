// node tests/overlay.js [截圖資料夾] — 現況/分割兩個獨立圖層、假合併、框選線段改歸屬（以苑西 635 高院補繪為例）
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  pg.on('dialog', d => d.accept());
  const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) errs.push(n); };
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await pg.evaluate(() => { window.print = () => {}; });
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
  await fc.setFiles(path.join(__dirname, '..', 'samples', '635', '1130412.dxf'));
  await pg.waitForFunction(() => App.cad && App.cad.lines.length > 7000, null, { timeout: 20000 });
  await pg.waitForTimeout(300);
  const mg = await pg.evaluate(() => ({ parcels: App.P.merge.parcels, mode: App.P.merge.mode, info: Object.keys(Render.mergeInfo(App.P, App.cad).internal).length, marks: Render.mergeInfo(App.P, App.cad).marks.length }));
  check('假合併自動判斷 ' + JSON.stringify(mg), /635/.test(mg.parcels) && /638/.test(mg.parcels) && mg.info === 2 && mg.marks === 2);
  const toS = (X, Y) => pg.evaluate(([X, Y]) => { const m = App.P.elements.find(e => e.type === 'map'); const q = Render.mapView(m).toP(X, Y); const r = document.getElementById('svg').getBoundingClientRect(); return [r.left + (q[0] - App.view.ox) * App.view.z, r.top + (q[1] - App.view.oy) * App.view.z]; }, [X, Y]);
  // 置中並放大
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); App.api.centerMap(m, 'target'); App.api.render(); });
  // 現況圖層：在 PAR_2 "635(2)" 附近（現況區塊內）點選成面
  const pts = await pg.evaluate(() => {
    const T = n => { const t = App.cad.texts.find(t => t.text === n); return [t.x, t.y]; };
    return { p1: T('635(1)'), p2: T('635(2)'), p3: T('635(3)') };
  });
  await pg.click('#ovBadge [data-setov=case]');
  await pg.keyboard.press('f');
  let p = await toS(pts.p1[0], pts.p1[1]); await pg.mouse.click(p[0], p[1]);
  await pg.click('#ovBadge [data-setov=split]');
  await pg.keyboard.press('f');
  p = await toS(pts.p2[0], pts.p2[1]); await pg.mouse.click(p[0], p[1]);
  p = await toS(pts.p3[0], pts.p3[1]); await pg.mouse.click(p[0], p[1]);
  const feats = await pg.evaluate(() => App.P.features.map(f => (f.ov || 'case') + ':' + f.code + '=' + Render.featureArea(f, 2)));
  console.log('features', feats.join(' '));
  check('現況與分割同一份清單、同一套編號 A B C', feats.join(' ').indexOf('case:A') >= 0 && feats.some(s => s.startsWith('split:B')) && feats.some(s => s.startsWith('split:C')));
  // 分割的面不受現況線影響：split 面積 = 只用地籍線+分割線的面
  const ok = await pg.evaluate(() => {
    const m = App.P.elements.find(e => e.type === 'map'); const f = App.P.features.find(f => f.ov === 'split');
    const segs = []; Render.eachPiece(App.P, App.cad, (pc, role) => { if (role === 'parcel' || role === 'split') segs.push([pc.x1, pc.y1, pc.x2, pc.y2]); }, { keepMerged: true });
    const MI = Render.mergeInfo(App.P, App.cad);
    const segs2 = []; Render.eachPiece(App.P, App.cad, (pc, role) => { if ((role === 'parcel' && !MI.internal[pc.key]) || role === 'split') segs2.push([pc.x1, pc.y1, pc.x2, pc.y2]); }, { keepMerged: true });
    const face = Geom.faceAt(segs2, Geom.labelPoint(f.pts), 0.002);
    return Math.abs(Geom.area(face) - Geom.area(f.pts)) < 0.01;
  });
  check('分割面只用地籍線＋分割線（不受現況線切割、跨過合併界線）', ok);
  // 合併界線隱藏
  const cnt = await pg.evaluate(() => { let a = 0, b = 0; App.P.merge.mode = 'x'; Render.eachPiece(App.P, App.cad, () => a++); App.P.merge.mode = 'hide'; Render.eachPiece(App.P, App.cad, () => b++); App.P.merge.mode = 'x'; return a - b; });
  check('「整條隱藏」少畫 2 段界線 (' + cnt + ')', cnt === 2);
  // 框選線段 → 改歸屬為分割
  await pg.evaluate(() => { App.api.selectFn(null); });
  await pg.keyboard.press('q');
  const box = await pg.evaluate(() => { const t = App.cad.texts.find(t => t.text === '635(1)'); return [t.x - 25, t.y - 25, t.x + 25, t.y + 25]; });
  const a = await toS(box[0], box[3]), c = await toS(box[2], box[1]);
  await pg.mouse.move(a[0], a[1]); await pg.mouse.down(); await pg.mouse.move(c[0], c[1], { steps: 5 }); await pg.mouse.up();
  const sel = await pg.evaluate(() => App.sel && App.sel.kind === 'seg' ? App.sel.idx.length : 0);
  check('框選線段選到 ' + sel + ' 段', sel > 0);
  if (sel) {
    await pg.selectOption('#props [data-k=role]', 'split');
    const r = await pg.evaluate(() => App.sel.idx.every(k => App.P.segStyle[k] && App.P.segStyle[k].role === 'split'));
    check('改歸屬為分割', r);
  }
  // 說明表依圖層
  await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable'); ft.ov = 'split'; App.api.render(); });
  const rows = await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable'); return Render.tableModel(ft, App.P).kinds.filter(k => !['title', 'header', 'notes'].includes(k)).length; });
  check('說明表只列分割層 (' + rows + ' 筆)', rows === 2);
  // 同時有現況與分割 → 現況預設藍色
  const col = await pg.evaluate(() => { Render.updateBoth(App.P, App.cad); return Render.lineStyle(App.P, 'case', null).color; });
  check('兩層並存時現況為藍色 (' + col + ')', col === '#0050ff');
  // 改歸屬工具：上方先選「分割」，連點兩條不同的線都變分割；改選「現況」再點 → 現況
  await pg.evaluate(() => { App.P.segStyle = {}; App.api.selectFn(null); App.api.render(); });
  await pg.keyboard.press('a');
  check('改歸屬工具條出現', await pg.isVisible('#assignBar'));
  await pg.click('#assignBar [data-assign=split]');
  const lns = await pg.evaluate(() => {
    const out = [];
    App.cad.lines.forEach((l, i) => { if (out.length < 2 && l.layer === 'REF_LINE0' && Math.hypot(l.x2 - l.x1, l.y2 - l.y1) > 8 && Math.abs(l.x1 - 213670) < 40 && Math.abs(l.y1 - 2704360) < 40 && (!out.length || Math.hypot((l.x1 + l.x2) / 2 - out[0].m[0], (l.y1 + l.y2) / 2 - out[0].m[1]) > 6)) out.push({ i, m: [(l.x1 + l.x2) / 2, (l.y1 + l.y2) / 2] }); });
    return out;
  });
  for (const ln of lns) { const q = await toS(ln.m[0], ln.m[1]); await pg.mouse.click(q[0], q[1]); }
  const rr = await pg.evaluate((ids) => ids.map(i => (App.P.segStyle[String(i)] || {}).role), lns.map(l => l.i));
  check('連點兩條線都改成分割 ' + rr, rr.length === 2 && rr.every(r => r === 'split'));
  await pg.click('#assignBar [data-assign=case]');
  { const q = await toS(lns[0].m[0], lns[0].m[1]); await pg.mouse.click(q[0], q[1]); }
  const r3 = await pg.evaluate((i) => (App.P.segStyle[String(i)] || {}).role, lns[0].i);
  check('改選「現況」後點 → 現況 (' + r3 + ')', r3 === 'case');
  // 右鍵選單：線段改線型、粗細
  await pg.keyboard.press('v');
  { const q = await toS(lns[1].m[0], lns[1].m[1]); await pg.mouse.click(q[0], q[1], { button: 'right' }); }
  check('右鍵選單出現', await pg.isVisible('#ctx'));
  await pg.click('#ctx .ctx-row:has-text("線型") button:has-text("虛線")');
  { const q = await toS(lns[1].m[0], lns[1].m[1]); await pg.mouse.click(q[0], q[1], { button: 'right' }); }
  await pg.click('#ctx .ctx-row:has-text("粗細") button:has-text("0.5")');
  const st5 = await pg.evaluate((i) => App.P.segStyle[String(i)], lns[1].i);
  check('右鍵改線型、粗細 ' + JSON.stringify(st5), st5 && st5.dash === 'dash' && st5.lw === 0.5);
  // 框外全圖：選取略圖框時不顯示，移圖拖曳時才顯示
  const ghost1 = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); App.api.selectFn({ kind: 'el', id: m.id }); App.api.render(); return document.querySelectorAll('#svg .ghost').length; });
  check('選取略圖框時不顯示框外全圖', ghost1 === 0);
  if (OUT) { await pg.evaluate(() => { App.api.selectFn(null); App.api.render(); }); await pg.waitForTimeout(300); await pg.screenshot({ path: path.join(OUT, 'overlay635.png') }); }
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); if (errs.length) process.exit(1);
})();
