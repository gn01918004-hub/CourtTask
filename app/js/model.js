/* 資料模型、預設範本、欄位、文字排版工具 */
(function (global) {
  'use strict';

  var KAI = '"DFKai-SB","標楷體","BiauKai","KaiTi","TW-Kai","Noto Serif TC",serif';
  var SANS = 'Arial,"Microsoft JhengHei","微軟正黑體",sans-serif';

  /* 案件資料欄位（可在文字中用 {key} 引用） */
  var FIELDS = [
    { group: '機關' },
    { key: 'office', label: '機關名稱', def: '苗栗縣通霄地政事務所', pref: true },
    { key: 'title', label: '圖名', def: '土地複丈成果圖' },
    { group: '土地坐落' },
    { key: 'county', label: '縣市', def: '苗栗縣', pref: true, list: ['苗栗縣'] },
    { key: 'town', label: '鄉鎮市區（可下拉或自行輸入）', def: '', pref: true, list: ['通霄鎮', '苑裡鎮'] },
    { key: 'section', label: '段（如：城北段）', def: '' },
    { key: 'subsection', label: '小段', def: '' },
    { key: 'landNo', label: '地號', def: '' },
    { group: '囑託' },
    { key: 'courtDoc', label: '囑託法院及文號', def: '', multi: true },
    { key: 'matter', label: '囑託事項', def: '', multi: true },
    { group: '收件 / 鑑測' },
    { key: 'recvY', label: '收件(年)', def: '', short: true },
    { key: 'recvM', label: '收件(月)', def: '', short: true },
    { key: 'recvD', label: '收件(日)', def: '', short: true },
    { key: 'recvWord', label: '收件字', def: '' },
    { key: 'recvNo', label: '收件號', def: '' },
    { key: 'surveyY', label: '鑑測(年)', def: '', short: true },
    { key: 'surveyM', label: '鑑測(月)', def: '', short: true },
    { key: 'surveyD', label: '鑑測(日)', def: '', short: true },
    { group: '其他' },
    { key: 'remark', label: '附記', def: '本複丈成果圖僅供法院參考，不得發給土地所有權人。', multi: true },
    { key: 'explain', label: '說明', def: '', multi: true },
    { group: '送審核定（送審回來後填寫）' },
    { key: 'apY', label: '核定(年)', def: '', short: true },
    { key: 'apM', label: '核定(月)', def: '', short: true },
    { key: 'apD', label: '核定(日)', def: '', short: true },
    { key: 'copies', label: '印製份數', def: '', short: true }
  ];

  function uid() { return 'e' + Math.random().toString(36).slice(2, 9); }

  function cell(r, c, text, o) {
    var x = { r: r, c: c, text: text };
    for (var k in o || {}) x[k] = o[k];
    return x;
  }

  /* 依「土地複丈成果圖（法院囑託）」實際成果量測之 A3 橫式版面（單位 mm） */
  function defaultElements() {
    var L = { align: 'center', valign: 'middle', fs: 4.15 };
    var C = { align: 'left', valign: 'top', fs: 4.15 };
    return [
      { id: uid(), type: 'text', name: '圖名', x: 60, y: 25, w: 300, h: 13, text: '{office}{title}', fs: 9.6, align: 'center', valign: 'middle', ls: 1.4, font: 'kai' },
      { id: uid(), type: 'rect', name: '外框', x: 20.7, y: 44.5, w: 350.6, h: 231.8, lw: 0.24 },
      {
        id: uid(), type: 'table', name: '左側說明欄', x: 20.7, y: 44.5, lw: 0.24,
        cols: [12.4, 13.4, 8.6, 13.4, 9.2], rows: [11.4, 6.2, 6.1, 22.9, 57.9, 15.7, 10.9, 18.1, 82.6],
        cells: [
          cell(0, 0, '土地坐落', Object.assign({ rs: 3 }, L)),
          // 縣／市、鄉鎮／市區 上下堆疊各成一格，名稱另成一格，輸入「苗栗縣」或「苗栗」都能對齊
          cell(0, 1, '{countyName}', Object.assign({}, L, { fit: 'shrink', hideR: true })),
          cell(0, 2, '縣\n市', Object.assign({}, L, { hideL: true, hideR: true, lh: 1.05 })),
          cell(0, 3, '{townName}', Object.assign({}, L, { fit: 'shrink', hideL: true, hideR: true })),
          cell(0, 4, '鄉鎮\n市區', Object.assign({}, L, { hideL: true, lh: 1.05, fit: 'shrink' })),
          cell(1, 1, '{sectionName}', Object.assign({}, L, { fit: 'shrink', hideR: true })),
          cell(1, 2, '段', Object.assign({}, L, { hideL: true, hideR: true })),
          cell(1, 3, '{subsectionName}', Object.assign({}, L, { fit: 'shrink', hideL: true, hideR: true })),
          cell(1, 4, '小段', Object.assign({}, L, { hideL: true, fit: 'shrink' })),
          cell(2, 1, '{landNo}地號', Object.assign({ cs: 4 }, L, { fit: 'shrink' })),
          cell(3, 0, '囑託法院及文號', L), cell(3, 1, '{courtDoc}', Object.assign({ cs: 4 }, C)),
          cell(4, 0, '囑託事項', L), cell(4, 1, '{matter}', Object.assign({ cs: 4 }, C, { valign: 'middle' })),
          cell(5, 0, '收件日期文號', L), cell(5, 1, ' {recvY} 年 {recvM} 月 {recvD} 日\n {recvWord} 字{recvNo} 號', Object.assign({ cs: 4 }, C, { valign: 'middle' })),
          cell(6, 0, '鑑測日期', L), cell(6, 1, ' {surveyY} 年 {surveyM} 月 {surveyD} 日', Object.assign({ cs: 4 }, C, { valign: 'middle' })),
          cell(7, 0, '附記', L), cell(7, 1, '{remark}', Object.assign({ cs: 4 }, C, { valign: 'middle' })),
          cell(8, 0, '說明', L), cell(8, 1, '{explain}', Object.assign({ cs: 4 }, C))
        ]
      },
      { id: uid(), type: 'north', name: '指北', x: 84.5, y: 44.2, w: 9.5, h: 30.5 },
      {
        id: uid(), type: 'ftable', name: '說明表', x: 85.5, y: 77.6, lw: 0.24,
        cols: [19, 19, 20, 19.9], titleH: 13.3, headerH: 11.4, rowH: 8.6, rowHs: {}, notesH: 8.5,
        title: '{landNo}地號地上物說明：', titleFs: 5.6,
        columns: [
          { key: 'code', header: '編號：' }, { key: 'area', header: '面積\n(平方公尺)' },
          { key: 'landNo', header: '使用地號' }, { key: 'note', header: '備註', fs: 3.94 }
        ],
        headerFs: 3.1, dataFs: 5.16, decimals: 2,
        notes: '1.面積計算至平方公分，以平方公尺為單位。\n2.虛線表位於非本案標的之部分，並未列入面積計算。', notesFs: 3.05,
        cellOver: {}
      },
      { id: uid(), type: 'map', name: '略圖框', x: 168.4, y: 48.5, w: 200, h: 200, scale: 500, cx: null, cy: null, border: true, lw: 0.18 },
      { id: uid(), type: 'text', name: '主任', x: 262, y: 254.5, w: 40, h: 8, text: '主任', fs: 5.16, align: 'left', valign: 'middle', font: 'kai' },
      { id: uid(), type: 'text', name: '核定日期', x: 262, y: 265.5, w: 90, h: 8, text: '中華民國　{apY}　年　{apM}　月　{apD}　日', fs: 5.16, align: 'left', valign: 'middle', font: 'kai' },
      { id: uid(), type: 'text', name: '比例尺', x: 150, y: 279, w: 80, h: 8, text: '比例尺： 1/{scale}', fs: 5.04, align: 'center', valign: 'middle', font: 'kai' }
    ];
  }

  function defaultStyles() {
    return {
      parcelLine: { color: '#000000', width: 0.15, dash: 'solid' },
      caseLine: { color: '#ff0000', width: 0.2, dash: 'solid', colorBoth: '#0050ff' },  // colorBoth：同時有分割時的現況顏色
      splitLine: { color: '#ff0000', width: 0.3, dash: 'solid' },
      otherLine: { color: '#000000', width: 0.15, dash: 'solid' },
      parcelText: { color: '#000000', size: 6.2 },
      targetText: { color: '#ff0000', size: 6.2 },
      otherText: { color: '#000000', size: 4 },
      featureLabel: { color: '#ff0000', size: 6.2 },
      anno: { color: '#000000', size: 4.2 },
      mapFont: 'sans',
      autoAvoid: true
    };
  }

  function newProject(tpl) {
    var fields = {};
    FIELDS.forEach(function (f) { if (f.key) fields[f.key] = f.def; });
    var p = {
      app: 'CourtTask', version: 1,
      fields: fields,
      styles: defaultStyles(),
      sheet: { w: 420, h: 297, dx: 0, dy: 0 },
      layerRoles: {},
      segStyle: {},
      textOver: {},
      features: [],
      annos: [],
      userLines: [],
      elements: defaultElements(),
      output: { k8: { w: 388, h: 267, offX: 20, offY: 20, dx: 0, dy: 0, region: null } },
      settings: { snapEdges: true, faceWithParcel: true, codeScheme: 'alpha' },
      splits: {},
      ovs: { case: { name: '現況', visible: true, codeScheme: 'alpha' }, split: { name: '分割', visible: true, codeScheme: 'stem', schemeSet: true } },
      activeOv: 'case',
      merge: { parcels: '', mode: 'x', xSize: 3 },
      plans: [{ name: '方案1', data: null }], planIdx: 0
    };
    if (tpl) {
      ['elements', 'styles', 'sheet', 'output', 'settings'].forEach(function (k) { if (tpl[k]) p[k] = JSON.parse(JSON.stringify(tpl[k])); });
      if (tpl.fields) for (var k in tpl.fields) p.fields[k] = tpl.fields[k];
      p.elements.forEach(function (e) { if (e.type === 'map') { e.cx = null; e.cy = null; } });
    }
    return p;
  }

  /* ---------- 文字排版 ---------- */
  var ctx = null;
  function fontFamily(f) { return f === 'sans' ? SANS : KAI; }
  function measure(str, fs, font, ls) {
    if (!ctx) {
      try { ctx = document.createElement('canvas').getContext('2d'); } catch (e) { ctx = null; }
    }
    if (!ctx) return str.length * fs;
    ctx.font = '100px ' + fontFamily(font);
    return ctx.measureText(str).width * fs / 100 + (ls || 0) * str.length;
  }
  function wrap(text, maxW, fs, font, ls) {
    var out = [];
    String(text).split('\n').forEach(function (para) {
      if (maxW <= 0) { out.push(para); return; }
      var line = '';
      for (var i = 0; i < para.length; i++) {
        var ch = para[i], test = line + ch;
        if (line && measure(test, fs, font, ls) > maxW + 0.01) {
          // 避免標點在行首
          if ('，。、；：！？）」』'.indexOf(ch) >= 0) { out.push(test); line = ''; continue; }
          out.push(line); line = ch;
        } else line = test;
      }
      out.push(line);
    });
    return out;
  }
  function fill(str, fields) {
    var out = String(str == null ? '' : str);
    for (var pass = 0; pass < 3 && /\{\w+\}/.test(out); pass++) {   // 欄位內容本身也可含 {欄位}
      out = out.replace(/\{(\w+)\}/g, function (m, k) { return fields[k] != null ? fields[k] : ''; });
    }
    return out;
  }

  /* 自動編號 A..Z, AA.. */
  var STEMS = '甲乙丙丁戊己庚辛壬癸';
  function codeAt(i, scheme) {
    if (scheme === 'num') return String(i + 1);
    if (scheme === 'stem') return STEMS[i % 10] + (i >= 10 ? Math.floor(i / 10) : '');
    return i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + i % 26);
  }
  function nextCode(features, scheme) {
    var used = {};
    features.forEach(function (f) { used[f.code] = 1; });
    for (var i = 0; i < 702; i++) { var s = codeAt(i, scheme); if (!used[s]) return s; }
    return '?';
  }
  /* 方案（同一案件的不同分割方案）各自保有的資料 */
  var PLAN_KEYS = ['elements', 'features', 'annos', 'userLines', 'segStyle', 'splits', 'textOver', 'layerRoles', 'output', 'ovs', 'activeOv', 'merge'];

  global.Model = {
    FIELDS: FIELDS, KAI: KAI, SANS: SANS, uid: uid, newProject: newProject, defaultElements: defaultElements,
    defaultStyles: defaultStyles, measure: measure, codeAt: codeAt, PLAN_KEYS: PLAN_KEYS, wrap: wrap, fill: fill, fontFamily: fontFamily, nextCode: nextCode
  };
})(typeof window !== 'undefined' ? window : globalThis);
