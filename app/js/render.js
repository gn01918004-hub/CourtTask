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
    if (/^LIN|^MERGE$/.test(u)) return 'parcel';
    return 'other';
  }
  var ROLE_STYLE = { parcel: 'parcelLine', case: 'caseLine', split: 'splitLine', other: 'otherLine' };
  function roleStyle(P, role) { return P.styles[ROLE_STYLE[role] || 'otherLine'] || P.styles.otherLine; }

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
  function eachPiece(P, cad, fn) {
    if (!cad) return;
    cad.lines.forEach(function (l, idx) {
      var role = roleOf(P, l.layer, 'line');
      if (role === 'hide') return;
      pieces(P, l, idx).forEach(function (pc) {
        var ss = P.segStyle[pc.key];
        if (ss && ss.hidden) return;
        fn(pc, role, ss, l);
      });
    });
  }
  function roleOf(P, layer, kind) {
    var r = P.layerRoles[kind + ':' + layer];
    return r || defaultRole(layer, kind);
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
  function tableModel(el, P) {
    var F = fieldsOf(P);
    if (el.type === 'table') {
      return {
        cols: el.cols, rows: el.rows,
        cells: el.cells.map(function (c) { var o = Object.assign({}, c); o.text = M.fill(c.text, F); return o; }),
        kinds: null
      };
    }
    // 地上物說明表
    var feats = P.features.filter(function (f) {
      if (f.hideInTable) return false;
      if (el.landFilter) return String(f.landNo) === String(el.landFilter);
      return true;
    });
    var rows = [], kinds = [], cells = [], cols = el.columns || [];
    if (el.titleH > 0) {
      rows.push(el.titleH); kinds.push('title');
      cells.push({ r: 0, c: 0, cs: cols.length, text: M.fill(el.title, F), align: 'center', valign: 'middle', fs: el.titleFs, fit: 'shrink' });
    }
    if (el.headerH > 0) {
      var hr = rows.length; rows.push(el.headerH); kinds.push('header');
      cols.forEach(function (c, i) { cells.push({ r: hr, c: i, text: c.header || '', align: 'center', valign: 'middle', fs: el.headerFs, fit: 'shrink' }); });
    }
    feats.forEach(function (f) {
      var r = rows.length;
      rows.push(el.rowHs[f.id] || el.rowH); kinds.push(f.id);
      cols.forEach(function (col, c) {
        var v = col.key === 'area' ? featureArea(f, el.decimals) : f[col.key];
        cells.push({ r: r, c: c, text: v == null ? '' : String(v), align: col.align || 'center', valign: 'middle', fs: col.fs || el.dataFs, fit: 'shrink', fid: f.id });
      });
    });
    if (el.notesH > 0) {
      var ntext = M.fill(el.notes, F), tw = cols.length ? el.cols.reduce(function (a, b) { return a + b; }, 0) - 1.6 : 50;
      var need = M.wrap(ntext, tw, el.notesFs, 'kai').length * el.notesFs * 1.12 + 1.6;
      rows.push(Math.max(el.notesH, need)); kinds.push('notes');
      cells.push({ r: rows.length - 1, c: 0, cs: cols.length, text: M.fill(el.notes, F), align: 'left', valign: 'top', fs: el.notesFs });
    }
    return { cols: el.cols, rows: rows, cells: cells, kinds: kinds };
  }

  function featureArea(f, dec) {
    if (f.areaOverride != null && f.areaOverride !== '') return String(f.areaOverride);
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
    tm.cells.forEach(function (c) {
      var r = cellRect(el, tm, c);
      if (lw > 0 && !c.noBorder) s += '<rect x="' + n(r.x) + '" y="' + n(r.y) + '" width="' + n(r.w) + '" height="' + n(r.h) + '" fill="none" stroke="#000" stroke-width="' + lw + '"/>';
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
    s += '<text x="' + n(cx) + '" y="' + n(el.y + fs * 0.55) + '" font-size="' + n(fs) + '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(M.fontFamily('kai')) + '">' + esc(el.label || '北') + '</text>';
    s += '<path d="M' + n(cx) + ' ' + n(top) + ' L' + n(cx - aw / 2) + ' ' + n(top + ah) + ' L' + n(cx + aw / 2) + ' ' + n(top + ah) + ' Z" fill="#000"/>';
    s += '<line x1="' + n(cx) + '" y1="' + n(top + ah) + '" x2="' + n(cx) + '" y2="' + n(el.y + el.h) + '" stroke="#000" stroke-width="0.24"/>';
    var hy = top + ah + (el.y + el.h - top - ah) * 0.3;
    s += '<line x1="' + n(el.x) + '" y1="' + n(hy) + '" x2="' + n(el.x + el.w) + '" y2="' + n(hy) + '" stroke="#000" stroke-width="0.24"/>';
    return s + '</g>';
  }

  function dashOf(style, lw) { return dashAttr(style, lw); }

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
    var v = mapView(el), ST = P.styles, font = ST.mapFont, k = v.k, res = { feat: {}, text: {} }, TS = el.textScale || 1;
    var auto = ST.autoAvoid !== false;
    var segs = [];
    function addSeg(x1, y1, x2, y2) { var c = G.clipSeg(x1, y1, x2, y2, v.X0, v.Y0, v.X1, v.Y1); if (c) segs.push(c); }
    if (auto) {
      eachPiece(P, cad, function (pc) { addSeg(pc.x1, pc.y1, pc.x2, pc.y2); });
      (P.userLines || []).forEach(function (l) { addSeg(l.x1, l.y1, l.x2, l.y2); });
      P.features.forEach(function (f) {
        if (!f.outline) return;
        for (var i = 0; i < f.pts.length; i++) { var a = f.pts[i], b = f.pts[(i + 1) % f.pts.length]; addSeg(a[0], a[1], b[0], b[1]); }
      });
    }
    var placed = [];
    function place(anchor, text, size, poly) {
      var hw = M.measure(text, size, font) / 2 / k * 1.05, hh = size * 0.42 / k;
      function boxAt(x, y) { return [x - hw, y - hh, x + hw, y + hh]; }
      var b0 = boxAt(anchor[0], anchor[1]), base = boxHits(b0, segs, placed);
      if (!auto || base === 0) { placed.push(b0); return anchor; }
      var best = anchor, bestS = base * 1000, maxR = size * 1.1 / k; // 最多移動約 1 個字高
      for (var ri = 1; ri <= 6; ri++) {
        var r = maxR * ri / 6;
        for (var ai = 0; ai < 16; ai++) {
          var ang = (ai + (ri % 2) * 0.5) * Math.PI / 8;
          var x = anchor[0] + Math.cos(ang) * r, y = anchor[1] + Math.sin(ang) * r * 0.8;
          var sc = boxHits(boxAt(x, y), segs, placed) * 1000 + r * k * 10;
          if (poly && !G.pointInPoly([x, y], poly)) sc += 600;
          if (sc < bestS) { bestS = sc; best = [x, y]; }
        }
      }
      placed.push(boxAt(best[0], best[1]));
      return best;
    }
    // 地上物編號
    P.features.forEach(function (f) {
      if (f.label === false) return;
      if (f.labelAt) { res.feat[f.id] = f.labelAt; return; }
      res.feat[f.id] = place(G.labelPoint(f.pts), f.code, (f.labelSize || ST.featureLabel.size) * TS, f.pts);
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
        res.text[o.idx] = place([o.x, o.y], o.t.text, (o.ov.size || st.size) * TS, null);
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
    var v = mapView(el), ST = P.styles, font = M.fontFamily(ST.mapFont), TS = el.textScale || 1;
    var clipId = 'clip_' + el.id + (opts.print ? '_p' : '');
    s += '<clipPath id="' + clipId + '"><rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '"/></clipPath>';
    if (el.bg !== false) s += '<rect x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="#fff" stroke="none"/>';
    s += '<g clip-path="url(#' + clipId + ')">';

    // 地上物填色（在線之下）
    P.features.forEach(function (f) {
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
    (P.userLines || []).forEach(function (l) {
      var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (!c) return;
      var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]), st = lineStyle(P, l.role || 'case', l);
      s += lineSVG(a, b, st);
      if (l.arrow) s += arrows(a, b, st, l.arrow);
    });

    // 地上物外框
    P.features.forEach(function (f) {
      if (!f.outline) return;
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
        s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((ov.size || st.size) * TS) + '" fill="' + (ov.color || st.color) + '" text-anchor="' + (centered ? 'middle' : 'start') +
          '" dominant-baseline="' + (centered ? 'central' : 'alphabetic') + '" font-family="' + esc(font) + '"' +
          (t.rot ? ' transform="rotate(' + n(-t.rot) + ' ' + n(q[0]) + ' ' + n(q[1]) + ')"' : '') + '>' + esc(t.text) + '</text>';
      });
    }
    // 地上物編號
    P.features.forEach(function (f) {
      if (f.label === false) return;
      var lp = LY.feat[f.id] || f.labelAt || G.labelPoint(f.pts), q = v.toP(lp[0], lp[1]);
      if (f.leader) {
        var ip = G.labelPoint(f.pts), qi = v.toP(ip[0], ip[1]), dx = qi[0] - q[0], dy = qi[1] - q[1], L = Math.hypot(dx, dy);
        var r0 = (f.labelSize || ST.featureLabel.size) * TS * 0.6;
        if (L > r0 + 0.5) {
          var st = { color: f.labelColor || ST.featureLabel.color, lw: 0.13, dash: 'solid' }, a0 = [q[0] + dx / L * r0, q[1] + dy / L * r0];
          s += lineSVG(a0, qi, st) + arrowHead(a0, qi, 0.15, st.color);
        }
      }
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((f.labelSize || ST.featureLabel.size) * TS) + '" fill="' + (f.labelColor || ST.featureLabel.color) +
        '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(font) + '">' + esc(f.code) + '</text>';
    });
    // 圖面註記
    P.annos.forEach(function (a) {
      var q = v.toP(a.x, a.y);
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n((a.size || ST.anno.size) * TS) + '" fill="' + (a.color || ST.anno.color) +
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
    featureArea: featureArea, fieldsOf: fieldsOf, pieces: pieces, eachPiece: eachPiece, lineStyle: lineStyle, roleStyle: roleStyle,
    DASH_LIST: DASH_LIST, normDash: normDash, layoutLabels: layoutLabels, lastLayout: lastLayout
  };
})(typeof window !== 'undefined' ? window : globalThis);
