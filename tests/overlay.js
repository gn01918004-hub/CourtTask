// node tests/overlay.js [截圖資料夾] — 現況/分割兩個獨立圖層、假合併、框選線段改歸屬（以苑西 635 高院補繪為例）
const { chromium } = require('playwright');
const path = require('path');
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
  check('現況、分割各自編號（現況 A、分割 甲乙）', feats.some(s => s.startsWith('case:A')) && feats.some(s => s.startsWith('split:甲')) && feats.some(s => s.startsWith('split:乙')));
  const tabs = await pg.evaluate(() => App.P.elements.filter(e => e.type === 'ftable').map(e => e.ov + ':' + e.title));
  check('現況＋分割自動分成兩張說明表 ' + JSON.stringify(tabs), tabs.length === 2 && tabs.some(t => /^case:.*地上物說明/.test(t)) && tabs.some(t => /^split:.*分割方案說明/.test(t)));
  await pg.waitForTimeout(100);
  const st = await pg.evaluate(() => {
    const fts = App.P.elements.filter(e => e.type === 'ftable'), a = fts.find(e => e.ov === 'case'), b = fts.find(e => e.ov === 'split');
    const ba = Render.bounds(a, App.P), bb = Render.bounds(b, App.P);
    return { gap: Math.round((bb.y - (ba.y + ba.h)) * 100) / 100, wa: Math.round(ba.w * 10) / 10, wb: Math.round(bb.w * 10) / 10, notesTop: a.notesH, notesBottom: b.notesH };
  });
  check('兩張表接在一起、同寬、附註只在下表 ' + JSON.stringify(st), st.gap === 0 && st.wa === st.wb && st.notesTop === 0 && st.notesBottom > 0);
  // 分割表右鍵：合併兩列的「所有權人」
  const cellP = await pg.evaluate(() => {
    const b = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'), tm = Render.tableModel(b, App.P);
    const r0 = tm.kinds.findIndex(k => k !== 'title' && k !== 'header' && k !== 'notes');
    App.api.selectFn({ kind: 'el', id: b.id }); App.selCell = { r0: r0, c0: 2, r1: r0 + 1, c1: 2 };
    const rc = Render.cellRect(b, tm, { r: r0, c: 2 }); const r = document.getElementById('svg').getBoundingClientRect();
    return [r.left + (rc.x + rc.w / 2 - App.view.ox) * App.view.z, r.top + (rc.y + rc.h / 2 - App.view.oy) * App.view.z];
  });
  await pg.mouse.click(cellP[0], cellP[1], { button: 'right' });
  await pg.click('#ctx .ctx-item:has-text("合併選取的格子")');
  const mg2 = await pg.evaluate(() => { const b = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'); const tm = Render.tableModel(b, App.P); return { merges: (b.merges || []).length, rs: (tm.cells.find(c => c.merged) || {}).rs }; });
  check('說明表右鍵合併兩列 ' + JSON.stringify(mg2), mg2.merges === 1 && mg2.rs === 2);
  // 左側說明欄：字不縮小、自動換行加高，表格總高不變
  const lt = await pg.evaluate(() => {
    App.P.fields.courtDoc = '臺灣苗栗地方法院112年4月11日苗院雅民仁111重訴37字第11048號函，另依同年5月2日補充函辦理，並請一併檢附相關圖說資料以供參考。';
    const t = App.P.elements.find(e => e.type === 'table'), tm = Render.tableModel(t, App.P);
    const sum = a => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;
    const c = tm.cells.find(c => c.r === 3 && c.c === 1);
    return { set: t.rows[3], shown: tm.rows[3], totalSet: sum(t.rows), totalShown: sum(tm.rows), fs: c.fs, fit: c.fit || '' };
  });
  check('說明欄自動加高列高、字高不變、總高不變 ' + JSON.stringify(lt), lt.shown > lt.set && lt.totalSet === lt.totalShown && lt.fs === 4.15 && lt.fit === '');
  // 清冊：勾一筆分割項目列入清冊 → 圖上表格少一筆、多「詳如清冊」列；CSV 有該筆
  await pg.click('.tabs [data-tab=feat]');
  const regId = await pg.evaluate(() => App.P.features.find(f => f.ov === 'split').id);
  check('清冊欄平時不顯示', !(await pg.isVisible('[data-reg="' + regId + '"]')));
  await pg.check('[data-regon=split]');
  await pg.check('[data-reg="' + regId + '"]');
  const rg = await pg.evaluate((id) => {
    const ft = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'), tm = Render.tableModel(ft, App.P);
    const f = App.P.features.find(f => f.id === id);
    return { inTable: tm.kinds.indexOf(id) >= 0, regRow: tm.kinds.indexOf('register') >= 0, regText: (tm.cells.find(c => /詳如清冊/.test(c.text)) || {}).text, csv: Printer.registerCSV(App.P, ft).indexOf(f.code) >= 0 };
  }, regId);
  check('清冊：圖上表格改寫「詳如清冊」、CSV 有資料 ' + JSON.stringify(rg), !rg.inTable && rg.regRow && rg.csv);
  await pg.click('#tab-feat [data-regall=split]');
  const allReg = await pg.evaluate(() => App.P.features.filter(f => f.ov === 'split').every(f => f.inRegister));
  await pg.click('#tab-feat [data-regall=split]');
  const noneReg = await pg.evaluate(() => App.P.features.filter(f => f.ov === 'split').every(f => !f.inRegister));
  check('清冊全選／全部取消 ' + [allReg, noneReg], allReg && noneReg);
  await pg.click('#tab-feat [data-regall=split]');
  const allTm = await pg.evaluate(() => { const ft = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'), tm = Render.tableModel(ft, App.P); return { kinds: tm.kinds.join(','), text: tm.cells.map(c => c.text).join('|') }; });
  check('全部進清冊：只留標題＋詳如清冊 ' + JSON.stringify(allTm), /^title,register/.test(allTm.kinds) && allTm.kinds.indexOf('header') < 0 && /\|詳如清冊/.test(allTm.text));
  await pg.click('#tab-feat [data-regall=split]');
  await pg.check('[data-reg="' + regId + '"]');
  await pg.uncheck('[data-reg="' + regId + '"]');
  await pg.uncheck('[data-regon=split]');
  // 說明頁最上方的「兩張說明表：接在一起／分開擺放」
  await pg.click('#tab-feat [data-join="0"]');
  const j0 = await pg.evaluate(() => !!App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split').stackBelow);
  await pg.click('#tab-feat [data-join="1"]');
  const j1 = await pg.evaluate(() => !!App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split').stackBelow);
  check('說明頁切換兩張表接在一起／分開 ' + [j0, j1], j0 === false && j1 === true);
  // 說明頁：分割區塊的輸入欄位＝所有權人；現況區塊＝地號、備註
  await pg.click('.tabs [data-tab=feat]');
  const heads = await pg.evaluate(() => Array.from(document.querySelectorAll('#tab-feat .fblock')).map(b => Array.from(b.querySelectorAll('thead th')).map(t => t.textContent).join('/')));
  check('說明頁輸入欄位跟表格走 ' + JSON.stringify(heads), heads.length === 2 && /地號.*備註/.test(heads[0]) && /所有權人/.test(heads[1]));
  // 拖拉規則：兩張表一致（欄＝互讓總寬不變、列＝只改該列）
  for (const ov of ['case', 'split']) {
    const info = await pg.evaluate((ov) => {
      const t = App.P.elements.find(e => e.type === 'ftable' && e.ov === ov), tm = Render.tableModel(t, App.P);
      App.api.setTool('select'); App.api.fitView(); App.api.selectFn({ kind: 'el', id: t.id }); App.tableEdit = t.id; App.api.render();
      const r = document.getElementById('svg').getBoundingClientRect(); const S = (x, y) => [r.left + (x - App.view.ox) * App.view.z, r.top + (y - App.view.oy) * App.view.z];
      const b = Render.bounds(t, App.P), fd = tm.kinds.findIndex(k => !['title', 'header', 'notes', 'register'].includes(k));
      let y = t.y; for (let i = 0; i <= fd; i++) y += tm.rows[i];
      return { col: S(t.x + t.cols[0], b.y + b.h * 0.5), row: S(t.x + t.cols[0] / 2, y), w: Math.round(b.w * 100) / 100, cols: t.cols.slice(), rows: tm.rows.slice(), fs: t.dataFs, fd };
    }, ov);
    const z = await pg.evaluate(() => App.view.z);
    await pg.mouse.move(info.col[0], info.col[1]); await pg.mouse.down(); await pg.mouse.move(info.col[0] + 4 * z, info.col[1], { steps: 4 }); await pg.mouse.up();
    await pg.mouse.move(info.row[0], info.row[1]); await pg.mouse.down(); await pg.mouse.move(info.row[0], info.row[1] + 5 * z, { steps: 4 }); await pg.mouse.up();
    const after = await pg.evaluate((ov) => { const t = App.P.elements.find(e => e.type === 'ftable' && e.ov === ov), tm = Render.tableModel(t, App.P), b = Render.bounds(t, App.P); return { w: Math.round(b.w * 100) / 100, cols: t.cols.slice(), rows: tm.rows.slice(), fs: t.dataFs }; }, ov);
    const okCol = after.w === info.w && Math.abs(after.cols[0] - info.cols[0] - 4) < 0.6;
    const okRow = Math.abs(after.rows[info.fd] - info.rows[info.fd] - 5) < 0.6 && after.rows[info.fd + 1] === info.rows[info.fd + 1];
    check(ov + ' 表：拖欄互讓（總寬不變）、拖列只改該列、字高不變 ' + JSON.stringify({ w: [info.w, after.w], c0: [info.cols[0], after.cols[0]], r: [info.rows[info.fd], after.rows[info.fd]], next: [info.rows[info.fd + 1], after.rows[info.fd + 1]] }), okCol && okRow && after.fs === info.fs);
    await pg.keyboard.press('Escape');
  }
  // 舊專案：分開 → 再接合
  await pg.evaluate(() => { const t = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'); App.api.selectFn({ kind: 'el', id: t.id }); });
  await pg.click('#props [data-act=stackSplit]');
  const sp1 = await pg.evaluate(() => { const t = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'); return !!t.stackBelow; });
  await pg.click('#props [data-act=stackJoin]');
  const sp2 = await pg.evaluate(() => { const a = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'case'), t = App.P.elements.find(e => e.type === 'ftable' && e.ov === 'split'), ba = Render.bounds(a, App.P); return { joined: t.stackBelow === a.id, gap: Math.round((t.y - ba.y - ba.h) * 100) / 100, notesTop: a.notesH }; });
  check('分開／接合按鈕 ' + JSON.stringify({ sp1, sp2 }), sp1 === false && sp2.joined && sp2.gap === 0 && sp2.notesTop === 0);
  // 點說明表 → 左側切到「說明」；點左側說明欄 → 切到「案件資料」
  const tabs2 = await pg.evaluate(() => {
    const out = [];
    App.api.selectFn({ kind: 'el', id: App.P.elements.find(e => e.type === 'ftable').id }); out.push(App.tab);
    App.api.selectFn({ kind: 'el', id: App.P.elements.find(e => e.type === 'table').id }); out.push(App.tab);
    return out;
  });
  check('點表格自動切換左側頁籤 ' + tabs2, tabs2[0] === 'feat' && tabs2[1] === 'case');
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
    await pg.click('#props [data-qr=split]');
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
