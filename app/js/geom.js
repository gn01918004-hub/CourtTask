/* 幾何運算：面積、裁切、交點、自動成面 */
(function (global) {
  'use strict';
  var EPS = 1e-9;

  function signedArea(pts) {
    var s = 0, n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      s += a[0] * b[1] - b[0] * a[1];
    }
    return s / 2;
  }
  function area(pts) { return Math.abs(signedArea(pts)); }

  function centroid(pts) {
    var a = signedArea(pts), cx = 0, cy = 0, n = pts.length;
    if (Math.abs(a) < EPS) {
      for (var i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; }
      return [cx / n, cy / n];
    }
    // 以第一點為原點計算，避免 TWD97 大座標造成精度損失
    var ox = pts[0][0], oy = pts[0][1];
    for (var j = 0; j < n; j++) {
      var p = pts[j], q = pts[(j + 1) % n];
      var x0 = p[0] - ox, y0 = p[1] - oy, x1 = q[0] - ox, y1 = q[1] - oy;
      var f = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    return [ox + cx / (6 * a), oy + cy / (6 * a)];
  }

  function pointInPoly(p, pts) {
    var x = p[0], y = p[1], inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function distToSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var l2 = dx * dx + dy * dy, t = 0;
    if (l2 > 0) t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    var x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1];
    return Math.sqrt(x * x + y * y);
  }

  /* 標籤位置：面積重心若不在多邊形內，改用格點搜尋離邊界最遠的點 */
  function labelPoint(pts) {
    var c = centroid(pts);
    if (pointInPoly(c, pts) && edgeDist(c, pts) > 0) {
      return c;
    }
    var b = bbox(pts), best = null, bestD = -1, N = 24;
    for (var i = 1; i < N; i++) for (var j = 1; j < N; j++) {
      var p = [b[0] + (b[2] - b[0]) * i / N, b[1] + (b[3] - b[1]) * j / N];
      if (!pointInPoly(p, pts)) continue;
      var d = edgeDist(p, pts);
      if (d > bestD) { bestD = d; best = p; }
    }
    return best || c;
  }
  function edgeDist(p, pts) {
    var m = Infinity;
    for (var i = 0; i < pts.length; i++) m = Math.min(m, distToSeg(p, pts[i], pts[(i + 1) % pts.length]));
    return m;
  }
  function bbox(pts) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    }
    return b;
  }

  /* Liang-Barsky 線段裁切，回傳 [x1,y1,x2,y2] 或 null */
  function clipSeg(x1, y1, x2, y2, xmin, ymin, xmax, ymax) {
    var dx = x2 - x1, dy = y2 - y1, t0 = 0, t1 = 1;
    var p = [-dx, dx, -dy, dy], q = [x1 - xmin, xmax - x1, y1 - ymin, ymax - y1];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) { if (q[i] < 0) return null; }
      else {
        var r = q[i] / p[i];
        if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
      }
    }
    return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
  }

  /* Sutherland–Hodgman 多邊形裁切至矩形 */
  function clipPoly(pts, xmin, ymin, xmax, ymax) {
    var edges = [
      function (p) { return p[0] >= xmin; }, function (a, b) { var t = (xmin - a[0]) / (b[0] - a[0]); return [xmin, a[1] + t * (b[1] - a[1])]; },
      function (p) { return p[0] <= xmax; }, function (a, b) { var t = (xmax - a[0]) / (b[0] - a[0]); return [xmax, a[1] + t * (b[1] - a[1])]; },
      function (p) { return p[1] >= ymin; }, function (a, b) { var t = (ymin - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ymin]; },
      function (p) { return p[1] <= ymax; }, function (a, b) { var t = (ymax - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), ymax]; }
    ];
    var out = pts.slice();
    for (var e = 0; e < 8; e += 2) {
      var inside = edges[e], inter = edges[e + 1], inp = out; out = [];
      if (!inp.length) break;
      for (var i = 0; i < inp.length; i++) {
        var cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
        if (inside(cur)) { if (!inside(prev)) out.push(inter(prev, cur)); out.push(cur); }
        else if (inside(prev)) out.push(inter(prev, cur));
      }
    }
    return out;
  }

  function segIntersect(a1, a2, b1, b2) {
    var rx = a2[0] - a1[0], ry = a2[1] - a1[1], sx = b2[0] - b1[0], sy = b2[1] - b1[1];
    var den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    var qx = b1[0] - a1[0], qy = b1[1] - a1[1];
    var t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return { t: t, u: u, x: a1[0] + t * rx, y: a1[1] + t * ry };
  }

  /* 線段網路 → 平面圖的所有封閉面。segs: [[x1,y1,x2,y2],...]，tol: 合併節點容許(公尺) */
  function buildFaces(segs, tol) {
    tol = tol || 0.002;
    var n = segs.length, cuts = [];
    var len = [];
    for (var i = 0; i < n; i++) {
      cuts.push([0, 1]);
      var s = segs[i]; len.push(Math.hypot(s[2] - s[0], s[3] - s[1]) || 1);
    }
    for (i = 0; i < n; i++) {
      var A = segs[i], a1 = [A[0], A[1]], a2 = [A[2], A[3]];
      var ab = [Math.min(A[0], A[2]) - tol, Math.min(A[1], A[3]) - tol, Math.max(A[0], A[2]) + tol, Math.max(A[1], A[3]) + tol];
      for (var j = i + 1; j < n; j++) {
        var B = segs[j];
        if (Math.max(B[0], B[2]) < ab[0] || Math.min(B[0], B[2]) > ab[2] || Math.max(B[1], B[3]) < ab[1] || Math.min(B[1], B[3]) > ab[3]) continue;
        var b1 = [B[0], B[1]], b2 = [B[2], B[3]];
        var r = segIntersect(a1, a2, b1, b2);
        if (r) {
          var ti = tol / len[i], tj = tol / len[j];
          if (r.t > -ti && r.t < 1 + ti && r.u > -tj && r.u < 1 + tj) {
            cuts[i].push(Math.max(0, Math.min(1, r.t)));
            cuts[j].push(Math.max(0, Math.min(1, r.u)));
          }
        }
        // 端點落在另一線段上（含平行重疊）
        [[b1, i, A], [b2, i, A]].forEach(function (it) {
          if (distToSeg(it[0], a1, a2) < tol) cuts[i].push(projT(it[0], a1, a2));
        });
        [[a1, j], [a2, j]].forEach(function (it) {
          if (distToSeg(it[0], b1, b2) < tol) cuts[j].push(projT(it[0], b1, b2));
        });
      }
    }
    // 節點
    var nodes = [], grid = {}, cell = tol * 4;
    function nodeId(x, y) {
      var gx = Math.floor(x / cell), gy = Math.floor(y / cell);
      for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
        var arr = grid[(gx + dx) + ',' + (gy + dy)];
        if (!arr) continue;
        for (var k = 0; k < arr.length; k++) {
          var nd = nodes[arr[k]];
          if (Math.abs(nd[0] - x) <= tol && Math.abs(nd[1] - y) <= tol) return arr[k];
        }
      }
      nodes.push([x, y]);
      var key = gx + ',' + gy; (grid[key] = grid[key] || []).push(nodes.length - 1);
      return nodes.length - 1;
    }
    var edgeSet = {}, adj = [];
    for (i = 0; i < n; i++) {
      var S = segs[i], c = cuts[i].sort(function (p, q) { return p - q; });
      var prev = null;
      for (var k = 0; k < c.length; k++) {
        var id = nodeId(S[0] + c[k] * (S[2] - S[0]), S[1] + c[k] * (S[3] - S[1]));
        if (prev !== null && prev !== id) {
          var key = prev < id ? prev + '_' + id : id + '_' + prev;
          if (!edgeSet[key]) {
            edgeSet[key] = 1;
            (adj[prev] = adj[prev] || []).push(id);
            (adj[id] = adj[id] || []).push(prev);
          }
        }
        prev = id;
      }
    }
    // 移除懸空線（度數 1 的節點）
    var deg = nodes.map(function (_, idx) { return (adj[idx] || []).length; });
    var stack = [];
    deg.forEach(function (d, idx) { if (d === 1) stack.push(idx); });
    var removed = {};
    while (stack.length) {
      var v = stack.pop();
      if (removed[v] || deg[v] !== 1) continue;
      removed[v] = 1; deg[v] = 0;
      (adj[v] || []).forEach(function (w) {
        if (removed[w]) return;
        deg[w]--; if (deg[w] === 1) stack.push(w);
      });
    }
    var out = [];
    for (v = 0; v < nodes.length; v++) {
      if (removed[v] || !adj[v]) { out.push([]); continue; }
      var list = adj[v].filter(function (w) { return !removed[w]; });
      list.sort(function (p, q) {
        return Math.atan2(nodes[p][1] - nodes[v][1], nodes[p][0] - nodes[v][0]) - Math.atan2(nodes[q][1] - nodes[v][1], nodes[q][0] - nodes[v][0]);
      });
      out.push(list);
    }
    // 走訪半邊：每個半邊左側的面
    var used = {}, faces = [];
    for (v = 0; v < nodes.length; v++) {
      for (var e = 0; e < out[v].length; e++) {
        var w = out[v][e];
        if (used[v + '>' + w]) continue;
        var poly = [], u = v, x = w, guard = 0;
        while (!used[u + '>' + x] && guard++ < 100000) {
          used[u + '>' + x] = 1;
          poly.push(nodes[u]);
          var lst = out[x], idx = lst.indexOf(u);
          var nx = lst[(idx - 1 + lst.length) % lst.length];
          u = x; x = nx;
        }
        if (poly.length >= 3) {
          var sa = signedArea(relative(poly));
          if (sa > 1e-6) faces.push(poly);
        }
      }
    }
    return faces;
  }
  function projT(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    if (!l2) return 0;
    return Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  }
  function relative(poly) {
    var ox = poly[0][0], oy = poly[0][1];
    return poly.map(function (p) { return [p[0] - ox, p[1] - oy]; });
  }

  /* 找出包含 p 的最小封閉面 */
  function faceAt(segs, p, tol) {
    var faces = buildFaces(segs, tol), best = null, bestA = Infinity;
    for (var i = 0; i < faces.length; i++) {
      if (!pointInPoly(p, faces[i])) continue;
      var a = area(faces[i]);
      if (a < bestA) { bestA = a; best = faces[i]; }
    }
    return best ? simplify(best) : null;
  }
  /* 移除共線中間點 */
  function simplify(pts) {
    var res = pts.slice(), changed = true;
    while (changed && res.length > 3) {
      changed = false;
      for (var i = 0; i < res.length; i++) {
        var a = res[(i - 1 + res.length) % res.length], b = res[i], c = res[(i + 1) % res.length];
        var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        var l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
        if (Math.abs(cross) / l < 1e-4) { res.splice(i, 1); changed = true; break; }
      }
    }
    return res;
  }

  function median(arr) {
    if (!arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  global.Geom = {
    signedArea: signedArea, area: function (pts) { return Math.abs(signedArea(relative(pts))); },
    centroid: centroid, pointInPoly: pointInPoly, distToSeg: distToSeg,
    labelPoint: labelPoint, bbox: bbox, clipSeg: clipSeg, clipPoly: clipPoly,
    segIntersect: segIntersect, buildFaces: buildFaces, faceAt: faceAt, simplify: simplify, median: median
  };
})(typeof window !== 'undefined' ? window : globalThis);
