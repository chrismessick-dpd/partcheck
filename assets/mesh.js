// Triangle-mesh geometry: what a STEP becomes after OpenCascade tessellates it. Mass properties,
// a closed-solid test, through-holes from the Euler characteristic, and the two analysis views
// (draft for a pull direction, wall thickness by ray casting). Units are mm throughout.
(function (PC) {
  'use strict';

  // occt-import-js result → one mesh. Positions are already in model coordinates.
  function fromOcct(res) {
    let nv = 0, nt = 0;
    for (const m of res.meshes) { nv += m.attributes.position.array.length / 3; nt += m.index.array.length / 3; }
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint32Array(nt * 3), body = new Uint16Array(nt);
    const colors = [];
    let vo = 0, to = 0;
    res.meshes.forEach((m, bi) => {
      const p = m.attributes.position.array, n = m.attributes.normal && m.attributes.normal.array, ix = m.index.array;
      pos.set(p, vo * 3);
      if (n && n.length === p.length) nrm.set(n, vo * 3);
      for (let i = 0; i < ix.length; i++) idx[to * 3 + i] = ix[i] + vo;
      body.fill(bi, to, to + ix.length / 3);
      colors.push(m.color || null);
      vo += p.length / 3; to += ix.length / 3;
    });
    const mesh = { pos, nrm, idx, body, bodies: res.meshes.length, names: res.meshes.map(m => m.name || ''), colors };
    if (!res.meshes.some(m => m.attributes.normal)) smoothNormals(mesh);
    return mesh;
  }

  // Binary or ASCII STL → mesh (3D-print packages often carry STL instead of STEP).
  function fromStl(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = bytes.length >= 84 ? dv.getUint32(80, true) : 0;
    let tri = [];
    if (bytes.length === 84 + n * 50 && n > 0) {
      tri = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(84 + i * 50 + 12 + k * 4, true);
    } else {
      const text = new TextDecoder().decode(bytes);
      const v = [...text.matchAll(/vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g)].map(m => [+m[1], +m[2], +m[3]]);
      tri = new Float32Array(v.flat());
    }
    const nt = tri.length / 9;
    const idx = new Uint32Array(nt * 3).map((_, i) => i);
    const mesh = { pos: tri, nrm: new Float32Array(tri.length), idx, body: new Uint16Array(nt), bodies: 1, names: [''], colors: [null] };
    smoothNormals(mesh, true);
    return mesh;
  }

  function faceNormal(p, a, b, c, out) {
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    out[0] = l ? x / l : 0; out[1] = l ? y / l : 0; out[2] = l ? z / l : 0;
    return l / 2; // triangle area
  }

  function smoothNormals(mesh, flat) {
    const { pos, idx, nrm } = mesh, n = [0, 0, 0];
    nrm.fill(0);
    for (let t = 0; t < idx.length; t += 3) {
      faceNormal(pos, idx[t], idx[t + 1], idx[t + 2], n);
      for (let k = 0; k < 3; k++) { const v = idx[t + k]; nrm[v * 3] += n[0]; nrm[v * 3 + 1] += n[1]; nrm[v * 3 + 2] += n[2]; }
    }
    for (let v = 0; v < nrm.length; v += 3) { const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1; nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l; }
    if (flat) mesh.flat = true;
  }

  function bbox(pos) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], diag: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
  }

  // Weld vertices that share a position: OpenCascade meshes each b-rep face on its own, so the
  // same point appears once per face. Topology (closed? holes?) needs one id per point.
  function weld(mesh, box) {
    const q = Math.max(box.diag, 1e-9) * 1e-5, map = new Map(), id = new Uint32Array(mesh.pos.length / 3);
    // vertices weld only within their own body
    const vb = new Uint16Array(id.length);
    if (mesh.body) for (let t = 0; t < mesh.idx.length / 3; t++) for (let k = 0; k < 3; k++) vb[mesh.idx[t * 3 + k]] = mesh.body[t];
    let n = 0;
    for (let v = 0; v < id.length; v++) {
      const k = vb[v] + ':' + Math.round(mesh.pos[v * 3] / q) + ',' + Math.round(mesh.pos[v * 3 + 1] / q) + ',' + Math.round(mesh.pos[v * 3 + 2] / q);
      let w = map.get(k);
      if (w === undefined) { w = n++; map.set(k, w); }
      id[v] = w;
    }
    return { id, count: n };
  }

  // A body that is open but nearly closed (a few tessellation gaps: a handful of stray edges, and
  // a tiny share of all its edges) still counts as a solid. A real surface patch is mostly edge.
  const nearlyClosed = b => b.closed || (b.open + b.nonManifold <= Math.max(6, b.edges * 0.001) && b.open + b.nonManifold <= b.edges * 0.02);

  // Mass properties and topology, body by body. A STEP often holds more than the part: a stray
  // construction surface, or several solids that touch. Each body is welded and counted on its
  // own, so touching solids don't read as non-manifold, and only closed bodies count for volume
  // and mass. Volume and centroid by the divergence theorem (signed tetrahedra).
  function stats(mesh) {
    const { pos, idx } = mesh, box = bbox(pos), n = [0, 0, 0], w = weld(mesh, box);
    const nb = Math.max(1, mesh.bodies || 1), nt = idx.length / 3;
    const B = Array.from({ length: nb }, (_, index) => ({ index, vol: 0, cx: 0, cy: 0, cz: 0, area: 0, edges: new Map(), faces: 0, used: new Set(), tris: 0 }));
    for (let t = 0; t < nt; t++) {
      const b = B[mesh.body ? mesh.body[t] : 0] || B[0];
      const ia = idx[t * 3] * 3, ib = idx[t * 3 + 1] * 3, ic = idx[t * 3 + 2] * 3;
      const x1 = pos[ia], y1 = pos[ia + 1], z1 = pos[ia + 2], x2 = pos[ib], y2 = pos[ib + 1], z2 = pos[ib + 2], x3 = pos[ic], y3 = pos[ic + 1], z3 = pos[ic + 2];
      const v = (x1 * (y2 * z3 - y3 * z2) - x2 * (y1 * z3 - y3 * z1) + x3 * (y1 * z2 - y2 * z1)) / 6;
      b.vol += v; b.cx += v * (x1 + x2 + x3) / 4; b.cy += v * (y1 + y2 + y3) / 4; b.cz += v * (z1 + z2 + z3) / 4;
      b.area += faceNormal(pos, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2], n);
      b.tris++;
      const a = w.id[idx[t * 3]], c2 = w.id[idx[t * 3 + 1]], c3 = w.id[idx[t * 3 + 2]];
      if (a === c2 || c2 === c3 || a === c3) continue; // degenerate sliver from tessellation
      b.faces++;
      b.used.add(a); b.used.add(c2); b.used.add(c3);
      for (const [u, vv] of [[a, c2], [c2, c3], [c3, a]]) {
        const k = u < vv ? u * 4294967296 + vv : vv * 4294967296 + u;
        b.edges.set(k, (b.edges.get(k) || 0) + 1);
      }
    }
    // per body: open and non-manifold edges, shells (connected pieces) and through-holes (genus)
    const bodies = B.filter(b => b.tris).map(b => {
      let open = 0, nonManifold = 0;
      for (const c of b.edges.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
      const parent = new Map([...b.used].map(v => [v, v]));
      const find = i => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
      for (const k of b.edges.keys()) { const u = Math.floor(k / 4294967296), v = k % 4294967296, ru = find(u), rv = find(v); if (ru !== rv) parent.set(ru, rv); }
      const shells = new Set([...b.used].map(find)).size;
      const closed = open === 0 && nonManifold === 0;
      const chi = b.used.size - b.edges.size + b.faces;
      const sign = b.vol < 0 ? -1 : 1;
      return { index: b.index, closed, open, nonManifold, shells, edges: b.edges.size, holes: closed ? Math.max(0, Math.round((2 * shells - chi) / 2)) : null,
        volume: Math.abs(b.vol), area: b.area, cx: b.cx * sign, cy: b.cy * sign, cz: b.cz * sign, triangles: b.tris };
    });
    const nearly = b => !b.closed && nearlyClosed(b);
    const solids = bodies.filter(b => b.closed || nearly(b)), surfaces = bodies.filter(b => !solids.includes(b));
    const vol = solids.reduce((s, b) => s + b.volume, 0);
    const sum = k => solids.reduce((s, b) => s + b[k], 0);
    const all = k => bodies.reduce((s, b) => s + b[k], 0);
    return {
      bbox: box, volume: vol, area: all('area'), centroid: vol ? [sum('cx') / vol, sum('cy') / vol, sum('cz') / vol] : null,
      triangles: nt, vertices: w.count, edges: all('edges'), bodies, solids: solids.length, surfaces: surfaces.length,
      closed: bodies.every(b => b.closed), openEdges: all('open'), nonManifold: all('nonManifold'),
      shells: all('shells'), holes: bodies.every(b => b.closed) ? all('holes') : null,
    };
  }

  // Is a sheet part flat (laser or punch only, no bends)? Its faces then all face along its thin
  // axis or square to it; bends add cylinder faces in between.
  // Only the given bodies count (the solids), so loose construction surfaces don't spoil it.
  function isFlat(mesh, box, bodies) {
    const { pos, idx } = mesh, ax = [0, 1, 2].reduce((m, k) => (box.size[k] < box.size[m] ? k : m), 0), n = [0, 0, 0];
    const keep = bodies ? new Set(bodies) : null;
    let total = 0, between = 0;
    for (let t = 0; t < idx.length / 3; t++) {
      if (keep && mesh.body && !keep.has(mesh.body[t])) continue;
      const a = faceNormal(pos, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2], n), c = Math.abs(n[ax]);
      total += a;
      if (c > 0.05 && c < 0.95) between += a;
    }
    return total > 0 && between / total < 0.005;
  }

  // ── Draft: angle of each face to a pull direction ──
  // draft = asin(|n·d|) is 90° for faces square to the pull and 0° for walls parallel to it.
  // Walls (faces within 60° of parallel) below the minimum are the ones a molder flags.
  function draft(mesh, dir, minDeg) {
    const { pos, idx } = mesh, nt = idx.length / 3, out = new Float32Array(nt), side = new Int8Array(nt), n = [0, 0, 0];
    const lim = Math.sin(minDeg * Math.PI / 180), zero = Math.sin(0.25 * Math.PI / 180);
    let wallArea = 0, lowArea = 0, zeroArea = 0;
    for (let t = 0; t < nt; t++) {
      const a = faceNormal(pos, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2], n);
      const c = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
      out[t] = Math.asin(Math.min(1, Math.abs(c))) * 180 / Math.PI;
      side[t] = c > zero ? 1 : c < -zero ? -1 : 0;
      if (Math.abs(c) < 0.5) { wallArea += a; if (Math.abs(c) < lim) lowArea += a; if (Math.abs(c) < zero) zeroArea += a; }
    }
    return { deg: out, side, minDeg, wallArea, lowArea, zeroArea };
  }

  // ── Bounding-volume hierarchy for ray casting ──
  function bvh(mesh) {
    const { pos, idx } = mesh, nt = idx.length / 3;
    const cen = new Float32Array(nt * 3), lo = new Float32Array(nt * 3), hi = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
      const a = pos[idx[t * 3] * 3 + k], b = pos[idx[t * 3 + 1] * 3 + k], c = pos[idx[t * 3 + 2] * 3 + k];
      lo[t * 3 + k] = Math.min(a, b, c); hi[t * 3 + k] = Math.max(a, b, c); cen[t * 3 + k] = (a + b + c) / 3;
    }
    const order = new Uint32Array(nt).map((_, i) => i);
    const nodes = []; // [lo3, hi3, left|start, right|count, leaf]
    function build(s, e) {
      const node = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
      for (let i = s; i < e; i++) { const t = order[i]; for (let k = 0; k < 3; k++) { node.lo[k] = Math.min(node.lo[k], lo[t * 3 + k]); node.hi[k] = Math.max(node.hi[k], hi[t * 3 + k]); } }
      nodes.push(node);
      if (e - s <= 6) { node.s = s; node.e = e; return node; }
      const ax = [0, 1, 2].reduce((m, k) => (node.hi[k] - node.lo[k] > node.hi[m] - node.lo[m] ? k : m), 0);
      const sub = Array.from(order.subarray(s, e)).sort((a, b) => cen[a * 3 + ax] - cen[b * 3 + ax]);
      order.set(sub, s);
      const mid = (s + e) >> 1;
      node.l = build(s, mid); node.r = build(mid, e);
      return node;
    }
    const root = build(0, nt);
    return { root, order, mesh };
  }

  function rayBox(o, inv, lo, hi, tmax) {
    let t0 = 0, t1 = tmax;
    for (let k = 0; k < 3; k++) {
      let a = (lo[k] - o[k]) * inv[k], b = (hi[k] - o[k]) * inv[k];
      if (a > b) { const x = a; a = b; b = x; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }

  // Nearest hit along d from o on a triangle facing away from the ray (the far wall's inside).
  function cast(tree, o, d, tmax, skip) {
    const { pos, idx } = tree.mesh, inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    let best = tmax, hit = -1;
    const stack = [tree.root];
    while (stack.length) {
      const nd = stack.pop();
      if (!rayBox(o, inv, nd.lo, nd.hi, best)) continue;
      if (nd.l) { stack.push(nd.l, nd.r); continue; }
      for (let i = nd.s; i < nd.e; i++) {
        const t = tree.order[i];
        if (t === skip) continue;
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        // the hit face must face along the ray (its normal · d > 0)
        const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
        if (nx * d[0] + ny * d[1] + nz * d[2] <= 0) continue;
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det, sx = o[0] - pos[a], sy = o[1] - pos[a + 1], sz = o[2] - pos[a + 2];
        const u = f * (sx * px + sy * py + sz * pz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
        if (v < 0 || u + v > 1) continue;
        const tt = f * (e2x * qx + e2y * qy + e2z * qz);
        if (tt > 1e-6 && tt < best) { best = tt; hit = t; }
      }
    }
    return hit < 0 ? null : best;
  }

  // Distance from p to the nearest point on the surface (closest point on a triangle per Ericson,
  // Real-Time Collision Detection 5.1.5), pruning BVH boxes that can't beat the best so far.
  function closestOnTri(p, a, b, c) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const at = (s, t) => [a[0] + ab[0] * s + ac[0] * t, a[1] + ab[1] * s + ac[1] * t, a[2] + ab[2] * s + ac[2] * t];
    const d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0);
    const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return [b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]; }
    const den = 1 / (va + vb + vc);
    return at(vb * den, vc * den);
  }
  function nearest(tree, p, maxD) {
    const { pos, idx } = tree.mesh, V = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
    let best = maxD * maxD;
    const stack = [tree.root];
    while (stack.length) {
      const nd = stack.pop();
      let d2 = 0;
      for (let k = 0; k < 3; k++) { const v = p[k] < nd.lo[k] ? nd.lo[k] - p[k] : p[k] > nd.hi[k] ? p[k] - nd.hi[k] : 0; d2 += v * v; }
      if (d2 >= best) continue;
      if (nd.l) { stack.push(nd.l, nd.r); continue; }
      for (let i = nd.s; i < nd.e; i++) {
        const t = tree.order[i], q = closestOnTri(p, V(idx[t * 3]), V(idx[t * 3 + 1]), V(idx[t * 3 + 2]));
        const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
        if (e < best) best = e;
      }
    }
    return Math.sqrt(best);
  }

  // Wall thickness at a surface point, the "rolling ball" way: the diameter of the largest sphere
  // that touches the point and stays inside the part. The inward ray's depth bounds it; bisection
  // finds the radius where the sphere first touches another surface. Unlike the bare ray depth,
  // this doesn't read a rim or an edge as thick when the ray runs down a wall lengthwise.
  function wallAt(tree, o, d, tmax, skip, steps) {
    const t = cast(tree, o, d, tmax, skip);
    if (t == null) return NaN;
    let lo = 0, hi = t / 2;
    for (let i = 0; i < steps; i++) {
      const r = (lo + hi) / 2, c = [o[0] + d[0] * r, o[1] + d[1] * r, o[2] + d[2] * r];
      if (nearest(tree, c, r) >= r * 0.995) lo = r; else hi = r;
    }
    return 2 * lo;
  }

  // ── Wall thickness: from points on each face, cast inward and measure to the far wall ──
  // Three samples per triangle (near each corner) so colors blend across large faces. Runs in
  // slices and reports progress, because a production part can have hundreds of thousands of faces.
  async function thickness(mesh, onProgress) {
    const tree = bvh(mesh), { pos, idx } = mesh, nt = idx.length / 3;
    const box = bbox(pos), eps = box.diag * 1e-6, n = [0, 0, 0];
    const per = nt > 30000 ? 1 : 3, steps = nt > 100000 ? 6 : 9;
    const val = new Float32Array(nt * 3).fill(NaN);
    const centre = new Float32Array(nt).fill(NaN), area = new Float32Array(nt);
    let t0 = performance.now();
    for (let t = 0; t < nt; t++) {
      area[t] = faceNormal(pos, idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2], n);
      const d = [-n[0], -n[1], -n[2]];
      const cx = (pos[idx[t * 3] * 3] + pos[idx[t * 3 + 1] * 3] + pos[idx[t * 3 + 2] * 3]) / 3;
      const cy = (pos[idx[t * 3] * 3 + 1] + pos[idx[t * 3 + 1] * 3 + 1] + pos[idx[t * 3 + 2] * 3 + 1]) / 3;
      const cz = (pos[idx[t * 3] * 3 + 2] + pos[idx[t * 3 + 1] * 3 + 2] + pos[idx[t * 3 + 2] * 3 + 2]) / 3;
      centre[t] = wallAt(tree, [cx + d[0] * eps, cy + d[1] * eps, cz + d[2] * eps], d, box.diag, t, steps);
      for (let k = 0; k < 3; k++) {
        if (per === 1) { val[t * 3 + k] = centre[t]; continue; }
        const v = idx[t * 3 + k] * 3;
        const o = [pos[v] * 0.7 + cx * 0.3 + d[0] * eps, pos[v + 1] * 0.7 + cy * 0.3 + d[1] * eps, pos[v + 2] * 0.7 + cz * 0.3 + d[2] * eps];
        val[t * 3 + k] = wallAt(tree, o, d, box.diag, t, steps);
      }
      if (onProgress && performance.now() - t0 > 40) { onProgress(t / nt); await PC.util.nextFrame(); t0 = performance.now(); }
    }
    // Nominal wall: the area-weighted median of the face-center readings.
    const rows = [];
    for (let t = 0; t < nt; t++) if (isFinite(centre[t])) rows.push([centre[t], area[t]]);
    rows.sort((a, b) => a[0] - b[0]);
    const total = rows.reduce((s, r) => s + r[1], 0);
    let acc = 0, nominal = null, p05 = null, p95 = null;
    for (const [v, a] of rows) {
      acc += a;
      if (p05 == null && acc >= total * 0.05) p05 = v;
      if (nominal == null && acc >= total * 0.5) nominal = v;
      if (p95 == null && acc >= total * 0.95) p95 = v;
    }
    let thick = 0;
    for (const [v, a] of rows) if (nominal && v > nominal * 1.5) thick += a;
    return { val, nominal, p05, p95, min: rows.length ? rows[0][0] : null, thickArea: thick, area: total };
  }

  PC.mesh = { fromOcct, fromStl, stats, draft, thickness, bbox, faceNormal, isFlat, nearlyClosed };
})(window.PC = window.PC || {});
