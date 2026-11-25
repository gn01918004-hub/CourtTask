// node tests/align.js — 自動套疊：外部畫的現況圖／分割方案圖（TWD67、圖紙 mm、旋轉）匯入時，依地籍線自動對到現有地籍圖，
//                        重複的地籍線、地號只留一份
const path = require('path'), fs = require('fs'), os = require('os');
global.window = global;
['geom', 'dxf', 'align'].forEach(m => require(path.join(__dirname, '..', 'app', 'js', m + '.js')));
const S = path.join(__dirname, '..', 'samples');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-align-'));
const rd = f => DXF.parse(DXF.decodeBytes(fs.readFileSync(f)));

// 把 641 分割方案圖轉到另一套座標，另存成 DXF（模擬外部畫的圖）
const plan = rd(path.join(S, '641', 'plan3_1140822.dxf'));
function save(name, a, b, tx, ty) {
  const d = Align.apply({ a, b, tx, ty }, JSON.parse(JSON.stringify(plan)));
  const w = new DXF.Writer();
  d.lines.forEach(l => w.line(l.layer, l.x1, l.y1, l.x2, l.y2, l.color));
  d.texts.forEach(t => w.text(t.layer, t.x, t.y, t.h, t.text, { center: true, rot: t.rot }));
  const f = path.join(TMP, name); fs.writeFileSync(f, w.toString()); return f;
}
const th = 25 * Math.PI / 180;
const F67 = save('plan_twd67.dxf', 1.0000085, 0.0000032, -828.21, 206.93);
const FMM = save('plan_mm500.dxf', 2 * Math.cos(th), 2 * Math.sin(th), -431700, -5406000);
const splitRef = plan.lines.filter(l => l.layer === 'SPLIT');

(async () => {
  const b = await require('./launch')();
  const pg = await b.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  let answer = true; pg.on('dialog', d => (answer ? d.accept() : d.dismiss()));
  const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) errs.push(n); };
  await pg.goto('file://' + path.join(__dirname, '..', 'app', 'index.html'));
  const imp = async (f, replace) => {
    answer = replace;
    await pg.evaluate(() => { window.__n = App.cad ? App.cad.name : ''; document.getElementById('toast').textContent = ''; });
    const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#btnImport')]);
    await fc.setFiles(f);
    await pg.waitForFunction(() => App.cad && App.cad.name !== window.__n, null, { timeout: 30000 });
    return pg.evaluate(() => document.getElementById('toast').textContent);
  };
  const state = () => pg.evaluate(() => {
    const isPar = l => Render.roleOf(App.P, l.layer, 'line', l.color) === 'parcel';
    return { par: App.cad.lines.filter(isPar).length, texts: App.cad.texts.length, all: App.cad.lines.length,
      split: App.cad.lines.filter(l => l.layer === 'SPLIT').map(l => [l.x1, l.y1, l.x2, l.y2]),
      n641: App.cad.texts.filter(t => t.text === '641').length };
  });
  const maxErr = sp => {
    let m = 0;
    splitRef.forEach((l, i) => { const s = sp[i]; if (!s) { m = Infinity; return; } m = Math.max(m, Math.hypot(s[0] - l.x1, s[1] - l.y1), Math.hypot(s[2] - l.x2, s[3] - l.y2)); });
    return m;
  };

  // 基準：現況圖（TWD97）＋ 原座標的分割方案圖，合併後的數量
  await imp(path.join(S, '641', 'current_1110809.dxf'), true);
  const base = await state();
  await imp(path.join(S, '641', 'plan3_1140822.dxf'), false);
  const ref = await state();
  check('同座標合併：不套疊、地號不重複 ' + JSON.stringify({ par: ref.par, texts: ref.texts, n641: ref.n641 }), ref.n641 === 1 && maxErr(ref.split) < 1e-6);

  for (const [name, f] of [['TWD67', F67], ['圖紙 mm 1/500 旋轉 25°', FMM]]) {
    await imp(path.join(S, '641', 'current_1110809.dxf'), true);
    const t0 = Date.now();
    const msg = await imp(f, false);
    const st = await state();
    const e = maxErr(st.split);
    console.log('  ' + name + '：' + (Date.now() - t0) + 'ms ' + msg.split('\n').slice(1).join(' '));
    check(name + '：自動套疊、分割線回到正確位置（誤差 ' + (e * 1000).toFixed(3) + ' mm）', /自動套疊/.test(msg) && e < 0.001);
    check(name + '：地籍線、地號只留一份 ' + JSON.stringify({ par: [st.par, ref.par], texts: [st.texts, ref.texts], n641: st.n641 }),
      st.par === ref.par && st.texts === ref.texts && st.n641 === base.n641);
  }

  // 新方案用「取代」匯入外部圖：仍以原方案的座標為準
  await imp(path.join(S, '641', 'current_1110809.dxf'), true);
  const msgR = await imp(F67, true);
  const stR = await state();
  check('取代匯入也會套到原座標（誤差 ' + (maxErr(stR.split) * 1000).toFixed(3) + ' mm）', /自動套疊/.test(msgR) && maxErr(stR.split) < 0.001);

  // 不同地區：照原座標加入並提醒
  await imp(path.join(S, '641', 'current_1110809.dxf'), true);
  const msgX = await imp(path.join(S, '486.dxf'), false);
  const x0 = await pg.evaluate(() => { const t = App.cad.texts.find(t => t.layer === 'PAR' && t.text === '1' && t.x > 219000); return t && [t.x, t.y]; });
  console.log('  '+msgX.split('\n').slice(1).join(' '), JSON.stringify(x0)); check('不同地區：不套疊、照原座標、有提醒', /對不上/.test(msgX) && x0 && Math.abs(x0[0] - 219918.4) < 0.2);

  // 取代成另一個案件：不比對、不提醒
  const msgY = await imp(path.join(S, '486.dxf'), true);
  check('取代成另一個案件：不套疊', !/套疊|對不上/.test(msgY));

  console.log(errs.length ? 'errors: ' + errs.join(' | ') : 'errors: none');
  await b.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(errs.length ? 1 : 0);
})();
