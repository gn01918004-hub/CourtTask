// node tests/dist.js — 驗證打包後的散發版（單檔與多檔）在完全斷網下可運作
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const DIST = path.join(__dirname, '..', 'dist');
const dir = fs.readdirSync(DIST).filter(d => /^CourtTask_v/.test(d) && fs.statSync(path.join(DIST, d)).isDirectory()).sort().pop();
(async () => {
  const b = await chromium.launch();
  let fail = 0;
  for (const page of [path.join(DIST, dir, 'CourtTask.html'), path.join(DIST, dir, 'app', 'index.html')]) {
    const ctx = await b.newContext({ offline: true, viewport: { width: 1500, height: 900 } });
    const pg = await ctx.newPage();
    const errs = [], net = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.route('**/*', r => { if (r.request().url().startsWith('file:')) r.continue(); else { net.push(r.request().url()); r.abort(); } });
    pg.on('dialog', d => d.accept());
    await pg.goto('file://' + page);
    await pg.evaluate(() => { window.print = () => { window.__p = document.getElementById('printArea').innerHTML.length; }; });
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('[data-cmd=import]')]);
    await fc.setFiles(path.join(__dirname, '..', 'samples', '486.dxf'));
    await pg.waitForFunction(() => App.cad && App.cad.lines.length > 6000);
    const r = await pg.evaluate(() => {
      const m = App.P.elements.find(e => e.type === 'map'); m.cx = 221031.88057; m.cy = 2706879.24196;
      const v = Render.mapView(m), segs = [];
      App.cad.lines.forEach(l => { const c = Geom.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1); if (c) segs.push(c); });
      const f = Geom.buildFaces(segs, 0.002).find(f => Geom.area(f).toFixed(2) === '212.02');
      App.api.addFaceAt(m, Geom.labelPoint(f));
      return { area: Render.featureArea(App.P.features[0], 2), ver: (document.querySelector('meta[name=version]') || {}).content };
    });
    await pg.click('[data-cmd=printA3]'); await pg.waitForTimeout(200);
    const printed = await pg.evaluate(() => window.__p || 0);
    const ok = !errs.length && !net.length && r.area === '212.02' && printed > 1000 && r.ver;
    console.log((ok ? 'PASS ' : 'FAIL ') + path.relative(DIST, page), JSON.stringify({ area: r.area, version: r.ver, printed, network: net, errors: errs }));
    if (!ok) fail++;
    await ctx.close();
  }
  await b.close(); process.exit(fail ? 1 : 0);
})();
