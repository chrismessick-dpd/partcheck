// Exports: mesh formats for viewing and printing (STL, OBJ, GLB), preview images, and the preview
// pack Signoff PL would read. STEP can't be written here: OpenCascade's browser build only reads.
(function (PC) {
  'use strict';
  const U = PC.util;
  const safe = s => String(s || 'part').replace(/[^A-Za-z0-9._-]+/g, '_');
  const baseName = p => safe(p.label + (p.rev ? '_' + p.rev : '') + (p.desc ? '_' + p.desc.replace(/\s+/g, '-') : ''));

  function triNormal(m, t, n) { PC.mesh.faceNormal(m.pos, m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2], n); return n; }

  // Binary STL in mm.
  function stl(p) {
    const m = p.mesh, nt = m.idx.length / 3, buf = new ArrayBuffer(84 + nt * 50), dv = new DataView(buf), n = [0, 0, 0];
    const head = ('Partcheck ' + p.label + ' rev ' + (p.rev || '?') + ' (mm)').slice(0, 80);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
    dv.setUint32(80, nt, true);
    for (let t = 0; t < nt; t++) {
      const o = 84 + t * 50;
      triNormal(m, t, n);
      for (let k = 0; k < 3; k++) dv.setFloat32(o + k * 4, n[k], true);
      for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) dv.setFloat32(o + 12 + c * 12 + k * 4, m.pos[m.idx[t * 3 + c] * 3 + k], true);
    }
    return new Blob([buf], { type: 'model/stl' });
  }

  function obj(p) {
    const m = p.mesh, out = ['# Partcheck export: ' + p.label + ' rev ' + (p.rev || '?') + ', units mm', 'o ' + safe(p.label)];
    for (let v = 0; v < m.pos.length; v += 3) out.push('v ' + m.pos[v].toFixed(5) + ' ' + m.pos[v + 1].toFixed(5) + ' ' + m.pos[v + 2].toFixed(5));
    for (let v = 0; v < m.nrm.length; v += 3) out.push('vn ' + m.nrm[v].toFixed(4) + ' ' + m.nrm[v + 1].toFixed(4) + ' ' + m.nrm[v + 2].toFixed(4));
    for (let t = 0; t < m.idx.length; t += 3) { const a = m.idx[t] + 1, b = m.idx[t + 1] + 1, c = m.idx[t + 2] + 1; out.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`); }
    return new Blob([out.join('\n') + '\n'], { type: 'text/plain' });
  }

  // glTF binary: meters and Y-up, as glTF requires (PowerPoint, Windows 3D Viewer, web viewers).
  function glb(p) {
    const m = p.mesh, nv = m.pos.length / 3;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nv; v++) {
      // CAD (x, y, z) Z-up → glTF (x, z, -y) Y-up, mm → m
      const x = m.pos[v * 3] / 1000, y = m.pos[v * 3 + 2] / 1000, z = -m.pos[v * 3 + 1] / 1000;
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      nrm[v * 3] = m.nrm[v * 3]; nrm[v * 3 + 1] = m.nrm[v * 3 + 2]; nrm[v * 3 + 2] = -m.nrm[v * 3 + 1];
      [x, y, z].forEach((c, k) => { if (c < lo[k]) lo[k] = c; if (c > hi[k]) hi[k] = c; });
    }
    const idx = new Uint32Array(m.idx);
    const parts = [pos, nrm, idx].map(a => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
    let off = 0;
    const views = parts.map((b, i) => { const v = { buffer: 0, byteOffset: off, byteLength: b.length, target: i < 2 ? 34962 : 34963 }; off += Math.ceil(b.length / 4) * 4; return v; });
    const metal = p.material && p.material.match && p.material.match.kind === 'metal';
    const col = (p.mesh.colors && p.mesh.colors[0]) || (metal ? [0.74, 0.76, 0.79] : [0.93, 0.93, 0.91]);
    const json = {
      asset: { version: '2.0', generator: 'Partcheck' }, scene: 0, scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: p.label + (p.rev ? ' rev ' + p.rev : '') }],
      meshes: [{ name: p.name || p.label, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
      materials: [{ name: (p.material && p.material.match && p.material.match.name) || 'part', pbrMetallicRoughness: { baseColorFactor: [...col, 1], metallicFactor: metal ? 0.6 : 0, roughnessFactor: metal ? 0.4 : 0.6 } }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: nv, type: 'VEC3', min: lo, max: hi },
        { bufferView: 1, componentType: 5126, count: nv, type: 'VEC3' },
        { bufferView: 2, componentType: 5125, count: idx.length, type: 'SCALAR' },
      ],
      bufferViews: views, buffers: [{ byteLength: off }],
    };
    let js = new TextEncoder().encode(JSON.stringify(json));
    const jsLen = Math.ceil(js.length / 4) * 4;
    const total = 12 + 8 + jsLen + 8 + off, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsLen, true); dv.setUint32(16, 0x4E4F534A, true);
    out.fill(0x20, 20, 20 + jsLen); out.set(js, 20);
    dv.setUint32(20 + jsLen, off, true); dv.setUint32(24 + jsLen, 0x004E4942, true);
    views.forEach((v, i) => out.set(parts[i], 28 + jsLen + v.byteOffset));
    return new Blob([out], { type: 'model/gltf-binary' });
  }

  const png = url => new Blob([U.dataUrlToBytes(url)], { type: 'image/png' });

  const FORMATS = {
    stl: { label: 'STL', ext: 'stl', make: stl, what: 'Binary STL in mm, for 3D printing and slicers.' },
    obj: { label: 'OBJ', ext: 'obj', make: obj, what: 'Wavefront OBJ in mm, for renderers and Blender.' },
    glb: { label: 'GLB', ext: 'glb', make: glb, what: 'glTF binary (meters, Y-up). Opens in PowerPoint (Insert > 3D Model), Windows 3D Viewer and web viewers.' },
    png: { label: 'PNG views', ext: 'png', make: p => png(PC.viewer.viewSheet(p, 1280, 960)), what: 'Iso, top, front, and right views on one 1280 × 960 image.' },
  };

  // ── Preview pack: what Signoff PL would read (see docs/preview-format.md) ──
  function summary(p, pkg) {
    const s = p.stats || {}, b = s.bbox, f = pkg.findings.filter(x => x.part === p.key);
    const count = sev => f.filter(x => x.sev === sev).length;
    return {
      partNumber: p.pn, revision: p.rev || null, name: p.name, process: p.process,
      material: p.material.text || null, materialFamily: p.material.match ? p.material.match.name : null,
      density_g_cm3: p.material.match ? p.material.match.density : null,
      volume_mm3: s.volume != null ? +s.volume.toFixed(1) : null, area_mm2: s.area != null ? +s.area.toFixed(1) : null,
      mass_g: p.mass != null ? +p.mass.toFixed(2) : null, massSource: p.mass != null ? 'computed: model volume × density' : null,
      massOnDrawing_g: p.drawingMass != null ? +p.drawingMass.toFixed(2) : null,
      bbox_mm: b ? b.size.map(v => +v.toFixed(2)) : null, bodies: p.mesh ? p.mesh.bodies : null, closed: s.closed != null ? s.closed : null,
      throughHoles: s.holes != null ? s.holes : null,
      findings: { error: count('error'), warn: count('warn'), info: count('info') },
      model: p.model ? { file: p.model.name, sha256: p.model.sha256 } : null,
      at: pkg.at,
    };
  }

  async function previewPack(pkg, hero) {
    const z = new JSZip(), dir = z.folder('preview'), items = [];
    for (const p of pkg.parts) {
      if (!p.mesh || !p.stats) continue;
      const key = safe(p.pn || p.label);
      dir.file(key + '.png', U.dataUrlToBytes(p.thumb || PC.viewer.snapshot(p)));
      dir.file(key + '-views.png', U.dataUrlToBytes(PC.viewer.viewSheet(p)));
      dir.file(key + '.json', JSON.stringify(summary(p, pkg), null, 2));
      items.push({ key, partNumber: p.pn, revision: p.rev || null, name: p.name, png: key + '.png', views: key + '-views.png', json: key + '.json' });
    }
    const index = {
      format: 'signoff-preview/1', tool: { name: 'Partcheck', version: PC.VERSION || 'dev' }, at: pkg.at,
      package: { name: pkg.name, sha256: pkg.sha256 }, hero: hero || (items[0] && items[0].key) || null, items,
    };
    dir.file('index.json', JSON.stringify(index, null, 2));
    z.file('partcheck-run.json', JSON.stringify(runRecord(pkg), null, 2));
    return z.generateAsync({ type: 'blob' });
  }

  function runRecord(pkg) {
    const n = sev => pkg.findings.filter(f => f.sev === sev).length;
    return {
      tool: { name: 'Partcheck', version: PC.VERSION || 'dev' }, at: pkg.at,
      package: { name: pkg.name, sha256: pkg.sha256, files: pkg.files.map(f => ({ path: f.path, size: f.size, sha256: f.sha256, kind: f.kind })) },
      summary: { error: n('error'), warn: n('warn'), info: n('info') },
      parts: pkg.parts.map(p => ({ key: p.key, partNumber: p.pn, revision: p.rev || null, name: p.name, process: p.process })),
      results: pkg.results.map(r => ({ check: r.check, part: r.part, sev: r.sev, title: r.title, detail: r.detail, related: r.related })),
    };
  }

  PC.export = { FORMATS, previewPack, runRecord, summary, baseName, safe, png };
})(window.PC = window.PC || {});
