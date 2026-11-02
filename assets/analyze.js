// Read every part's files (model, drawing, flat pattern) and work out what the part is: revision,
// process, material, mass. The checks then compare these facts across the files.
(function (PC) {
  'use strict';
  const PROCESS = {
    molded: 'Injection molded', sheet: 'Sheet metal', machined: 'CNC machined', printed: '3D printed',
    cast: 'Cast', purchased: 'Purchased', unknown: 'Process not known',
  };

  // Tessellation fine enough for a smooth preview, coarse enough to stay quick on big parts.
  const TESS = { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.0015, angularDeflection: 0.35 };

  async function readModel(f) {
    if (f.kind === 'mesh') return { mesh: PC.mesh.fromStl(f.bytes), header: null };
    const kind = /\.(iges|igs)$/i.test(f.name) ? 'iges' : /\.brep$/i.test(f.name) ? 'brep' : 'step';
    const header = kind === 'step' ? PC.pkg.stepHeader(new TextDecoder().decode(f.bytes)) : null;
    const res = await PC.libs.readCad(kind, f.bytes, TESS);
    if (!res || !res.success || !res.meshes.length) throw new Error('OpenCascade could not read any solid from ' + f.name);
    return { mesh: PC.mesh.fromOcct(res), header, ms: res.ms, tree: res.root };
  }

  async function analyzePart(p, log) {
    const byKind = k => p.files.filter(f => f.kind === k);
    p.model = byKind('model')[0] || byKind('mesh')[0] || null;
    p.drawingFile = byKind('drawing')[0] || null;
    p.flatFile = byKind('flat')[0] || null;
    if (p.model) {
      log('Reading ' + p.model.name);
      try {
        const r = await readModel(p.model);
        Object.assign(p, { mesh: r.mesh, header: r.header, readMs: r.ms });
        p.stats = PC.mesh.stats(r.mesh);
      } catch (e) { p.modelError = e.message || String(e); }
    }
    if (p.drawingFile) {
      log('Reading the drawing ' + p.drawingFile.name);
      try { p.drawing = await PC.drawing.readPdf(p.drawingFile.bytes); } catch (e) { p.drawingError = e.message || String(e); }
    }
    if (p.flatFile) {
      try { p.flat = PC.drawing.readDxf(new TextDecoder().decode(p.flatFile.bytes)); } catch (e) { p.flatError = e.message || String(e); }
    }
    const F = k => (p.drawing && p.drawing.fields[k] ? p.drawing.fields[k].value : '');

    // Revisions as each file states them.
    p.revs = [];
    for (const f of p.files) if (f.rev) p.revs.push({ src: f.name, kind: f.kind, rev: f.rev, how: 'file name' });
    if (p.header && p.header.revision) p.revs.push({ src: p.model.name, kind: 'model', rev: p.header.revision.toUpperCase(), how: 'inside the STEP' });
    if (F('rev')) p.revs.push({ src: p.drawingFile.name, kind: 'drawing', rev: F('rev').toUpperCase(), how: 'title block' });
    if (p.drawing && p.drawing.latestRev) p.revs.push({ src: p.drawingFile.name, kind: 'drawing', rev: p.drawing.latestRev, how: 'revision table' });
    if (p.flat && p.flat.rev) p.revs.push({ src: p.flatFile.name, kind: 'flat', rev: p.flat.rev, how: 'text in the DXF' });
    if (p.bom && p.bom.rev) p.revs.push({ src: 'BOM', kind: 'bom', rev: p.bom.rev, how: 'BOM' });
    p.rev = F('rev').toUpperCase() || (p.model && p.model.rev) || (p.bom && p.bom.rev) || (p.revs[0] && p.revs[0].rev) || '';

    // Name, material, process, mass.
    const product = p.header && p.header.products[0];
    p.name = F('title') || (p.bom && p.bom.desc) || (product && product.name) || p.desc || p.label;
    const matText = F('material') || (p.bom && p.bom.material) || '';
    p.material = { text: matText, source: F('material') ? 'drawing' : p.bom && p.bom.material ? 'BOM' : '', match: PC.materials.match(matText) };
    const D = p.drawing || {};
    p.process = (p.bom && p.bom.process) ||
      (p.flat || D.flatNote || (D.bendNote && /BEND|UP\s*\d/.test(D.bendNote)) || /\b\d+\s*GA\b|\bGAUGE\b|\bSHT\b|\bSHEET\b/i.test(matText) ? 'sheet' : null) ||
      (p.material.match && p.material.match.process) || 'unknown';
    if (p.stats && p.material.match) p.mass = p.stats.volume / 1000 * p.material.match.density;
    if (p.process === 'sheet' && p.mesh) {
      const solid = p.stats.bodies.filter(PC.mesh.nearlyClosed).map(b => b.index);
      p.flatSheet = PC.mesh.isFlat(p.mesh, p.stats.bbox, solid.length ? solid : null);
    }
    p.drawingMass = PC.drawing.massGrams(F('mass'));
    p.processLabel = PROCESS[p.process] || p.process;
  }

  async function analyze(pkg, log) {
    for (const p of pkg.parts) {
      await analyzePart(p, log);
      await PC.util.nextFrame();
    }
    pkg.results = PC.checks.run(pkg);
    pkg.findings = pkg.results.filter(r => r.sev !== 'ok');
  }

  PC.analyze = { analyze, analyzePart, readModel, PROCESS };
})(window.PC = window.PC || {});
