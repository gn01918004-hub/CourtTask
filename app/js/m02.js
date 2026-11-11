/* 讀取舊系統 SVMAP 的 .m02 專案（V5.00 格式），轉成本系統的專案
 *
 * 檔案結構（逆向解析）：
 *   檔頭 100 bytes："##%%" + 說明字串
 *   之後是一連串記錄：'@@' + u16 型別 + u16 0 + u32 長度(含 8 bytes 表頭) + 資料
 *   一個檔案有多個「圖組」：5001 起始 … 5999 結束。第 1 組＝圖紙（mm），之後＝地圖（TWD97 公尺）
 *     5001 圖組表頭 [X0, Y0, 寬, 高, 比例尺]   5100 圖層名稱   5101 視窗狀態   5006 (保留)
 *   圖形元素共同表頭：ffff0500, u32, u32, u16 圖層, u16 線型/字型, u8 線寬, u8, u8, RGB(3)
 *   之後為區塊 [u32 種類][u32 長度][資料]…，以 u32 0 結束
 *     5021 線段   5023 折線/多邊形   5027 文字   5028 文字框   5029 表格
 *     5030 群組   5032 圖塊（如指北針）
 */
(function (global) {
  'use strict';

  function decodeStr(bytes) {
    var end = bytes.indexOf(0); if (end >= 0) bytes = bytes.subarray(0, end);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {
      try { return new TextDecoder('big5').decode(bytes); } catch (e2) { return ''; }
    }
  }

  function Reader(u8) {
    this.u8 = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  }
  Reader.prototype.u16 = function (o) { return this.dv.getUint16(o, true); };
  Reader.prototype.u32 = function (o) { return this.dv.getUint32(o, true); };
  Reader.prototype.f32 = function (o) { return this.dv.getFloat32(o, true); };
  Reader.prototype.f64 = function (o) { return this.dv.getFloat64(o, true); };
  Reader.prototype.sub = function (a, b) { return this.u8.subarray(a, b); };

  function hex2(n) { return ('0' + n.toString(16)).slice(-2); }

  /* 解析區塊序列 */
  function blocks(r, off) {
    var out = [];
    while (off + 8 <= r.u8.length) {
      var k = r.u32(off), l = r.u32(off + 4);
      if (k === 0 || off + 8 + l > r.u8.length) break;
      out.push({ k: k, d: r.sub(off + 8, off + 8 + l) });
      off += 8 + l;
    }
    return out;
  }
  function blk(bl, k) { for (var i = 0; i < bl.length; i++) if (bl[i].k === k) return new Reader(bl[i].d); return null; }

  /* 解析一個圖形元素（資料以 ffff0500 開頭） */
  function element(type, d) {
    var r = new Reader(d);
    if (d.length < 22) return null;
    var e = {
      type: type, layer: r.u16(12), ltype: r.u16(14), width: d[16],
      rgb: '#' + hex2(d[19]) + hex2(d[20]) + hex2(d[21])
    };
    var bl = blocks(r, 22), b2 = blk(bl, 2), b3 = blk(bl, 3), i, n;
    switch (type) {
      case 5021: // 線段
        if (!b2 || b2.u8.length < 32) return null;
        e.kind = 'line'; e.pts = [[b2.f64(0), b2.f64(8)], [b2.f64(16), b2.f64(24)]];
        return e;
      case 5023: // 折線／多邊形
        if (!b3) return null;
        e.kind = 'poly'; e.pts = [];
        n = b3.u32(0); var stride = b3.u16(4) || 18;
        for (i = 0; i < n && 6 + i * stride + 16 <= b3.u8.length; i++) e.pts.push([b3.f64(6 + i * stride), b3.f64(6 + i * stride + 8)]);
        e.closed = b2 ? b2.u8[0] === 1 : false;
        e.filled = b2 ? b2.u8[1] === 1 : false;
        return e;
      case 5027: // 文字
        if (!b2 || b2.u8.length < 28) return null;
        e.kind = 'text'; e.x = b2.f64(0); e.y = b2.f64(8); e.h = b2.f32(16); e.v = b2.f32(20); e.align = b2.u16(26);
        e.text = b3 ? decodeStr(b3.u8) : '';
        return e;
      case 5028: // 文字框
        if (!b2 || b2.u8.length < 56) return null;
        e.kind = 'tbox';
        e.x1 = b2.f64(0); e.y1 = b2.f64(8); e.x2 = b2.f64(16); e.y2 = b2.f64(24);
        e.h = b2.f32(40); e.lsp = b2.f32(44); e.font = b2.u8[53]; e.flags = b2.u8[54];
        e.text = b3 ? decodeStr(b3.u8).replace(/\r\n/g, '\n') : '';
        return e;
      case 5029: { // 表格
        if (!b2 || b2.u8.length < 24) return null;
        e.kind = 'table'; e.x = b2.f64(0); e.y = b2.f64(8);
        var nc = b2.u32(16), nr = b2.u32(20), o = 28;
        e.cols = []; e.rows = []; e.cells = [];
        for (i = 0; i <= nc && o + 8 <= b2.u8.length; i++, o += 8) e.cols.push(b2.f64(o));
        for (i = 0; i <= nr && o + 8 <= b2.u8.length; i++, o += 8) e.rows.push(b2.f64(o));
        if (b3 && b3.u8.length >= 4) {
          n = b3.u32(0); o = 4;
          for (i = 0; i < n && o + 20 <= b3.u8.length; i++) {
            var c0 = b3.u16(o), c1 = b3.u16(o + 2), r0 = b3.u16(o + 4), r1 = b3.u16(o + 6);
            var ty = b3.u32(o + 12), ln = b3.u32(o + 16);
            var cell = element(ty, b3.sub(o + 20, o + 12 + ln));
            if (cell) { cell.c0 = c0; cell.c1 = c1; cell.r0 = r0; cell.r1 = r1; e.cells.push(cell); }
            o += 12 + ln;
          }
        }
        return e;
      }
      case 5030: { // 群組：u32 數量，之後 [u32 前置][u32 型別][u32 長度][資料]
        e.kind = 'group'; e.items = [];
        n = r.u32(4); var p = 8;
        for (i = 0; i < n && p + 12 <= d.length; i++) {
          var t2 = r.u32(p + 4), l2 = r.u32(p + 8);
          var it = element(t2, r.sub(p + 12, p + 4 + l2));
          if (it) e.items.push(it);
          p += 4 + l2;
        }
        return e;
      }
      case 5032: { // 圖塊（例如指北針）
        e.kind = 'block';
        if (b2 && b2.u8.length >= 40) { e.x = b2.f64(0); e.y = b2.f64(8); e.name = decodeStr(b2.sub(36, b2.u8.length)); }
        e.items = [];
        if (b3 && b3.u8.length >= 4) {
          n = b3.u32(0); var q = 4;
          for (i = 0; i < n && q + 12 <= b3.u8.length; i++) {
            var t3 = b3.u32(q + 4), l3 = b3.u32(q + 8);
            var it3 = element(t3, b3.sub(q + 12, q + 4 + l3));
            if (it3) e.items.push(it3);
            q += 4 + l3;
          }
        }
        return e;
      }
    }
    return { kind: 'unknown', type: type };
  }

  function parse(buf) {
    var u8 = new Uint8Array(buf), r = new Reader(u8);
    if (u8.length < 110 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== '##%%') throw new Error('不是 SVMAP .m02 檔案');
    var groups = [], g = null, i = 100, unknown = {};
    while (i + 10 <= u8.length) {
      if (u8[i] !== 0x40 || u8[i + 1] !== 0x40) throw new Error('檔案格式不符（位置 ' + i + '）');
      var type = r.u16(i + 2), len = r.u32(i + 6);
      if (len < 8 || i + 2 + len > u8.length) throw new Error('記錄長度錯誤（位置 ' + i + '）');
      var d = r.sub(i + 10, i + 2 + len), dr = new Reader(d);
      if (type === 5001) {
        g = { x0: dr.f64(4), y0: dr.f64(12), w: dr.f64(20), h: dr.f64(28), scale: dr.f64(36), layers: [], elems: [] };
        groups.push(g);
      } else if (type === 5100 && g) {
        g.layers[dr.u16(12)] = decodeStr(d.subarray(16));
      } else if (type === 5101 && g && d.length >= 52) {
        g.view = [dr.f64(4), dr.f64(12), dr.f64(20), dr.f64(28), dr.f64(36)];
      } else if (type !== 5006 && type !== 5999 && g) {
        var e = element(type, d);
        if (e && e.kind !== 'unknown') g.elems.push(e);
        else unknown[type] = (unknown[type] || 0) + 1;
      }
      i += 2 + len;
    }
    return { groups: groups, unknown: unknown };
  }

  /* 攤平群組／圖塊 */
  function flat(elems) {
    var out = [];
    elems.forEach(function (e) {
      if (e.kind === 'group' || (e.kind === 'block' && !/指北/.test(e.name || ''))) out = out.concat(flat(e.items || []));
      else out.push(e);
    });
    return out;
  }

  var DASH = { 0: null, 1: 'dashS', 2: 'dash', 3: 'dot', 4: 'dashDot', 5: 'dashDot2', 6: 'dashL', 7: 'dashS' };
  function lwOf(w) { return w ? Math.min(1.5, 0.15 + w * 0.15) : 0.18; }
  function isBlack(rgb) { return rgb === '#000000'; }

  /* 轉成本系統專案：{ project, cad, report } */
  function toProject(m) {
    var Mo = global.Model, uid = Mo.uid;
    var P = Mo.newProject(), report = { sheet: 0, map: 0, unknown: m.unknown, warnings: [] };
    P.elements = [];
    var sheet = m.groups[0];
    if (!sheet) throw new Error('檔案中沒有圖紙資料');
    var k = sheet.scale ? 1000 / sheet.scale : 1, H = sheet.h || 297;
    P.sheet.w = Math.round((sheet.w || 420) * k) || 420; P.sheet.h = Math.round(H * k) || 297;
    if (Math.abs(P.sheet.w - 420) < 25 && Math.abs(P.sheet.h - 297) < 25) { P.sheet.w = 420; P.sheet.h = 297; }
    var PH = P.sheet.h;
    function X(x) { return Math.round(x * k * 100) / 100; }
    function Y(y) { return Math.round((PH - y * k) * 100) / 100; }
    function al(flags) { return (flags & 0x04) || (flags & 0x01) ? 'center' : (flags & 0x02) ? 'right' : 'left'; }
    function va(flags) { return (flags & 0x08) ? 'top' : 'middle'; }
    function font(f) { return f === 6 || f === 0 ? 'kai' : 'sans'; }
    var border = null;

    flat(sheet.elems).forEach(function (e) {
      report.sheet++;
      if (e.kind === 'line') {
        var a = e.pts[0], b = e.pts[1];
        P.elements.push({ id: uid(), type: 'line', name: '線', x: X(a[0]), y: Y(a[1]), w: X(b[0]) - X(a[0]), h: Y(b[1]) - Y(a[1]), lw: lwOf(e.width) * 1.3, color: isBlack(e.rgb) ? undefined : e.rgb, dash: DASH[e.ltype] || undefined });
        [a, b].forEach(function (p) {
          border = border || [Infinity, Infinity, -Infinity, -Infinity];
          border[0] = Math.min(border[0], X(p[0])); border[2] = Math.max(border[2], X(p[0]));
          border[1] = Math.min(border[1], Y(p[1])); border[3] = Math.max(border[3], Y(p[1]));
        });
      } else if (e.kind === 'poly') {
        for (var i = 0; i + 1 < e.pts.length + (e.closed ? 1 : 0); i++) {
          var p = e.pts[i], q = e.pts[(i + 1) % e.pts.length];
          P.elements.push({ id: uid(), type: 'line', name: '線', x: X(p[0]), y: Y(p[1]), w: X(q[0]) - X(p[0]), h: Y(q[1]) - Y(p[1]), lw: lwOf(e.width) * 1.3, color: isBlack(e.rgb) ? undefined : e.rgb });
        }
      } else if (e.kind === 'text') {
        var fs = e.h * k, w = Math.max(fs, Mo.measure(e.text, fs * 1.0, 'kai')) + 2, hh = fs * 1.6;
        var cx = X(e.x), by = Y(e.y);
        var left = e.align === 1 ? cx - w / 2 : e.align === 2 ? cx - w : cx - 0.8;
        var top = e.v ? by - hh / 2 : by - fs * 1.15;
        P.elements.push({ id: uid(), type: 'text', name: e.text.slice(0, 10) || '文字', x: Math.round(left * 100) / 100, y: Math.round(top * 100) / 100, w: Math.round(w * 100) / 100, h: Math.round(hh * 100) / 100, text: e.text, fs: Math.round(fs * 100) / 100, align: e.align === 1 ? 'center' : e.align === 2 ? 'right' : 'left', valign: 'middle', font: 'kai', color: isBlack(e.rgb) ? undefined : e.rgb });
      } else if (e.kind === 'tbox') {
        P.elements.push({ id: uid(), type: 'text', name: e.text.split('\n')[0].slice(0, 10) || '文字框', x: X(e.x1), y: Y(e.y2), w: X(e.x2) - X(e.x1), h: Y(e.y1) - Y(e.y2), text: e.text, fs: Math.round(e.h * k * 100) / 100, lh: e.lsp && e.h && e.text.indexOf('\n') >= 0 ? Math.max(1, Math.min(2.6, e.lsp / e.h)) : 1.12, align: al(e.flags), valign: va(e.flags), font: font(e.font), color: isBlack(e.rgb) ? undefined : e.rgb });
      } else if (e.kind === 'table') {
        if (e.cols.length < 2 || e.rows.length < 2) return;
        var cols = [], rows = [], j;
        for (j = 1; j < e.cols.length; j++) cols.push(Math.round((e.cols[j] - e.cols[j - 1]) * k * 100) / 100);
        for (j = 1; j < e.rows.length; j++) rows.push(Math.round((e.rows[j] - e.rows[j - 1]) * k * 100) / 100);
        var cells = e.cells.map(function (c) {
          var o = { r: c.r0, c: c.c0, text: (c.text || '').replace(/[ \u3000]+$/g, ''), fs: Math.round((c.h || 4) * k * 100) / 100, align: al(c.flags), valign: va(c.flags), font: font(c.font) };
          if (c.r1 - c.r0 > 1) o.rs = c.r1 - c.r0;
          if (c.c1 - c.c0 > 1) o.cs = c.c1 - c.c0;
          if (c.lsp && c.h && o.text.indexOf('\n') >= 0) o.lh = Math.max(1, Math.min(2, c.lsp / c.h));
          return o;
        });
        var isFeat = cells.some(function (c) { return /地上物|面積|說明/.test(c.text) && c.r === 0; });
        P.elements.push({ id: uid(), type: 'table', name: isFeat ? '地上物說明表（舊檔）' : '說明欄（舊檔）', x: X(e.x), y: Y(e.y), cols: cols, rows: rows, cells: cells, lw: 0.24 });
      } else if (e.kind === 'block') { // 指北針
        var pts = [];
        (e.items || []).forEach(function (it) { (it.pts || []).forEach(function (p) { pts.push(p); }); });
        if (!pts.length) return;
        var bb = global.Geom.bbox(pts);
        var hasLabel = flat(sheet.elems).some(function (t) { return t.kind === 'text' && /^北$/.test(t.text) && Math.abs(t.x - e.x) < 15; });
        P.elements.push({ id: uid(), type: 'north', name: '指北', label: hasLabel ? '' : '北', x: X(bb[0]), y: Y(bb[3]) - 6, w: Math.max(5, X(bb[2]) - X(bb[0])), h: Y(bb[1]) - Y(bb[3]) + 6 });
      }
    });

    // ---- 地圖組 ----
    var cad = { name: '', lines: [], texts: [], arcs: [] };
    var maps = [], seen = {};
    function lkey(x1, y1, x2, y2) { return [x1, y1, x2, y2].map(function (v) { return Math.round(v * 1000); }).join(','); }
    m.groups.slice(1).forEach(function (g, gi) {
      var lname = function (i) { return g.layers[i] != null ? g.layers[i] : 'L' + i; };
      var frame = null;
      flat(g.elems).forEach(function (e) {
        report.map++;
        var layer = lname(e.layer);
        if (e.kind === 'line' || e.kind === 'poly') {
          // 裁切框：圖層 0、4 點封閉矩形、未填色
          if (e.kind === 'poly' && e.closed && !e.filled && e.layer === 0 && e.pts.length === 4 && !frame) {
            var b = global.Geom.bbox(e.pts);
            if (Math.abs(global.Geom.area(e.pts) - (b[2] - b[0]) * (b[3] - b[1])) < 0.01 * (b[2] - b[0]) * (b[3] - b[1])) { frame = b; return; }
          }
          var ps = e.pts, nseg = ps.length - 1 + (e.kind === 'poly' && e.closed ? 1 : 0);
          for (var i = 0; i < nseg; i++) {
            var a = ps[i], c = ps[(i + 1) % ps.length];
            var lk = lkey(a[0], a[1], c[0], c[1]), lk2 = lkey(c[0], c[1], a[0], a[1]);
            if (seen[lk] || seen[lk2]) continue;   // 多個地圖組疊在一起時去掉重複線
            seen[lk] = 1;
            cad.lines.push({ layer: layer, x1: a[0], y1: a[1], x2: c[0], y2: c[1] });
            var st = {};
            if (!isBlack(e.rgb)) st.color = e.rgb;
            if (DASH[e.ltype]) st.dash = DASH[e.ltype];
            if (e.width) st.lw = lwOf(e.width);
            if (Object.keys(st).length) P.segStyle[String(cad.lines.length - 1)] = st;
          }
        } else if (e.kind === 'text' || e.kind === 'tbox') {
          var tx = e.kind === 'text' ? e.x : (e.x1 + e.x2) / 2, ty = e.kind === 'text' ? e.y : (e.y1 + e.y2) / 2;
          var centered = e.kind === 'tbox' || e.align === 1;
          var tk = 't' + e.text + '@' + Math.round(tx * 100) + ',' + Math.round(ty * 100);
          if (seen[tk]) return; seen[tk] = 1;
          if (e.kind === 'text' && centered && !e.v) ty += e.h * 0.35; // 基線 → 中心
          cad.texts.push({ layer: layer, x: tx, y: ty, h: e.h, rot: 0, text: e.text, h72: centered ? 4 : 0, v73: 0 });
          var ov = { size: Math.round(e.h * 1000 / g.scale * 1.35 * 100) / 100 };
          if (!isBlack(e.rgb)) ov.color = e.rgb;
          P.textOver[String(cad.texts.length - 1)] = ov;
        }
      });
      if (!frame) frame = [g.x0, g.y0, g.x0 + g.w, g.y0 + g.h];
      // 比例尺與裁切範圍相同的地圖組（例如現況＋分割方案）疊在同一個略圖框
      // 比例尺相同的地圖組（例如現況＋分割方案）都是 TWD97 座標，依座標疊在同一個略圖框；裁切範圍用最後一組
      var same = maps.filter(function (mp) { return mp.scale === g.scale; })[0];
      if (same) { same.frame = frame; same.merged = (same.merged || 1) + 1; }
      else maps.push({ scale: g.scale, frame: frame });
    });
    cad.name = '舊檔 m02';
    // 文字樣式以檔案為準 → 本案地號圖層也用原色
    // 略圖框：放在外框右側（舊檔沒有記錄地圖在圖紙上的位置，請再確認）
    maps.forEach(function (mp, i) {
      var s = mp.scale || 500, kk = 1000 / s, f = mp.frame;
      var w = Math.round((f[2] - f[0]) * kk * 100) / 100, h = Math.round((f[3] - f[1]) * kk * 100) / 100;
      var x = border ? border[2] - 3 - w : 168.4, y = border ? border[1] + 4 : 48.5;
      if (i > 0) { x -= 10 * i; y += 10 * i; }
      P.elements.push({ id: uid(), type: 'map', name: '略圖框' + (i ? i + 1 : ''), x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, w: w, h: h, scale: s, cx: (f[0] + f[2]) / 2, cy: (f[1] + f[3]) / 2, border: true, lw: 0.18 });
    });
    P.styles.autoAvoid = false;          // 舊檔的文字位置已經手動排好
    P.styles.hideTempNo = false;
    P.merge.mode = 'off';
    maps.forEach(function (mp) { if (mp.merged) report.warnings.push('舊檔有 ' + mp.merged + ' 組 1/' + mp.scale + ' 的地圖（例如現況與分割方案），已依座標疊在同一個略圖框。'); });
    if (maps.length) report.warnings.push('舊檔沒有記錄略圖在圖紙上的位置，已放在外框右側，請確認或拖曳調整。');
    if (k !== 1) report.warnings.push('此檔圖紙比例為 ' + (Math.round(k * 1000) / 1000) + ' 倍（舊系統設定），已換算成實際 mm。');
    return { project: P, cad: cad, report: report };
  }

  global.M02 = { parse: parse, toProject: toProject };
})(typeof window !== 'undefined' ? window : globalThis);
