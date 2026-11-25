/* 自動套疊：新匯入的 DXF（現況圖、分割方案圖）依其中的地籍線，對到目前的地籍圖。
   找出 縮放、旋轉、平移（相似轉換 x' = a·x − b·y + tx，y' = b·x + a·y + ty），
   適用於：圖紙單位 mm、任意原點、TWD67 與 TWD97 之間的平移等。
   base 的單位假設為公尺（內網輸出的地籍圖）。 */
(function (global) {
  'use strict';

  /* ---------- 小工具 ---------- */
  function nodes(lines) {
    // 線段端點去重（依檔案自身的尺度取捨入單位）
    var b = bbox(lines), q = Math.max(b[2] - b[0], b[3] - b[1], 1e-9) * 1e-8, seen = {}, out = [];
    function add(x, y) { var k = Math.round(x / q) + ',' + Math.round(y / q); if (!seen[k]) { seen[k] = 1; out.push([x, y]); } }
    lines.forEach(function (l) { add(l.x1, l.y1); add(l.x2, l.y2); });
    return out;
  }
  function bbox(lines) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    lines.forEach(function (l) {
      b[0] = Math.min(b[0], l.x1, l.x2); b[1] = Math.min(b[1], l.y1, l.y2);
      b[2] = Math.max(b[2], l.x1, l.x2); b[3] = Math.max(b[3], l.y1, l.y2);
    });
    return b;
  }
  /* 點的格網索引：near() 找 tol 內最近的點 */
  function Grid(pts, cell) {
    var m = new Map();
    pts.forEach(function (p, i) {
      var k = Math.floor(p[0] / cell) * 1000003 + Math.floor(p[1] / cell);
      var a = m.get(k); if (a) a.push(i); else m.set(k, [i]);
    });
    this.m = m; this.cell = cell; this.pts = pts;
  }
  Grid.prototype.near = function (x, y, tol) {
    var c = this.cell, ix = Math.floor(x / c), iy = Math.floor(y / c), best = -1, bd = tol * tol, r = Math.ceil(tol / c);
    for (var i = -r; i <= r; i++) for (var j = -r; j <= r; j++) {
      var a = this.m.get((ix + i) * 1000003 + iy + j); if (!a) continue;
      for (var n = 0; n < a.length; n++) {
        var p = this.pts[a[n]], dx = p[0] - x, dy = p[1] - y, d = dx * dx + dy * dy;
        if (d <= bd) { bd = d; best = a[n]; }
      }
    }
    return best;
  };
  function tf(T, p) { return [T.a * p[0] - T.b * p[1] + T.tx, T.b * p[0] + T.a * p[1] + T.ty]; }
  /* 兩點對兩點 */
  function from2(p, q, P, Q) {
    var dx = q[0] - p[0], dy = q[1] - p[1], DX = Q[0] - P[0], DY = Q[1] - P[1], L = dx * dx + dy * dy;
    if (L < 1e-18) return null;
    var a = (DX * dx + DY * dy) / L, b = (DY * dx - DX * dy) / L;
    return { a: a, b: b, tx: P[0] - (a * p[0] - b * p[1]), ty: P[1] - (b * p[0] + a * p[1]) };
  }
  /* 最小二乘相似轉換 */
  function helmert(src, dst) {
    var n = src.length; if (n < 2) return null;
    var sx = 0, sy = 0, dx = 0, dy = 0, i;
    for (i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
    sx /= n; sy /= n; dx /= n; dy /= n;
    var A = 0, B = 0, S = 0;
    for (i = 0; i < n; i++) {
      var x = src[i][0] - sx, y = src[i][1] - sy, X = dst[i][0] - dx, Y = dst[i][1] - dy;
      A += X * x + Y * y; B += Y * x - X * y; S += x * x + y * y;
    }
    if (S < 1e-18) return null;
    var a = A / S, b = B / S;
    return { a: a, b: b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
  }
  function sample(arr, n) {
    if (arr.length <= n) return arr.slice();
    var out = [], st = arr.length / n;
    for (var i = 0; i < n; i++) out.push(arr[Math.floor(i * st)]);
    return out;
  }
  /* 對上的「不同」界址點數：整張圖被縮成一小團時，很多點會對到同一點，不能算數 */
  function count(T, pts, grid, tol) {
    var seen = new Set();
    for (var i = 0; i < pts.length; i++) { var p = tf(T, pts[i]), j = grid.near(p[0], p[1], tol); if (j >= 0) seen.add(j); }
    return seen.size;
  }
  function inBox(T, pts, b, pad) {
    var c = 0;
    for (var i = 0; i < pts.length; i++) { var p = tf(T, pts[i]); if (p[0] >= b[0] - pad && p[0] <= b[2] + pad && p[1] >= b[1] - pad && p[1] <= b[3] + pad) c++; }
    return c;
  }
  /* 逐次找最近點、重算轉換（由粗到細） */
  function refine(T, src, grid, tols) {
    tols.forEach(function (tol) {
      for (var it = 0; it < 3; it++) {
        var s = [], d = [];
        for (var i = 0; i < src.length; i++) {
          var p = tf(T, src[i]), j = grid.near(p[0], p[1], tol);
          if (j >= 0) { s.push(src[i]); d.push(grid.pts[j]); }
        }
        var N = helmert(s, d); if (!N) return;
        T = N;
      }
    });
    return T;
  }
  function stats(T, src, grid, tol) {
    var m = 0, e2 = 0, seen = new Set();
    for (var i = 0; i < src.length; i++) {
      var p = tf(T, src[i]), j = grid.near(p[0], p[1], tol);
      if (j >= 0) { m++; seen.add(j); var q = grid.pts[j]; e2 += (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]); }
    }
    return { matched: m, distinct: seen.size, rms: m ? Math.sqrt(e2 / m) : 0 };
  }
  /* 新檔相鄰界址點間距（中位數）：轉換後必須遠大於吻合容許值，否則是把圖縮成一團的假吻合 */
  function spacing(lines) {
    var d = lines.map(function (l) { return Math.hypot(l.x2 - l.x1, l.y2 - l.y1); }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    return d.length ? d[Math.floor(d.length / 2)] : 0;
  }

  /* ---------- 主程式 ----------
     base / inc：{ lines: 地籍線（只用來比對）, texts: 地號文字 [{text,x,y}] }
     回傳 { identity:true } 已在同一座標；
          { T, scale, rotDeg, matched, rms, method } 找到；
          null 找不到 */
  var FINE = 0.05;   // 最後吻合判定：5 公分
  function fit(base, inc) {
    if (!base.lines.length || !inc.lines.length) return null;
    var BN = nodes(base.lines), IN = nodes(inc.lines);
    if (BN.length < 4 || IN.length < 4) return null;
    var grid = new Grid(BN, 0.5), bb = bbox(base.lines);
    var probe = sample(IN, 400);
    // 1. 已經是同一套座標
    var I = { a: 1, b: 0, tx: 0, ty: 0 };
    var hit0 = count(I, probe, grid, 0.01);
    if (hit0 >= Math.max(4, probe.length * 0.3)) return { identity: true, matched: hit0 };

    var best = null;
    function consider(T, method) {
      if (!T) return;
      var s = Math.hypot(T.a, T.b); if (!(s > 1e-5 && s < 1e5)) return;
      var sc = count(T, probe, grid, 0.3);
      if (!best || sc > best.sc) best = { T: T, sc: sc, method: method };
    }

    // 2. 用相同的地號文字當控制點（兩邊各只出現一次的地號）
    function uniq(ts) {
      var m = {}; ts.forEach(function (t) { var k = String(t.text).trim(); if (!/^\d+(-\d+)?$/.test(k)) return; m[k] = m[k] === undefined ? t : null; });
      return m;
    }
    var ub = uniq(base.texts || []), ui = uniq(inc.texts || []), common = [];
    Object.keys(ui).forEach(function (k) { if (ui[k] && ub[k]) common.push([[ui[k].x, ui[k].y], [ub[k].x, ub[k].y]]); });
    if (common.length >= 2) {
      var cs = sample(common, 12);
      var T0 = helmert(cs.map(function (c) { return c[0]; }), cs.map(function (c) { return c[1]; }));
      if (T0) consider(refine(T0, IN, grid, [3, 1, 0.3]), 'text');
    }

    // 3. 幾何比對：新檔最長的幾條地籍線段，假設它等於地籍圖上的某一段，看相鄰線段的端點能不能對上
    if (!best || best.sc < probe.length * 0.5) {
      var adj = {};
      var key = function (p) { return p[0].toPrecision(12) + ',' + p[1].toPrecision(12); };
      inc.lines.forEach(function (l, i) {
        [[l.x1, l.y1], [l.x2, l.y2]].forEach(function (p) { var k = key(p); (adj[k] = adj[k] || []).push(i); });
      });
      var segs = inc.lines.map(function (l, i) { return { i: i, len: Math.hypot(l.x2 - l.x1, l.y2 - l.y1) }; })
        .filter(function (s) { return s.len > 0; }).sort(function (a, b) { return b.len - a.len; });
      var bl = base.lines.map(function (l) { return [[l.x1, l.y1], [l.x2, l.y2], Math.hypot(l.x2 - l.x1, l.y2 - l.y1)]; })
        .filter(function (s) { return s[2] > 0.05; });
      var tried = 0, t0 = Date.now();
      for (var si = 0; si < segs.length && tried < 25 && Date.now() - t0 < 4000; si++) {
        var L = inc.lines[segs[si].i], p = [L.x1, L.y1], q = [L.x2, L.y2];
        // 接在 q 端、方向不同的相鄰線段，取它的另一端 r 當檢查點
        var r = null, rl = 0;
        (adj[key(q)] || []).forEach(function (j) {
          if (j === segs[si].i) return;
          var M = inc.lines[j], o = key([M.x1, M.y1]) === key(q) ? [M.x2, M.y2] : [M.x1, M.y1];
          var v1 = [q[0] - p[0], q[1] - p[1]], v2 = [o[0] - q[0], o[1] - q[1]];
          var cr = Math.abs(v1[0] * v2[1] - v1[1] * v2[0]) / (Math.hypot(v1[0], v1[1]) * Math.hypot(v2[0], v2[1]) || 1);
          var ln = Math.hypot(v2[0], v2[1]);
          if (cr > 0.05 && ln > rl) { r = o; rl = ln; }
        });
        if (!r) continue;
        tried++;
        for (var k = 0; k < bl.length; k++) {
          for (var dir = 0; dir < 2; dir++) {
            var P = bl[k][dir], Q = bl[k][1 - dir];
            var T = from2(p, q, P, Q); if (!T) continue;
            var tol = Math.min(0.5, Math.max(0.05, bl[k][2] * 0.003));
            var R = tf(T, r);
            if (grid.near(R[0], R[1], tol) < 0) continue;
            var sc = count(T, probe, grid, tol);
            if (sc >= 4 && (!best || sc > best.sc)) best = { T: T, sc: sc, method: 'geom' };
          }
        }
        if (best && best.sc >= probe.length * 0.8) break;
      }
      if (best && best.method === 'geom') best.T = refine(best.T, IN, grid, [1, 0.3, 0.1]);
    }
    if (!best || !best.T) return null;
    var T = refine(best.T, IN, grid, [0.2, FINE]);
    var st = stats(T, IN, grid, FINE), inside = inBox(T, IN, bb, 1);
    // 判定：至少 6 個不同界址點對上、一點對一點、落在地籍圖範圍內的點有四成以上對得上、
    //       轉換後線段長度（中位數）至少 1 公尺（不是把整張圖縮成一團）
    if (st.distinct < 6 || st.distinct < st.matched * 0.9 || st.matched < inside * 0.4) return null;
    if (spacing(inc.lines) * Math.hypot(T.a, T.b) < 1) return null;
    return {
      T: T, scale: Math.hypot(T.a, T.b), rotDeg: Math.atan2(T.b, T.a) * 180 / Math.PI,
      matched: st.matched, total: IN.length, rms: st.rms, method: best.method
    };
  }

  /* 把整個 DXF 資料（線、文字、弧）套用轉換 */
  function apply(T, data) {
    var s = Math.hypot(T.a, T.b), th = Math.atan2(T.b, T.a) * 180 / Math.PI;
    var P = function (x, y) { return tf(T, [x, y]); };
    data.lines = data.lines.map(function (l) {
      var a = P(l.x1, l.y1), b = P(l.x2, l.y2);
      return Object.assign({}, l, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    });
    data.texts = (data.texts || []).map(function (t) {
      var a = P(t.x, t.y);
      return Object.assign({}, t, { x: a[0], y: a[1], h: t.h * s, rot: ((t.rot || 0) + th + 360) % 360 });
    });
    data.arcs = (data.arcs || []).map(function (c) {
      var a = P(c.cx, c.cy);
      return Object.assign({}, c, { cx: a[0], cy: a[1], r: c.r * s, a0: c.a0 + th, a1: c.a1 + th, chord: c.chord * s });
    });
    return data;
  }

  /* 套疊後去掉重複：
     ・新檔線段端點離原有界址點 tol 內的，吸附到同一點（之後重複線段就能被認出來只留一份）
     ・新檔的地號文字，原圖附近已有同一個地號的就不再加（不會出現兩份地籍圖、兩個地號） */
  function snap(baseLines, data, tol) {
    tol = tol || FINE;
    var BN = nodes(baseLines); if (!BN.length) return 0;
    var grid = new Grid(BN, 0.5), n = 0;
    data.lines = data.lines.map(function (l) {
      var a = grid.near(l.x1, l.y1, tol), b = grid.near(l.x2, l.y2, tol);
      if (a < 0 && b < 0) return l;
      var o = Object.assign({}, l);
      if (a >= 0) { o.x1 = BN[a][0]; o.y1 = BN[a][1]; n++; }
      if (b >= 0) { o.x2 = BN[b][0]; o.y2 = BN[b][1]; n++; }
      return o;
    });
    return n;
  }
  /* isNo(t)：是地號文字。地號在同一張圖只會有一個，原圖已有就不再加（不論位置）；其他文字在 dist 內相同才算重複 */
  function dedupTexts(baseTexts, texts, dist, isNo) {
    dist = dist || 2; isNo = isNo || function () { return false; };
    var by = {}, nos = {};
    baseTexts.forEach(function (t) { var k = String(t.text).trim(); (by[k] = by[k] || []).push(t); if (isNo(t)) nos[k] = 1; });
    return texts.filter(function (t) {
      var k = String(t.text).trim();
      if (isNo(t) && nos[k]) return false;
      return !(by[k] || []).some(function (b) { return Math.hypot(b.x - t.x, b.y - t.y) <= dist; });
    });
  }

  global.Align = { fit: fit, apply: apply, snap: snap, dedupTexts: dedupTexts, helmert: helmert };
})(typeof window !== 'undefined' ? window : globalThis);
