// node tests/geom.test.js  — 驗證 DXF 解析與自動成面面積
const fs = require('fs'), path = require('path');
require('../app/js/geom.js'); require('../app/js/dxf.js');
const root = path.join(__dirname, '..', 'samples');
const kc = DXF.parse(DXF.decodeBytes(fs.readFileSync(path.join(root, 'KC1117.DXF'))));
const segs = kc.lines.map(l => [l.x1, l.y1, l.x2, l.y2]);
const faces = Geom.buildFaces(segs, 0.002).map(f => Geom.area(f).toFixed(2)).sort((a,b)=>a-b);
console.log('case faces:', faces.join(', '));
const expect = ['75.51','88.04','90.81','96.63','103.16','104.84','107.11','110.20','212.02'];
const big = DXF.parse(DXF.decodeBytes(fs.readFileSync(path.join(root, '486.dxf'))));
console.log('486.dxf lines', big.lines.length, 'texts', big.texts.length, 'layers', JSON.stringify(big.layers));
// 案件線＋地籍線一起成面（實際作業方式）
const B = [220981.88, 2706829.24, 221081.88, 2706929.24], all = [];
for (const l of big.lines) { const c = Geom.clipSeg(l.x1, l.y1, l.x2, l.y2, B[0] - 50, B[1] - 50, B[2] + 50, B[3] + 50); if (c) all.push(c); }
const faces2 = Geom.buildFaces(all, 0.002).map(f => Geom.area(f).toFixed(2));
const miss2 = expect.filter(e => !faces2.includes(e));
console.log('with LIN, missing:', miss2);
if (miss2.length) { console.error('MISSING', miss); process.exit(1); }
console.log('OK');
