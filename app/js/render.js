/* 將專案繪製成 SVG（單位：紙上 mm） */
(function (global) {
  'use strict';
  var M = global.Model, G = global.Geom;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function n(v) { return Math.round(v * 1000) / 1000; }

  function fieldsOf(P) {
    var f = Object.assign({}, P.fields);
    var maps = P.elements.filter(function (e) { return e.type === 'map'; });
    f.scale = maps[0] ? maps[0].scale : '';
    f.plan = P.plans && P.plans[P.planIdx] ? P.plans[P.planIdx].name : '';
    maps.forEach(function (m, i) { f['scale' + (i + 1)] = m.scale; });
    // 去掉行政區字尾，讓「縣／市」「鄉鎮／市區」「段」固定在自己的格子
    f.countyName = String(f.county || '').trim().replace(/[縣市]$/, '');
    f.townName = String(f.town || '').trim().replace(/(鄉|鎮|市|區)$/, '');
    f.sectionName = String(f.section || '').trim().replace(/段$/, '');
    f.subsectionName = String(f.subsection || '').trim().replace(/小段$/, '');
    return f;
  }

  /* ---------- 圖層角色 ---------- */
  function defaultRole(layer, kind) {
    var u = String(layer).toUpperCase();
    if (kind === 'text') {
      if (/^PAR_?2$/.test(u) || /TARGET|^MERGEPAR$/.test(u)) return 'target';
      if (/^PAR/.test(u)) return 'parcelNo';
      return 'otherText';
    }
    if (/REF_LINE|^KC|CASE|^0$/.test(u)) return 'case';
    if (/SPLIT|分割/.test(u)) return 'split';
    if (/^MERGE$|^MERGEPAR2$/.test(u)) return 'hide';        // 內網合併的 X 記號：由本系統自行繪製
    if (/^LIN|^MERGESRC$/.test(u)) return 'parcel';          // MERGESRC = 被合併的原地號界線
    return 'other';
  }
  var ROLE_STYLE = { parcel: 'parcelLine', case: 'caseLine', split: 'splitLine', other: 'otherLine' };
  var bothFlag = new WeakMap();   // 該專案目前是否同時有現況與分割
  function roleStyle(P, role) {
    var st = P.styles[ROLE_STYLE[role] || 'otherLine'] || P.styles.otherLine;
    if (role === 'case' && st.colorBoth && bothFlag.get(P)) return Object.assign({}, st, { color: st.colorBoth });
    return st;
  }
  function updateBoth(P, cad) {
    var c = false, s = false;
    if (cad) {
      var memo = {};
      cad.lines.forEach(function (l) { var k = l.layer + '|' + l.color; if (!(k in memo)) memo[k] = roleOf(P, l.layer, 'line', l.color); if (memo[k] === 'case') c = true; if (memo[k] === 'split') s = true; });
    }
    Object.keys(P.segStyle || {}).forEach(function (k) { var r = P.segStyle[k] && P.segStyle[k].role; if (r === 'case') c = true; if (r === 'split') s = true; });
    (P.userLines || []).forEach(function (l) { if ((l.role || 'case') === 'case') c = true; if (l.role === 'split') s = true; });
    (P.features || []).forEach(function (f) { if ((f.ov || 'case') === 'case') c = true; else if (f.ov === 'split') s = true; });
    bothFlag.set(P, c && s);
    return c && s;
  }

  /* ---------- 線型 ---------- */
  var DASHES = {
    solid: null, dash: [3, 1.5], dashS: [1.5, 1], dashL: [6, 2], dot: [0.05, 0.9],
    dashDot: [4, 1, 0.3, 1], dashDot2: [4, 1, 0.3, 1, 0.3, 1], center: [8, 1.5, 1.5, 1.5]
  };
  var DASH_LIST = [['solid', '實線 ────'], ['dash', '虛線 ─ ─ ─'], ['dashS', '短虛線 - - - -'], ['dashL', '長虛線 ── ──'],
    ['dot', '點線 ·······'], ['dashDot', '一點鏈線 ─·─·'], ['dashDot2', '二點鏈線 ─··─··'], ['center', '中心線 ───·───']];
  function normDash(d) { if (d === true) return 'dash'; if (!d || !DASHES.hasOwnProperty(d)) return 'solid'; return d; }
  function dashAttr(d, lw) {
    d = normDash(d);
    var p = DASHES[d]; if (!p) return '';
    var k = Math.max(1, (lw || 0.2) / 0.2);
    return ' stroke-dasharray="' + p.map(function (x) { return n(x * k); }).join(' ') + '"' + (d === 'dot' ? ' stroke-linecap="round"' : '');
  }
  /* 線段樣式：圖層預設 + 個別覆寫 */
  function lineStyle(P, role, ss) {
    var b = roleStyle(P, role);
    ss = ss || {};
    return { color: ss.color || b.color, lw: ss.lw || b.width, dash: ss.dash != null && ss.dash !== '' ? normDash(ss.dash) : normDash(b.dash) };
  }
  function lineSVG(a, b, st, extra) {
    return '<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) + '" stroke="' + st.color + '" stroke-width="' + n(st.lw) + '" stroke-linecap="round"' + dashAttr(st.dash, st.lw) + (extra || '') + '/>';
  }
  function arrowHead(from, to, lw, color) {
    var dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy); if (!L) return '';
    var ux = dx / L, uy = dy / L, sz = Math.max(1.8, lw * 9), w = sz * 0.35;
    var bx = to[0] - ux * sz, by = to[1] - uy * sz;
    return '<path d="M' + n(to[0]) + ' ' + n(to[1]) + 'L' + n(bx - uy * w) + ' ' + n(by + ux * w) + 'L' + n(bx + uy * w) + ' ' + n(by - ux * w) + 'Z" fill="' + color + '"/>';
  }
  function arrows(a, b, st, mode) {
    var s = '';
    if (mode === 'end' || mode === 'both') s += arrowHead(a, b, st.lw, st.color);
    if (mode === 'start' || mode === 'both') s += arrowHead(b, a, st.lw, st.color);
    return s;
  }

  /* ---------- 斷線：把一條線依 P.splits[idx] 分成多段 ---------- */
  function pieces(P, l, idx) {
    var sp = P.splits && P.splits[idx];
    if (!sp || !sp.length) return [{ key: String(idx), idx: idx, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 }];
    var ts = [0].concat(sp, [1]), out = [];
    for (var k = 0; k + 1 < ts.length; k++) {
      var t0 = ts[k], t1 = ts[k + 1];
      out.push({ key: idx + '.' + k, idx: idx, x1: l.x1 + (l.x2 - l.x1) * t0, y1: l.y1 + (l.y2 - l.y1) * t0, x2: l.x1 + (l.x2 - l.x1) * t1, y2: l.y1 + (l.y2 - l.y1) * t1 });
    }
    return out;
  }
  /* 逐段走訪所有可見的圖資線段 */
  /* 逐段走訪圖資線段。opts.all：含隱藏圖層；opts.keepMerged：保留假合併中被隱藏的界線 */
  function eachPiece(P, cad, fn, opts) {
    if (!cad) return;
    opts = opts || {};
    var mi = opts.keepMerged ? null : mergeInfo(P, cad), hideInternal = mi && P.merge && P.merge.mode === 'hide';
    cad.lines.forEach(function (l, idx) {
      var base = roleOf(P, l.layer, 'line', l.color);
      pieces(P, l, idx).forEach(function (pc) {
        var ss = P.segStyle[pc.key], role = (ss && ss.role) || base;
        if (!opts.all) {
          if (role === 'hide' || (ss && ss.hidden)) return;
          if (P.ovs && P.ovs[role] && P.ovs[role].visible === false) return;
          if (hideInternal && mi.internal[pc.key]) return;
        }
        fn(pc, role, ss, l);
      });
    });
  }
  function roleOf(P, layer, kind, color) {
    var r = (color != null && P.layerRoles[kind + ':' + layer + '|' + color]) || P.layerRoles[kind + ':' + layer];
    return r || defaultRole(layer, kind);
  }

  /* ---------- 假合併 ----------
     P.merge = { parcels: '641、643、646', mode: 'x' | 'hide' | 'off', xSize: 3 }
     找出所列地號彼此之間的共用界線：mode x = 保留並在線上打 X；hide = 不顯示。
     點選成面時一律不把這些界線當邊界。 */
  function parseParcels(str) {
    return String(str || '').split(/[、,，;；\s]+/).map(function (x) { return x.trim(); }).filter(Boolean);
  }
  var EMPTY_MERGE = { internal: {}, marks: [], parcels: [], missing: [] };
  function mergeInfo(P, cad) {
    var mg = P.merge;
    if (!cad || !mg || mg.mode === 'off') return EMPTY_MERGE;
    var list = parseParcels(mg.parcels);
    var hasSrc = cad.lines.some(function (l) { return /MERGESRC/i.test(l.layer); });
    if (list.length < 2 && !hasSrc) return EMPTY_MERGE;
    var key = list.join(',') + '|' + JSON.stringify(P.splits || {}) + '|' + JSON.stringify(P.layerRoles || {}) + '|' + cad.lines.length;
    if (cad._merge && cad._merge.key === key) return cad._merge.res;
    var labels = {};
    cad.texts.forEach(function (t) {
      var tx = String(t.text).trim();
      if (list.indexOf(tx) >= 0 && !labels[tx]) labels[tx] = [t.x, t.y];
    });
    var pts = Object.keys(labels).map(function (k) { return labels[k]; });
    var res = { internal: {}, marks: [], parcels: Object.keys(labels), missing: list.filter(function (no) { return !labels[no]; }) };
    var inner = [];
    // 內網合併輸出的 MERGESRC 圖層本身就是被合併的原界線
    eachPiece(P, cad, function (pc, role, ss, l) {
      if (/MERGESRC/i.test(l.layer)) { res.internal[pc.key] = 1; inner.push(pc); }
    }, { keepMerged: true });
    if (pts.length >= 2) {
      var bb = G.bbox(pts), M_ = 400;
      bb = [bb[0] - M_, bb[1] - M_, bb[2] + M_, bb[3] + M_];
      var pcs = [];
      eachPiece(P, cad, function (pc, role) {
        if (role !== 'parcel') return;
        if (Math.max(pc.x1, pc.x2) < bb[0] || Math.min(pc.x1, pc.x2) > bb[2] || Math.max(pc.y1, pc.y2) < bb[1] || Math.min(pc.y1, pc.y2) > bb[3]) return;
        pcs.push(pc);
      }, { keepMerged: true });
      var faces = G.buildFaces(pcs.map(function (p) { return [p.x1, p.y1, p.x2, p.y2]; }), 0.002), polys = [];
      Object.keys(labels).forEach(function (no) {
        var best = null, ba = Infinity;
        faces.forEach(function (f) { if (G.pointInPoly(labels[no], f)) { var a = G.area(f); if (a < ba) { ba = a; best = f; } } });
        if (best) polys.push({ no: no, poly: best, bb: G.bbox(best), area: ba });
      });
      polys.sort(function (a, b) { return a.area - b.area; }); // 有洞的大面會包住小面，取最小者
      var which = function (p) {
        for (var i = 0; i < polys.length; i++) {
          var b = polys[i].bb;
          if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue;
          if (G.pointInPoly(p, polys[i].poly)) return polys[i].no;
        }
        return null;
      };
      pcs.forEach(function (pc) {
        if (res.internal[pc.key]) return;
        var dx = pc.x2 - pc.x1, dy = pc.y2 - pc.y1, L = Math.hypot(dx, dy); if (L < 0.01) return;
        var mx = (pc.x1 + pc.x2) / 2, my = (pc.y1 + pc.y2) / 2, nx = -dy / L * 0.05, ny = dx / L * 0.05;
        var a = which([mx + nx, my + ny]), b = which([mx - nx, my - ny]);
        if (a && b && a !== b) { res.internal[pc.key] = 1; inner.push(pc); }
      });
    }
    {
      // 相連的界線分成一組，在較長的線段中點打 X
      var node = {}, comp = [], seen = {};
      var k = function (x, y) { return Math.round(x * 1000) + ',' + Math.round(y * 1000); };
      inner.forEach(function (pc, i) { [k(pc.x1, pc.y1), k(pc.x2, pc.y2)].forEach(function (q) { (node[q] = node[q] || []).push(i); }); });
      inner.forEach(function (pc, i) {
        if (seen[i]) return;
        var stack = [i], group = []; seen[i] = 1;
        while (stack.length) {
          var j = stack.pop(), p = inner[j]; group.push(p);
          [k(p.x1, p.y1), k(p.x2, p.y2)].forEach(function (q) { node[q].forEach(function (m) { if (!seen[m]) { seen[m] = 1; stack.push(m); } }); });
        }
        comp.push(group);
      });
      var len = function (p) { return Math.hypot(p.x2 - p.x1, p.y2 - p.y1); };
      comp.forEach(function (g) {
        var longest = Math.max.apply(null, g.map(len));
        g.forEach(function (p) {
          if (len(p) < longest * 0.5) return;
          res.marks.push({ x: (p.x1 + p.x2) / 2, y: (p.y1 + p.y2) / 2, ang: Math.atan2(p.y2 - p.y1, p.x2 - p.x1) });
        });
      });
    }
    cad._merge = { key: key, res: res };
    return res;
  }

  /* 從 DXF 中的 X 記號（兩條短線交叉）推測合併的地號：X 所在界線兩側封閉區內的地號 */
  function detectMerge(P, cad) {
    if (!cad) return [];
    var shorts = [], grid = {};
    // X 記號優先找 MERGE 類圖層；沒有的話找非地籍線圖層（地籍圖本身也有交叉小符號）
    var hasMergeLayer = cad.lines.some(function (l) { return /MERGE$/i.test(l.layer); });
    cad.lines.forEach(function (l) {
      if (hasMergeLayer ? !/MERGE$/i.test(l.layer) : roleOf(P, l.layer, 'line', l.color) === 'parcel') return;
      var L = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      if (L < 0.3 || L > 8) return;
      var mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2, key = Math.round(mx) + ',' + Math.round(my);
      shorts.push({ l: l, mx: mx, my: my, L: L });
      (grid[key] = grid[key] || []).push(shorts.length - 1);
    });
    var centers = [];
    shorts.forEach(function (a, i) {
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        (grid[(Math.round(a.mx) + dx) + ',' + (Math.round(a.my) + dy)] || []).forEach(function (j) {
          if (j <= i) return;
          var b = shorts[j];
          if (Math.hypot(a.mx - b.mx, a.my - b.my) > 0.05 * Math.min(a.L, b.L) || Math.abs(a.L - b.L) > 0.2 * a.L) return;
          var r = G.segIntersect([a.l.x1, a.l.y1], [a.l.x2, a.l.y2], [b.l.x1, b.l.y1], [b.l.x2, b.l.y2]);
          if (r && Math.abs(r.t - 0.5) < 0.1 && Math.abs(r.u - 0.5) < 0.1) centers.push([a.mx, a.my]);
        });
      }
    });
    if (!centers.length) return [];
    var found = [];
    centers.forEach(function (c) {
      var bb = [c[0] - 300, c[1] - 300, c[0] + 300, c[1] + 300], segs = [], near = null, nd = 3;
      eachPiece(P, cad, function (pc, role) {
        if (role !== 'parcel') return;
        var cs = G.clipSeg(pc.x1, pc.y1, pc.x2, pc.y2, bb[0], bb[1], bb[2], bb[3]); if (!cs) return;
        segs.push(cs);
        var d = G.distToSeg(c, [pc.x1, pc.y1], [pc.x2, pc.y2]);
        if (d < nd) { nd = d; near = pc; }
      }, { keepMerged: true });
      if (!near) return;
      var faces = G.buildFaces(segs, 0.002);
      var dx = near.x2 - near.x1, dy = near.y2 - near.y1, L = Math.hypot(dx, dy);
      var foot = [c[0], c[1]];
      [1, -1].forEach(function (sg) {
        var p = [foot[0] - dy / L * 0.3 * sg, foot[1] + dx / L * 0.3 * sg], best = null, ba = Infinity;
        faces.forEach(function (f) { if (G.pointInPoly(p, f)) { var a = G.area(f); if (a < ba) { ba = a; best = f; } } });
        if (!best) return;
        var cands = cad.texts.filter(function (t) {
          var role = roleOf(P, t.layer, 'text');
          return (role === 'parcelNo' || role === 'target') && !/\(\d+\)$/.test(t.text) && G.pointInPoly([t.x, t.y], best);
        });
        cands.sort(function (a, b) { return (roleOf(P, b.layer, 'text') === 'target') - (roleOf(P, a.layer, 'text') === 'target'); });
        if (cands[0] && found.indexOf(String(cands[0].text).trim()) < 0) found.push(String(cands[0].text).trim());
      });
    });
    return found;
  }

  /* ---------- 地圖座標轉換 ---------- */
  function mapView(el) {
    var k = 1000 / el.scale;
    var cx = el.cx || 0, cy = el.cy || 0;
    var X0 = cx - el.w / 2 / k, X1 = cx + el.w / 2 / k, Y0 = cy - el.h / 2 / k, Y1 = cy + el.h / 2 / k;
    return {
      k: k, X0: X0, X1: X1, Y0: Y0, Y1: Y1,
      toP: function (x, y) { return [el.x + (x - X0) * k, el.y + el.h - (y - Y0) * k]; },
      toW: function (px, py) { return [X0 + (px - el.x) / k, Y0 + (el.y + el.h - py) / k]; }
    };
  }

  /* ---------- 表格模型 ---------- */
  /* 表格排版：文字維持設定的字高，放不下就換行並自動加高列高（行距舒適）。
     el.autoRowH === false 時回到舊行為（列高固定、字縮小）。
     一般表格另有 keepTotal（預設開）：列被撐高時，從最空的列借高度，表格總高不變。 */
  var LH = 1.3;
  function needH(text, w, fs, font, lh) {
    if (!text) return 0;
    return M.wrap(text, Math.max(1, w - 1.6), fs, font || 'kai').length * fs * (lh || LH) + 1.6;
  }
  function spanW(cols, c, cs) { var w = 0; for (var i = c; i < c + (cs || 1) && i < cols.length; i++) w += cols[i]; return w; }
  function tableModel(el, P) {
    var F = fieldsOf(P);
    if (el.type === 'table') {
      var rows = el.rows.slice(), auto = el.autoRowH !== false;
      var cells = el.cells.map(function (c) { var o = Object.assign({}, c); o.text = M.fill(c.text, F); return o; });
      if (auto) {
        var need = rows.map(function () { return 0; });
        cells.forEach(function (c) {
          if (c.fit === 'shrink' || !c.text) return;
          if (!c.lh && c.text.indexOf('\n') < 0) c.lh = LH;
          var h = needH(c.text, spanW(el.cols, c.c, c.cs), c.fs || 4, c.font, c.lh || LH);
          var rs = c.rs || 1, have = 0, i;
          for (i = c.r; i < c.r + rs && i < rows.length; i++) have += rows[i];
          if (rs === 1) need[c.r] = Math.max(need[c.r], h);
          else if (h > have) { var last = Math.min(rows.length - 1, c.r + rs - 1); need[last] = Math.max(need[last], rows[last] + h - have); }
        });
        var excess = 0;
        rows = rows.map(function (r, i) { if (need[i] > r + 0.01) { excess += need[i] - r; return Math.round(need[i] * 100) / 100; } return r; });
        if (excess > 0 && el.keepTotal !== false) {
          // 從空間最多的列借高度（不小於該列內容所需）
          var order = rows.map(function (r, i) { return i; }).sort(function (a, b) { return (rows[b] - Math.max(need[b], 4)) - (rows[a] - Math.max(need[a], 4)); });
          order.forEach(function (i) {
            if (excess <= 0) return;
            var slack = rows[i] - Math.max(need[i], 4); if (slack <= 0) return;
            var take = Math.min(slack, excess); rows[i] = Math.round((rows[i] - take) * 100) / 100; excess -= take;
          });
          // 四捨五入殘差補到最高的那一列，總高與設定完全一致
          var t0 = el.rows.reduce(function (a, b) { return a + b; }, 0), t1 = rows.reduce(function (a, b) { return a + b; }, 0), d = Math.round((t0 - t1) * 100) / 100;
          if (d && excess <= 0.001) { var mi = rows.indexOf(Math.max.apply(null, rows)); rows[mi] = Math.round((rows[mi] + d) * 100) / 100; }
        }
      }
      return { cols: el.cols, rows: rows, cells: cells, kinds: null };
    }
    // 說明表（依說明項目自動產生）
    var all = P.features.filter(function (f) {
      if (f.hideInTable) return false;
      if (el.ov && featOv(f) !== el.ov) return false;
      if (el.landFilter) return String(f.landNo) === String(el.landFilter);
      return true;
    });
    var feats = all.filter(function (f) { return !f.inRegister; }), inReg = all.length - feats.length;   // 列入清冊的不在圖上表格
    var rowsF = [], kinds = [], cellsF = [], cols = el.columns || [], autoF = el.autoRowH !== false;
    var allReg = !feats.length && inReg > 0;   // 全部列入清冊：只留標題＋「詳如清冊」
    if (el.titleH > 0) {
      rowsF.push(el.titleH); kinds.push('title');
      cellsF.push({ r: 0, c: 0, cs: cols.length, text: M.fill(el.title, F), align: 'center', valign: 'middle', fs: el.titleFs, fit: 'shrink' });
    }
    if (el.headerH > 0 && !allReg) {
      var hr = rowsF.length; rowsF.push(el.headerH); kinds.push('header');
      cols.forEach(function (c, i) { cellsF.push({ r: hr, c: i, text: c.header || '', align: 'center', valign: 'middle', fs: el.headerFs, fit: 'shrink' }); });
    }
    var firstData = rowsF.length;
    feats.forEach(function (f) {
      var r = rowsF.length, base = el.rowHs[f.id] || el.rowH, nd = 0;
      cols.forEach(function (col, c) {
        var v = col.key === 'area' ? featureArea(f, el.decimals) : f[col.key], txt = v == null ? '' : String(v), fs = col.fs || el.dataFs;
        var numeric = col.key === 'code' || col.key === 'area';   // 編號、面積不換行（太長就縮小）
        var cell = { r: r, c: c, text: txt, align: col.align || 'center', valign: 'middle', fs: fs, fit: (!autoF || numeric) ? 'shrink' : '', fid: f.id, lh: LH };
        cellsF.push(cell);
        if (autoF && txt) nd = Math.max(nd, numeric ? fs * LH + 1.6 : needH(txt, el.cols[c] || 10, fs, 'kai', LH));
      });
      rowsF.push(autoF ? Math.max(base, Math.round(nd * 100) / 100) : base); kinds.push(f.id);
    });
    if (inReg > 0) {   // 其餘項目詳如清冊；全部進清冊時只寫「詳如清冊」
      var rr = rowsF.length; rowsF.push(allReg ? Math.max(el.rowH, 12) : el.rowH); kinds.push('register');
      cellsF.push({ r: rr, c: 0, cs: cols.length, text: allReg ? M.fill(el.registerAllText || '詳如清冊', F) : M.fill(el.registerText || '其餘 ' + inReg + ' 筆詳如清冊', F), align: 'center', valign: 'middle', fs: allReg ? el.dataFs : el.dataFs * 0.85, fit: 'shrink' });
    }
    // 合併儲存格：{ fid: 起始列的說明項目, n: 列數, c: 起始欄, cs: 欄數 }
    (el.merges || []).forEach(function (mg) {
      var r0 = kinds.indexOf(mg.fid); if (r0 < 0) return;
      var n = Math.max(1, Math.min(mg.n || 1, rowsF.length - r0)), cs = Math.max(1, Math.min(mg.cs || 1, cols.length - mg.c));
      for (var i = r0; i < r0 + n; i++) if (typeof kinds[i] !== 'string' || kinds[i] === 'title' || kinds[i] === 'header' || kinds[i] === 'notes' || kinds[i] === 'register') return;
      var anchor = null;
      cellsF = cellsF.filter(function (c) {
        var inside = c.r >= r0 && c.r < r0 + n && c.c >= mg.c && c.c < mg.c + cs;
        if (!inside) return true;
        if (c.r === r0 && c.c === mg.c) { anchor = c; return true; }
        return false;
      });
      if (anchor) { anchor.rs = n; anchor.cs = cs; anchor.merged = true; }
    });
    if (el.notesH > 0 && !(allReg && !el.stackBelow)) {
      var ntext = M.fill(el.notes, F), tw = cols.length ? el.cols.reduce(function (a, b) { return a + b; }, 0) : 50;
      rowsF.push(Math.max(el.notesH, needH(ntext, tw, el.notesFs, 'kai', 1.25))); kinds.push('notes');
      cellsF.push({ r: rowsF.length - 1, c: 0, cs: cols.length, text: ntext, align: 'left', valign: 'top', fs: el.notesFs, lh: 1.25 });
    }
    return { cols: el.cols, rows: rowsF, cells: cellsF, kinds: kinds, firstData: firstData };
  }

  /* 說明項目的定位點：一般為面的內部點；「標號」（不算面積）為點選的位置 */
  function featAnchor(f) { return f.pt || G.labelPoint(f.pts); }
  function featureArea(f, dec) {
    if (f.areaOverride != null && f.areaOverride !== '') return String(f.areaOverride);
    if (f.pt || !f.pts || f.pts.length < 3) return '';
    return (G.area(f.pts) + (f.arcAdj || 0)).toFixed(dec == null ? 2 : dec);
  }

  function cellRect(el, tm, c) {
    var x = el.x, y = el.y, i;
    for (i = 0; i < c.c; i++) x += tm.cols[i];
    for (i = 0; i < c.r; i++) y += tm.rows[i];
    var w = 0, h = 0;
    for (i = c.c; i < c.c + (c.cs || 1) && i < tm.cols.length; i++) w += tm.cols[i];
    for (i = c.r; i < c.r + (c.rs || 1) && i < tm.rows.length; i++) h += tm.rows[i];
    return { x: x, y: y, w: w, h: h };
  }

  /* ---------- 文字方塊 ---------- */
  function textBlock(x, y, w, h, text, o) {
    var fs = o.fs || 4, font = o.font || 'kai', ls = o.ls || 0, pad = o.pad == null ? 0.8 : o.pad;
    var iw = Math.max(0.1, w - pad * 2), ih = Math.max(0.1, h - pad * 2), lhF = o.lh || 1.12;
    var lines;
    if (o.fit === 'shrink') {
      lines = String(text).split('\n');
      for (var g = 0; g < 60; g++) {
        var widest = 0;
        lines.forEach(function (l) { widest = Math.max(widest, M.measure(l, fs, font, ls)); });
        if ((widest <= iw && lines.length * fs * lhF <= ih + 0.01) || fs < 1.2) break;
        fs *= 0.95;
      }
    } else {
      lines = M.wrap(text, iw, fs, font, ls);
    }
    var lh = fs * lhF, total = lines.length * lh;
    var y0 = o.valign === 'top' ? y + pad : o.valign === 'bottom' ? y + h - pad - total : y + (h - total) / 2;
    var anchor = o.align === 'center' ? 'middle' : o.align === 'right' ? 'end' : 'start';
    var tx = o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w - pad : x + pad;
    var s = '';
    lines.forEach(function (l, i) {
      if (!l) return;
      var ax = tx;
      if (ls && anchor === 'middle') ax += ls / 2; // 字距置中修正
      s += '<text x="' + n(ax) + '" y="' + n(y0 + (i + 0.5) * lh) + '" font-size="' + n(fs) + '" text-anchor="' + anchor +
        '" dominant-baseline="central"' + (ls ? ' letter-spacing="' + n(ls) + '"' : '') +
        ' font-family="' + esc(M.fontFamily(font)) + '" fill="' + (o.color || '#000') + '"' + (o.bold ? ' font-weight="bold"' : '') +
        ' xml:space="preserve" style="white-space:pre">' + esc(l) + '</text>';
    });
    return s;
  }

  /* ---------- 各元件 ---------- */
  function renderTable(el, P) {
    var tm = tableModel(el, P), s = '<g data-id="' + el.id + '">';
    var lw = el.lw == null ? 0.24 : el.lw;
    // 白底：表格放在其他元件上面時，蓋住底下的格線
    if (el.bg !== false) {
      var tw = tm.cols.reduce(function (a, b) { return a + b; }, 0), th = tm.rows.reduce(function (a, b) { return a + b; }, 0);
      s += '<rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(tw) + '" height="' + n(th) + '" fill="#fff" stroke="none"/>';
    }
    tm.cells.forEach(function (c) {
      var r = cellRect(el, tm, c);
      if (lw > 0 && !c.noBorder) {
        if (c.hideL || c.hideR) {
          var ln = function (x1, y1, x2, y2) { return '<line x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) + '" stroke="#000" stroke-width="' + lw + '"/>'; };
          s += ln(r.x, r.y, r.x + r.w, r.y) + ln(r.x, r.y + r.h, r.x + r.w, r.y + r.h);
          if (!c.hideL) s += ln(r.x, r.y, r.x, r.y + r.h);
          if (!c.hideR) s += ln(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
        } else s += '<rect x="' + n(r.x) + '" y="' + n(r.y) + '" width="' + n(r.w) + '" height="' + n(r.h) + '" fill="none" stroke="#000" stroke-width="' + lw + '"/>';
      }
      if (c.text) s += textBlock(r.x, r.y, r.w, r.h, c.text, c);
    });
    // 沒有內容定義的格子也畫框線
    if (lw > 0) {
      var covered = {};
      tm.cells.forEach(function (c) {
        for (var i = c.r; i < c.r + (c.rs || 1); i++) for (var j = c.c; j < c.c + (c.cs || 1); j++) covered[i + ',' + j] = 1;
      });
      for (var i = 0; i < tm.rows.length; i++) for (var j = 0; j < tm.cols.length; j++) {
        if (covered[i + ',' + j]) continue;
        var r = cellRect(el, tm, { r: i, c: j });
        s += '<rect x="' + n(r.x) + '" y="' + n(r.y) + '" width="' + n(r.w) + '" height="' + n(r.h) + '" fill="none" stroke="#000" stroke-width="' + lw + '"/>';
      }
    }
    return s + '</g>';
  }

  function tableSize(el, P) {
    var tm = tableModel(el, P);
    return { w: tm.cols.reduce(function (a, b) { return a + b; }, 0), h: tm.rows.reduce(function (a, b) { return a + b; }, 0) };
  }

  function renderNorth(el) {
    var cx = el.x + el.w / 2, fs = Math.min(el.w * 0.55, 5.04);
    var top = el.y + fs * 1.15, ah = Math.min(5, el.h * 0.18), aw = Math.min(el.w * 0.32, 2.2);
    var s = '<g data-id="' + el.id + '">';
    s += '<text x="' + n(cx) + '" y="' + n(el.y + fs * 0.55) + '" font-size="' + n(fs) + '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(M.fontFamily('kai')) + '">' + esc(el.label != null ? el.label : '北') + '</text>';
    s += '<path d="M' + n(cx) + ' ' + n(top) + ' L' + n(cx - aw / 2) + ' ' + n(top + ah) + ' L' + n(cx + aw / 2) + ' ' + n(top + ah) + ' Z" fill="#000"/>';
    s += '<line x1="' + n(cx) + '" y1="' + n(top + ah) + '" x2="' + n(cx) + '" y2="' + n(el.y + el.h) + '" stroke="#000" stroke-width="0.24"/>';
    var hy = top + ah + (el.y + el.h - top - ah) * 0.3;
    s += '<line x1="' + n(el.x) + '" y1="' + n(hy) + '" x2="' + n(el.x + el.w) + '" y2="' + n(hy) + '" stroke="#000" stroke-width="0.24"/>';
    return s + '</g>';
  }

  function dashOf(style, lw) { return dashAttr(style, lw); }
  function featOv(f) { return f.ov || 'case'; }
  function featVisible(P, f) { return !(P.ovs && P.ovs[featOv(f)] && P.ovs[featOv(f)].visible === false); }
  function featColor(P, f) { return P.styles.featureLabelByLayer === false ? P.styles.featureLabel.color : roleStyle(P, featOv(f)).color; }
  function visFeatures(P) { return P.features.filter(function (f) { return featVisible(P, f); }); }

  /* 略圖框的文字比例：編號、本案地號、非本案地號分開設定（舊版的 textScale 為共同預設） */
  function textScales(el) {
    var b = el.textScale || 1;
    return { feat: el.tsFeat || b, target: el.tsTarget || b, parcel: el.tsParcel || b };
  }
  /* 本案範圍：地上物＋本案地號所在地塊（給非本案地號避開用） */
  function caseAreas(P, cad, v) {
    var polys = [];
    visFeatures(P).forEach(function (f) { if (f.pts && f.pts.length >= 3) polys.push(f.pts); });
    if (cad) {
      var key = JSON.stringify(P.layerRoles || {}) + '|' + cad.lines.length + '|' + cad.texts.length;
      if (!cad._tgt || cad._tgt.key !== key) {
        var res = [];
        var tg = cad.texts.filter(function (t) { return roleOf(P, t.layer, 'text') === 'target' && !/\(\d+\)$/.test(t.text); });
        if (tg.length && tg.length <= 30) {
          var bb = G.bbox(tg.map(function (t) { return [t.x, t.y]; })), pad = 400, segs = [];
          bb = [bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad];
          eachPiece(P, cad, function (pc, role) {
            if (role !== 'parcel') return;
            var c = G.clipSeg(pc.x1, pc.y1, pc.x2, pc.y2, bb[0], bb[1], bb[2], bb[3]); if (c) segs.push(c);
          });
          var faces = G.buildFaces(segs, 0.002);
          tg.forEach(function (t) {
            var best = null, ba = Infinity;
            faces.forEach(function (f) { if (G.pointInPoly([t.x, t.y], f)) { var a = G.area(f); if (a < ba) { ba = a; best = f; } } });
            if (best && ba < 2e6) res.push(best);
          });
        }
        cad._tgt = { key: key, polys: res };
      }
      polys = polys.concat(cad._tgt.polys);
    }
    return polys.map(function (p) { return { pts: p, bb: G.bbox(p) }; });
  }
  function boxInAreas(box, areas) {
    for (var i = 0; i < areas.length; i++) {
      var a = areas[i], b = a.bb;
      if (b[2] < box[0] || b[0] > box[2] || b[3] < box[1] || b[1] > box[3]) continue;
      var cs = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]];
      for (var j = 0; j < cs.length; j++) if (G.pointInPoly(cs[j], a.pts)) return true;
    }
    return false;
  }

  /* ---------- 標籤自動避開線條 ---------- */
  function boxHits(box, segs, boxes) {
    var h = 0;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (Math.max(s[0], s[2]) < box[0] || Math.min(s[0], s[2]) > box[2] || Math.max(s[1], s[3]) < box[1] || Math.min(s[1], s[3]) > box[3]) continue;
      if (G.clipSeg(s[0], s[1], s[2], s[3], box[0], box[1], box[2], box[3])) h++;
    }
    for (i = 0; i < boxes.length; i++) {
      var b = boxes[i];
      if (!(b[2] < box[0] || b[0] > box[2] || b[3] < box[1] || b[1] > box[3])) h++;
    }
    return h;
  }
  /* 回傳世界座標下各標籤位置 {feat:{id:[x,y]}, text:{idx:[x,y]}}；手動移動過的不變 */
  function layoutLabels(el, P, cad) {
    var v = mapView(el), ST = P.styles, font = ST.mapFont, k = v.k, res = { feat: {}, text: {} }, TSc = textScales(el);
    var auto = ST.autoAvoid !== false;
    var segs = [];
    function addSeg(x1, y1, x2, y2) { var c = G.clipSeg(x1, y1, x2, y2, v.X0, v.Y0, v.X1, v.Y1); if (c) segs.push(c); }
    if (auto) {
      eachPiece(P, cad, function (pc) { addSeg(pc.x1, pc.y1, pc.x2, pc.y2); });
      (P.userLines || []).forEach(function (l) { addSeg(l.x1, l.y1, l.x2, l.y2); });
      visFeatures(P).forEach(function (f) {
        if (!f.outline || !f.pts || f.pts.length < 3) return;
        for (var i = 0; i < f.pts.length; i++) { var a = f.pts[i], b = f.pts[(i + 1) % f.pts.length]; addSeg(a[0], a[1], b[0], b[1]); }
      });
    }
    var placed = [], areas = auto && ST.avoidCase !== false ? caseAreas(P, cad, v) : [];
    function place(anchor, text, size, poly, isOther) {
      var hw = M.measure(text, size, font) / 2 / k * 1.05, hh = size * 0.42 / k;
      function boxAt(x, y) { return [x - hw, y - hh, x + hw, y + hh]; }
      // 非本案地號壓到本案範圍（地上物、本案地塊）時加重扣分
      function score(b) { return boxHits(b, segs, placed) * 1000 + (isOther && areas.length && boxInAreas(b, areas) ? 6000 : 0); }
      var b0 = boxAt(anchor[0], anchor[1]), base = score(b0);
      if (!auto || base === 0) { placed.push(b0); return anchor; }
      var best = anchor, bestS = base, maxR = size * (isOther ? 2.2 : 1.1) / k; // 一般只移約 1 個字高；非本案地號可再遠一點
      for (var ri = 1; ri <= 8; ri++) {
        var r = maxR * ri / 8;
        for (var ai = 0; ai < 16; ai++) {
          var ang = (ai + (ri % 2) * 0.5) * Math.PI / 8;
          var x = anchor[0] + Math.cos(ang) * r, y = anchor[1] + Math.sin(ang) * r * 0.8;
          var sc = score(boxAt(x, y)) + r * k * 10;
          if (poly && !G.pointInPoly([x, y], poly)) sc += 600;
          if (sc < bestS) { bestS = sc; best = [x, y]; }
        }
      }
      placed.push(boxAt(best[0], best[1]));
      return best;
    }
    // 地上物編號
    visFeatures(P).forEach(function (f) {
      if (f.label === false) return;
      if (f.labelAt) { res.feat[f.id] = f.labelAt; return; }
      if (!featAnchor(f)) return;
      res.feat[f.id] = place(featAnchor(f), f.code, (f.labelSize || ST.featureLabel.size) * TSc.feat, f.pt ? null : f.pts);
    });
    if (cad) {
      var order = [];
      cad.texts.forEach(function (t, idx) {
        var role = roleOf(P, t.layer, 'text');
        if (role === 'hide') return;
        var ov = P.textOver[idx] || {};
        if (ov.hidden) return;
        if (ST.hideTempNo !== false && /\(\d+\)$/.test(t.text) && !ov.show) return; // 分割暫編地號如 641(1)
        var x = ov.x != null ? ov.x : t.x, y = ov.y != null ? ov.y : t.y;
        if (x < v.X0 || x > v.X1 || y < v.Y0 || y > v.Y1) return;
        order.push({ idx: idx, t: t, ov: ov, x: x, y: y, role: role });
      });
      order.sort(function (a, b) { return (a.role === 'target' ? 0 : 1) - (b.role === 'target' ? 0 : 1); });
      order.forEach(function (o) {
        var st = o.role === 'target' ? ST.targetText : o.role === 'parcelNo' ? ST.parcelText : ST.otherText;
        var centered = o.t.h72 === 4 || o.t.h72 === 1 || o.ov.x != null;
        if (o.ov.x != null || !centered || o.t.rot) { res.text[o.idx] = [o.x, o.y]; return; }
        res.text[o.idx] = place([o.x, o.y], o.t.text, (o.ov.size || st.size) * (o.role === 'target' ? TSc.target : TSc.parcel), null, o.role !== 'target');
      });
    }
    lastLayout[el.id] = res;
    return res;
  }
  var lastLayout = {};

  function renderMap(el, P, cad, opts) {
    var s = '<g data-id="' + el.id + '">';
    if (el.cx == null) {
      s += '<rect x="' + el.x + '" y="' + el.y + '" width="' + el.w + '" height="' + el.h + '" fill="none" stroke="#000" stroke-width="' + (el.lw || 0.18) + '"/>';
      if (!opts.print) s += '<text x="' + n(el.x + el.w / 2) + '" y="' + n(el.y + el.h / 2) + '" font-size="5" text-anchor="middle" fill="#999" font-family="' + esc(M.SANS) + '">請先「匯入 DXF」</text>';
      return s + '</g>';
    }
    var v = mapView(el), ST = P.styles, font = M.fontFamily(ST.mapFont), TSc = textScales(el);
    var clipId = 'clip_' + el.id + (opts.print ? '_p' : '');
    s += '<clipPath id="' + clipId + '"><rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '"/></clipPath>';
    if (el.bg !== false) s += '<rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="#fff" stroke="none"/>';
    s += '<g clip-path="url(#' + clipId + ')">';

    // 地上物填色（在線之下）
    visFeatures(P).forEach(function (f) {
      if (!f.fill) return;
      var d = f.pts.map(function (p, i) { var q = v.toP(p[0], p[1]); return (i ? 'L' : 'M') + n(q[0]) + ' ' + n(q[1]); }).join('') + 'Z';
      s += '<path d="' + d + '" fill="' + f.fill + '" fill-opacity="' + (f.fillOpacity == null ? 0.25 : f.fillOpacity) + '" stroke="none"/>';
    });

    var groups = { parcel: '', other: '', split: '', case: '' }, special = '';
    eachPiece(P, cad, function (pc, role, ss) {
      var c = G.clipSeg(pc.x1, pc.y1, pc.x2, pc.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (!c) return;
      var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]);
      if (ss && (ss.dash != null || ss.color || ss.lw)) special += lineSVG(a, b, lineStyle(P, role, ss));
      else groups[role in groups ? role : 'other'] += 'M' + n(a[0]) + ' ' + n(a[1]) + 'L' + n(b[0]) + ' ' + n(b[1]);
    });
    ['parcel', 'other', 'case', 'split'].forEach(function (r) {
      if (!groups[r]) return;
      var st = lineStyle(P, r, null);
      s += '<path d="' + groups[r] + '" fill="none" stroke="' + st.color + '" stroke-width="' + n(st.lw) + '" stroke-linecap="round"' + dashAttr(st.dash, st.lw) + '/>';
    });
    s += special;
    var MI = mergeInfo(P, cad);
    if (P.merge && P.merge.mode === 'x' && MI.marks.length) {
      var xs = P.merge.xSize || 3, pst = lineStyle(P, 'parcel', null), xl = { color: pst.color, lw: Math.max(pst.lw, 0.18), dash: 'solid' };
      MI.marks.forEach(function (mk) {
        if (mk.x < v.X0 || mk.x > v.X1 || mk.y < v.Y0 || mk.y > v.Y1) return;
        var q = v.toP(mk.x, mk.y), a = -mk.ang;
        [Math.PI / 4, -Math.PI / 4].forEach(function (d) {
          var c = Math.cos(a + d) * xs / 2, sn = Math.sin(a + d) * xs / 2;
          s += lineSVG([q[0] - c, q[1] - sn], [q[0] + c, q[1] + sn], xl);
        });
      });
    }
    (P.userLines || []).forEach(function (l) {
      var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (!c) return;
      var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]), st = lineStyle(P, l.role || 'case', l);
      s += lineSVG(a, b, st);
      if (l.arrow) s += arrows(a, b, st, l.arrow);
    });

    // 地上物外框
    visFeatures(P).forEach(function (f) {
      if (!f.outline || !f.pts || f.pts.length < 3) return;
      var d = f.pts.map(function (p, i) { var q = v.toP(p[0], p[1]); return (i ? 'L' : 'M') + n(q[0]) + ' ' + n(q[1]); }).join('') + 'Z';
      var lw = f.lw || ST.caseLine.width;
      s += '<path d="' + d + '" fill="none" stroke="' + (f.color || ST.caseLine.color) + '" stroke-width="' + n(lw) + '" stroke-linejoin="round"' + dashAttr(f.dash, lw) + '/>';
    });

    var LY = layoutLabels(el, P, cad);
    // 地號文字
    if (cad) {
      cad.texts.forEach(function (t, idx) {
        var pos = LY.text[idx]; if (!pos) return;
        var role = roleOf(P, t.layer, 'text'), ov = P.textOver[idx] || {};
        var st = role === 'target' ? ST.targetText : role === 'parcelNo' ? ST.parcelText : ST.otherText;
        var q = v.toP(pos[0], pos[1]), centered = t.h72 === 4 || t.h72 === 1 || ov.x != null;
        s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((ov.size || st.size) * (role === 'target' ? TSc.target : TSc.parcel)) + '" fill="' + (ov.color || st.color) + '" text-anchor="' + (centered ? 'middle' : 'start') +
          '" dominant-baseline="' + (centered ? 'central' : 'alphabetic') + '" font-family="' + esc(font) + '"' +
          (t.rot ? ' transform="rotate(' + n(-t.rot) + ' ' + n(q[0]) + ' ' + n(q[1]) + ')"' : '') + '>' + esc(t.text) + '</text>';
      });
    }
    // 地上物編號
    visFeatures(P).forEach(function (f) {
      if (f.label === false) return;
      var lp = LY.feat[f.id] || f.labelAt || featAnchor(f);
      if (!lp) return;
      var q = v.toP(lp[0], lp[1]);
      if (f.leader) {
        var ip = featAnchor(f), qi = v.toP(ip[0], ip[1]), dx = qi[0] - q[0], dy = qi[1] - q[1], L = Math.hypot(dx, dy);
        var r0 = (f.labelSize || ST.featureLabel.size) * TSc.feat * 0.6;
        if (L > r0 + 0.5) {
          var st = { color: f.labelColor || featColor(P, f), lw: 0.13, dash: 'solid' }, a0 = [q[0] + dx / L * r0, q[1] + dy / L * r0];
          s += lineSVG(a0, qi, st) + arrowHead(a0, qi, 0.15, st.color);
        }
      }
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((f.labelSize || ST.featureLabel.size) * TSc.feat) + '" fill="' + (f.labelColor || featColor(P, f)) +
        '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(font) + '">' + esc(f.code) + '</text>';
    });
    // 圖面註記
    P.annos.forEach(function (a) {
      var q = v.toP(a.x, a.y);
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((a.size || ST.anno.size) * TSc.feat) + '" fill="' + (a.color || ST.anno.color) +
        '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(M.fontFamily(a.font || 'kai')) + '"' +
        (a.rot ? ' transform="rotate(' + n(-a.rot) + ' ' + n(q[0]) + ' ' + n(q[1]) + ')"' : '') + '>' + esc(a.text) + '</text>';
    });
    s += '</g>';
    if (el.border !== false) s += '<rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="none" stroke="#000" stroke-width="' + (el.lw || 0.18) + '"/>';
    if (el.scaleLabel) s += textBlock(el.x, el.y + el.h + 0.5, el.w, 7, '比例尺： 1/' + el.scale, { fs: 4.5, align: 'center', valign: 'top', font: 'kai' });
    return s + '</g>';
  }

  /* 圖框外的淡灰色預覽（不列印），方便移動裁切範圍 */
  function renderGhost(el, P, cad) {
    if (!cad || el.cx == null) return '';
    var v = mapView(el), mx = (v.X1 - v.X0) * 0.6, my = (v.Y1 - v.Y0) * 0.6, s = '';
    cad.lines.forEach(function (l) {
      var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0 - mx, v.Y0 - my, v.X1 + mx, v.Y1 + my);
      if (!c) return;
      var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]);
      s += 'M' + n(a[0]) + ' ' + n(a[1]) + 'L' + n(b[0]) + ' ' + n(b[1]);
    });
    var t = '';
    cad.texts.forEach(function (tx) {
      if (tx.x < v.X0 - mx || tx.x > v.X1 + mx || tx.y < v.Y0 - my || tx.y > v.Y1 + my) return;
      if (tx.x >= v.X0 && tx.x <= v.X1 && tx.y >= v.Y0 && tx.y <= v.Y1) return;
      var q = v.toP(tx.x, tx.y);
      t += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="4" text-anchor="middle" dominant-baseline="central">' + esc(tx.text) + '</text>';
    });
    return '<g class="ghost" pointer-events="none"><path d="' + s + '" stroke="#7a8ca5" stroke-width="0.15" fill="none"/><g fill="#7a8ca5" font-family="Arial">' + t + '</g></g>';
  }

  function renderElement(el, P, cad, opts) {
    if (el.hidden) return '';
    switch (el.type) {
      case 'text': {
        var s = '<g data-id="' + el.id + '">';
        if (el.border) s += '<rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="none" stroke="#000" stroke-width="' + (el.lw || 0.24) + '"/>';
        return s + textBlock(el.x, el.y, el.w, el.h, M.fill(el.text, fieldsOf(P)), el) + '</g>';
      }
      case 'rect':
        return '<rect data-id="' + el.id + '" x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="none" stroke="' + (el.color || '#000') + '" stroke-width="' + (el.lw || 0.24) + '"' + dashAttr(el.dash, el.lw || 0.24) + '/>';
      case 'line': {
        var st = { color: el.color || '#000', lw: el.lw || 0.24, dash: normDash(el.dash) }, a = [el.x, el.y], b = [el.x + el.w, el.y + el.h];
        return '<g data-id="' + el.id + '">' + lineSVG(a, b, st) + (el.arrow ? arrows(a, b, st, el.arrow) : '') + '</g>';
      }
      case 'table': case 'ftable': return renderTable(el, P);
      case 'north': return renderNorth(el);
      case 'map': return renderMap(el, P, cad, opts);
    }
    return '';
  }

  function renderSheet(P, cad, opts) {
    updateBoth(P, cad);
    opts = opts || {};
    var s = '';
    P.elements.forEach(function (el) { s += renderElement(el, P, cad, opts); });
    return s;
  }

  /* 元件外框（表格大小由內容決定） */
  function bounds(el, P) {
    if (el.type === 'table' || el.type === 'ftable') {
      var sz = tableSize(el, P);
      return { x: el.x, y: el.y, w: sz.w, h: sz.h };
    }
    if (el.type === 'line') return { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) };
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }

  global.Render = {
    esc: esc, renderSheet: renderSheet, renderElement: renderElement, renderGhost: renderGhost, mapView: mapView,
    tableModel: tableModel, cellRect: cellRect, bounds: bounds, roleOf: roleOf, defaultRole: defaultRole,
    featureArea: featureArea, featAnchor: featAnchor, fieldsOf: fieldsOf, pieces: pieces, eachPiece: eachPiece, lineStyle: lineStyle, roleStyle: roleStyle,
    DASH_LIST: DASH_LIST, textScales: textScales, updateBoth: updateBoth, mergeInfo: mergeInfo, detectMerge: detectMerge, parseParcels: parseParcels, featOv: featOv, visFeatures: visFeatures, normDash: normDash, layoutLabels: layoutLabels, lastLayout: lastLayout
  };
})(typeof window !== 'undefined' ? window : globalThis);
