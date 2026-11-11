// node tests/ui.js — 滑鼠互動測試：表格格線拖拉、元件移動、移動圖面、點選成面、合併儲存格
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  await pg.evaluate(() => { try { localStorage.clear(); } catch (e) {} window.confirm = () => true; window.print = () => { window.__printed = document.getElementById('printArea').innerHTML.length; }; });
  const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
  await fc.setFiles([path.join(__dirname, '..', 'samples', '486.dxf')]);
  await pg.waitForTimeout(500);
  const toScreen = (x, y) => pg.evaluate(([x, y]) => { const r = document.getElementById('svg').getBoundingClientRect(); return [r.left + (x - App.view.ox) * App.view.z, r.top + (y - App.view.oy) * App.view.z]; }, [x, y]);
  const check = (name, cond) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) errs.push(name); };

  // 1) 點選左欄表格的格子
  let p = await toScreen(50, 100); await pg.mouse.click(p[0], p[1]);
  let st = await pg.evaluate(() => ({ sel: App.sel, cell: App.selCell }));
  check('select table cell', st.sel && st.cell && st.cell.r0 === 4 && st.cell.c0 === 1);
  // 1b) 未進入表格編輯：在格線上拖曳 = 移動整個表格（不會誤拉格線）
  const t0 = await pg.evaluate(() => { const t = App.P.elements.find(e => e.type === 'table'); return [t.x, t.y, t.rows[4]]; });
  p = await toScreen(50, 149.0); await pg.mouse.move(p[0], p[1]); await pg.mouse.down();
  let q0 = await toScreen(50, 139.0); await pg.mouse.move(q0[0], q0[1], { steps: 5 }); await pg.mouse.up();
  const t1 = await pg.evaluate(() => { const t = App.P.elements.find(e => e.type === 'table'); return [t.x, t.y, t.rows[4]]; });
  check('drag on table border moves table, not divider (' + t0 + ' → ' + t1 + ')', t1[2] === t0[2] && Math.abs(t1[1] - t0[1] + 10) < 1.5);
  await pg.keyboard.press('Control+z'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { const t = App.P.elements.find(e => e.type === 'table'); t.x = 20.7; t.y = 44.5; App.api.render(); });
  // 雙擊進入表格編輯
  p = await toScreen(50, 100); await pg.mouse.dblclick(p[0], p[1]);
  check('dblclick enters table edit', await pg.evaluate(() => !!App.tableEdit));
  // 2) 拖拉列分隔線 (第 4 列底 y=44.5+11.4+6.2+6.1+22.9+57.9=149.0)
  const before = await pg.evaluate(() => App.P.elements.find(e => e.type === 'table').rows.slice());
  p = await toScreen(50, 149.0); await pg.mouse.move(p[0], p[1]); await pg.mouse.down();
  let q = await toScreen(50, 139.0); await pg.mouse.move(q[0], q[1], { steps: 5 }); await pg.mouse.up();
  const after = await pg.evaluate(() => App.P.elements.find(e => e.type === 'table').rows.slice());
  check('row divider drag (' + before[4] + '→' + after[4] + ', ' + before[5] + '→' + after[5] + ')', Math.abs(after[4] - (before[4] - 10)) < 0.3 && Math.abs(after[5] - (before[5] + 10)) < 0.3);
  // 3) 合併儲存格：選 (8,0)-(8,1)
  p = await toScreen(25, 250); await pg.mouse.click(p[0], p[1]);
  p = await toScreen(60, 250); await pg.keyboard.down('Shift'); await pg.mouse.click(p[0], p[1]); await pg.keyboard.up('Shift');
  await pg.click('[data-act=merge]');
  const merged = await pg.evaluate(() => App.P.elements.find(e => e.type === 'table').cells.find(c => c.r === 8 && c.c === 0));
  check('merge cells (auto-expand to merged cell) cs=' + (merged && merged.cs), merged && merged.cs === 5);
  // 4) 拖曳指北針
  const nb = await pg.evaluate(() => { const e = App.P.elements.find(e => e.type === 'north'); return [e.x, e.y]; });
  p = await toScreen(nb[0] + 4.75, nb[1] + 20); await pg.mouse.move(p[0], p[1]); await pg.mouse.down();
  q = await toScreen(nb[0] + 4.75 + 30, nb[1] + 20 + 2); await pg.mouse.move(q[0], q[1], { steps: 6 }); await pg.mouse.up();
  const na = await pg.evaluate(() => { const e = App.P.elements.find(e => e.type === 'north'); return [e.x, e.y]; });
  check('move north arrow', Math.abs(na[0] - nb[0] - 30) < 1.5);
  // 5) 移動圖面
  await pg.keyboard.press('h');
  const c0 = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); return [m.cx, m.cy]; });
  p = await toScreen(260, 150); await pg.mouse.move(p[0], p[1]); await pg.mouse.down();
  q = await toScreen(280, 150); await pg.mouse.move(q[0], q[1], { steps: 5 }); await pg.mouse.up();
  const c1 = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); return [m.cx, m.cy]; });
  check('pan map 20mm = 10m (' + (c0[0] - c1[0]).toFixed(2) + ')', Math.abs(c0[0] - c1[0] - 10) < 0.05);
  // 6) 點選成面（以滑鼠）
  await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); m.cx = 221031.88057; m.cy = 2706879.24196; App.api.render(); });
  await pg.keyboard.press('f');
  const tp = await pg.evaluate(() => { const m = App.P.elements.find(e => e.type === 'map'); return Render.mapView(m).toP(221044.0, 2706898.0); });
  p = await toScreen(tp[0], tp[1]); await pg.mouse.click(p[0], p[1]);
  const fa = await pg.evaluate(() => App.P.features.map(f => Geom.area(f.pts).toFixed(2)));
  check('face by click ' + fa, fa.length === 1);
  // 7) 復原
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(500);
  await pg.keyboard.press('Control+z'); await pg.waitForTimeout(100);
  const fz = await pg.evaluate(() => App.P.features.length);
  check('undo face', fz === 0);
  // 8) 新增第二個略圖框並改比例尺
  await pg.click('#rail .dd .ddbtn'); await pg.click('[data-cmd=add-map]');
  await pg.fill('[data-k=scale]', '1000');
  const m2 = await pg.evaluate(() => App.P.elements.filter(e => e.type === 'map').map(m => m.scale));
  check('second map 1/1000 ' + m2, m2.length === 2 && m2[1] === 1000);
  // 9) 列印按鈕
  await pg.click('#toolbar [data-cmd=printA3]'); await pg.waitForTimeout(200);
  check('print A3 builds page', (await pg.evaluate(() => window.__printed)) > 1000);
  if (process.argv[2]) await pg.screenshot({ path: process.argv[2] });
  console.log('errors:', errs.length ? errs : 'none');
  await b.close(); if (errs.length) process.exit(1);
})();
