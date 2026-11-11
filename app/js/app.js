/* 法院囑託略圖編輯系統 — 主程式 */
(function () {
  'use strict';
  var M = Model, R = Render, G = Geom;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var App = window.App = {
    P: M.newProject(), cad: null,
    sel: null,          // {kind:'el'|'feature'|'flabel'|'seg'|'uline'|'ptext'|'anno', id/idx, mapId}
    selCell: null,      // {r0,c0,r1,c1}
    tool: 'select',
    view: { z: 2, ox: -10, oy: -10 },
    undo: [], redo: [], lastSnap: null,
    draw: null,         // 繪製中的多邊形 / 線
    guides: [], snapPt: null, space: false,
    planCads: [null]    // 各方案的圖資（可共用同一份）
  };
  var svg, stage;

  /* ================= 工具 ================= */
  function toast(msg, ms) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 2600);
  }
  function round(v, d) { var k = Math.pow(10, d == null ? 2 : d); return Math.round(v * k) / k; }
  function elById(id) { return App.P.elements.filter(function (e) { return e.id === id; })[0]; }
  function featById(id) { return App.P.features.filter(function (f) { return f.id === id; })[0]; }
  function maps() { return App.P.elements.filter(function (e) { return e.type === 'map'; }); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  /* ================= 復原 / 自動儲存 ================= */
  function snap() { return JSON.stringify(App.P); }
  function changed() {
    clearTimeout(changed._t);
    changed._t = setTimeout(checkpoint, 350);
  }
  function checkpoint() {
    var cur = snap();
    if (cur === App.lastSnap) return;
    if (App.lastSnap) { App.undo.push(App.lastSnap); if (App.undo.length > 200) App.undo.shift(); }
    App.redo = []; App.lastSnap = cur;
    autosave(); updateSteps();
  }
  function undo() {
    checkpoint();
    if (!App.undo.length) return toast('沒有可復原的動作');
    App.redo.push(App.lastSnap); App.lastSnap = App.undo.pop();
    App.P = JSON.parse(App.lastSnap); App.sel = null; App.cad = App.planCads[App.P.planIdx] || App.cad; refreshAll();
  }
  function redo() {
    if (!App.redo.length) return;
    App.undo.push(App.lastSnap); App.lastSnap = App.redo.pop();
    App.P = JSON.parse(App.lastSnap); App.sel = null; App.cad = App.planCads[App.P.planIdx] || App.cad; refreshAll();
  }
  var IDB = {
    db: null,
    open: function () {
      if (IDB.db) return Promise.resolve(IDB.db);
      return new Promise(function (res, rej) {
        try {
          var r = indexedDB.open('courttask', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { IDB.db = r.result; res(IDB.db); };
          r.onerror = function () { rej(r.error); };
        } catch (e) { rej(e); }
      });
    },
    put: function (k, v) {
      return IDB.open().then(function (db) {
        return new Promise(function (res, rej) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; });
      });
    },
    get: function (k) {
      return IDB.open().then(function (db) {
        return new Promise(function (res, rej) { var r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; });
      });
    }
  };
  function autosave() {
    clearTimeout(autosave._t);
    autosave._t = setTimeout(function () {
      var text = JSON.stringify(fileData());
      function done(ok) { $('#saveState').textContent = ok ? '已自動暫存 ' + new Date().toLocaleTimeString() : '自動暫存失敗（請手動儲存）'; }
      IDB.put('autosave', text).then(function () { done(true); }, function () { done(lsSet('courttask.autosave', text)); });
    }, 800);
  }

  /* ================= 檔案 ================= */
  function packCad(cad) {
    if (!cad) return null;
    var layers = [], li = {};
    function L(n) { if (li[n] == null) { li[n] = layers.length; layers.push(n); } return li[n]; }
    return {
      name: cad.name, layers: layers,
      lines: cad.lines.map(function (l) { return l.color != null ? [L(l.layer), l.x1, l.y1, l.x2, l.y2, l.color] : [L(l.layer), l.x1, l.y1, l.x2, l.y2]; }),
      texts: cad.texts.map(function (t) { return [L(t.layer), t.x, t.y, t.h, t.rot, t.text, t.h72, t.v73]; }),
      arcs: cad.arcs || []
    };
  }
  function unpackCad(c) {
    if (!c) return null;
    return {
      name: c.name,
      lines: c.lines.map(function (a) { return { layer: c.layers[a[0]], x1: a[1], y1: a[2], x2: a[3], y2: a[4], color: a[5] }; }),
      texts: c.texts.map(function (a) { return { layer: c.layers[a[0]], x: a[1], y: a[2], h: a[3], rot: a[4], text: a[5], h72: a[6], v73: a[7] }; }),
      arcs: c.arcs || []
    };
  }
  function fileData() {
    App.planCads[App.P.planIdx] = App.cad;
    var cads = [], refs = App.P.plans.map(function (pl, i) {
      var c = App.planCads[i]; if (!c) return -1;
      var j = cads.indexOf(c); if (j < 0) { cads.push(c); j = cads.length - 1; }
      return j;
    });
    return { app: 'CourtTask', format: 2, savedAt: new Date().toISOString(), project: App.P, cads: cads.map(packCad), planCad: refs };
  }
  function loadData(d) {
    if (!d || !d.project) throw new Error('不是本系統的專案檔');
    App.P = upgrade(d.project);
    if (d.cads) {
      var cads = d.cads.map(unpackCad);
      App.planCads = App.P.plans.map(function (pl, i) { var r = (d.planCad || [])[i]; return r >= 0 ? cads[r] : null; });
    } else App.planCads = [unpackCad(d.cad)];
    App.cad = App.planCads[App.P.planIdx] || null;
    App.undo = []; App.redo = []; App.lastSnap = snap(); App.sel = null;
    refreshAll(); fitView();
  }
  function upgrade(P) {
    var base = M.newProject();
    ['styles', 'sheet', 'output', 'settings', 'fields'].forEach(function (k) { P[k] = Object.assign(base[k], P[k] || {}); });
    P.output.k8 = Object.assign(M.newProject().output.k8, P.output.k8 || {});
    P.userLines = P.userLines || []; P.annos = P.annos || []; P.features = P.features || [];
    P.segStyle = P.segStyle || {}; P.textOver = P.textOver || {}; P.layerRoles = P.layerRoles || {}; P.splits = P.splits || {};
    if (!P.plans || !P.plans.length) { P.plans = [{ name: '方案1', data: null }]; P.planIdx = 0; }
    P.ovs = P.ovs || clone(base.ovs); P.activeOv = P.activeOv || 'case'; P.merge = P.merge || clone(base.merge);
    if (P.settings.codeScheme && !P.ovs.case._mig) { P.ovs.case.codeScheme = P.ovs.case.codeScheme || P.settings.codeScheme; }
    ['parcelLine', 'caseLine', 'splitLine', 'otherLine'].forEach(function (k) { P.styles[k] = Object.assign({}, base.styles[k], P.styles[k] || {}); });
    P.elements.forEach(function (e) {
      if (e.type === 'ftable' && !e.columns) {
        var keys = ['code', 'area', 'landNo', 'note'];
        e.columns = (e.headers || []).map(function (h, i) { return { key: keys[i] || 'note', header: h, fs: i === 3 ? e.noteFs : undefined }; });
        delete e.headers;
      }
    });
    return P;
  }
  function defaultName() {
    var f = App.P.fields;
    return f.caseName || ((f.section || '') + (f.landNo || '') + '略圖') || '未命名';
  }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/octet-stream' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  var fileHandle = null;
  function saveProject(saveAs) {
    checkpoint();
    var text = JSON.stringify(fileData());
    var name = defaultName() + '.ctp';
    if (window.showSaveFilePicker) {
      var p = (!saveAs && fileHandle) ? Promise.resolve(fileHandle) :
        window.showSaveFilePicker({ suggestedName: name, types: [{ description: '略圖專案', accept: { 'application/json': ['.ctp'] } }] });
      p.then(function (h) {
        fileHandle = h;
        return h.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); });
      }).then(function () { toast('已儲存：' + fileHandle.name); })
        .catch(function (e) { if (e && e.name !== 'AbortError') { download(name, text); toast('已下載專案檔'); } });
    } else { download(name, text); toast('已下載專案檔 ' + name); }
  }
  function readFile(file, asText) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(r.result); }; r.onerror = rej;
      if (asText) r.readAsText(file, 'utf-8'); else r.readAsArrayBuffer(file);
    });
  }
  function pickFiles(accept, multiple) {
    return new Promise(function (res) {
      var inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
      inp.onchange = function () { res(Array.prototype.slice.call(inp.files)); };
      inp.click();
    });
  }
  /* 開啟舊系統 SVMAP 的 .m02 → 轉成新專案（可直接修改） */
  function openM02(file) {
    return readFile(file).then(function (buf) {
      var m = M02.parse(buf), r = M02.toProject(m);
      checkpoint();
      App.P = upgrade(r.project); App.cad = r.cad.lines.length || r.cad.texts.length ? r.cad : null;
      App.planCads = [App.cad]; fileHandle = null;
      App.P.fields.caseName = file.name.replace(/\.m02$/i, '');
      App.P.plans[0].name = '舊檔';
      App.undo = []; App.redo = []; App.lastSnap = snap(); App.sel = null;
      refreshAll(); fitView(); autosave();
      var unk = Object.keys(r.report.unknown).length ? '；略過不支援的物件（影像等）' + Object.keys(r.report.unknown).map(function (k) { return r.report.unknown[k]; }).reduce(function (a, b) { return a + b; }, 0) + ' 個' : '';
      toast('已開啟舊檔 ' + file.name + '：圖紙物件 ' + r.report.sheet + '、圖資線 ' + r.cad.lines.length + '、文字 ' + r.cad.texts.length + unk, 6000);
      if (r.report.warnings.length) setTimeout(function () { alert('舊檔轉換說明：\n・' + r.report.warnings.join('\n・') + '\n\n轉換後的文字、表格都可以直接修改；原本的說明表是一般表格，若要改成自動產生，請新增「說明項目表」並用點選成面重建說明項目。'); }, 300);
    }).catch(function (e) { alert('無法讀取 .m02：' + (e && e.message || e)); });
  }
  function openProject() {
    pickFiles('.ctp,.json,.m02,.M02').then(function (fs) {
      if (!fs.length) return;
      fileHandle = null;
      if (/\.m02$/i.test(fs[0].name)) { openM02(fs[0]); return; }
      readFile(fs[0], true).then(function (t) {
        try { loadData(JSON.parse(t)); toast('已開啟 ' + fs[0].name); } catch (e) { alert('無法開啟：' + e.message); }
      });
    });
  }

  /* ================= DXF 匯入 ================= */
  function importDXF() {
    pickFiles('.dxf,.DXF', true).then(function (files) {
      if (!files.length) return;
      Promise.all(files.map(function (f) { return readFile(f).then(function (b) { return { name: f.name, data: DXF.parse(DXF.decodeBytes(b)) }; }); }))
        .then(function (list) {
          var replace = true;
          if (App.cad && App.cad.lines.length) replace = confirm('目前方案已經有圖資。\n按「確定」= 取代現有圖資\n按「取消」= 合併加入（套疊，例如另加分割線 DXF）');
          var old = replace ? { name: '', lines: [], texts: [], arcs: [] } : App.cad;
          var cad = { name: old.name, lines: old.lines.slice(), texts: old.texts.slice(), arcs: (old.arcs || []).slice() };
          if (replace) { App.P.segStyle = {}; App.P.textOver = {}; App.P.splits = {}; }
          // 重複線段只保留一條（layer 0 與 SPLIT 常重複）
          var seen = {};
          function key(x1, y1, x2, y2) { return [x1, y1, x2, y2].map(function (v) { return Math.round(v * 1000); }).join(','); }
          cad.lines.forEach(function (l, i) { seen[key(l.x1, l.y1, l.x2, l.y2)] = i; seen[key(l.x2, l.y2, l.x1, l.y1)] = i; });
          var dup = 0;
          list.forEach(function (it) {
            it.data.lines.forEach(function (l) {
              var k = key(l.x1, l.y1, l.x2, l.y2), j = seen[k];
              if (j != null) { dup++; if (cad.lines[j].layer === '0' && l.layer !== '0') cad.lines[j] = l; return; }
              cad.lines.push(l); seen[k] = seen[key(l.x2, l.y2, l.x1, l.y1)] = cad.lines.length - 1;
            });
            cad.texts = cad.texts.concat(it.data.texts);
            cad.arcs = cad.arcs.concat(it.data.arcs || []);
            cad.name = (cad.name ? cad.name + ' + ' : '') + it.name;
          });
          App.cad = cad; App.planCads[App.P.planIdx] = cad;
          if (!R.parseParcels(App.P.merge.parcels).length) {
            var det = R.detectMerge(App.P, App.cad);
            if (det.length >= 2) { App.P.merge.parcels = det.join('、'); App.P.merge.mode = App.P.merge.mode || 'x'; toast('偵測到合併記號：' + det.join('、') + '（可在「圖層」頁修改）', 5000); }
          }
          var tgt = App.cad.texts.filter(function (t) { return R.roleOf(App.P, t.layer, 'text') === 'target'; })[0];
          if (tgt && !App.P.fields.landNo) App.P.fields.landNo = tgt.text;
          maps().forEach(function (m) { if (m.cx == null || replace) centerMap(m, 'auto'); });
          refreshAll(); changed();
          toast('已匯入 ' + list.map(function (x) { return x.name; }).join('、') + '（線 ' + App.cad.lines.length + '，文字 ' + App.cad.texts.length + (dup ? '，略過重複線 ' + dup : '') + '）', 4000);
          switchTab('layer');
        }).catch(function (e) { console.error(e); alert('匯入失敗：' + (e && e.message || e)); });
    });
  }

  function centerMap(m, how) {
    var P = App.P, cad = App.cad, pt = null;
    if (how === 'features' && P.features.length) {
      var all = []; P.features.forEach(function (f) { all = all.concat(f.pts); });
      var b = G.bbox(all); pt = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    }
    if (!pt && cad && (how === 'auto' || how === 'target')) {
      var ts = cad.texts.filter(function (t) { return R.roleOf(P, t.layer, 'text') === 'target'; });
      if (ts.length) { var tb = G.bbox(ts.map(function (t) { return [t.x, t.y]; })); pt = [(tb[0] + tb[2]) / 2, (tb[1] + tb[3]) / 2]; }
    }
    if (!pt && cad && how !== 'target') {
      var cs = cad.lines.filter(function (l) { var r = R.roleOf(P, l.layer, 'line'); return r === 'case' || r === 'split'; });
      if (cs.length) pt = [G.median(cs.map(function (l) { return (l.x1 + l.x2) / 2; })), G.median(cs.map(function (l) { return (l.y1 + l.y2) / 2; }))];
    }
    if (!pt && cad && cad.lines.length) {
      pt = [G.median(cad.lines.map(function (l) { return l.x1; })), G.median(cad.lines.map(function (l) { return l.y1; }))];
    }
    if (!pt) return false;
    m.cx = round(pt[0], 3); m.cy = round(pt[1], 3);
    return true;
  }

  function pieceByKey(key) {
    if (!App.cad) return null;
    var idx = parseInt(String(key), 10), l = App.cad.lines[idx];
    if (!l) return null;
    return R.pieces(App.P, l, idx).filter(function (p) { return p.key === String(key); })[0] || null;
  }
  function layoutOf(m) { return R.lastLayout[m.id] || R.layoutLabels(m, App.P, App.cad); }

  /* ================= 檢視 ================= */
  function fitView() {
    var r = stage.getBoundingClientRect(), W = App.P.sheet.w, H = App.P.sheet.h;
    var z = Math.min((r.width - 30) / W, (r.height - 30) / H);
    App.view.z = z; App.view.ox = -(r.width / z - W) / 2; App.view.oy = -(r.height / z - H) / 2;
    render();
  }
  function applyView() {
    var r = stage.getBoundingClientRect();
    svg.setAttribute('viewBox', [App.view.ox, App.view.oy, r.width / App.view.z, r.height / App.view.z].join(' '));
    $('#zoomLbl').textContent = Math.round(App.view.z / (96 / 25.4) * 100) + '%';
  }
  function toPaper(ev) {
    var r = svg.getBoundingClientRect();
    return [App.view.ox + (ev.clientX - r.left) / App.view.z, App.view.oy + (ev.clientY - r.top) / App.view.z];
  }

  /* ================= 繪製 ================= */
  var rafPending = false;
  function render() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () { rafPending = false; renderNow(); });
  }
  function renderNow() {
    applyView();
    var P = App.P, s = '';
    s += '<defs><filter id="shadow" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0.6" dy="0.8" stdDeviation="1.2" flood-opacity="0.25"/></filter></defs>';
    s += '<rect x="0" y="0" width="' + P.sheet.w + '" height="' + P.sheet.h + '" fill="#fff" filter="url(#shadow)"/>';
    // 圖框外預覽
    var gm = null;
    if (App.sel && App.sel.kind === 'el') { var se = elById(App.sel.id); if (se && se.type === 'map') gm = se; }
    if (App.hoverMap && App.tool === 'pan') gm = elById(App.hoverMap) || gm;
    if (gm) s += R.renderGhost(gm, P, App.cad);
    s += '<g id="content">' + R.renderSheet(P, App.cad, {}) + '</g>';
    s += renderOverlay();
    svg.innerHTML = s;
  }

  function hs() { return 7 / App.view.z; } // 控制點大小 (mm)
  function rectSVG(b, cls) {
    return '<rect class="' + cls + '" x="' + b.x + '" y="' + b.y + '" width="' + Math.max(b.w, 0.01) + '" height="' + Math.max(b.h, 0.01) + '"/>';
  }
  function handlesOf(b) {
    return [['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y], ['e', b.x + b.w, b.y + b.h / 2],
      ['se', b.x + b.w, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['sw', b.x, b.y + b.h], ['w', b.x, b.y + b.h / 2]];
  }
  function renderOverlay() {
    var P = App.P, s = '<g class="overlay">', h = hs();
    // 8K 輸出範圍
    var rg = P.output.k8.region;
    if (rg && (App.tool === 'region' || App.tab === 'out')) {
      s += '<rect class="ov-region" x="' + rg.x + '" y="' + rg.y + '" width="' + rg.w + '" height="' + rg.h + '"/>';
      s += '<text class="ov-label" x="' + (rg.x + 1) + '" y="' + (rg.y - 1) + '" font-size="' + (11 / App.view.z) + '">8K 套印範圍 ' + round(rg.w, 1) + '×' + round(rg.h, 1) + 'mm</text>';
    }
    var sel = App.sel;
    if (sel && sel.kind === 'el') {
      var el = elById(sel.id);
      if (el) {
        var b = R.bounds(el, P);
        s += rectSVG({ x: b.x - 0.3, y: b.y - 0.3, w: b.w + 0.6, h: b.h + 0.6 }, 'ov-sel');
        if (!el.locked) {
          if (el.type === 'line') {
            s += '<rect class="ov-h" x="' + (el.x - h / 2) + '" y="' + (el.y - h / 2) + '" width="' + h + '" height="' + h + '"/>';
            s += '<rect class="ov-h" x="' + (el.x + el.w - h / 2) + '" y="' + (el.y + el.h - h / 2) + '" width="' + h + '" height="' + h + '"/>';
          } else handlesOf(b).forEach(function (p) { s += '<rect class="ov-h" x="' + (p[1] - h / 2) + '" y="' + (p[2] - h / 2) + '" width="' + h + '" height="' + h + '"/>'; });
        }
        if (App.tableEdit === el.id) s += rectSVG({ x: b.x - 0.8, y: b.y - 0.8, w: b.w + 1.6, h: b.h + 1.6 }, 'ov-tedit');
        if ((el.type === 'table' || el.type === 'ftable') && App.selCell) {
          var tm = R.tableModel(el, P), c = App.selCell;
          var r0 = Math.min(c.r0, c.r1), r1 = Math.max(c.r0, c.r1), c0 = Math.min(c.c0, c.c1), c1 = Math.max(c.c0, c.c1);
          var cr = R.cellRect(el, tm, { r: r0, c: c0, rs: r1 - r0 + 1, cs: c1 - c0 + 1 });
          s += rectSVG(cr, 'ov-cell');
        }
        if (el.type === 'map') {
          var v = R.mapView(el);
          s += '<text class="ov-label" x="' + el.x + '" y="' + (el.y - 1) + '" font-size="' + (11 / App.view.z) + '">1/' + el.scale + '　裁切 ' + round(el.w / 10, 2) + '×' + round(el.h / 10, 2) + 'cm（實地 ' + round(el.w / v.k, 1) + '×' + round(el.h / v.k, 1) + 'm）</text>';
        }
      }
    }
    var m = sel && sel.mapId ? elById(sel.mapId) : null;
    if (m && m.cx != null) {
      var mv = R.mapView(m);
      if (sel.kind === 'feature' || sel.kind === 'flabel') {
        var f = featById(sel.id);
        if (f) {
          s += '<path class="ov-feat" d="' + f.pts.map(function (p, i) { var q = mv.toP(p[0], p[1]); return (i ? 'L' : 'M') + q[0] + ' ' + q[1]; }).join('') + 'Z"/>';
          f.pts.forEach(function (p) { var q = mv.toP(p[0], p[1]); s += '<rect class="ov-v" x="' + (q[0] - h / 2.6) + '" y="' + (q[1] - h / 2.6) + '" width="' + h / 1.3 + '" height="' + h / 1.3 + '"/>'; });
        }
      }
      if (sel.kind === 'seg' && App.cad) {
        (sel.idx || []).forEach(function (key) {
          var l = pieceByKey(key); if (!l) return;
          var a = mv.toP(l.x1, l.y1), bq = mv.toP(l.x2, l.y2);
          s += '<line class="ov-seg" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + bq[0] + '" y2="' + bq[1] + '"/>';
        });
      }
      if (sel.kind === 'uline') {
        var ul = P.userLines[sel.idx];
        if (ul) { var a2 = mv.toP(ul.x1, ul.y1), b2 = mv.toP(ul.x2, ul.y2); s += '<line class="ov-seg" x1="' + a2[0] + '" y1="' + a2[1] + '" x2="' + b2[0] + '" y2="' + b2[1] + '"/>'; }
      }
      if (sel.kind === 'ptext' || sel.kind === 'anno') {
        var pos = subPos(sel);
        if (pos) { var q2 = mv.toP(pos[0], pos[1]); s += '<circle class="ov-pt" cx="' + q2[0] + '" cy="' + q2[1] + '" r="' + h * 0.9 + '"/>'; }
      }
    }
    // 繪製中
    if (App.draw && App.draw.pts.length) {
      var dm = elById(App.draw.mapId), dv = R.mapView(dm);
      var pts = App.draw.pts.concat(App.draw.cursor ? [App.draw.cursor] : []);
      s += '<path class="ov-draw" d="' + pts.map(function (p, i) { var q = dv.toP(p[0], p[1]); return (i ? 'L' : 'M') + q[0] + ' ' + q[1]; }).join('') + (App.draw.type === 'poly' ? 'Z' : '') + '"/>';
      if (App.draw.type === 'poly' && pts.length >= 3) {
        s += '<text class="ov-label" x="' + (dv.toP(pts[pts.length - 1][0], pts[pts.length - 1][1])[0] + 2) + '" y="' + (dv.toP(pts[pts.length - 1][0], pts[pts.length - 1][1])[1] - 2) + '" font-size="' + (11 / App.view.z) + '">' + G.area(pts).toFixed(2) + ' m²</text>';
      }
    }
    if (App.snapPt) s += '<rect class="ov-snap" x="' + (App.snapPt[0] - h / 1.6) + '" y="' + (App.snapPt[1] - h / 1.6) + '" width="' + h * 1.25 + '" height="' + h * 1.25 + '"/>';
    App.guides.forEach(function (g) {
      if (g.x != null) s += '<line class="ov-guide" x1="' + g.x + '" y1="-50" x2="' + g.x + '" y2="' + (P.sheet.h + 50) + '"/>';
      else s += '<line class="ov-guide" x1="-50" y1="' + g.y + '" x2="' + (P.sheet.w + 50) + '" y2="' + g.y + '"/>';
    });
    if (App.rubber) s += rectSVG(App.rubber, 'ov-region');
    return s + '</g>';
  }
  function subPos(sel) {
    if (sel.kind === 'anno') { var a = App.P.annos.filter(function (x) { return x.id === sel.id; })[0]; return a ? [a.x, a.y] : null; }
    if (sel.kind === 'ptext' && App.cad) {
      var m = elById(sel.mapId), ly = m && layoutOf(m);
      if (ly && ly.text[sel.idx]) return ly.text[sel.idx];
      var t = App.cad.texts[sel.idx], ov = App.P.textOver[sel.idx] || {};
      return t ? [ov.x != null ? ov.x : t.x, ov.y != null ? ov.y : t.y] : null;
    }
    return null;
  }

  /* ================= 點選判斷 ================= */
  function tol() { return 5 / App.view.z; }
  function hitHandle(p) {
    if (!App.sel || App.sel.kind !== 'el') return null;
    var el = elById(App.sel.id); if (!el || el.locked) return null;
    var h = hs() * 0.8;
    if (el.type === 'line') {
      if (Math.abs(p[0] - el.x) < h && Math.abs(p[1] - el.y) < h) return 'p1';
      if (Math.abs(p[0] - el.x - el.w) < h && Math.abs(p[1] - el.y - el.h) < h) return 'p2';
      return null;
    }
    var hit = null;
    handlesOf(R.bounds(el, App.P)).forEach(function (q) { if (Math.abs(p[0] - q[1]) < h && Math.abs(p[1] - q[2]) < h) hit = q[0]; });
    return hit;
  }
  function hitDivider(p) {
    if (!App.sel || App.sel.kind !== 'el') return null;
    var el = elById(App.sel.id);
    if (!el || (el.type !== 'table' && el.type !== 'ftable') || el.locked) return null;
    if (App.tableEdit !== el.id) return null;   // 只有「表格編輯」狀態（雙擊表格）才能拉格線
    var tm = R.tableModel(el, App.P), b = R.bounds(el, App.P), t = tol() * 0.7;
    if (p[0] < b.x - t || p[0] > b.x + b.w + t || p[1] < b.y - t || p[1] > b.y + b.h + t) return null;
    var x = el.x, i;
    for (i = 0; i < tm.cols.length; i++) { x += tm.cols[i]; if (Math.abs(p[0] - x) < t && p[1] > b.y + t && p[1] < b.y + b.h - t) return { dir: 'col', i: i }; }
    var y = el.y;
    for (i = 0; i < tm.rows.length; i++) { y += tm.rows[i]; if (Math.abs(p[1] - y) < t && p[0] > b.x + t && p[0] < b.x + b.w - t) return { dir: 'row', i: i }; }
    return null;
  }
  function hitElement(p) {
    var els = App.P.elements, t = tol();
    for (var i = els.length - 1; i >= 0; i--) {
      var el = els[i]; if (el.hidden) continue;
      var b = R.bounds(el, App.P);
      if (el.type === 'rect') {
        var inX = p[0] > b.x - t && p[0] < b.x + b.w + t, inY = p[1] > b.y - t && p[1] < b.y + b.h + t;
        if (inX && inY && (Math.abs(p[0] - b.x) < t || Math.abs(p[0] - b.x - b.w) < t || Math.abs(p[1] - b.y) < t || Math.abs(p[1] - b.y - b.h) < t)) return el;
      } else if (el.type === 'line') {
        if (G.distToSeg(p, [el.x, el.y], [el.x + el.w, el.y + el.h]) < t) return el;
      } else if (p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h) return el;
    }
    return null;
  }
  function mapAt(p) {
    var ms = maps();
    for (var i = ms.length - 1; i >= 0; i--) {
      var m = ms[i];
      if (!m.hidden && m.cx != null && p[0] >= m.x && p[0] <= m.x + m.w && p[1] >= m.y && p[1] <= m.y + m.h) return m;
    }
    return null;
  }
  function hitMapObject(m, p, anyLine) {
    var P = App.P, v = R.mapView(m), w = v.toW(p[0], p[1]), tw = tol() / v.k, best = null, bd, LY = layoutOf(m);
    // 說明項目編號
    for (var i = P.features.length - 1; i >= 0; i--) {
      var f = P.features[i]; if (f.label === false) continue;
      var lp = LY.feat[f.id] || f.labelAt || G.labelPoint(f.pts);
      if (Math.hypot(lp[0] - w[0], lp[1] - w[1]) < (f.labelSize || P.styles.featureLabel.size) * 0.6 / v.k) return { kind: 'flabel', id: f.id, mapId: m.id };
    }
    for (i = P.annos.length - 1; i >= 0; i--) {
      var a = P.annos[i], half = Math.max(1, M.measure(a.text, a.size || P.styles.anno.size, a.font || 'kai') / 2) / v.k;
      if (Math.abs(a.x - w[0]) < half && Math.abs(a.y - w[1]) < (a.size || 4) * 0.6 / v.k) return { kind: 'anno', id: a.id, mapId: m.id };
    }
    if (App.cad) {
      bd = 3.2 / v.k;
      App.cad.texts.forEach(function (t, idx) {
        var pos = LY.text[idx]; if (!pos) return;
        var d = Math.hypot(pos[0] - w[0], pos[1] - w[1]);
        if (d < bd) { bd = d; best = { kind: 'ptext', idx: idx, mapId: m.id }; }
      });
      if (best) return best;
      bd = tw;
      R.eachPiece(P, App.cad, function (pc, role) {
        if (!anyLine && role !== 'case' && role !== 'split') return;
        if (Math.max(pc.x1, pc.x2) < w[0] - bd || Math.min(pc.x1, pc.x2) > w[0] + bd || Math.max(pc.y1, pc.y2) < w[1] - bd || Math.min(pc.y1, pc.y2) > w[1] + bd) return;
        var d = G.distToSeg(w, [pc.x1, pc.y1], [pc.x2, pc.y2]);
        if (d < bd) { bd = d; best = { kind: 'seg', idx: [pc.key], mapId: m.id }; }
      });
    }
    (P.userLines || []).forEach(function (l, idx) {
      var d = G.distToSeg(w, [l.x1, l.y1], [l.x2, l.y2]);
      if (d < (bd || tw)) { bd = d; best = { kind: 'uline', idx: idx, mapId: m.id }; }
    });
    if (best) return best;
    for (i = P.features.length - 1; i >= 0; i--) {
      if (G.pointInPoly(w, P.features[i].pts)) return { kind: 'feature', id: P.features[i].id, mapId: m.id };
    }
    return null;
  }

  /* ================= 鎖點 ================= */
  function snapWorld(m, p) {
    var v = R.mapView(m), w = v.toW(p[0], p[1]), tw = 2.2 / App.view.z * 2 / v.k, best = null, bd = tw;
    function test(x, y) { var d = Math.hypot(x - w[0], y - w[1]); if (d < bd) { bd = d; best = [x, y]; } }
    var near = [];
    function consider(x1, y1, x2, y2) {
      test(x1, y1); test(x2, y2);
      if (G.distToSeg(w, [x1, y1], [x2, y2]) < tw * 2) near.push([x1, y1, x2, y2]);
    }
    if (App.cad) App.cad.lines.forEach(function (l) {
      if (Math.max(l.x1, l.x2) < w[0] - 50 || Math.min(l.x1, l.x2) > w[0] + 50 || Math.max(l.y1, l.y2) < w[1] - 50 || Math.min(l.y1, l.y2) > w[1] + 50) return;
      if (R.roleOf(App.P, l.layer, 'line') === 'hide') return;
      consider(l.x1, l.y1, l.x2, l.y2);
    });
    App.P.userLines.forEach(function (l) { consider(l.x1, l.y1, l.x2, l.y2); });
    App.P.features.forEach(function (f) { f.pts.forEach(function (q) { test(q[0], q[1]); }); });
    if (App.draw) App.draw.pts.forEach(function (q) { test(q[0], q[1]); });
    for (var i = 0; i < near.length; i++) for (var j = i + 1; j < near.length; j++) {
      var a = near[i], b = near[j], r = G.segIntersect([a[0], a[1]], [a[2], a[3]], [b[0], b[1]], [b[2], b[3]]);
      if (r && r.t > -0.001 && r.t < 1.001 && r.u > -0.001 && r.u < 1.001) test(r.x, r.y);
    }
    if (!best && near.length) { // 線上最近點
      var s = near[0], dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy;
      var t = l2 ? Math.max(0, Math.min(1, ((w[0] - s[0]) * dx + (w[1] - s[1]) * dy) / l2)) : 0;
      if (G.distToSeg(w, [s[0], s[1]], [s[2], s[3]]) < tw * 0.6) best = [s[0] + t * dx, s[1] + t * dy];
    }
    return best ? { w: best, p: v.toP(best[0], best[1]) } : { w: w, p: null };
  }

  /* 元件邊緣對齊 */
  function snapMove(el, b, dx, dy) {
    App.guides = [];
    if (!App.P.settings.snapEdges) return [dx, dy];
    var t = 6 / App.view.z, xs = [], ys = [];
    App.P.elements.forEach(function (o) {
      if (o === el || o.hidden) return;
      var ob = R.bounds(o, App.P);
      xs.push(ob.x, ob.x + ob.w); ys.push(ob.y, ob.y + ob.h);
    });
    var bx = [b.x + dx, b.x + b.w + dx], by = [b.y + dy, b.y + b.h + dy], bestX = null, bestY = null;
    xs.forEach(function (x) { bx.forEach(function (e) { var d = x - e; if (Math.abs(d) < t && (bestX === null || Math.abs(d) < Math.abs(bestX.d))) bestX = { d: d, x: x }; }); });
    ys.forEach(function (y) { by.forEach(function (e) { var d = y - e; if (Math.abs(d) < t && (bestY === null || Math.abs(d) < Math.abs(bestY.d))) bestY = { d: d, y: y }; }); });
    if (bestX) { dx += bestX.d; App.guides.push({ x: bestX.x }); }
    if (bestY) { dy += bestY.d; App.guides.push({ y: bestY.y }); }
    return [dx, dy];
  }

  /* ================= 滑鼠操作 ================= */
  var drag = null;
  function onDown(ev) {
    if (ev.button === 1 || (ev.button === 0 && App.space)) {
      drag = { type: 'view', sx: ev.clientX, sy: ev.clientY, ox: App.view.ox, oy: App.view.oy };
      svg.setPointerCapture(ev.pointerId); ev.preventDefault(); return;
    }
    if (ev.button !== 0) return;
    svg.setPointerCapture(ev.pointerId);
    var p = toPaper(ev), m;
    var tool = App.tool;

    if (tool === 'face') {
      m = mapAt(p); if (!m) return toast('請在略圖框內點選');
      addFaceAt(m, R.mapView(m).toW(p[0], p[1]), ev.shiftKey); return;
    }
    if (tool === 'assign') {
      m = mapAt(p); if (!m) return toast('請在略圖框內點選線段');
      assignAt(m, p, ev.shiftKey, ev.altKey); return;
    }
    if (tool === 'break') {
      m = mapAt(p); if (!m) return toast('請在略圖框內點選線段');
      breakAt(m, p); return;
    }
    if (tool === 'poly' || tool === 'line' || tool === 'sline') {
      m = App.draw ? elById(App.draw.mapId) : mapAt(p);
      if (!m) return toast('請在略圖框內點選');
      var sp = snapWorld(m, p);
      if (!App.draw) App.draw = { type: tool === 'poly' ? 'poly' : 'line', role: tool === 'sline' ? 'split' : 'case', mapId: m.id, pts: [] };
      if (ev.detail >= 2) { finishDraw(); return; }
      App.draw.pts.push(sp.w); render(); return;
    }
    if (tool === 'text') {
      m = mapAt(p);
      if (m) {
        var w = R.mapView(m).toW(p[0], p[1]);
        var a = { id: M.uid(), x: round(w[0], 3), y: round(w[1], 3), text: '註記', size: App.P.styles.anno.size };
        App.P.annos.push(a); select({ kind: 'anno', id: a.id, mapId: m.id });
      } else {
        var el = { id: M.uid(), type: 'text', name: '文字', x: round(p[0], 1), y: round(p[1], 1), w: 40, h: 8, text: '文字', fs: 4.15, align: 'left', valign: 'middle', font: 'kai' };
        App.P.elements.push(el); select({ kind: 'el', id: el.id });
      }
      setTool('select'); changed(); setTimeout(function () { var ta = $('#props textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
      return;
    }
    if (tool === 'region' || tool === 'lsel') {
      if (tool === 'lsel' && !mapAt(p)) return toast('請在略圖框內拖曳');
      drag = { type: tool === 'lsel' ? 'lsel' : 'region', sx: p[0], sy: p[1], m: mapAt(p) }; App.rubber = { x: p[0], y: p[1], w: 0, h: 0 }; return;
    }
    if (tool === 'pan') {
      m = mapAt(p); if (!m) return;
      drag = { type: 'pan', m: m, sp: p, cx: m.cx, cy: m.cy }; return;
    }

    // ===== 選取工具 =====
    var hh = hitHandle(p);
    if (hh) { var se = elById(App.sel.id); drag = { type: 'resize', el: se, h: hh, sp: p, orig: clone(se), b: R.bounds(se, App.P) }; return; }
    var dv = hitDivider(p);
    if (dv) { var te = elById(App.sel.id); drag = { type: 'divider', el: te, d: dv, sp: p, orig: clone(te), shift: ev.shiftKey }; return; }
    // 說明項目頂點
    if (App.sel && (App.sel.kind === 'feature' || App.sel.kind === 'flabel')) {
      var f = featById(App.sel.id), fm = elById(App.sel.mapId);
      if (f && fm) {
        var fv = R.mapView(fm);
        for (var vi = 0; vi < f.pts.length; vi++) {
          var q = fv.toP(f.pts[vi][0], f.pts[vi][1]);
          if (Math.hypot(q[0] - p[0], q[1] - p[1]) < hs() * 0.7) { drag = { type: 'vertex', f: f, i: vi, m: fm }; return; }
        }
      }
    }
    m = mapAt(p);
    var hit = null;
    if (m) hit = hitMapObject(m, p, ev.altKey);
    if (hit) {
      if (hit.kind === 'seg' && ev.shiftKey && App.sel && App.sel.kind === 'seg') {
        var idx = App.sel.idx.slice(), k = idx.indexOf(hit.idx[0]);
        if (k >= 0) idx.splice(k, 1); else idx.push(hit.idx[0]);
        hit.idx = idx;
      }
      select(hit);
      if (hit.kind === 'flabel' || hit.kind === 'anno' || hit.kind === 'ptext') drag = { type: 'sub', sel: hit, m: m, sp: p, moved: false };
      return;
    }
    var el2 = hitElement(p);
    if (App.tableEdit && (!el2 || el2.id !== App.tableEdit)) { App.tableEdit = null; }   // 點到表格外 → 離開表格編輯
    if (el2) {
      var prevSel = App.sel && App.sel.kind === 'el' && App.sel.id === el2.id;
      var isTbl = el2.type === 'table' || el2.type === 'ftable';
      if (isTbl) {
        var rc = cellAtPoint(el2, p);
        if (rc) {
          if (ev.shiftKey && prevSel && App.selCell) { App.selCell.r1 = rc.r; App.selCell.c1 = rc.c; }
          else App.selCell = { r0: rc.r, c0: rc.c, r1: rc.r, c1: rc.c };
        }
      } else App.selCell = null;
      select({ kind: 'el', id: el2.id }, true);
      // 表格編輯中只選格子不移動；平常拖曳＝移動整個元件
      if (!el2.locked && !(isTbl && App.tableEdit === el2.id)) drag = { type: 'move', el: el2, sp: p, orig: clone(el2), b: R.bounds(el2, App.P), moved: false };
      return;
    }
    select(null);
  }

  function onMove(ev) {
    var p = toPaper(ev);
    // 狀態列座標
    var m = mapAt(p), st = '紙上 ' + round(p[0], 1) + ', ' + round(p[1], 1) + ' mm';
    if (m) { var w = R.mapView(m).toW(p[0], p[1]); st += '　｜　TWD97 E ' + w[0].toFixed(3) + '　N ' + w[1].toFixed(3) + '　(1/' + m.scale + ')'; }
    $('#coord').textContent = st;
    var hm = m ? m.id : null;
    if (App.tool === 'pan' && hm !== App.hoverMap) { App.hoverMap = hm; render(); }

    if (!drag) {
      // 游標
      var cur = '';
      if (App.tool === 'select') {
        var h = hitHandle(p), d = !h && hitDivider(p);
        if (h) cur = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', p1: 'move', p2: 'move' }[h];
        else if (d) cur = d.dir === 'col' ? 'col-resize' : 'row-resize';
      }
      svg.style.cursor = cur;
      if (App.draw) {
        var dm = elById(App.draw.mapId), sp = snapWorld(dm, p);
        App.draw.cursor = sp.w; App.snapPt = sp.p; render();
      } else if (App.tool === 'poly' || App.tool === 'line' || App.tool === 'sline' || App.tool === 'break') {
        if (m) { var s2 = snapWorld(m, p); App.snapPt = s2.p; } else App.snapPt = null;
        render();
      }
      return;
    }
    var dx = p[0] - (drag.sp ? drag.sp[0] : 0), dy = p[1] - (drag.sp ? drag.sp[1] : 0), el, o;
    switch (drag.type) {
      case 'view':
        App.view.ox = drag.ox - (ev.clientX - drag.sx) / App.view.z;
        App.view.oy = drag.oy - (ev.clientY - drag.sy) / App.view.z; applyView(); return;
      case 'region': case 'lsel':
        App.rubber = { x: Math.min(drag.sx, p[0]), y: Math.min(drag.sy, p[1]), w: Math.abs(p[0] - drag.sx), h: Math.abs(p[1] - drag.sy) }; break;
      case 'pan': {
        var k = 1000 / drag.m.scale;
        drag.m.cx = round(drag.cx - dx / k, 3); drag.m.cy = round(drag.cy + dy / k, 3); break;
      }
      case 'move':
        if (!drag.moved && Math.hypot(dx, dy) < 2 / App.view.z) return;
        drag.moved = true; el = drag.el; o = drag.orig;
        var sd = ev.altKey ? [dx, dy] : snapMove(el, drag.b, dx, dy);
        el.x = round(o.x + sd[0], 2); el.y = round(o.y + sd[1], 2); break;
      case 'resize': resizeEl(drag, dx, dy, ev); break;
      case 'divider': dragDivider(drag, dx, dy); break;
      case 'vertex': {
        var sv = snapWorld(drag.m, p); App.snapPt = sv.p;
        drag.f.pts[drag.i] = [round(sv.w[0], 6), round(sv.w[1], 6)]; drag.f.arcAdj = arcAdj(drag.f.pts); delete drag.f.seeds; refreshFeatures(); break;
      }
      case 'sub': {
        if (!drag.moved && Math.hypot(dx, dy) < 2 / App.view.z) return;
        drag.moved = true;
        var w2 = R.mapView(drag.m).toW(p[0], p[1]), sl = drag.sel;
        if (sl.kind === 'flabel') featById(sl.id).labelAt = [round(w2[0], 3), round(w2[1], 3)];
        else if (sl.kind === 'anno') { var an = App.P.annos.filter(function (x) { return x.id === sl.id; })[0]; an.x = round(w2[0], 3); an.y = round(w2[1], 3); }
        else if (sl.kind === 'ptext') { var ov = App.P.textOver[sl.idx] = App.P.textOver[sl.idx] || {}; ov.x = round(w2[0], 3); ov.y = round(w2[1], 3); }
        break;
      }
    }
    render();
    if (drag.type === 'move' || drag.type === 'resize' || drag.type === 'divider' || drag.type === 'pan') updateGeomFields();
  }

  function onUp(ev) {
    if (!drag) return;
    var d = drag; drag = null; App.guides = []; App.snapPt = null;
    if (d.type === 'lsel') {
      var rr = App.rubber; App.rubber = null;
      if (rr && rr.w > 1 && rr.h > 1) windowSelect(d.m, rr);
    } else if (d.type === 'region') {
      var r = App.rubber; App.rubber = null;
      if (r && r.w > 2 && r.h > 2) {
        App.P.output.k8.region = { x: round(r.x, 2), y: round(r.y, 2), w: round(r.w, 2), h: round(r.h, 2) };
        changed(); setTool('select'); switchTab('out'); toast('已設定 8K 套印範圍');
      }
    } else if (d.type !== 'view') changed();
    render(); if (d.type !== 'view') refreshPanels();
  }

  function resizeEl(d, dx, dy, ev) {
    var el = d.el, o = d.orig, b = d.b, h = d.h;
    if (h === 'p1') { el.x = round(o.x + dx, 2); el.y = round(o.y + dy, 2); el.w = round(o.w - dx, 2); el.h = round(o.h - dy, 2); if (ev.shiftKey) axisLock(el); return; }
    if (h === 'p2') { el.w = round(o.w + dx, 2); el.h = round(o.h + dy, 2); if (ev.shiftKey) axisLock(el); return; }
    var nx = b.x, ny = b.y, nw = b.w, nh = b.h;
    if (h.indexOf('w') >= 0) { nx = b.x + dx; nw = b.w - dx; }
    if (h.indexOf('e') >= 0) { nw = b.w + dx; }
    if (h.indexOf('n') >= 0) { ny = b.y + dy; nh = b.h - dy; }
    if (h.indexOf('s') >= 0) { nh = b.h + dy; }
    if ((ev.shiftKey || el.type === 'north') && h.length === 2) { // 等比例
      var sc = Math.max(nw / b.w, nh / b.h);
      nw = b.w * sc; nh = b.h * sc;
      if (h.indexOf('w') >= 0) nx = b.x + b.w - nw;
      if (h.indexOf('n') >= 0) ny = b.y + b.h - nh;
    }
    if (nw < 2 || nh < 2) return;
    if (el.type === 'table' || el.type === 'ftable') {
      var sx = nw / b.w, sy = nh / b.h;
      el.x = round(nx, 2); el.y = round(ny, 2);
      el.cols = o.cols.map(function (c) { return round(c * sx, 2); });
      if (el.type === 'table') el.rows = o.rows.map(function (r) { return round(r * sy, 2); });
      else {
        el.titleH = round(o.titleH * sy, 2); el.headerH = round(o.headerH * sy, 2); el.rowH = round(o.rowH * sy, 2); el.notesH = round(o.notesH * sy, 2);
        el.rowHs = {}; for (var k in o.rowHs) el.rowHs[k] = round(o.rowHs[k] * sy, 2);
      }
      return;
    }
    if (el.type === 'map' && el.cx != null) {
      var kk = 1000 / el.scale;
      var X0o = o.cx - o.w / 2 / kk, Y0o = o.cy - o.h / 2 / kk;
      var X0n = X0o + (nx - o.x) / kk, Y0n = Y0o + (o.y + o.h - ny - nh) / kk;
      el.cx = round(X0n + nw / 2 / kk, 3); el.cy = round(Y0n + nh / 2 / kk, 3);
    }
    el.x = round(nx, 2); el.y = round(ny, 2); el.w = round(nw, 2); el.h = round(nh, 2);
  }
  function axisLock(el) { if (Math.abs(el.w) > Math.abs(el.h)) el.h = 0; else el.w = 0; }

  function dragDivider(d, dx, dy) {
    var el = d.el, o = d.orig, dir = d.d.dir, i = d.d.i;
    if (dir === 'col') {
      var cols = o.cols.slice(), delta = dx;
      if (i < cols.length - 1 && !d.shift) {
        delta = Math.max(1 - cols[i], Math.min(cols[i + 1] - 1, delta));
        cols[i] += delta; cols[i + 1] -= delta;
      } else cols[i] = Math.max(1, cols[i] + delta);
      el.cols = cols.map(function (c) { return round(c, 2); });
      return;
    }
    var tmo = R.tableModel(o, App.P), rows = tmo.rows.slice(), dl = dy;
    if (i < rows.length - 1 && !d.shift) {
      dl = Math.max(1 - rows[i], Math.min(rows[i + 1] - 1, dl));
      rows[i] += dl; rows[i + 1] -= dl;
      setRowH(el, tmo, i, rows[i]); setRowH(el, tmo, i + 1, rows[i + 1]);
    } else setRowH(el, tmo, i, Math.max(1, rows[i] + dl));
  }
  function setRowH(el, tm, i, h) {
    h = round(h, 2);
    if (el.type === 'table') { el.rows[i] = h; return; }
    var kind = tm.kinds[i];
    if (kind === 'title') el.titleH = h; else if (kind === 'header') el.headerH = h; else if (kind === 'notes') el.notesH = h;
    else el.rowHs[kind] = h;
  }
  function setTableEdit(id) {
    App.tableEdit = id;
    if (id) toast('表格編輯：拖拉格線調整欄寬／列高，點格子編輯內容（Shift 多選可合併）。按 Esc 或點表格外結束。', 4000);
    render(); renderProps();
  }
  function cellAtPoint(el, p) {
    var tm = R.tableModel(el, App.P), x = el.x, y = el.y, r = -1, c = -1, i;
    for (i = 0; i < tm.cols.length; i++) { if (p[0] >= x && p[0] < x + tm.cols[i]) { c = i; break; } x += tm.cols[i]; }
    for (i = 0; i < tm.rows.length; i++) { if (p[1] >= y && p[1] < y + tm.rows[i]) { r = i; break; } y += tm.rows[i]; }
    if (r < 0 || c < 0) return null;
    // 合併格 → 回到錨點
    var cell = tm.cells.filter(function (cc) { return r >= cc.r && r < cc.r + (cc.rs || 1) && c >= cc.c && c < cc.c + (cc.cs || 1); })[0];
    return cell ? { r: cell.r, c: cell.c } : { r: r, c: c };
  }

  function onWheel(ev) {
    ev.preventDefault();
    var r = svg.getBoundingClientRect(), p = toPaper(ev);
    var z = App.view.z * (ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    z = Math.max(0.3, Math.min(60, z));
    App.view.z = z;
    App.view.ox = p[0] - (ev.clientX - r.left) / z;
    App.view.oy = p[1] - (ev.clientY - r.top) / z;
    render();
  }

  /* ================= 說明項目 ================= */
  function ovFeatures(ov) { ov = ov || App.P.activeOv || 'case'; return App.P.features.filter(function (f) { return (f.ov || 'case') === ov; }); }
  function ovScheme(ov) { var o = App.P.ovs[ov || App.P.activeOv] || {}; return o.codeScheme || 'alpha'; }
  function nextCodeOv() { return M.nextCode(ovFeatures(), ovScheme()); }
  function arcAdj(pts) { return App.cad ? round(G.arcCorrection(pts, App.cad.arcs), 6) : 0; }
  function faceSegs(m, pts) {
    var P = App.P, segs = [], R2 = Math.max(m.w, m.h) * m.scale / 1000, bx = G.bbox(pts);
    bx = [bx[0] - R2, bx[1] - R2, bx[2] + R2, bx[3] + R2];
    function add(x1, y1, x2, y2) { var c = G.clipSeg(x1, y1, x2, y2, bx[0], bx[1], bx[2], bx[3]); if (c) segs.push(c); }
    var roles = P.settings.faceRoles || { parcel: true, other: false }, ov = P.activeOv || 'case';
    var MI = R.mergeInfo(P, App.cad);
    R.eachPiece(P, App.cad, function (pc, role) {
      if (MI.internal[pc.key]) return;                 // 假合併的界線不當邊界
      if (role === ov || (role === 'parcel' && roles.parcel !== false) || (role === 'other' && roles.other)) add(pc.x1, pc.y1, pc.x2, pc.y2);
    }, { keepMerged: true });
    P.userLines.forEach(function (l) { if ((l.role || 'case') === ov) add(l.x1, l.y1, l.x2, l.y2); });
    return segs;
  }
  function addFaceAt(m, w, merge) {
    var P = App.P;
    // Shift+點選：併入目前選取的說明項目
    var target = merge && App.sel && (App.sel.kind === 'feature' || App.sel.kind === 'flabel') ? featById(App.sel.id) : null;
    if (target) {
      var seeds = (target.seeds || [G.labelPoint(target.pts)]).concat([w]);
      var u = G.faceUnionAt(faceSegs(m, seeds), seeds, 0.002);
      if (!u) return toast('找不到可合併的封閉區域');
      target.seeds = seeds; target.pts = u.map(function (p) { return [round(p[0], 6), round(p[1], 6)]; }); target.arcAdj = arcAdj(target.pts);
      delete target.labelAt;
      changed(); render(); refreshFeatures(); renderProps();
      return toast('已併入 ' + target.code + '：' + R.featureArea(target, 2) + ' m²');
    }
    var face = G.faceAt(faceSegs(m, [w]), w, 0.002);
    if (!face) return toast('此處找不到封閉區域（請確認線段有閉合）');
    var a = G.area(face);
    var dup = P.features.filter(function (f) { return Math.abs(G.area(f.pts) - a) < 0.005 && G.pointInPoly(w, f.pts); })[0];
    if (dup) { select({ kind: 'feature', id: dup.id, mapId: m.id }); return toast('此區域已是說明項目 ' + dup.code); }
    var f = {
      id: M.uid(), ov: P.activeOv || 'case', code: nextCodeOv(), pts: face.map(function (p) { return [round(p[0], 6), round(p[1], 6)]; }),
      landNo: P.fields.landNo || '', note: '', outline: false, dash: false, label: true, seeds: [w]
    };
    f.arcAdj = arcAdj(f.pts);
    P.features.push(f); select({ kind: 'feature', id: f.id, mapId: m.id });
    changed(); toast('新增說明項目 ' + f.code + '：' + R.featureArea(f, 2) + ' m²（Shift+點選相鄰區塊可併入）');
  }
  function finishDraw() {
    var d = App.draw; if (!d) return;
    var P = App.P;
    if (d.type === 'poly') {
      if (d.pts.length >= 3) {
        var f = { id: M.uid(), ov: P.activeOv || 'case', code: nextCodeOv(), pts: d.pts.map(function (p) { return [round(p[0], 6), round(p[1], 6)]; }), landNo: P.fields.landNo || '', note: '', outline: true, dash: false, label: true };
        f.arcAdj = arcAdj(f.pts);
        P.features.push(f); App.draw = null; select({ kind: 'feature', id: f.id, mapId: d.mapId }); changed();
        toast('新增說明項目 ' + f.code + '：' + G.area(f.pts).toFixed(2) + ' m²');
      } else { App.draw = null; toast('至少需要 3 點'); }
    } else {
      for (var i = 0; i + 1 < d.pts.length; i++) P.userLines.push({ role: d.role || 'case', x1: round(d.pts[i][0], 4), y1: round(d.pts[i][1], 4), x2: round(d.pts[i + 1][0], 4), y2: round(d.pts[i + 1][1], 4) });
      App.draw = null; changed();
    }
    App.snapPt = null; render(); refreshPanels();
  }
  /* 斷線：在點選位置把線段切成兩段，之後可分別設定線型或隱藏 */
  function breakAt(m, p) {
    var P = App.P, v = R.mapView(m), w = v.toW(p[0], p[1]), bd = tol() / v.k, best = null;
    R.eachPiece(P, App.cad, function (pc) {
      var d = G.distToSeg(w, [pc.x1, pc.y1], [pc.x2, pc.y2]);
      if (d < bd) { bd = d; best = { cad: pc }; }
    });
    P.userLines.forEach(function (l, i) {
      var d = G.distToSeg(w, [l.x1, l.y1], [l.x2, l.y2]);
      if (d < bd) { bd = d; best = { user: i }; }
    });
    if (!best) return toast('請點在線段上');
    var sp = snapWorld(m, p).w;
    function projT(l) {
      var dx = l.x2 - l.x1, dy = l.y2 - l.y1, l2 = dx * dx + dy * dy;
      return l2 ? ((sp[0] - l.x1) * dx + (sp[1] - l.y1) * dy) / l2 : 0;
    }
    if (best.user != null) {
      var ul = P.userLines[best.user], t = projT(ul);
      if (t <= 0.001 || t >= 0.999) return toast('斷點太靠近端點');
      var mx = ul.x1 + (ul.x2 - ul.x1) * t, my = ul.y1 + (ul.y2 - ul.y1) * t;
      var b = Object.assign({}, ul, { x1: mx, y1: my }); ul.x2 = mx; ul.y2 = my;
      P.userLines.splice(best.user + 1, 0, b);
      select({ kind: 'uline', idx: best.user + 1, mapId: m.id });
    } else {
      var idx = best.cad.idx, l = App.cad.lines[idx], tt = projT(l), len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      if (tt * len < 0.005 || (1 - tt) * len < 0.005) return toast('斷點太靠近端點');
      var arr = (P.splits[idx] || []).slice();
      if (arr.some(function (x) { return Math.abs(x - tt) * len < 0.005; })) return toast('這裡已經是斷點');
      var old = R.pieces(P, l, idx), oldSt = old.map(function (o) { var st = P.segStyle[o.key]; delete P.segStyle[o.key]; return st; });
      arr.push(tt); arr.sort(function (a, b) { return a - b; });
      P.splits[idx] = arr;
      var neu = R.pieces(P, l, idx), keys = [];
      neu.forEach(function (np) {
        var mt = ((np.x1 + np.x2) / 2 - l.x1) * (l.x2 - l.x1) + ((np.y1 + np.y2) / 2 - l.y1) * (l.y2 - l.y1);
        mt /= (len * len) || 1;
        old.forEach(function (o, k) {
          var t0 = ((o.x1 - l.x1) * (l.x2 - l.x1) + (o.y1 - l.y1) * (l.y2 - l.y1)) / ((len * len) || 1);
          var t1 = ((o.x2 - l.x1) * (l.x2 - l.x1) + (o.y2 - l.y1) * (l.y2 - l.y1)) / ((len * len) || 1);
          if (mt >= t0 && mt <= t1 && oldSt[k]) P.segStyle[np.key] = clone(oldSt[k]);
        });
        var a0 = (np.x1 - l.x1) * (l.x2 - l.x1) + (np.y1 - l.y1) * (l.y2 - l.y1), a1 = (np.x2 - l.x1) * (l.x2 - l.x1) + (np.y2 - l.y1) * (l.y2 - l.y1);
        if (Math.abs(a0 / (len * len) - tt) < 1e-9 || Math.abs(a1 / (len * len) - tt) < 1e-9) keys.push(np.key);
      });
      select({ kind: 'seg', idx: keys.slice(-1), mapId: m.id });
    }
    changed(); toast('已斷線，可分別設定兩段的線型');
  }
  /* 從已選線段往外找端點相接、歸屬相同的線段（同一張 DXF 分開現況/分割時好用） */
  function connectedPieces(keys) {
    var P = App.P, all = {}, node = {}, roleOf = {};
    var k = function (x, y) { return Math.round(x * 500) + ',' + Math.round(y * 500); };
    R.eachPiece(P, App.cad, function (pc, role) {
      all[pc.key] = pc; roleOf[pc.key] = role;
      [k(pc.x1, pc.y1), k(pc.x2, pc.y2)].forEach(function (q) { (node[q] = node[q] || []).push(pc.key); });
    });
    var want = {}, out = [], stack = keys.slice();
    keys.forEach(function (x) { want[roleOf[x]] = 1; });
    var seen = {}; keys.forEach(function (x) { seen[x] = 1; });
    while (stack.length) {
      var key = stack.pop(), pc = all[key]; if (!pc) continue;
      out.push(key);
      [k(pc.x1, pc.y1), k(pc.x2, pc.y2)].forEach(function (q) {
        (node[q] || []).forEach(function (o) { if (!seen[o] && want[roleOf[o]]) { seen[o] = 1; stack.push(o); } });
      });
    }
    toast('已選取 ' + out.length + ' 段相連線段');
    return out;
  }
  function windowSelect(m, r) {
    var v = R.mapView(m), a = v.toW(r.x, r.y + r.h), b = v.toW(r.x + r.w, r.y), out = [];
    R.eachPiece(App.P, App.cad, function (pc, role) {
      if (role === 'parcel' && !App.P.settings.lselParcel) return;
      if (Math.min(pc.x1, pc.x2) >= a[0] && Math.max(pc.x1, pc.x2) <= b[0] && Math.min(pc.y1, pc.y2) >= a[1] && Math.max(pc.y1, pc.y2) <= b[1]) out.push(pc.key);
    });
    if (!out.length) return toast('框內沒有線段（地籍線不列入）');
    select({ kind: 'seg', idx: out, mapId: m.id });
    toast('框選 ' + out.length + ' 段，可在右側改「歸屬」或線型');
  }
  /* 點選改歸屬：點一下＝指定為目前編輯的圖層，再點一次＝還原圖層設定；Shift＝整串相連線段 */
  function assignAt(m, p, chain, anyLine) {
    var P = App.P, v = R.mapView(m), w = v.toW(p[0], p[1]), bd = tol() / v.k, best = null, ov = P.activeOv || 'case';
    R.eachPiece(P, App.cad, function (pc, role) {
      if (role === 'parcel' && !anyLine) return;
      var d = G.distToSeg(w, [pc.x1, pc.y1], [pc.x2, pc.y2]);
      if (d < bd) { bd = d; best = { pc: pc, role: role }; }
    });
    var ul = null;
    P.userLines.forEach(function (l, i) { var d = G.distToSeg(w, [l.x1, l.y1], [l.x2, l.y2]); if (d < bd) { bd = d; ul = i; best = null; } });
    if (ul != null) { var L = P.userLines[ul]; L.role = (L.role || 'case') === ov ? (ov === 'case' ? 'split' : 'case') : ov; changed(); render(); return; }
    if (!best) return toast('請點在線段上（地籍線請按住 Alt）');
    var keys = chain ? connectedPieces([best.pc.key]) : [best.pc.key];
    var undoTo = best.role === ov;  // 已經是目前圖層 → 還原
    keys.forEach(function (k) {
      var o = P.segStyle[k] = P.segStyle[k] || {};
      if (undoTo) delete o.role; else o.role = ov;
      if (!Object.keys(o).length) delete P.segStyle[k];
    });
    changed(); render();
    toast((undoTo ? '已還原 ' : '已指定為「' + P.ovs[ov].name + '」：') + keys.length + ' 段', 1200);
  }
  function unsplit(keys) {
    var P = App.P, done = {};
    keys.forEach(function (k) {
      var idx = parseInt(k, 10); if (done[idx] || !P.splits[idx]) return; done[idx] = 1;
      var l = App.cad.lines[idx], ps = R.pieces(P, l, idx), first = P.segStyle[ps[0].key];
      ps.forEach(function (pc) { delete P.segStyle[pc.key]; });
      delete P.splits[idx];
      if (first) P.segStyle[String(idx)] = first;
    });
  }
  /* 面積配賦：最大餘數法 */
  function distributeArea(total) {
    var P = App.P, fs = P.features.filter(function (f) { return !f.hideInTable; });
    if (!(total > 0) || !fs.length) return toast('請輸入登記總面積');
    var comp = fs.map(function (f) { return G.area(f.pts) + (f.arcAdj || 0); }), sum = comp.reduce(function (a, b) { return a + b; }, 0);
    var cents = Math.round(total * 100), raw = comp.map(function (a) { return a / sum * cents; });
    var fl = raw.map(Math.floor), rest = cents - fl.reduce(function (a, b) { return a + b; }, 0);
    raw.map(function (r, i) { return [r - fl[i], i]; }).sort(function (a, b) { return b[0] - a[0]; }).slice(0, rest).forEach(function (x) { fl[x[1]]++; });
    fs.forEach(function (f, i) { f.areaOverride = (fl[i] / 100).toFixed(2); });
    changed(); render(); renderFeatTab();
    toast('已配賦：計算合計 ' + sum.toFixed(4) + ' → 登記 ' + total.toFixed(2) + '（差 ' + (total - sum).toFixed(4) + '）', 4500);
  }
  function refreshFeatures() { if (App.tab === 'feat') renderFeatTab(); }

  /* ================= 選取 / 刪除 / 排序 ================= */
  function select(s, keepCell) {
    App.sel = s;
    if (!keepCell) App.selCell = null;
    render(); renderProps();
    if (App.tab === 'feat') renderFeatTab();
  }
  function deleteSel() {
    var s = App.sel, P = App.P; if (!s) return;
    if (s.kind === 'el') { var el = elById(s.id); if (el && el.locked) return toast('元件已鎖定'); P.elements = P.elements.filter(function (e) { return e.id !== s.id; }); }
    else if (s.kind === 'feature' || s.kind === 'flabel') P.features = P.features.filter(function (f) { return f.id !== s.id; });
    else if (s.kind === 'anno') P.annos = P.annos.filter(function (a) { return a.id !== s.id; });
    else if (s.kind === 'uline') P.userLines.splice(s.idx, 1);
    else if (s.kind === 'seg') s.idx.forEach(function (k) { P.segStyle[k] = Object.assign(P.segStyle[k] || {}, { hidden: true }); });
    else if (s.kind === 'ptext') { P.textOver[s.idx] = Object.assign(P.textOver[s.idx] || {}, { hidden: true }); }
    select(null); changed(); refreshPanels();
  }
  function reorder(id, dir) {
    var els = App.P.elements, i = els.findIndex(function (e) { return e.id === id; });
    var j = dir === 'top' ? els.length - 1 : dir === 'bottom' ? 0 : i + dir;
    if (i < 0 || j < 0 || j >= els.length) return;
    var e = els.splice(i, 1)[0]; els.splice(j, 0, e); changed(); render();
  }
  function duplicateEl(id) {
    var e = elById(id); if (!e) return;
    var c = clone(e); c.id = M.uid(); c.x += 5; c.y += 5; c.name = (c.name || '') + ' 複本';
    App.P.elements.push(c); select({ kind: 'el', id: c.id }); changed();
  }

  /* ================= 表格編輯 ================= */
  function cellRange() {
    var c = App.selCell; if (!c) return null;
    return { r0: Math.min(c.r0, c.r1), r1: Math.max(c.r0, c.r1), c0: Math.min(c.c0, c.c1), c1: Math.max(c.c0, c.c1) };
  }
  function getCell(el, r, c, create) {
    var cell = el.cells.filter(function (x) { return x.r === r && x.c === c; })[0];
    if (!cell && create) { cell = { r: r, c: c, text: '', align: 'left', valign: 'middle', fs: 4.15 }; el.cells.push(cell); }
    return cell;
  }
  var TableOps = {
    insertRow: function (el, at) {
      el.rows.splice(at, 0, 8);
      el.cells.forEach(function (c) { if (c.r >= at) c.r++; else if (c.r + (c.rs || 1) > at) c.rs = (c.rs || 1) + 1; });
    },
    deleteRow: function (el, i) {
      if (el.rows.length <= 1) return;
      el.cells = el.cells.filter(function (c) { return !(c.r === i && (c.rs || 1) === 1); });
      el.cells.forEach(function (c) {
        if (c.r === i) c.rs--; else if (c.r > i) c.r--; else if (c.r + (c.rs || 1) > i) c.rs--;
      });
      el.rows.splice(i, 1);
    },
    insertCol: function (el, at) {
      el.cols.splice(at, 0, 15);
      el.cells.forEach(function (c) { if (c.c >= at) c.c++; else if (c.c + (c.cs || 1) > at) c.cs = (c.cs || 1) + 1; });
    },
    deleteCol: function (el, i) {
      if (el.cols.length <= 1) return;
      el.cells = el.cells.filter(function (c) { return !(c.c === i && (c.cs || 1) === 1); });
      el.cells.forEach(function (c) {
        if (c.c === i) c.cs--; else if (c.c > i) c.c--; else if (c.c + (c.cs || 1) > i) c.cs--;
      });
      el.cols.splice(i, 1);
    },
    merge: function (el, g) {
      // 選取範圍碰到既有合併格時自動擴大（同 Excel）
      for (var grow = true, guard = 0; grow && guard < 50; guard++) {
        grow = false;
        el.cells.forEach(function (c) {
          var cr1 = c.r + (c.rs || 1) - 1, cc1 = c.c + (c.cs || 1) - 1;
          if (cr1 < g.r0 || c.r > g.r1 || cc1 < g.c0 || c.c > g.c1) return;
          if (c.r < g.r0) { g.r0 = c.r; grow = true; } if (cr1 > g.r1) { g.r1 = cr1; grow = true; }
          if (c.c < g.c0) { g.c0 = c.c; grow = true; } if (cc1 > g.c1) { g.c1 = cc1; grow = true; }
        });
      }
      var inside = [], bad = false;
      el.cells.forEach(function (c) {
        var cr1 = c.r + (c.rs || 1) - 1, cc1 = c.c + (c.cs || 1) - 1;
        var overlap = !(cr1 < g.r0 || c.r > g.r1 || cc1 < g.c0 || c.c > g.c1);
        if (!overlap) return;
        if (c.r < g.r0 || cr1 > g.r1 || c.c < g.c0 || cc1 > g.c1) bad = true; else inside.push(c);
      });
      if (bad) return toast('選取範圍與其他合併格部分重疊，無法合併');
      var anchor = getCell(el, g.r0, g.c0, true);
      var texts = inside.filter(function (c) { return c !== anchor && c.text; }).map(function (c) { return c.text; });
      if (texts.length) anchor.text = [anchor.text].concat(texts).filter(Boolean).join('\n');
      el.cells = el.cells.filter(function (c) { return c === anchor || inside.indexOf(c) < 0; });
      anchor.rs = g.r1 - g.r0 + 1; anchor.cs = g.c1 - g.c0 + 1;
    },
    split: function (el, g) {
      var c = getCell(el, g.r0, g.c0, false); if (c) { delete c.rs; delete c.cs; }
    }
  };

  /* ================= 面板 ================= */
  function field(label, html, cls) { return '<label class="fld ' + (cls || '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function inp(k, v, type, extra) {
    return '<input data-k="' + k + '" type="' + (type || 'text') + '" value="' + R.esc(v == null ? '' : v) + '" ' + (extra || '') + '>';
  }
  function chk(k, v) { return '<input data-k="' + k + '" type="checkbox"' + (v ? ' checked' : '') + '>'; }
  function sel(k, v, opts) {
    return '<select data-k="' + k + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
  }
  function dashSel(k, v, withDefault) {
    var opts = (withDefault ? [['', '依圖層預設']] : []).concat(R.DASH_LIST);
    return sel(k, v == null ? (withDefault ? '' : 'solid') : (v === true ? 'dash' : v === false ? (withDefault ? '' : 'solid') : v), opts);
  }
  function arrowSel(k, v) { return sel(k, v || '', [['', '無'], ['end', '終點箭頭 →'], ['start', '起點箭頭 ←'], ['both', '兩端箭頭 ↔']]); }
  function color(k, v) { return '<input data-k="' + k + '" type="color" value="' + (v || '#000000') + '">'; }
  function ta(k, v, rows) { return '<textarea data-k="' + k + '" rows="' + (rows || 3) + '">' + R.esc(v == null ? '' : v) + '</textarea>'; }
  function btn(act, label, cls) { return '<button data-act="' + act + '" class="' + (cls || '') + '">' + label + '</button>'; }

  /* 通用綁定：data-k 對應 target[k]（支援 a.b） */
  function bind(container, target, after) {
    $$('[data-k]', container).forEach(function (inpEl) {
      var evName = (inpEl.type === 'checkbox' || inpEl.tagName === 'SELECT' || inpEl.type === 'color') ? 'change' : 'input';
      inpEl.addEventListener(evName, function () {
        var path = inpEl.dataset.k.split('.'), o = typeof target === 'function' ? target() : target;
        for (var i = 0; i < path.length - 1; i++) o = o[path[i]] = o[path[i]] || {};
        var key = path[path.length - 1], v;
        if (inpEl.type === 'checkbox') v = inpEl.checked;
        else if (inpEl.type === 'number') { v = inpEl.value === '' ? null : parseFloat(inpEl.value); if (v !== null && isNaN(v)) return; }
        else v = inpEl.value;
        if (inpEl.dataset.num === '1' && v !== '' && v != null) { var nv = parseFloat(v); if (!isNaN(nv)) v = nv; }
        o[key] = v;
        if (after) after(key, v, inpEl);
        render(); changed();
      });
    });
  }

  function renderProps() {
    var box = $('#props'), s = App.sel, P = App.P, h = '';
    if (!s) {
      box.innerHTML = '<div class="hint"><b>操作提示</b><ul>' +
        '<li>點選元件可移動、拖拉控制點縮放；拖曳時會自動對齊其他元件邊緣（按住 Alt 取消對齊）。</li>' +
        '<li>表格：選取後拖拉內部格線可調整欄寬/列高（Shift = 只改單邊，表格跟著變大）。點格子可編輯內容，Shift+點選多格可合併。</li>' +
        '<li>略圖框：工具列「移動圖面(H)」拖曳框內即可改變裁切位置；拖拉框的控制點即改變裁切大小。</li>' +
        '<li>「點選成面(F)」：在略圖內點一下，自動由案件線與地籍線找出封閉範圍並計算面積。</li>' +
        '<li>滑鼠滾輪縮放；按住空白鍵或滑鼠中鍵拖曳平移畫面。</li>' +
        '<li>Ctrl+Z 復原、Ctrl+Y 重做、Ctrl+S 儲存、Delete 刪除、方向鍵微調 (Shift ×10)。</li></ul></div>';
      return;
    }
    if (s.kind === 'el') {
      var el = elById(s.id); if (!el) { box.innerHTML = ''; return; }
      var TYPE = { text: '文字', rect: '矩形框', line: '線', table: '表格', ftable: '說明表', north: '指北針', map: '略圖框' };
      h += '<div class="ptitle">' + TYPE[el.type] + '<small>' + R.esc(el.name || '') + '</small></div>';
      h += field('名稱', inp('name', el.name));
      var isTbl = el.type === 'table' || el.type === 'ftable';
      h += '<div class="grid2">' + field('X (mm)', inp('x', el.x, 'number', 'step="0.1"')) + field('Y (mm)', inp('y', el.y, 'number', 'step="0.1"'));
      if (!isTbl) h += field(el.type === 'line' ? 'ΔX' : '寬 (mm)', inp('w', el.w, 'number', 'step="0.1"')) + field(el.type === 'line' ? 'ΔY' : '高 (mm)', inp('h', el.h, 'number', 'step="0.1"'));
      h += '</div>';
      if (el.type === 'text') {
        h += field('內容（可用 {欄位}，如 {landNo}、{scale}）', ta('text', el.text, 3));
        h += '<div class="grid2">' + field('字高 (mm)', inp('fs', el.fs, 'number', 'step="0.1"')) + field('字距 (mm)', inp('ls', el.ls || 0, 'number', 'step="0.1"')) +
          field('字型', sel('font', el.font || 'kai', [['kai', '標楷體'], ['sans', '黑體/Arial']])) + field('顏色', color('color', el.color || '#000000')) +
          field('水平', sel('align', el.align, [['left', '靠左'], ['center', '置中'], ['right', '靠右']])) + field('垂直', sel('valign', el.valign, [['top', '靠上'], ['middle', '置中'], ['bottom', '靠下']])) +
          field('排版', sel('fit', el.fit || '', [['', '自動換行'], ['shrink', '縮小以符合']])) + field('框線', chk('border', el.border)) + '</div>';
      }
      if (el.type === 'rect' || el.type === 'line') {
        h += '<div class="grid2">' + field('線寬 (mm)', inp('lw', el.lw || 0.24, 'number', 'step="0.01"')) + field('顏色', color('color', el.color || '#000000')) +
          field('線型', dashSel('dash', el.dash)) + (el.type === 'line' ? field('箭頭', arrowSel('arrow', el.arrow)) : '') + '</div>';
      }
      if (el.type === 'north') h += field('文字', inp('label', el.label || '北'));
      if (el.type === 'map') h += mapProps(el);
      if (el.type === 'table' || el.type === 'ftable') h += '<div class="btnrow">' + (App.tableEdit === el.id ? btn('tedit', '結束表格編輯 (Esc)', 'primary') : btn('tedit', '編輯表格（或雙擊表格）')) + '</div>';
      if (el.type === 'table') h += tableProps(el);
      if (el.type === 'ftable') h += ftableProps(el);
      h += '<div class="btnrow">' + btn('front', '移到最上層') + btn('back', '移到最下層') + btn('dup', '複製') + '</div>';
      h += '<div class="btnrow">' + '<label class="inline">' + chk('locked', el.locked) + ' 鎖定</label>' + btn('del', '刪除', 'danger') + '</div>';
      box.innerHTML = h;
      bind(box, el, function (k) { if (k === 'name') renderLayerList(); if (k === 'locked') render(); });
      bindTableCellEditor(box, el);
      box.onclick = function (ev) {
        var a = ev.target.closest('[data-act]'); if (!a) return;
        var act = a.dataset.act;
        if (act === 'front') reorder(el.id, 'top'); else if (act === 'back') reorder(el.id, 'bottom');
        else if (act === 'dup') duplicateEl(el.id); else if (act === 'del') deleteSel();
        else if (act === 'tedit') setTableEdit(App.tableEdit === el.id ? null : el.id);
        else elAction(el, act, a);
      };
      return;
    }
    if (s.kind === 'feature' || s.kind === 'flabel') {
      var f = featById(s.id); if (!f) { box.innerHTML = ''; return; }
      h += '<div class="ptitle">說明項目 ' + R.esc(f.code) + '<small>計算面積 ' + (G.area(f.pts) + (f.arcAdj || 0)).toFixed(4) + ' m²</small></div>';
      h += '<div class="grid2">' + field('編號', inp('code', f.code)) + field('使用地號', inp('landNo', f.landNo)) + '</div>';
      h += field('備註（如門牌、倉庫）', inp('note', f.note));
      h += '<div class="grid2">' + field('所有權人', inp('owner', f.owner)) + field('其他（自訂欄）', inp('extra', f.extra)) + '</div>';
      h += field('面積（空白＝自動計算）', inp('areaOverride', f.areaOverride == null ? '' : f.areaOverride, 'text', 'placeholder="' + G.area(f.pts).toFixed(2) + '"'));
      h += '<div class="grid2">' + field('顯示外框', chk('outline', f.outline)) + field('外框線型', dashSel('dash', f.dash)) +
        field('外框線寬', inp('lw', f.lw || P.styles.caseLine.width, 'number', 'step="0.01"')) + field('外框顏色', color('color', f.color || P.styles.caseLine.color)) +
        field('填色', '<span class="row">' + chk('fillOn', !!f.fill) + color('fillColor', f.fill || '#ffcccc') + '</span>') +
        field('顯示編號', chk('label', f.label !== false)) + field('編號字高', inp('labelSize', f.labelSize || P.styles.featureLabel.size, 'number', 'step="0.1"')) +
        field('編號引線（小區塊用）', chk('leader', f.leader)) +
        field('不列入說明表', chk('hideInTable', f.hideInTable)) + '</div>';
      h += '<div class="btnrow">' + btn('resetLabel', '編號位置重設') + btn('del', '刪除', 'danger') + '</div>';
      h += '<p class="small">拖曳藍色頂點可修改形狀（會自動鎖點）。用「點選成面」時按住 Shift 點相鄰區塊，可併入此說明項目。' + (f.arcAdj ? '（含圓弧修正 ' + f.arcAdj.toFixed(4) + ' m²）' : '') + '</p>';
      box.innerHTML = h;
      bind(box, f, function (k, v) {
        if (k === 'areaOverride' && v === '') f.areaOverride = null;
        if (k === 'fillOn') { f.fill = v ? ($('[data-k=fillColor]', box).value) : ''; delete f.fillOn; }
        if (k === 'fillColor') { delete f.fillColor; if ($('[data-k=fillOn]', box).checked) f.fill = v; }
        renderFeatTab();
      });
      box.onclick = function (ev) {
        var a = ev.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'resetLabel') { delete f.labelAt; render(); changed(); }
        if (a.dataset.act === 'del') deleteSel();
      };
      return;
    }
    if (s.kind === 'seg' || s.kind === 'uline') {
      var isU = s.kind === 'uline', ul = isU ? P.userLines[s.idx] : null;
      var first = isU ? ul : (P.segStyle[s.idx[0]] || {});
      var lay = isU ? '自繪線' : App.cad.lines[parseInt(s.idx[0], 10)].layer;
      var anySplit = !isU && s.idx.some(function (k) { return P.splits[parseInt(k, 10)]; });
      h += '<div class="ptitle">線段<small>' + R.esc(lay) + (isU ? '' : '　已選 ' + s.idx.length + ' 段（Shift+點選可多選）') + '</small></div>';
      h += '<div class="grid2">' + field('線型', dashSel('dash', first.dash, true)) + field('線寬 (mm)', inp('lw', first.lw || '', 'number', 'step="0.01" placeholder="依圖層"')) +
        field('顏色', color('color', first.color || R.lineStyle(P, isU ? (ul.role || 'case') : R.roleOf(P, lay, 'line'), null).color));
      if (isU) h += field('歸屬', sel('role', ul.role || 'case', [['case', '現況'], ['split', '分割'], ['other', '其他線']])) + field('箭頭', arrowSel('arrow', ul.arrow));
      else h += field('歸屬（同一張 DXF 混在一起時用）', sel('role', first.role || '', [['', '依圖層設定'], ['case', '現況'], ['split', '分割'], ['parcel', '地籍線'], ['other', '其他線']]));
      h += '</div>';
      h += '<div class="btnrow"><span class="small">快速：</span>' + [['#ff0000', '紅'], ['#0050ff', '藍'], ['#000000', '黑']].map(function (c) { return '<button data-qc="' + c[0] + '" style="color:' + c[0] + '">' + c[1] + '</button>'; }).join('') +
        '<button data-qd="solid">實線</button><button data-qd="dash">虛線</button></div>';
      if (!isU) h += '<div class="btnrow"><span class="small">歸屬：</span><button data-qr="case">→ 現況 (1)</button><button data-qr="split">→ 分割 (2)</button><button data-qr="">依圖層</button></div>';
      h += '<div class="btnrow">' + btn('del', isU ? '刪除' : '隱藏此段', 'danger') + (!isU ? btn('clr', '恢復圖層樣式') : '') + (anySplit ? btn('unsplit', '取消斷線') : '') + (!isU ? btn('conn', '選取相連線段') : '') + '</div>';
      h += '<p class="small">要讓同一條線一半實線、一半虛線：用工具列「斷線(B)」在線上點一下切成兩段，再分別設定。</p>';
      box.innerHTML = h;
      bind(box, function () { return {}; }, function (k, v) {
        if ((k === 'dash' || k === 'role') && v === '') v = null;
        if (k === 'role') setTimeout(function () { renderProps(); if (App.tab === 'layer') renderLayerTab(); }, 0);
        if (k === 'lw' && !v) v = null;
        if (isU) { if (v == null) delete ul[k]; else ul[k] = v; }
        else s.idx.forEach(function (key) { var o = P.segStyle[key] = P.segStyle[key] || {}; if (v == null) delete o[k]; else o[k] = v; });
      });
      box.onclick = function (ev) {
        var qr = ev.target.closest('[data-qr]');
        if (qr) {
          s.idx.forEach(function (key) { var o = P.segStyle[key] = P.segStyle[key] || {}; if (qr.dataset.qr) o.role = qr.dataset.qr; else delete o.role; });
          render(); changed(); renderProps(); return;
        }
        var q = ev.target.closest('[data-qc],[data-qd]');
        if (q) {
          var k = q.dataset.qc ? 'color' : 'dash', v = q.dataset.qc || q.dataset.qd;
          if (isU) ul[k] = v; else s.idx.forEach(function (key) { (P.segStyle[key] = P.segStyle[key] || {})[k] = v; });
          render(); changed(); renderProps(); return;
        }
        var a = ev.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'del') deleteSel();
        if (a.dataset.act === 'clr') { s.idx.forEach(function (k) { delete P.segStyle[k]; }); render(); changed(); renderProps(); }
        if (a.dataset.act === 'unsplit') { unsplit(s.idx); select(null); changed(); }
        if (a.dataset.act === 'conn') { select({ kind: 'seg', idx: connectedPieces(s.idx), mapId: s.mapId }); }
      };
      return;
    }
    if (s.kind === 'ptext') {
      var t = App.cad.texts[s.idx], ov = P.textOver[s.idx] || {};
      h += '<div class="ptitle">地號文字 ' + R.esc(t.text) + '<small>圖層 ' + R.esc(t.layer) + '</small></div>';
      h += '<div class="grid2">' + field('字高 (mm)', inp('size', ov.size || '', 'number', 'step="0.1" placeholder="預設"')) + field('顏色', color('color', ov.color || '#000000')) + '</div>';
      h += '<div class="btnrow">' + btn('reset', '恢復原位置/樣式') + btn('del', '隱藏', 'danger') + '</div>';
      box.innerHTML = h;
      bind(box, function () { return (P.textOver[s.idx] = P.textOver[s.idx] || {}); });
      box.onclick = function (ev) {
        var a = ev.target.closest('[data-act]'); if (!a) return;
        if (a.dataset.act === 'reset') { delete P.textOver[s.idx]; render(); changed(); renderProps(); }
        if (a.dataset.act === 'del') deleteSel();
      };
      return;
    }
    if (s.kind === 'anno') {
      var an = P.annos.filter(function (x) { return x.id === s.id; })[0]; if (!an) return;
      h += '<div class="ptitle">圖面註記</div>';
      h += field('文字', ta('text', an.text, 2));
      h += '<div class="grid2">' + field('字高 (mm)', inp('size', an.size || P.styles.anno.size, 'number', 'step="0.1"')) + field('旋轉 (度)', inp('rot', an.rot || 0, 'number', 'step="1"')) +
        field('字型', sel('font', an.font || 'kai', [['kai', '標楷體'], ['sans', '黑體/Arial']])) + field('顏色', color('color', an.color || '#000000')) + '</div>';
      h += '<div class="btnrow">' + btn('del', '刪除', 'danger') + '</div>';
      box.innerHTML = h; bind(box, an);
      box.onclick = function (ev) { var a = ev.target.closest('[data-act]'); if (a && a.dataset.act === 'del') deleteSel(); };
    }
  }

  function mapProps(el) {
    var presets = [100, 200, 250, 300, 500, 600, 1000, 1200, 2000, 2500, 3000, 5000];
    var h = '<div class="sec">比例尺與裁切</div>';
    h += '<div class="grid2">' + field('比例尺 1/', inp('scale', el.scale, 'number', 'step="1" min="1" list="scaleList"')) +
      field('常用', sel('_preset', '', [['', '選擇…']].concat(presets.map(function (p) { return [p, '1/' + p]; })))) + '</div>';
    h += '<datalist id="scaleList">' + presets.map(function (p) { return '<option value="' + p + '">'; }).join('') + '</datalist>';
    var k = 1000 / el.scale;
    h += '<div class="grid2">' + field('裁切寬 (cm)', '<input data-geo="w" type="number" step="0.1" value="' + round(el.w / 10, 2) + '">') +
      field('裁切高 (cm)', '<input data-geo="h" type="number" step="0.1" value="' + round(el.h / 10, 2) + '">') + '</div>';
    h += '<p class="small">實地範圍：' + round(el.w / k, 2) + ' × ' + round(el.h / k, 2) + ' 公尺</p>';
    h += '<div class="grid2">' + field('中心 E (TWD97)', inp('cx', el.cx, 'number', 'step="0.001"')) + field('中心 N (TWD97)', inp('cy', el.cy, 'number', 'step="0.001"')) + '</div>';
    h += '<div class="btnrow">' + btn('centerCase', '置中：案件線') + btn('centerTarget', '置中：本案地號') + btn('centerFeat', '置中：說明項目') + '</div>';
    var TSc = R.textScales(el);
    h += '<div class="sec">文字大小倍率（此略圖框）</div><div class="grid3">' +
      field('編號', '<input data-k="tsFeat" type="number" step="0.05" min="0.1" value="' + TSc.feat + '">') +
      field('本案地號', '<input data-k="tsTarget" type="number" step="0.05" min="0.1" value="' + TSc.target + '">') +
      field('非本案地號', '<input data-k="tsParcel" type="number" step="0.05" min="0.1" value="' + TSc.parcel + '">') + '</div>';
    h += '<div class="grid2">' + field('外框', chk('border', el.border !== false)) + field('框下顯示比例尺', chk('scaleLabel', el.scaleLabel)) + field('外框線寬', inp('lw', el.lw || 0.18, 'number', 'step="0.01"')) + field('白底（遮住下層）', chk('bg', el.bg !== false)) + '</div>';
    h += '<div class="btnrow">' + btn('exportDxf', '匯出裁切 DXF', 'primary') + '</div>';
    return h;
  }
  function tableProps(el) {
    var h = '<div class="sec">表格</div>';
    h += '<div class="grid2">' + field('框線寬 (mm)', inp('lw', el.lw == null ? 0.24 : el.lw, 'number', 'step="0.01"')) + '</div>';
    h += '<div class="small">欄寬 (mm)：</div><div class="sizes">' + el.cols.map(function (c, i) { return '<input data-size="col" data-i="' + i + '" type="number" step="0.1" value="' + c + '">'; }).join('') + '</div>';
    h += '<div class="small">列高 (mm)：</div><div class="sizes">' + el.rows.map(function (r, i) { return '<input data-size="row" data-i="' + i + '" type="number" step="0.1" value="' + r + '">'; }).join('') + '</div>';
    var g = cellRange();
    h += '<div class="sec">儲存格' + (g ? '（第 ' + (g.r0 + 1) + ' 列，第 ' + (g.c0 + 1) + ' 欄' + (g.r1 > g.r0 || g.c1 > g.c0 ? ' ～ 第 ' + (g.r1 + 1) + ' 列，第 ' + (g.c1 + 1) + ' 欄' : '') + '）' : '') + '</div>';
    if (!g) return h + '<p class="small">在表格上點一下格子即可編輯；Shift+點選可選取多格。</p>';
    var c = getCell(el, g.r0, g.c0, false) || { text: '', align: 'left', valign: 'middle', fs: 4.15 };
    h += '<div class="cellEd">' + field('內容（可用 {欄位}）', '<textarea data-cell="text" rows="3">' + R.esc(c.text || '') + '</textarea>');
    h += '<div class="grid2">' + field('字高 (mm)', '<input data-cell="fs" type="number" step="0.05" value="' + (c.fs || 4.15) + '">') +
      field('字型', '<select data-cell="font">' + [['kai', '標楷體'], ['sans', '黑體/Arial']].map(function (o) { return '<option value="' + o[0] + '"' + ((c.font || 'kai') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      field('水平', '<select data-cell="align">' + [['left', '靠左'], ['center', '置中'], ['right', '靠右']].map(function (o) { return '<option value="' + o[0] + '"' + ((c.align || 'left') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      field('垂直', '<select data-cell="valign">' + [['top', '靠上'], ['middle', '置中'], ['bottom', '靠下']].map(function (o) { return '<option value="' + o[0] + '"' + ((c.valign || 'middle') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      field('排版', '<select data-cell="fit">' + [['', '自動換行'], ['shrink', '縮小以符合']].map(function (o) { return '<option value="' + o[0] + '"' + ((c.fit || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
      field('不畫框線', '<input data-cell="noBorder" type="checkbox"' + (c.noBorder ? ' checked' : '') + '>') + '</div></div>';
    h += '<div class="btnrow">' + btn('rowAbove', '上方插入列') + btn('rowBelow', '下方插入列') + btn('rowDel', '刪除列') + '</div>';
    h += '<div class="btnrow">' + btn('colLeft', '左側插入欄') + btn('colRight', '右側插入欄') + btn('colDel', '刪除欄') + '</div>';
    h += '<div class="btnrow">' + btn('merge', '合併儲存格') + btn('split', '取消合併') + '</div>';
    return h;
  }
  var FT_KEYS = [['code', '編號／名稱'], ['area', '面積'], ['landNo', '地號'], ['note', '備註'], ['owner', '所有權人'], ['extra', '其他(自訂)']];
  function ftableProps(el) {
    var h = '<div class="sec">說明表</div>';
    h += field('標題（列高 0 = 不顯示標題列）', inp('title', el.title));
    h += '<div class="grid2">' + field('列出哪一層', sel('ov', el.ov || '', [['', '全部']].concat(Object.keys(App.P.ovs).map(function (k) { return [k, App.P.ovs[k].name]; })))) +
      field('只列此地號（空白＝全部）', inp('landFilter', el.landFilter || '')) + '</div>';
    h += '<div class="grid2">' + field('標題列高', inp('titleH', el.titleH, 'number', 'step="0.1" min="0"')) + field('標題字高', inp('titleFs', el.titleFs, 'number', 'step="0.05"')) +
      field('表頭列高（0=不顯示）', inp('headerH', el.headerH, 'number', 'step="0.1" min="0"')) + field('表頭字高', inp('headerFs', el.headerFs, 'number', 'step="0.05"')) +
      field('資料列高(預設)', inp('rowH', el.rowH, 'number', 'step="0.1"')) + field('內容字高', inp('dataFs', el.dataFs, 'number', 'step="0.05"')) +
      field('附註列高（0=不顯示）', inp('notesH', el.notesH, 'number', 'step="0.1" min="0"')) + field('附註字高', inp('notesFs', el.notesFs, 'number', 'step="0.05"')) +
      field('面積小數位', inp('decimals', el.decimals, 'number', 'step="1" min="0" max="4"')) + field('框線寬', inp('lw', el.lw == null ? 0.24 : el.lw, 'number', 'step="0.01"')) + '</div>';
    h += '<label class="inline">' + chk('autoRowH', el.autoRowH) + ' 資料列高自動配合文字（文字多時自動換行、列變高；不勾＝字縮小塞進固定列高）</label>';
    h += '<div class="sec">欄位（可增減、調整順序）</div><table class="flist cols"><thead><tr><th>內容</th><th>表頭文字（\\n 換行）</th><th>寬</th><th>字高</th><th></th></tr></thead><tbody>';
    el.columns.forEach(function (c, i) {
      h += '<tr data-ci="' + i + '"><td><select data-col="key">' + FT_KEYS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === c.key ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td>' +
        '<td><input data-col="header" value="' + R.esc((c.header || '').replace(/\n/g, '\\n')) + '"></td>' +
        '<td><input data-col="w" type="number" step="0.1" value="' + el.cols[i] + '"></td>' +
        '<td><input data-col="fs" type="number" step="0.05" placeholder="' + el.dataFs + '" value="' + (c.fs || '') + '"></td>' +
        '<td class="ops"><button data-cop="up">↑</button><button data-cop="down">↓</button><button data-cop="del">✕</button></td></tr>';
    });
    h += '</tbody></table><div class="btnrow">' + btn('colAdd', '新增欄位') + btn('rowsUniform', '資料列高全部一致') + '</div>';
    h += '<div class="btnrow">' + btn('preset4', '樣式：編號/面積/地號/備註') + btn('preset3', '名稱/面積/地號') + btn('preset2', '編號/坐落面積') + btn('presetOwner', '編號/面積/所有權人') + '</div>';
    h += field('附註文字', ta('notes', el.notes, 3));
    h += '<p class="small">內容由左側「說明」頁的清單自動產生，修改說明項目資料即同步更新。</p>';
    return h;
  }
  function bindTableCellEditor(box, el) {
    $$('[data-size]', box).forEach(function (i) {
      i.addEventListener('input', function () {
        var v = parseFloat(i.value); if (!(v > 0)) return;
        if (i.dataset.size === 'col') el.cols[+i.dataset.i] = v; else el.rows[+i.dataset.i] = v;
        render(); changed();
      });
    });
    $$('[data-col]', box).forEach(function (i) {
      i.addEventListener(i.tagName === 'SELECT' ? 'change' : 'input', function () {
        var ci = +i.closest('tr').dataset.ci, k = i.dataset.col, c = el.columns[ci];
        if (k === 'w') { var v = parseFloat(i.value); if (v > 0) el.cols[ci] = v; }
        else if (k === 'fs') { var f = parseFloat(i.value); if (f > 0) c.fs = f; else delete c.fs; }
        else if (k === 'header') c.header = i.value.replace(/\\n/g, '\n');
        else c[k] = i.value;
        render(); changed();
      });
    });
    $$('[data-cop]', box).forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var ci = +b.closest('tr').dataset.ci, op = b.dataset.cop, j = op === 'up' ? ci - 1 : ci + 1;
        if (op === 'del') { if (el.columns.length <= 1) return; el.columns.splice(ci, 1); el.cols.splice(ci, 1); }
        else if (j >= 0 && j < el.columns.length) {
          el.columns.splice(j, 0, el.columns.splice(ci, 1)[0]); el.cols.splice(j, 0, el.cols.splice(ci, 1)[0]);
        }
        render(); changed(); renderProps();
      });
    });
    $$('[data-geo]', box).forEach(function (i) {
      i.addEventListener('change', function () {
        var v = parseFloat(i.value) * 10; if (!(v > 0)) return;
        el[i.dataset.geo] = round(v, 2); render(); changed(); renderProps();
      });
    });
    var pre = $('[data-k=_preset]', box);
    if (pre) pre.addEventListener('change', function () { delete el._preset; if (pre.value) { el.scale = +pre.value; render(); changed(); renderProps(); } });
    $$('[data-cell]', box).forEach(function (i) {
      var ev = (i.tagName === 'SELECT' || i.type === 'checkbox') ? 'change' : 'input';
      i.addEventListener(ev, function () {
        var g = cellRange(); if (!g) return;
        var c = getCell(el, g.r0, g.c0, true), k = i.dataset.cell;
        c[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? parseFloat(i.value) : i.value;
        render(); changed();
      });
    });
  }
  function elAction(el, act) {
    var g = cellRange();
    if (el.type === 'table' && g) {
      if (act === 'rowAbove') TableOps.insertRow(el, g.r0);
      else if (act === 'rowBelow') TableOps.insertRow(el, g.r1 + 1);
      else if (act === 'rowDel') { TableOps.deleteRow(el, g.r0); App.selCell = null; }
      else if (act === 'colLeft') TableOps.insertCol(el, g.c0);
      else if (act === 'colRight') TableOps.insertCol(el, g.c1 + 1);
      else if (act === 'colDel') { TableOps.deleteCol(el, g.c0); App.selCell = null; }
      else if (act === 'merge') { TableOps.merge(el, g); App.selCell = { r0: g.r0, c0: g.c0, r1: g.r0, c1: g.c0 }; }
      else if (act === 'split') TableOps.split(el, g);
    }
    if (el.type === 'ftable') {
      if (act === 'rowsUniform') el.rowHs = {};
      if (act === 'colAdd') { el.columns.push({ key: 'note', header: '備註' }); el.cols.push(18); }
      var PRESET = {
        preset4: [[{ key: 'code', header: '編號：' }, { key: 'area', header: '面積\n(平方公尺)' }, { key: 'landNo', header: '使用地號：' }, { key: 'note', header: '備註', fs: 3.94 }], [19, 19, 20, 19.9]],
        preset3: [[{ key: 'code', header: '名稱' }, { key: 'area', header: '面積\n( 平方公尺 )' }, { key: 'landNo', header: '地號' }], [20, 33, 23]],
        preset2: [[{ key: 'code', header: '編號' }, { key: 'area', header: '坐落面積\n( 平方公尺 )' }], [20, 33]],
        presetOwner: [[{ key: 'code', header: '編號：' }, { key: 'area', header: '面積\n(平方公尺)', fs: 4.5 }, { key: 'owner', header: '所有權人', fs: 4.5 }], [17, 17, 35]]
      }[act];
      if (PRESET) {
        el.columns = clone(PRESET[0]); el.cols = PRESET[1].slice();
        if (act === 'preset3' || act === 'preset2') { el.titleH = 0; el.notesH = 0; }
        if (act === 'presetOwner') { el.title = '{landNo}地號分割方案說明：'; el.titleH = el.titleH || 13.3; el.notes = '一、為方便計算，本案已先將{landNo}地號進行合併後展示。\n二、面積計算至平方公分，以平方公尺為單位。'; el.notesH = Math.max(el.notesH, 8.5); }
      }
    }
    if (el.type === 'map') {
      if (act === 'centerCase') centerMap(el, 'case') || toast('沒有案件線');
      if (act === 'centerTarget') centerMap(el, 'target') || toast('找不到本案地號（請在「圖層」設定哪一層為本案地號）');
      if (act === 'centerFeat') centerMap(el, 'features') || toast('尚無說明項目');
      if (act === 'exportDxf') {
        if (el.cx == null) return toast('尚未匯入圖資');
        download((App.P.fields.landNo || 'map') + 'f.dxf', Printer.croppedDXF(App.P, App.cad, el), 'application/dxf');
        return;
      }
    }
    render(); changed(); renderProps();
  }
  function updateGeomFields() {
    if (!App.sel || App.sel.kind !== 'el') return;
    var el = elById(App.sel.id), box = $('#props');
    ['x', 'y', 'w', 'h', 'cx', 'cy'].forEach(function (k) { var i = $('[data-k=' + k + ']', box); if (i && document.activeElement !== i) i.value = el[k]; });
  }

  /* ---------- 左側分頁 ---------- */
  function switchTab(t) {
    App.tab = t;
    $$('.tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
    $$('.tabpane').forEach(function (p) { p.hidden = p.id !== 'tab-' + t; });
    if (t === 'case') renderCaseTab(); if (t === 'feat') renderFeatTab(); if (t === 'layer') renderLayerTab(); if (t === 'out') renderOutTab();
    render();
  }
  function renderCaseTab() {
    var box = $('#tab-case'), F = App.P.fields, h = '';
    h += field('專案名稱（存檔檔名）', inp('caseName', F.caseName || '', 'text', 'placeholder="例：1151110城北486法"'));
    var shortBuf = [];
    function flushShort() { if (shortBuf.length) { h += '<div class="grid3">' + shortBuf.join('') + '</div>'; shortBuf = []; } }
    M.FIELDS.forEach(function (f) {
      if (f.group) { flushShort(); h += '<div class="sec">' + f.group + '</div>'; return; }
      var html = f.multi ? ta(f.key, F[f.key], 3) : inp(f.key, F[f.key]);
      if (f.short) shortBuf.push(field(f.label, html)); else { flushShort(); h += field(f.label + ' <code>{' + f.key + '}</code>', html); }
    });
    flushShort();
    h += '<div class="btnrow">' + btn('today', '核定日期填今天') + '</div>';
    box.innerHTML = h;
    bind(box, F);
    box.onclick = function (ev) {
      var a = ev.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'today') {
        var d = new Date(); F.apY = String(d.getFullYear() - 1911); F.apM = String(d.getMonth() + 1); F.apD = String(d.getDate());
        renderCaseTab(); render(); changed();
      }
    };
  }
  function renderFeatTab() {
    var box = $('#tab-feat'), P = App.P, h = '', ov = P.activeOv || 'case', OV = P.ovs[ov];
    // 圖層（現況 / 分割）切換：兩者互不影響，只是疊在一起展示
    h += '<div class="ovbar">' + Object.keys(P.ovs).map(function (k) {
      var o = P.ovs[k], n = P.features.filter(function (f) { return (f.ov || 'case') === k; }).length;
      return '<button data-ov="' + k + '" class="' + (k === ov ? 'on' : '') + '">' + R.esc(o.name) + '（' + n + '）</button>' +
        '<label class="inline small" title="顯示/隱藏此圖層"><input type="checkbox" data-ovvis="' + k + '"' + (o.visible !== false ? ' checked' : '') + '>顯示</label>';
    }).join('') + '</div>';
    h += '<p class="small">目前編輯「' + R.esc(OV.name) + '」：點選成面只用地籍線＋' + R.esc(OV.name) + '線當邊界，編號也獨立計算。</p>';
    h += '<div class="btnrow">' + btn('toolFace', '點選成面 (F)', 'primary') + btn('toolPoly', '手繪多邊形 (P)') + '</div>';
    var LC = P.settings.flistCols || ['landNo', 'note'], LN = { landNo: '地號', note: '備註', owner: '所有權人', extra: '其他' };
    h += '<table class="flist"><thead><tr><th>編號</th><th>面積 m²</th><th>' + LN[LC[0]] + '</th><th>' + LN[LC[1]] + '</th><th></th></tr></thead><tbody>';
    var total = 0, list = ovFeatures(ov);
    list.forEach(function (f) {
      var a = parseFloat(R.featureArea(f, 2)) || 0; total += a;
      var on = App.sel && App.sel.id === f.id ? ' class="on"' : '';
      var calc = (G.area(f.pts) + (f.arcAdj || 0)).toFixed(2);
      h += '<tr data-fid="' + f.id + '"' + on + '><td><input data-f="code" value="' + R.esc(f.code) + '"></td>' +
        '<td><input data-f="areaOverride" class="num" placeholder="' + calc + '" value="' + R.esc(f.areaOverride == null ? '' : f.areaOverride) + '" title="空白＝系統計算值 ' + calc + '；可直接輸入內網計算系統的面積"></td>' +
        '<td><input data-f="' + LC[0] + '" value="' + R.esc(f[LC[0]] || '') + '"></td><td><input data-f="' + LC[1] + '" value="' + R.esc(f[LC[1]] || '') + '"></td>' +
        '<td class="ops"><button data-fop="up" title="上移">↑</button><button data-fop="down" title="下移">↓</button><button data-fop="del" title="刪除">✕</button></td></tr>';
    });
    h += '</tbody></table>';
    h += '<p class="small">面積欄空白＝系統計算值（灰字），也可以直接填入內網計算系統的面積。合計 ' + total.toFixed(2) + ' m²（' + list.length + ' 筆）。清單欄位：' +
      '<select id="flc0">' + Object.keys(LN).map(function (k) { return '<option value="' + k + '"' + (k === LC[0] ? ' selected' : '') + '>' + LN[k] + '</option>'; }).join('') + '</select>' +
      '<select id="flc1">' + Object.keys(LN).map(function (k) { return '<option value="' + k + '"' + (k === LC[1] ? ' selected' : '') + '>' + LN[k] + '</option>'; }).join('') + '</select></p>';
    h += '<div class="btnrow"><span class="small">編號方式</span>' + sel('_scheme', OV.codeScheme || 'alpha', [['alpha', 'A、B、C…'], ['stem', '甲、乙、丙…'], ['num', '1、2、3…']]) + '</div>';
    h += '<div class="btnrow">' + btn('recode', '依序重新編號') + btn('sortCode', '依編號排序') + '</div>';
    var FR = P.settings.faceRoles || { parcel: true, other: false };
    h += '<div class="sec">點選成面設定</div><div class="btnrow">' +
      '<label class="inline"><input type="checkbox" data-fr="parcel"' + (FR.parcel !== false ? ' checked' : '') + '>地籍線當邊界</label>' +
      '<label class="inline"><input type="checkbox" data-fr="other"' + (FR.other ? ' checked' : '') + '>其他線當邊界</label></div>' +
      '<p class="small">Shift+點選：把相鄰區塊併入目前選取的說明項目。假合併的界線（打 X 的線）不會當邊界。</p>';
    h += '<details><summary class="small">面積配賦（選用）</summary><div class="btnrow"><span class="small">登記總面積</span><input id="regArea" type="number" step="0.01" style="width:110px" value="' + (P.settings.regArea || '') + '">' +
      btn('distribute', '配賦尾差') + btn('undistribute', '清除面積') + '</div></details>';
    box.innerHTML = h;
    $$('[data-fr]', box).forEach(function (c) { c.onchange = function () { P.settings.faceRoles = Object.assign({}, FR); P.settings.faceRoles[c.dataset.fr] = c.checked; changed(); }; });
    $$('[data-ovvis]', box).forEach(function (c) { c.onchange = function () { P.ovs[c.dataset.ovvis].visible = c.checked; changed(); render(); }; });
    $('[data-k=_scheme]', box).onchange = function () { OV.codeScheme = this.value; changed(); };
    ['flc0', 'flc1'].forEach(function (id, i) { $('#' + id, box).onchange = function () { var lc = LC.slice(); lc[i] = this.value; P.settings.flistCols = lc; renderFeatTab(); }; });
    $('#regArea', box).onchange = function () { P.settings.regArea = this.value; changed(); };
    $$('input[data-f]', box).forEach(function (i) {
      i.addEventListener('input', function () {
        var f = featById(i.closest('tr').dataset.fid), k = i.dataset.f;
        f[k] = (k === 'areaOverride' && i.value.trim() === '') ? null : i.value; render(); changed();
      });
      i.addEventListener('focus', function () { var f = featById(i.closest('tr').dataset.fid); App.sel = { kind: 'feature', id: f.id, mapId: (maps()[0] || {}).id }; renderProps(); render(); });
    });
    box.onclick = function (ev) {
      var o = ev.target.closest('[data-ov]');
      if (o) { setActiveOv(o.dataset.ov); return; }
      var a = ev.target.closest('[data-act]');
      if (a) {
        if (a.dataset.act === 'toolFace') setTool('face');
        if (a.dataset.act === 'toolPoly') setTool('poly');
        if (a.dataset.act === 'distribute') distributeArea(parseFloat($('#regArea', box).value));
        if (a.dataset.act === 'undistribute') { list.forEach(function (f) { f.areaOverride = null; }); changed(); render(); renderFeatTab(); }
        if (a.dataset.act === 'recode') { list.forEach(function (f, i) { f.code = M.codeAt(i, OV.codeScheme); }); changed(); render(); renderFeatTab(); }
        if (a.dataset.act === 'sortCode') {
          var order = {}; for (var i = 0; i < 300; i++) order[M.codeAt(i, OV.codeScheme)] = i;
          var sorted = list.slice().sort(function (x, y) { var a1 = order[x.code], b1 = order[y.code]; return (a1 == null ? 999 : a1) - (b1 == null ? 999 : b1) || (x.code < y.code ? -1 : 1); });
          var others = P.features.filter(function (f) { return list.indexOf(f) < 0; });
          P.features = others.concat(sorted);
          changed(); render(); renderFeatTab();
        }
        return;
      }
      var b = ev.target.closest('[data-fop]');
      if (b) {
        var id = b.closest('tr').dataset.fid, j = list.findIndex(function (f) { return f.id === id; });
        var f = list[j], gi = P.features.indexOf(f);
        if (b.dataset.fop === 'del') P.features.splice(gi, 1);
        var nb = b.dataset.fop === 'up' ? list[j - 1] : b.dataset.fop === 'down' ? list[j + 1] : null;
        if (nb) { var gj = P.features.indexOf(nb); P.features[gi] = nb; P.features[gj] = f; }
        changed(); render(); renderFeatTab(); return;
      }
      var tr = ev.target.closest('tr[data-fid]');
      if (tr && ev.target.tagName !== 'INPUT') select({ kind: 'feature', id: tr.dataset.fid, mapId: (maps()[0] || {}).id });
    };
  }
  /* 目前編輯的圖層（現況 / 分割），工具列也有切換鈕 */
  function setActiveOv(k) {
    App.P.activeOv = k; changed(); updateOvBadge();
    if (App.tab === 'feat') renderFeatTab();
    toast('目前編輯：' + App.P.ovs[k].name);
  }
  function updateOvBadge() {
    var b = $('#ovBadge'); if (!b) return;
    var P = App.P;
    b.innerHTML = '<span class="lbl">編輯</span>' + Object.keys(P.ovs).map(function (k) { return '<button data-setov="' + k + '" class="' + (k === P.activeOv ? 'on' : '') + '">' + R.esc(P.ovs[k].name) + '</button>'; }).join('');
  }
  function renderLayerTab() {
    var box = $('#tab-layer'), P = App.P, S = P.styles, h = '';
    h += '<div class="btnrow">' + btn('import', '匯入 DXF…', 'primary') + '</div>';
    if (App.cad) {
      h += '<p class="small">圖資：' + R.esc(App.cad.name || '') + '</p>';
      var layers = {}, colors = {};
      App.cad.lines.forEach(function (l) {
        var k = 'line:' + l.layer; layers[k] = (layers[k] || 0) + 1;
        var ck = l.color == null ? '-' : l.color; colors[k] = colors[k] || {}; colors[k][ck] = (colors[k][ck] || 0) + 1;
      });
      App.cad.texts.forEach(function (t) { var k = 'text:' + t.layer; layers[k] = (layers[k] || 0) + 1; });
      h += '<table class="flist"><thead><tr><th>圖層</th><th>數量</th><th>用途</th></tr></thead><tbody>';
      Object.keys(layers).sort().forEach(function (k) {
        var kind = k.split(':')[0], name = k.slice(kind.length + 1), role = R.roleOf(P, name, kind);
        var opts = kind === 'line' ? [['parcel', '地籍線'], ['case', '現況'], ['split', '分割'], ['other', '其他線'], ['hide', '不顯示']] : [['parcelNo', '地號'], ['target', '本案地號(紅)'], ['otherText', '其他文字'], ['hide', '不顯示']];
        h += '<tr><td>' + R.esc(name) + '<small> ' + (kind === 'line' ? '線' : '字') + '</small></td><td class="num">' + layers[k] + '</td><td><select data-role="' + R.esc(k) + '">' +
          opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === role ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td></tr>';
        // 同一圖層有多種顏色：可依顏色分別指定（例如紅色＝現況、藍色＝分割）
        var cs = colors[k] && Object.keys(colors[k]);
        if (kind === 'line' && cs && cs.length > 1) cs.forEach(function (c) {
          if (c === '-') return;
          var ck = k + '|' + c, cr = P.layerRoles[ck] || role;
          h += '<tr class="sub"><td>└ <span class="sw" style="background:' + DXF.aciHex(+c) + '"></span>' + DXF.aciName(+c) + '</td><td class="num">' + colors[k][c] + '</td><td><select data-role="' + R.esc(ck) + '">' +
            opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cr ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></td></tr>';
        });
      });
      h += '</tbody></table>';
      h += '<p class="small">現況線和分割線若輸出在同一張 DXF：① 圖層不同 → 上表分別指定；② 圖層相同但顏色不同 → 依顏色列指定；③ 都相同 → 用工具列「框選線段(Q)」或點一條線後按「選取相連線段」，再在右側把「歸屬」改成現況或分割。</p>';
      var MG = P.merge, MI = R.mergeInfo(P, App.cad);
      h += '<div class="sec">假合併（多筆地號合併後展示）</div>';
      h += field('合併的地號（以頓號分隔）', '<input id="mgParcels" value="' + R.esc(MG.parcels || '') + '" placeholder="例：641、643、646">');
      h += '<div class="grid2">' + field('原地號界線', '<select id="mgMode">' + [['x', '保留並打 X'], ['hide', '整條隱藏'], ['off', '不合併']].map(function (o) { return '<option value="' + o[0] + '"' + (MG.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>') +
        field('X 大小 (mm)', '<input id="mgX" type="number" step="0.5" value="' + (MG.xSize || 3) + '">') + '</div>';
      h += '<div class="btnrow">' + btn('mgDetect', '依圖上的 X 記號自動判斷') + '</div>';
      h += '<p class="small">' + (MG.mode === 'off' ? '目前不合併。' : '找到界線 ' + Object.keys(MI.internal).length + ' 段' + (MI.missing.length ? '；找不到地號：' + R.esc(MI.missing.join('、')) : '')) + '　合併界線不會當作點選成面的邊界。</p>';
    } else h += '<p class="small">尚未匯入圖資。請匯入內網套疊產出的整段地籍 DXF（例：486.dxf），也可同時選取案件 DXF（例：KC1117.dxf）一起套疊。</p>';
    h += '<details class="fold"><summary>線條與文字樣式</summary>';
    h += '<div class="sec">線條樣式（依用途）</div><table class="flist"><thead><tr><th></th><th>顏色</th><th>線寬</th><th>線型</th></tr></thead><tbody>';
    [['parcelLine', '地籍線'], ['caseLine', '現況'], ['splitLine', '分割'], ['otherLine', '其他線']].forEach(function (r) {
      h += '<tr><td>' + r[1] + '</td><td>' + color(r[0] + '.color', S[r[0]].color) + '</td><td>' + inp(r[0] + '.width', S[r[0]].width, 'number', 'step="0.01"') + '</td><td>' + dashSel(r[0] + '.dash', S[r[0]].dash) + '</td></tr>';
    });
    h += '</tbody></table>';
    h += '<div class="btnrow"><span class="small">同時有現況與分割時，現況改用</span>' + color('caseLine.colorBoth', S.caseLine.colorBoth || '#0050ff') + '<span class="small">（' + (R.updateBoth(P, App.cad) ? '目前套用中' : '目前只有單一圖層，未套用') + '）</span></div>';
    h += '<div class="sec">文字樣式</div><div class="grid2">' +
      field('地號字高', inp('parcelText.size', S.parcelText.size, 'number', 'step="0.1"')) + field('地號顏色', color('parcelText.color', S.parcelText.color)) +
      field('本案地號字高', inp('targetText.size', S.targetText.size, 'number', 'step="0.1"')) + field('本案地號顏色', color('targetText.color', S.targetText.color)) +
      field('編號字高', inp('featureLabel.size', S.featureLabel.size, 'number', 'step="0.1"')) + field('編號顏色', color('featureLabel.color', S.featureLabel.color)) +
      field('註記字高', inp('anno.size', S.anno.size, 'number', 'step="0.1"')) + field('略圖字型', sel('mapFont', S.mapFont, [['sans', 'Arial'], ['kai', '標楷體']])) + '</div>';
    h += '<label class="inline">' + chk('autoAvoid', S.autoAvoid !== false) + ' 地號、編號自動避開線條（小幅移動；避不開就留原位，可再手動拖曳）</label>';
    h += '<label class="inline">' + chk('avoidCase', S.avoidCase !== false) + ' 非本案地號避開本案範圍（說明項目、本案地塊），避不開才壓在上面</label>';
    h += '<label class="inline">' + chk('hideTempNo', S.hideTempNo !== false) + ' 隱藏分割暫編地號（如 641(1)、635(2)）</label>';
    h += '</details>';
    var hiddenN = Object.keys(P.segStyle).filter(function (k) { return P.segStyle[k] && P.segStyle[k].hidden; }).length;
    var hiddenT = Object.keys(P.textOver).filter(function (k) { return P.textOver[k] && P.textOver[k].hidden; }).length;
    if (hiddenN || hiddenT) h += '<div class="btnrow">' + (hiddenN ? btn('showSegs', '顯示被隱藏的線段（' + hiddenN + '）') : '') + (hiddenT ? btn('showTexts', '顯示被隱藏的文字（' + hiddenT + '）') : '') + '</div>';
    h += '<div class="sec">畫面</div><label class="inline">' + chk('snapEdges', P.settings.snapEdges) + ' 移動元件時自動對齊其他元件邊緣</label>';
    box.innerHTML = h;
    bind(box, function () { return S; }, null);
    $$('[data-k=snapEdges]', box).forEach(function (i) { i.onchange = function () { P.settings.snapEdges = i.checked; }; });
    $$('[data-role]', box).forEach(function (s) {
      s.addEventListener('change', function () { P.layerRoles[s.dataset.role] = s.value; render(); changed(); });
    });
    var mgP = $('#mgParcels', box), mgM = $('#mgMode', box), mgX = $('#mgX', box);
    if (mgP) {
      mgP.onchange = function () { P.merge.parcels = mgP.value; changed(); render(); renderLayerTab(); };
      mgM.onchange = function () { P.merge.mode = mgM.value; changed(); render(); renderLayerTab(); };
      mgX.oninput = function () { P.merge.xSize = parseFloat(mgX.value) || 3; changed(); render(); };
    }
    box.onclick = function (ev) {
      var a = ev.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'mgDetect') {
        var det = R.detectMerge(P, App.cad);
        if (det.length < 2) toast('圖上找不到合併的 X 記號，請直接輸入地號');
        else { P.merge.parcels = det.join('、'); if (P.merge.mode === 'off') P.merge.mode = 'x'; changed(); render(); renderLayerTab(); toast('判斷為：' + det.join('、')); }
      }
      if (a.dataset.act === 'import') importDXF();
      if (a.dataset.act === 'showSegs') { Object.keys(P.segStyle).forEach(function (k) { if (P.segStyle[k]) delete P.segStyle[k].hidden; }); changed(); render(); renderLayerTab(); }
      if (a.dataset.act === 'showTexts') { Object.keys(P.textOver).forEach(function (k) { if (P.textOver[k]) delete P.textOver[k].hidden; }); changed(); render(); renderLayerTab(); }
    };
  }
  function renderOutTab() {
    var box = $('#tab-out'), P = App.P, o = P.output.k8, h = '';
    h += '<div class="sec">① A3 成果圖（1:1）</div>';
    h += '<div class="grid2">' + field('紙寬 (mm)', inp('sheet.w', P.sheet.w, 'number')) + field('紙高 (mm)', inp('sheet.h', P.sheet.h, 'number')) +
      field('印表位移 X (mm)', inp('sheet.dx', P.sheet.dx, 'number', 'step="0.1"')) + field('印表位移 Y (mm)', inp('sheet.dy', P.sheet.dy, 'number', 'step="0.1"')) + '</div>';
    h += '<div class="btnrow">' + btn('printA3', '列印 A3 成果圖', 'primary') + '</div>';
    h += '<div class="sec">② 8K 圖紙套印（框選部分 1:1）</div>';
    h += '<div class="grid2">' + field('紙寬 (mm)', inp('output.k8.w', o.w, 'number')) + field('紙高 (mm)', inp('output.k8.h', o.h, 'number')) +
      field('左下平移 X (mm)', inp('output.k8.offX', o.offX, 'number', 'step="0.1"')) + field('左下平移 Y (mm)', inp('output.k8.offY', o.offY, 'number', 'step="0.1"')) +
      field('印表位移 X', inp('output.k8.dx', o.dx, 'number', 'step="0.1"')) + field('印表位移 Y', inp('output.k8.dy', o.dy, 'number', 'step="0.1"')) + '</div>';
    if (o.region) {
      h += '<div class="grid2">' + field('範圍 X', inp('output.k8.region.x', o.region.x, 'number', 'step="0.1"')) + field('範圍 Y', inp('output.k8.region.y', o.region.y, 'number', 'step="0.1"')) +
        field('範圍寬', inp('output.k8.region.w', o.region.w, 'number', 'step="0.1"')) + field('範圍高', inp('output.k8.region.h', o.region.h, 'number', 'step="0.1"')) + '</div>';
    } else h += '<p class="small">尚未設定範圍。</p>';
    h += '<div class="btnrow">' + btn('region', '滑鼠框選範圍 (R)') + btn('regionFt', '框選：說明表') + btn('regionSel', '框選：目前選取元件') + '</div>';
    h += '<div class="btnrow">' + btn('swap8k', '8K 直/橫互換') + btn('print8k', '列印 8K 套印', 'primary') + '</div>';
    h += '<div class="sec">③ 送審核定後</div>';
    h += '<p class="small">於「案件資料」填入核定日期（右下角「中華民國　年　月　日」自動帶入），再列印 A3。份數請在列印視窗設定' + (P.fields.copies ? '：本案 <b>' + R.esc(P.fields.copies) + '</b> 份' : '') + '。</p>';
    h += '<div class="sec">列印注意</div><p class="small">列印視窗請選：目的地＝印表機或「另存為 PDF」、紙張＝A3（8K 用自訂紙張）、邊界＝<b>無</b>、縮放＝<b>預設/100%</b>，並勾選「背景圖形」。若印表機有固定偏移，可用上方「印表位移」校正。</p>';
    h += '<div class="sec">範本</div><div class="btnrow">' + btn('saveTpl', '目前版面存成範本') + btn('exportTpl', '匯出範本檔') + btn('importTpl', '匯入範本檔') + '</div>';
    box.innerHTML = h;
    bind(box, P, function () { render(); });
    box.onclick = function (ev) {
      var a = ev.target.closest('[data-act]'); if (!a) return;
      var act = a.dataset.act;
      if (act === 'printA3') { checkpoint(); Printer.printA3(P, App.cad); }
      if (act === 'print8k') { checkpoint(); if (!Printer.print8K(P, App.cad)) toast('請先框選 8K 套印範圍'); }
      if (act === 'region') setTool('region');
      if (act === 'swap8k') { var t = o.w; o.w = o.h; o.h = t; renderOutTab(); changed(); }
      if (act === 'regionFt' || act === 'regionSel') {
        var el = act === 'regionFt' ? P.elements.filter(function (e) { return e.type === 'ftable'; })[0] : (App.sel && App.sel.kind === 'el' ? elById(App.sel.id) : null);
        if (!el) return toast(act === 'regionFt' ? '沒有說明表' : '請先選取元件');
        var b = R.bounds(el, P); o.region = { x: round(b.x - 1, 2), y: round(b.y - 1, 2), w: round(b.w + 2, 2), h: round(b.h + 2, 2) };
        renderOutTab(); render(); changed();
      }
      if (act === 'saveTpl') saveTemplate();
      if (act === 'exportTpl') download('略圖範本.ctt', JSON.stringify(templateData()), 'application/json');
      if (act === 'importTpl') pickFiles('.ctt,.json').then(function (fs) {
        if (!fs.length) return;
        readFile(fs[0], true).then(function (t) {
          try { var d = JSON.parse(t); storeTemplate(d.name || fs[0].name.replace(/\.\w+$/, ''), d); toast('已匯入範本，可於「新案件」選用'); } catch (e) { alert('範本檔格式錯誤'); }
        });
      });
    };
  }

  /* ---------- 方案 ---------- */
  function renderPlanSel() {
    var ps = $('#planSel'); if (!ps) return;
    ps.innerHTML = App.P.plans.map(function (pl, i) { return '<option value="' + i + '"' + (i === App.P.planIdx ? ' selected' : '') + '>' + R.esc(pl.name) + '</option>'; }).join('');
  }
  function stashPlan() {
    var P = App.P, d = {};
    M.PLAN_KEYS.forEach(function (k) { d[k] = P[k]; });
    P.plans[P.planIdx].data = d; App.planCads[P.planIdx] = App.cad;
  }
  function switchPlan(j) {
    var P = App.P; if (j === P.planIdx || !P.plans[j]) return;
    checkpoint(); stashPlan();
    var d = P.plans[j].data;
    M.PLAN_KEYS.forEach(function (k) { if (d && d[k] !== undefined) P[k] = d[k]; });
    P.plans[j].data = null; P.planIdx = j; App.cad = App.planCads[j] || null;
    App.sel = null; App.draw = null; changed(); refreshAll();
    toast('切換到「' + P.plans[j].name + '」');
  }
  function addPlan() {
    var P = App.P, name = prompt('新方案名稱（會複製目前方案的圖資、說明項目與版面）', '方案' + (P.plans.length + 1));
    if (!name) return;
    checkpoint(); stashPlan();
    var copy = clone(P.plans[P.planIdx].data);
    P.plans[P.planIdx].data = null;
    P.plans.push({ name: name, data: copy }); App.planCads.push(App.cad);
    switchPlan(P.plans.length - 1);
  }
  function renamePlan() {
    var pl = App.P.plans[App.P.planIdx], name = prompt('方案名稱', pl.name);
    if (name) { pl.name = name; renderPlanSel(); changed(); }
  }
  function deletePlan() {
    var P = App.P;
    if (P.plans.length <= 1) return toast('至少要保留一個方案');
    if (!confirm('刪除方案「' + P.plans[P.planIdx].name + '」？')) return;
    var i = P.planIdx, j = i === 0 ? 1 : i - 1;
    switchPlan(j);
    P.plans.splice(i, 1); App.planCads.splice(i, 1);
    if (P.planIdx > i) P.planIdx--;
    App.undo = []; App.redo = []; App.lastSnap = snap();
    renderPlanSel(); autosave();
  }

  /* ---------- 範本 ---------- */
  function templateData(name) {
    var P = App.P;
    var keep = {};
    ['office', 'title', 'county', 'town', 'remark'].forEach(function (k) { keep[k] = P.fields[k]; });
    return { app: 'CourtTask-template', name: name || '我的範本', elements: P.elements, styles: P.styles, sheet: P.sheet, output: { k8: Object.assign({}, P.output.k8, { region: P.output.k8.region }) }, settings: P.settings, fields: keep };
  }
  function getTemplates() { try { return JSON.parse(lsGet('courttask.templates') || '{}'); } catch (e) { return {}; } }
  function storeTemplate(name, d) { var t = getTemplates(); d.name = name; t[name] = d; lsSet('courttask.templates', JSON.stringify(t)); }
  function saveTemplate() {
    var name = prompt('範本名稱（例：法院囑託現況圖、分割略圖）', '我的範本'); if (!name) return;
    storeTemplate(name, templateData(name)); toast('已儲存範本「' + name + '」');
  }
  function newCase() {
    var t = getTemplates(), names = Object.keys(t);
    var dlg = $('#dlgNew'), list = $('#tplList');
    list.innerHTML = '<label class="tpl"><input type="radio" name="tpl" value="__builtin" checked> 內建：法院囑託土地複丈成果圖（A3）</label>' +
      '<label class="tpl"><input type="radio" name="tpl" value="__current"> 沿用目前版面（清空案件資料與圖資）</label>' +
      names.map(function (n) { return '<label class="tpl"><input type="radio" name="tpl" value="' + R.esc(n) + '"> ' + R.esc(n) + ' <button type="button" data-deltpl="' + R.esc(n) + '">刪除</button></label>'; }).join('');
    list.onclick = function (ev) {
      var b = ev.target.closest('[data-deltpl]'); if (!b) return;
      ev.preventDefault();
      if (confirm('刪除範本「' + b.dataset.deltpl + '」？')) { delete t[b.dataset.deltpl]; lsSet('courttask.templates', JSON.stringify(t)); newCase(); }
    };
    dlg.showModal();
    $('#btnNewOk').onclick = function () {
      var v = ($('input[name=tpl]:checked', list) || {}).value;
      var tpl = v === '__builtin' ? null : v === '__current' ? templateData() : t[v];
      checkpoint();
      App.P = upgrade(M.newProject(tpl)); App.cad = null; App.planCads = [null]; fileHandle = null;
      App.undo = []; App.redo = []; App.lastSnap = snap(); App.sel = null;
      dlg.close(); refreshAll(); fitView(); switchTab('case'); autosave();
    };
  }

  /* ---------- 新增元件 ---------- */
  function addElement(type) {
    var P = App.P, cx = App.view.ox + stage.clientWidth / App.view.z / 2, cy = App.view.oy + stage.clientHeight / App.view.z / 2, el;
    var base = { id: M.uid(), x: round(cx - 20, 1), y: round(cy - 10, 1) };
    if (type === 'map') {
      el = Object.assign(base, { type: 'map', name: '略圖框' + (maps().length + 1), w: 100, h: 100, scale: 500, cx: null, cy: null, border: true, lw: 0.18, scaleLabel: maps().length > 0 });
      var first = maps()[0];
      if (first && first.cx != null) { el.cx = first.cx; el.cy = first.cy; el.scale = first.scale; } else centerMap(el, 'auto');
    } else if (type === 'text') el = Object.assign(base, { type: 'text', name: '文字', w: 50, h: 8, text: '文字', fs: 4.15, align: 'left', valign: 'middle', font: 'kai' });
    else if (type === 'table') el = Object.assign(base, { type: 'table', name: '表格', cols: [15, 30], rows: [8, 8, 8], cells: [], lw: 0.24 });
    else if (type === 'ftable') { el = Object.assign(M.defaultElements().filter(function (e) { return e.type === 'ftable'; })[0], base); }
    else if (type === 'north') el = Object.assign(base, { type: 'north', name: '指北', w: 9.5, h: 30 });
    else if (type === 'rect') el = Object.assign(base, { type: 'rect', name: '矩形框', w: 40, h: 25, lw: 0.24 });
    else if (type === 'line') el = Object.assign(base, { type: 'line', name: '線', w: 40, h: 0, lw: 0.24 });
    P.elements.push(el); select({ kind: 'el', id: el.id }); changed(); renderLayerList();
  }

  /* ---------- 元件清單 ---------- */
  function renderLayerList() {
    var box = $('#elList'); if (!box) return;
    var TYPE = { text: '字', rect: '框', line: '線', table: '表', ftable: '表', north: '北', map: '圖' };
    box.innerHTML = App.P.elements.slice().reverse().map(function (e) {
      var on = App.sel && App.sel.kind === 'el' && App.sel.id === e.id ? ' on' : '';
      return '<div class="eli' + on + '" data-eid="' + e.id + '"><span class="ty">' + TYPE[e.type] + '</span>' + R.esc(e.name || e.type) +
        '<span class="eops"><button data-eop="vis" title="顯示/隱藏">' + (e.hidden ? '◌' : '●') + '</button><button data-eop="lock" title="鎖定">' + (e.locked ? '🔒' : '🔓') + '</button></span></div>';
    }).join('');
  }

  /* ---------- 工具 ---------- */
  function setTool(t) {
    if (App.draw && t !== App.tool) App.draw = null;
    App.tool = t; App.snapPt = null;
    $$('[data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    stage.dataset.tool = t;
    var tips = {
      select: '選取：單擊選取、拖曳移動；雙擊表格進入表格編輯（拉格線、點格子）', pan: '移動圖面：在略圖框內拖曳以改變裁切位置',
      face: '點選成面：在略圖內點選封閉區域，自動建立說明項目並計算面積', poly: '多邊形：逐點點選（自動鎖點），雙擊或 Enter 完成，Esc 取消，Backspace 退一點',
      line: '畫現況線：逐點點選，雙擊或 Enter 完成（畫好後可在右側改線型、顏色）',
      sline: '畫分割線：逐點點選（自動鎖點），雙擊或 Enter 完成；畫好後可用「點選成面」切出分割範圍', break: '斷線：在線段上點一下，把它切成兩段，之後可分別設定線型（例如一段實線、一段虛線）', text: '文字：在略圖內點選＝圖面註記；在略圖外＝版面文字',
      region: '框選 8K 套印範圍：在版面上拖曳一個矩形',
      assign: '點選改歸屬：點線段＝改成目前編輯的圖層（工具列「編輯」切換現況/分割），再點一次還原；Shift＋點＝整串相連線段；Alt＋點＝可選地籍線',
      lsel: '框選線段：在略圖內拖曳矩形，選取完全在框內的現況/分割線（不含地籍線），再到右側改歸屬或線型'
    };
    $('#toolTip').textContent = tips[t] || '';
    render();
  }
  function refreshPanels() { renderProps(); renderLayerList(); if (App.tab) switchTab(App.tab); }
  function updateSteps() {
    var P = App.P, done = {
      import: !!App.cad,
      crop: maps().some(function (m) { return m.cx != null; }),
      feat: P.features.length > 0,
      case: !!(P.fields.landNo && (P.fields.courtDoc || P.fields.matter)),
      out: false
    };
    $$('.steps [data-step]').forEach(function (li) { li.classList.toggle('done', !!done[li.dataset.step]); });
  }
  function refreshAll() { refreshPanels(); renderPlanSel(); updateOvBadge(); updateSteps(); render(); }

  /* ================= 鍵盤 ================= */
  function onKey(ev) {
    var tag = (ev.target.tagName || '').toLowerCase(), typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    var ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === 's') { ev.preventDefault(); saveProject(ev.shiftKey); return; }
    if (ctrl && ev.key.toLowerCase() === 'o') { ev.preventDefault(); openProject(); return; }
    if (ctrl && ev.key.toLowerCase() === 'p') { ev.preventDefault(); checkpoint(); Printer.printA3(App.P, App.cad); return; }
    if (typing) return;
    if (ctrl && ev.key.toLowerCase() === 'z') { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
    if (ctrl && ev.key.toLowerCase() === 'y') { ev.preventDefault(); redo(); return; }
    if (ctrl && ev.key.toLowerCase() === 'd') { ev.preventDefault(); if (App.sel && App.sel.kind === 'el') duplicateEl(App.sel.id); return; }
    if (ev.key === ' ') { App.space = true; stage.classList.add('grab'); ev.preventDefault(); return; }
    if (ev.key === 'Escape' && App.tableEdit) { setTableEdit(null); return; }
    if (ev.key === 'Escape') { if (App.draw) { App.draw = null; render(); } else if (App.tool !== 'select') setTool('select'); else select(null); return; }
    if (ev.key === 'Enter' && App.draw) { finishDraw(); return; }
    if (ev.key === 'Backspace' && App.draw) { App.draw.pts.pop(); if (!App.draw.pts.length) App.draw = null; render(); ev.preventDefault(); return; }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSel(); ev.preventDefault(); return; }
    var map = { v: 'select', h: 'pan', f: 'face', p: 'poly', l: 'line', s: 'sline', b: 'break', t: 'text', r: 'region', q: 'lsel', a: 'assign' };
    // 選取線段時：1＝現況、2＝分割
    if (App.sel && App.sel.kind === 'seg' && (ev.key === '1' || ev.key === '2')) {
      var rr = ev.key === '1' ? 'case' : 'split';
      App.sel.idx.forEach(function (k) { (App.P.segStyle[k] = App.P.segStyle[k] || {}).role = rr; });
      changed(); render(); renderProps(); toast('已設為' + App.P.ovs[rr].name); return;
    }
    if (!ctrl && map[ev.key.toLowerCase()]) { setTool(map[ev.key.toLowerCase()]); return; }
    if (ev.key === '0' && !ctrl) { fitView(); return; }
    if (ev.key.indexOf('Arrow') === 0 && App.sel) {
      var st = ev.shiftKey ? 1 : 0.1, dx = ev.key === 'ArrowLeft' ? -st : ev.key === 'ArrowRight' ? st : 0, dy = ev.key === 'ArrowUp' ? -st : ev.key === 'ArrowDown' ? st : 0;
      ev.preventDefault();
      if (App.sel.kind === 'el') { var el = elById(App.sel.id); if (el && !el.locked) { el.x = round(el.x + dx, 2); el.y = round(el.y + dy, 2); } updateGeomFields(); }
      else if (App.sel.mapId) {
        var m = elById(App.sel.mapId), k = 1000 / m.scale, wdx = dx / k, wdy = -dy / k;
        if (App.sel.kind === 'flabel' || App.sel.kind === 'feature') { var f = featById(App.sel.id), lp = f.labelAt || G.labelPoint(f.pts); f.labelAt = [lp[0] + wdx, lp[1] + wdy]; }
        else if (App.sel.kind === 'anno') { var a = App.P.annos.filter(function (x) { return x.id === App.sel.id; })[0]; a.x += wdx; a.y += wdy; }
        else if (App.sel.kind === 'ptext') { var t = App.cad.texts[App.sel.idx], ov = App.P.textOver[App.sel.idx] = App.P.textOver[App.sel.idx] || {}; ov.x = (ov.x != null ? ov.x : t.x) + wdx; ov.y = (ov.y != null ? ov.y : t.y) + wdy; }
      }
      render(); changed();
    }
  }

  /* ================= 啟動 ================= */
  function init() {
    svg = $('#svg'); stage = $('#stage');
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('dblclick', function (ev) {
      if (App.tool === 'select' && App.sel && App.sel.kind === 'el') {
        var de = elById(App.sel.id);
        if (de && (de.type === 'table' || de.type === 'ftable')) { setTableEdit(de.id); return; }
        var ta2 = $('#props textarea'); if (ta2) { ta2.focus(); ta2.select(); }
      }
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', function (ev) { if (ev.key === ' ') { App.space = false; stage.classList.remove('grab'); } });
    window.addEventListener('resize', render);
    window.addEventListener('beforeprint', checkpoint);
    window.addEventListener('afterprint', function () { $('#printArea').innerHTML = ''; });

    $$('[data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
    $$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { switchTab(b.dataset.tab); }); });
    // 下拉選單：點按鈕開關，點其他地方關閉
    document.addEventListener('click', function (ev) {
      var btnDD = ev.target.closest('.ddbtn'), openDD = btnDD && btnDD.parentNode;
      $$('.dd.open').forEach(function (d) { if (d !== openDD) d.classList.remove('open'); });
      if (openDD) { openDD.classList.toggle('open'); return; }
      if (ev.target.closest('.ddmenu [data-cmd]')) $$('.dd.open').forEach(function (d) { d.classList.remove('open'); });
    });
    // 作業步驟
    $('.steps').addEventListener('click', function (ev) {
      var li = ev.target.closest('[data-step]'); if (!li) return;
      var st = li.dataset.step;
      if (st === 'import') { if (!App.cad) importDXF(); else { switchTab('layer'); toast('已有圖資；要再匯入請按「匯入 DXF」'); } }
      if (st === 'crop') { var m = maps()[0]; if (m) { select({ kind: 'el', id: m.id }); setTool('pan'); } }
      if (st === 'feat') { switchTab('feat'); setTool('face'); }
      if (st === 'case') { switchTab('case'); setTool('select'); }
      if (st === 'out') { switchTab('out'); setTool('select'); }
    });
    document.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cmd]'); if (!b || b.closest('dialog') || b.closest('#props') || b.closest('.tabpane')) return;
      var c = b.dataset.cmd;
      if (c === 'new') newCase(); else if (c === 'open') openProject(); else if (c === 'save') saveProject(false); else if (c === 'saveas') saveProject(true);
      else if (c === 'import') importDXF(); else if (c === 'undo') undo(); else if (c === 'redo') redo();
      else if (c === 'fit') fitView(); else if (c === 'zin' || c === 'zout') { App.view.z *= c === 'zin' ? 1.25 : 0.8; render(); }
      else if (c === 'z100') { var r = stage.getBoundingClientRect(), cx = App.view.ox + r.width / App.view.z / 2, cy = App.view.oy + r.height / App.view.z / 2; App.view.z = 96 / 25.4; App.view.ox = cx - r.width / App.view.z / 2; App.view.oy = cy - r.height / App.view.z / 2; render(); }
      else if (c === 'printA3') { checkpoint(); Printer.printA3(App.P, App.cad); }
      else if (c === 'print8k') { checkpoint(); if (!Printer.print8K(App.P, App.cad)) { toast('請先框選 8K 套印範圍'); switchTab('out'); } }
      else if (c.indexOf('add-') === 0) addElement(c.slice(4));
      else if (c === 'help') $('#dlgHelp').showModal();
      else if (c === 'planAdd') addPlan(); else if (c === 'planRen') renamePlan(); else if (c === 'planDel') deletePlan();
    });
    $('#planSel').addEventListener('change', function () { switchPlan(+this.value); });
    $('#ovBadge').addEventListener('click', function (ev) { var b = ev.target.closest('[data-setov]'); if (b) setActiveOv(b.dataset.setov); });
    $('#elList').addEventListener('click', function (ev) {
      var it = ev.target.closest('[data-eid]'); if (!it) return;
      var el = elById(it.dataset.eid), op = ev.target.closest('[data-eop]');
      if (op) { if (op.dataset.eop === 'vis') el.hidden = !el.hidden; else el.locked = !el.locked; changed(); render(); renderLayerList(); if (App.sel && App.sel.id === el.id) renderProps(); return; }
      select({ kind: 'el', id: el.id }); renderLayerList();
    });

    App.lastSnap = snap();
    setTool('select');
    switchTab('case');
    renderLayerList(); renderProps(); renderPlanSel(); updateOvBadge();
    fitView();
    // 還原自動暫存
    function restore(saved) {
      if (!saved) return;
      try { loadData(JSON.parse(saved)); toast('已還原上次的工作（自動暫存）'); } catch (e) { /* 忽略 */ }
    }
    IDB.get('autosave').then(function (v) { restore(v || lsGet('courttask.autosave')); }, function () { restore(lsGet('courttask.autosave')); });
  }

  App.api = { loadData: loadData, fileData: fileData, selectFn: select, setTool: setTool, render: renderNow, fitView: fitView, importParsed: function (name, data) {
    App.cad = { name: name, lines: data.lines, texts: data.texts }; maps().forEach(function (m) { centerMap(m, 'auto'); }); refreshAll(); changed();
  }, addFaceAt: addFaceAt, centerMap: centerMap };
  document.addEventListener('DOMContentLoaded', init);
})();
