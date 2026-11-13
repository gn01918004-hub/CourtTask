/* 列印：A3 1:1 成果圖、8K 圖紙框選套印、裁切 DXF 匯出 */
(function (global) {
  'use strict';
  var R = global.Render, G = global.Geom;

  function n(v) { return Math.round(v * 1000) / 1000; }

  function doPrint(pageW, pageH, svgHtml) {
    var area = document.getElementById('printArea');
    var st = document.getElementById('pageStyle');
    st.textContent = '@page{size:' + pageW + 'mm ' + pageH + 'mm;margin:0}';
    area.innerHTML = '<div class="printPage" style="width:' + pageW + 'mm;height:' + pageH + 'mm">' + svgHtml + '</div>';
    // 等字型與版面就緒再列印
    setTimeout(function () { withTitle(function () { window.print(); }); }, 60);
  }
  /* 列印期間把網頁標題換成專案名稱：「另存為 PDF」的預設檔名就是它，方便歸檔 */
  function withTitle(fn) {
    var old = document.title, t = global.Printer.titleFn ? global.Printer.titleFn() : '';
    if (t) document.title = t;
    try { fn(); } finally {
      if (t) setTimeout(function () { if (document.title !== t) return; if (global.Printer.titleRestore) global.Printer.titleRestore(); else document.title = old; }, 500);
    }
  }

  /* A3 全張 1:1 */
  function sheetSVG(P, cad) {
    var W = P.sheet.w, H = P.sheet.h, dx = +P.sheet.dx || 0, dy = +P.sheet.dy || 0;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + 'mm" height="' + H + 'mm" viewBox="0 0 ' + W + ' ' + H + '" style="position:absolute;left:0;top:0">' +
      '<g transform="translate(' + dx + ' ' + dy + ')">' + R.renderSheet(P, cad, { print: true }) + '</g></svg>';
  }
  function printA3(P, cad) { doPrint(P.sheet.w, P.sheet.h, sheetSVG(P, cad)); }

  /* 8K 套印：框選區域以 1:1 放在紙張左下角 (offX, offY) 處 */
  /* 8K 紙張方向：範圍（含左下平移）直式放不下、橫式放得下時，自動改用橫式。
     回傳 { w, h, swapped, fits, overW, overH }（overW/overH＝超出紙張的 mm） */
  function k8Page(P) {
    var o = P.output.k8, r = o.region, w = +o.w || 267, h = +o.h || 388;
    if (!r) return { w: w, h: h, swapped: false, fits: true, overW: 0, overH: 0 };
    var needW = r.w + (+o.offX || 0), needH = r.h + (+o.offY || 0), E = 0.05;
    var fit = function (pw, ph) { return needW <= pw + E && needH <= ph + E; };
    var swapped = !fit(w, h) && fit(h, w);
    if (swapped) { var t = w; w = h; h = t; }
    return { w: w, h: h, swapped: swapped, fits: fit(w, h), overW: Math.max(0, needW - w), overH: Math.max(0, needH - h) };
  }
  function regionSVG(P, cad) {
    var o = P.output.k8, r = o.region;
    if (!r || r.w <= 0 || r.h <= 0) return null;
    var pg = k8Page(P);
    var left = (+o.offX || 0) + (+o.dx || 0);
    var top = pg.h - (+o.offY || 0) - r.h + (+o.dy || 0);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + n(r.w) + 'mm" height="' + n(r.h) + 'mm" viewBox="' + n(r.x) + ' ' + n(r.y) + ' ' + n(r.w) + ' ' + n(r.h) +
      '" style="position:absolute;left:' + n(left) + 'mm;top:' + n(top) + 'mm;overflow:hidden">' + R.renderSheet(P, cad, { print: true }) + '</svg>';
  }
  function print8K(P, cad) {
    var s = regionSVG(P, cad);
    if (!s) return false;
    var pg = k8Page(P);
    doPrint(pg.w, pg.h, s);
    return true;
  }

  /* 裁切後 DXF（世界座標，如同 486f.dxf） */
  function croppedDXF(P, cad, mapEl) {
    var v = R.mapView(mapEl), w = new global.DXF.Writer();
    var LY = R.layoutLabels(mapEl, P, cad);
    R.eachPiece(P, cad, function (pc, role, ss, l) {
      var c = G.clipSeg(pc.x1, pc.y1, pc.x2, pc.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (c) w.line(l.layer, c[0], c[1], c[2], c[3]);
    });
    if (cad) {
      cad.texts.forEach(function (t, idx) {
        var pos = LY.text[idx]; if (!pos) return;
        w.text(t.layer, pos[0], pos[1], t.h, t.text, { center: true, rot: t.rot });
      });
    }
    (P.userLines || []).forEach(function (l) {
      var c = G.clipSeg(l.x1, l.y1, l.x2, l.y2, v.X0, v.Y0, v.X1, v.Y1);
      if (c) w.line(l.role === 'split' ? 'SPLIT' : 'REF_LINE0', c[0], c[1], c[2], c[3]);
    });
    P.features.forEach(function (f) {
      var pts = f.pts && f.pts.length >= 3 ? G.clipPoly(f.pts, v.X0, v.Y0, v.X1, v.Y1) : [];
      if (pts.length >= 3) w.poly('FEATURE', pts, true);
      (f.holes || []).forEach(function (h) { var hp = G.clipPoly(h, v.X0, v.Y0, v.X1, v.Y1); if (hp.length >= 3) w.poly('FEATURE', hp, true); });
      var lp = LY.feat[f.id] || f.labelAt || R.featAnchor(f);
      if (!lp || lp[0] < v.X0 || lp[0] > v.X1 || lp[1] < v.Y0 || lp[1] > v.Y1) return;
      w.text('FEATURE_TXT', lp[0], lp[1], 2.5, f.code, { center: true });
    });
    P.annos.forEach(function (a) {
      if (a.x < v.X0 || a.x > v.X1 || a.y < v.Y0 || a.y > v.Y1) return;
      w.text('NOTE', a.x, a.y, 2, a.text, { center: true, rot: a.rot });
    });
    w.poly('0', [[v.X0, v.Y0], [v.X0, v.Y1], [v.X1, v.Y1], [v.X1, v.Y0]], true);
    return w.toString();
  }

  /* 清冊：列入清冊的說明項目，A4 直式表格（可多頁，表頭每頁重複） */
  function registerData(P, ft) {
    var cols = ft.columns || [], F = R.fieldsOf(P);
    var items = P.features.filter(function (f) { return f.inRegister && (!ft.ov || (f.ov || 'case') === ft.ov); });
    var rows = items.map(function (f) { return cols.map(function (c) { var v = c.key === 'area' ? R.featureArea(f, ft.decimals) : f[c.key]; return v == null ? '' : String(v); }); });
    var title = global.Model.fill(ft.title || '', F).replace(/[:：]\s*$/, '') + '清冊';
    return { cols: cols, rows: rows, title: title, F: F };
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function printRegister(P, ft) {
    var d = registerData(P, ft); if (!d.rows.length) return false;
    var F = d.F, area = document.getElementById('printArea'), st = document.getElementById('pageStyle');
    st.textContent = '@page{size:210mm 297mm;margin:15mm 15mm 15mm 15mm}';
    var info = [F.office, (F.county || '') + (F.town || '') + (F.section || '') + (F.subsection ? F.subsection + '小段' : '') + ' ' + (F.landNo ? F.landNo + '地號' : ''), F.courtDoc ? '囑託文號：' + F.courtDoc : ''].filter(Boolean);
    var h = '<div class="regdoc"><h1>' + esc(d.title) + '</h1>' + info.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('') +
      '<table><thead><tr>' + d.cols.map(function (c) { return '<th>' + esc((c.header || '').replace(/[:：]$/, '')).replace(/\n/g, '<br>') + '</th>'; }).join('') + '</tr></thead><tbody>' +
      d.rows.map(function (r) { return '<tr>' + r.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>' +
      '<p class="regnote">' + esc(global.Model.fill(ft.notes || '', F)).replace(/\n/g, '<br>') + '</p></div>';
    area.innerHTML = h;
    setTimeout(function () { withTitle(function () { window.print(); }); }, 60);
    return true;
  }
  function registerCSV(P, ft) {
    var d = registerData(P, ft);
    var q = function (v) {
      v = String(v);
      if (/^\d{1,4}[-\/]\d{1,4}([-\/]\d{1,4})?$/.test(v)) return '"=""' + v + '"""';   // 25-4 之類的地號：Excel 會當成日期，改用文字公式
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var lines = [d.cols.map(function (c) { return q((c.header || '').replace(/\n/g, '').replace(/[:：]$/, '')); }).join(',')].concat(d.rows.map(function (r) { return r.map(q).join(','); }));
    return '\ufeff' + lines.join('\r\n');
  }

  global.Printer = { k8Page: k8Page, printRegister: printRegister, registerCSV: registerCSV, registerData: registerData, printA3: printA3, print8K: print8K, sheetSVG: sheetSVG, regionSVG: regionSVG, croppedDXF: croppedDXF };
})(window);
