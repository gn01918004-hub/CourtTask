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
    maps.forEach(function (m, i) { f['scale' + (i + 1)] = m.scale; });
    return f;
  }

  /* ---------- 圖層角色 ---------- */
  function defaultRole(layer, kind) {
    var u = String(layer).toUpperCase();
    if (kind === 'text') {
      if (/^PAR_?2$/.test(u) || /TARGET/.test(u)) return 'target';
      if (/^PAR/.test(u)) return 'parcelNo';
      return 'otherText';
    }
    if (/REF_LINE|^KC|CASE/.test(u)) return 'case';
    if (/^LIN/.test(u)) return 'parcel';
    return 'other';
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
    var rows = [el.titleH, el.headerH], kinds = ['title', 'header'], cells = [];
    cells.push({ r: 0, c: 0, cs: el.cols.length, text: M.fill(el.title, F), align: 'center', valign: 'middle', fs: el.titleFs, fit: 'shrink' });
    el.headers.forEach(function (h, i) { cells.push({ r: 1, c: i, text: h, align: 'center', valign: 'middle', fs: el.headerFs, fit: 'shrink' }); });
    feats.forEach(function (f, i) {
      var r = i + 2;
      rows.push(el.rowHs[f.id] || el.rowH); kinds.push(f.id);
      var vals = [f.code, featureArea(f, el.decimals), f.landNo, f.note];
      vals.forEach(function (v, c) {
        cells.push({ r: r, c: c, text: v == null ? '' : String(v), align: 'center', valign: 'middle', fs: c === 3 ? el.noteFs : el.dataFs, fit: 'shrink', fid: f.id });
      });
    });
    if (el.notesH > 0) {
      rows.push(el.notesH); kinds.push('notes');
      cells.push({ r: rows.length - 1, c: 0, cs: el.cols.length, text: M.fill(el.notes, F), align: 'left', valign: 'top', fs: el.notesFs });
    }
    return { cols: el.cols, rows: rows, cells: cells, kinds: kinds };
  }

  function featureArea(f, dec) {
    if (f.areaOverride != null && f.areaOverride !== '') return String(f.areaOverride);
    return G.area(f.pts).toFixed(dec == null ? 2 : dec);
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

  function dashOf(style, lw) {
    return style ? ' stroke-dasharray="' + n(Math.max(0.8, lw * 6)) + ' ' + n(Math.max(0.6, lw * 4)) + '"' : '';
  }

  function renderMap(el, P, cad, opts) {
    var s = '<g data-id="' + el.id + '">';
    if (el.cx == null) {
      s += '<rect x="' + el.x + '" y="' + el.y + '" width="' + el.w + '" height="' + el.h + '" fill="none" stroke="#000" stroke-width="' + (el.lw || 0.18) + '"/>';
      if (!opts.print) s += '<text x="' + n(el.x + el.w / 2) + '" y="' + n(el.y + el.h / 2) + '" font-size="5" text-anchor="middle" fill="#999" font-family="' + esc(M.SANS) + '">請先「匯入 DXF」</text>';
      return s + '</g>';
    }
    var v = mapView(el), ST = P.styles, font = M.fontFamily(ST.mapFont);
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

    var groups = { parcel: [], other: [], case: [] };
    if (cad) {
      cad.lines.forEach(function (l, idx) {
        var role = roleOf(P, l.layer, 'line');
        if (role === 'hide') return;
        var ss = P.segStyle[idx];
        if (ss && ss.hidden) return;
        var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1);
        if (!c) return;
        var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]);
        var seg = '<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) + '"';
        if (ss && (ss.dash || ss.color)) {
          var base = role === 'case' ? ST.caseLine : role === 'parcel' ? ST.parcelLine : ST.otherLine;
          s += seg + ' stroke="' + (ss.color || base.color) + '" stroke-width="' + base.width + '"' + dashOf(ss.dash, base.width) + '/>';
        } else (groups[role] || groups.other).push(seg + '/>');
      });
    }
    s += '<g stroke="' + ST.parcelLine.color + '" stroke-width="' + ST.parcelLine.width + '" stroke-linecap="round">' + groups.parcel.join('') + '</g>';
    s += '<g stroke="' + ST.otherLine.color + '" stroke-width="' + ST.otherLine.width + '" stroke-linecap="round">' + groups.other.join('') + '</g>';
    s += '<g stroke="' + ST.caseLine.color + '" stroke-width="' + ST.caseLine.width + '" stroke-linecap="round">' + groups.case.join('') + '</g>';
    (P.userLines || []).forEach(function (l) {
      var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (!c) return;
      var a = v.toP(c[0], c[1]), b = v.toP(c[2], c[3]), lw = ST.caseLine.width;
      s += '<line x1="' + n(a[0]) + '" y1="' + n(a[1]) + '" x2="' + n(b[0]) + '" y2="' + n(b[1]) + '" stroke="' + (l.color || ST.caseLine.color) + '" stroke-width="' + lw + '" stroke-linecap="round"' + dashOf(l.dash, lw) + '/>';
    });

    // 地上物外框
    P.features.forEach(function (f) {
      if (!f.outline) return;
      var d = f.pts.map(function (p, i) { var q = v.toP(p[0], p[1]); return (i ? 'L' : 'M') + n(q[0]) + ' ' + n(q[1]); }).join('') + 'Z';
      var lw = ST.caseLine.width;
      s += '<path d="' + d + '" fill="none" stroke="' + (f.color || ST.caseLine.color) + '" stroke-width="' + lw + '"' + dashOf(f.dash, lw) + '/>';
    });

    // 地號文字
    if (cad) {
      cad.texts.forEach(function (t, idx) {
        var role = roleOf(P, t.layer, 'text');
        if (role === 'hide') return;
        var ov = P.textOver[idx] || {};
        if (ov.hidden) return;
        var x = ov.x != null ? ov.x : t.x, y = ov.y != null ? ov.y : t.y;
        if (x < v.X0 || x > v.X1 || y < v.Y0 || y > v.Y1) return;
        var st = role === 'target' ? ST.targetText : role === 'parcelNo' ? ST.parcelText : ST.otherText;
        var q = v.toP(x, y), centered = t.h72 === 4 || t.h72 === 1 || ov.x != null;
        s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n(ov.size || st.size) + '" fill="' + (ov.color || st.color) + '" text-anchor="' + (centered ? 'middle' : 'start') +
          '" dominant-baseline="' + (centered ? 'central' : 'alphabetic') + '" font-family="' + esc(font) + '"' +
          (t.rot ? ' transform="rotate(' + n(-t.rot) + ' ' + n(q[0]) + ' ' + n(q[1]) + ')"' : '') + '>' + esc(t.text) + '</text>';
      });
    }
    // 地上物編號
    P.features.forEach(function (f) {
      if (f.label === false) return;
      var lp = f.labelAt || G.labelPoint(f.pts), q = v.toP(lp[0], lp[1]);
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n(f.labelSize || ST.featureLabel.size) + '" fill="' + (f.labelColor || ST.featureLabel.color) +
        '" text-anchor="middle" dominant-baseline="central" font-family="' + esc(font) + '">' + esc(f.code) + '</text>';
    });
    // 圖面註記
    P.annos.forEach(function (a) {
      var q = v.toP(a.x, a.y);
      s += '<text x="' + n(q[0]) + '" y="' + n(q[1]) + '" font-size="' + n(a.size || ST.anno.size) + '" fill="' + (a.color || ST.anno.color) +
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
        return '<rect data-id="' + el.id + '" x="' + n(el.x) + '" y="' + n(el.y) + '" width="' + n(el.w) + '" height="' + n(el.h) + '" fill="none" stroke="' + (el.color || '#000') + '" stroke-width="' + (el.lw || 0.24) + '"' + dashOf(el.dash, el.lw || 0.24) + '/>';
      case 'line':
        return '<line data-id="' + el.id + '" x1="' + n(el.x) + '" y1="' + n(el.y) + '" x2="' + n(el.x + el.w) + '" y2="' + n(el.y + el.h) + '" stroke="' + (el.color || '#000') + '" stroke-width="' + (el.lw || 0.24) + '"' + dashOf(el.dash, el.lw || 0.24) + '/>';
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
    featureArea: featureArea, fieldsOf: fieldsOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
