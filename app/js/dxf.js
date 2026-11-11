/* DXF 讀寫（ASCII DXF；支援 Big5 / UTF-8 編碼） */
(function (global) {
  'use strict';

  function decodeBytes(buf) {
    var bytes = new Uint8Array(buf);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
    } catch (e) {
      try { return new TextDecoder('big5').decode(bytes); } catch (e2) { return new TextDecoder('latin1').decode(bytes); }
    }
  }

  function unescapeText(s) {
    return String(s)
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%[cC]/g, 'Ø').replace(/%%%/g, '%');
  }
  function stripMtext(s) {
    return unescapeText(s).replace(/\\P/g, '\n').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/[{}]/g, '');
  }

  /* 解析 → { lines:[{layer,x1,y1,x2,y2}], texts:[{layer,x,y,h,rot,text}], layers:{name:count} } */
  function parse(text) {
    var raw = text.replace(/\r/g, '').split('\n');
    var pairs = [];
    for (var i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i], 10), raw[i + 1]]);
    var out = { lines: [], texts: [], layers: {}, arcs: [], layerColors: {} };
    var tblLayer = null;
    var section = null, ent = null, poly = null;

    function addLayer(l) { out.layers[l] = (out.layers[l] || 0) + 1; }
    function flush() {
      if (!ent) return;
      var e = ent; ent = null;
      var L = e.layer || '0';
      // 顏色：實體顏色(62)，BYLAYER(256)/未設定時用圖層顏色
      var col = e[62];
      if (col == null || col === 256 || col === 0) col = out.layerColors[L];
      if (col != null) col = Math.abs(col);
      switch (e.type) {
        case 'LINE':
          out.lines.push({ layer: L, x1: e[10], y1: e[20], x2: e[11], y2: e[21], color: col }); addLayer(L); break;
        case 'LWPOLYLINE':
          pushPoly(L, e.pts, (e[70] & 1) === 1, col); break;
        case 'POLYLINE':
          poly = { layer: L, pts: [], closed: (e[70] & 1) === 1, color: col }; break;
        case 'VERTEX':
          if (poly) poly.pts.push([e[10], e[20]]); break;
        case 'SEQEND':
          if (poly) pushPoly(poly.layer, poly.pts, poly.closed, poly.color); poly = null; break;
        case 'TEXT': case 'MTEXT': case 'ATTRIB': {
          var useAlign = e.type === 'TEXT' && ((e[72] || 0) !== 0 || (e[73] || 0) !== 0) && e[11] !== undefined;
          var t = e.type === 'MTEXT' ? stripMtext((e.t3 || '') + (e[1] || '')) : unescapeText(e[1] || '');
          out.texts.push({
            layer: L, x: useAlign ? e[11] : e[10], y: useAlign ? e[21] : e[20], h: e[40] || 1,
            rot: e[50] || 0, text: t, h72: e[72] || 0, v73: e[73] || 0
          });
          addLayer(L); break;
        }
        case 'ARC': case 'CIRCLE': {
          var cx = e[10], cy = e[20], r = e[40] || 0;
          var a0 = e.type === 'CIRCLE' ? 0 : (e[50] || 0), a1 = e.type === 'CIRCLE' ? 360 : (e[51] || 0);
          if (a1 <= a0) a1 += 360;
          // 依弦高誤差 ≤ 0.5 mm 決定分段數，讓面積計算精確
          var dth = r > 0.0005 ? 2 * Math.acos(Math.max(-1, 1 - 0.0005 / r)) * 180 / Math.PI : 6;
          var steps = Math.min(2000, Math.max(8, Math.ceil((a1 - a0) / Math.max(dth, 0.01)))), pts = [];
          for (var k = 0; k <= steps; k++) {
            var a = (a0 + (a1 - a0) * k / steps) * Math.PI / 180;
            pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          var stepDeg = (a1 - a0) / steps;
          out.arcs.push({ cx: cx, cy: cy, r: r, a0: a0, a1: a1, chord: 2 * r * Math.sin(stepDeg * Math.PI / 360) });
          pushPoly(L, pts, false, col); break;
        }
      }
    }
    function pushPoly(L, pts, closed, col) {
      if (!pts || pts.length < 2) return;
      for (var k = 0; k + 1 < pts.length; k++)
        out.lines.push({ layer: L, x1: pts[k][0], y1: pts[k][1], x2: pts[k + 1][0], y2: pts[k + 1][1], color: col });
      if (closed && pts.length > 2)
        out.lines.push({ layer: L, x1: pts[pts.length - 1][0], y1: pts[pts.length - 1][1], x2: pts[0][0], y2: pts[0][1], color: col });
      addLayer(L);
    }

    for (i = 0; i < pairs.length; i++) {
      var c = pairs[i][0], v = pairs[i][1], vt = v.trim();
      if (section === 'TABLES') {
        if (c === 0) { tblLayer = vt === 'LAYER' ? {} : null; continue; }
        if (tblLayer) {
          if (c === 2) tblLayer.name = vt;
          if (c === 62 && tblLayer.name != null) out.layerColors[tblLayer.name] = Math.abs(parseInt(vt, 10));
        }
        if (!(c === 0)) continue;
      }
      if (c === 0) {
        flush();
        if (vt === 'SECTION') { section = (pairs[i + 1] && pairs[i + 1][1].trim()) || null; i++; continue; }
        if (vt === 'ENDSEC') { section = null; continue; }
        if (section === 'ENTITIES' || section === null) {
          ent = { type: vt };
          if (vt === 'LWPOLYLINE') ent.pts = [];
        }
        continue;
      }
      if (!ent) continue;
      if (c === 8) ent.layer = vt;
      else if (c === 1) ent[1] = v;
      else if (c === 3) ent.t3 = (ent.t3 || '') + v;
      else if (ent.type === 'LWPOLYLINE' && c === 10) ent.pts.push([parseFloat(v), 0]);
      else if (ent.type === 'LWPOLYLINE' && c === 20) { if (ent.pts.length) ent.pts[ent.pts.length - 1][1] = parseFloat(v); }
      else if ((c >= 10 && c <= 59) || (c >= 70 && c <= 79) || c === 62) ent[c] = parseFloat(v);
    }
    flush();
    return out;
  }

  /* ---------- 匯出 ---------- */
  function esc(s) {
    var r = '';
    s = String(s);
    for (var i = 0; i < s.length; i++) {
      var code = s.charCodeAt(i);
      r += code > 126 ? '\\U+' + ('0000' + code.toString(16).toUpperCase()).slice(-4) : s[i];
    }
    return r;
  }
  function num(v) { return (Math.round(v * 1e6) / 1e6).toString(); }

  function Writer() { this.buf = ['0', 'SECTION', '2', 'ENTITIES']; }
  Writer.prototype.g = function (c, v) { this.buf.push(String(c), String(v)); return this; };
  Writer.prototype.line = function (layer, x1, y1, x2, y2, color) {
    this.g(0, 'LINE').g(8, layer); if (color) this.g(62, color);
    return this.g(10, num(x1)).g(20, num(y1)).g(30, 0).g(11, num(x2)).g(21, num(y2)).g(31, 0);
  };
  Writer.prototype.poly = function (layer, pts, closed, color) {
    this.g(0, 'POLYLINE').g(8, layer); if (color) this.g(62, color);
    this.g(66, 1).g(10, 0).g(20, 0).g(30, 0).g(70, closed ? 1 : 0);
    for (var i = 0; i < pts.length; i++) this.g(0, 'VERTEX').g(8, layer).g(10, num(pts[i][0])).g(20, num(pts[i][1])).g(30, 0);
    return this.g(0, 'SEQEND').g(8, layer);
  };
  Writer.prototype.text = function (layer, x, y, h, text, opt) {
    opt = opt || {};
    this.g(0, 'TEXT').g(8, layer); if (opt.color) this.g(62, opt.color);
    this.g(10, num(x)).g(20, num(y)).g(30, 0).g(40, num(h)).g(1, esc(text));
    if (opt.rot) this.g(50, num(opt.rot));
    if (opt.center) this.g(72, 4).g(11, num(x)).g(21, num(y)).g(31, 0);
    return this;
  };
  Writer.prototype.toString = function () { return this.buf.concat(['0', 'ENDSEC', '0', 'EOF']).join('\r\n') + '\r\n'; };

  /* AutoCAD 色號 → RGB（常用色；其他色號以色相近似） */
  var ACI = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 7: '#000000', 8: '#808080', 9: '#c0c0c0', 250: '#333333', 251: '#505050', 252: '#696969', 253: '#828282', 254: '#bebebe', 255: '#ffffff' };
  var ACI_NAME = { 1: '紅', 2: '黃', 3: '綠', 4: '青', 5: '藍', 6: '洋紅', 7: '黑/白', 8: '深灰', 9: '淺灰' };
  function aciHex(c) {
    if (c == null) return null;
    if (ACI[c]) return ACI[c];
    if (c >= 10 && c <= 249) {
      var hue = Math.floor((c - 10) / 10) * 15, lv = [1, 0.75, 0.6, 0.45, 0.3][Math.floor((c % 10) / 2)] || 0.6;
      var f = function (n) { var k = (n + hue / 30) % 12; return Math.round(255 * lv * (1 - Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 0.5 + 255 * lv * 0.5); };
      return '#' + [f(0), f(8), f(4)].map(function (x) { return ('0' + Math.max(0, Math.min(255, x)).toString(16)).slice(-2); }).join('');
    }
    return '#000000';
  }
  function aciName(c) { return c == null ? '' : (ACI_NAME[c] || '色號' + c); }

  global.DXF = { aciHex: aciHex, aciName: aciName, decodeBytes: decodeBytes, parse: parse, Writer: Writer, esc: esc };
})(typeof window !== 'undefined' ? window : globalThis);
