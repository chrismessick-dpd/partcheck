// Package checks. Each compares what the files say about a part and never judges the design:
// geometry DFM (draft, walls, radii) stays with the ME reviewer and Signoff ME's checklists.
// Every check names the Signoff ME checks it gives evidence for (`related`), so a finding can
// point a reviewer at the right checklist item.
(function (PC) {
  'use strict';
  const C = (id, group, title, related, what) => ({ id, group, title, related, what });
  const CATALOG = [
    C('files.model', 'Files', 'Every part has a 3D model', ['drw-sup-1', 'drw-rev-6'], 'A STEP (or IGES) for each fabricated part, so the vendor can quote, program or cut steel.'),
    C('files.drawing', 'Files', 'Every part has a drawing', ['drw-sup-1', 'drw-rev-6'], 'A PDF drawing carries tolerances, material, finish and inspection criteria: the STEP is nominal shape only.'),
    C('files.flat', 'Files', 'Sheet-metal parts have a flat pattern', ['drw-sm-1', 'pd-sm-3'], 'A DXF flat pattern, or a drawing note saying the shop makes its own.'),
    C('files.native', 'Files', 'Native CAD files', ['drw-rev-7'], 'SolidWorks, Creo or Inventor files can\'t be read here, and vendors usually want STEP. Fine to archive alongside.'),
    C('files.bom', 'Files', 'The BOM lists every part with files', ['drw-asm-1', 'drw-sup-1'], 'Parts in the package match the BOM, and fabricated BOM lines have files.'),
    C('rev.match', 'Revisions', 'Revisions agree across files', ['drw-rev-3', 'drw-rev-6', 'drw-tb-2', 'drw-sup-1'], 'File names, the STEP, the drawing title block, its revision table, the DXF and the BOM name the same revision.'),
    C('rev.step', 'Revisions', 'The STEP carries its revision', ['drw-rev-6', 'pd-cad-10'], 'Many CAD exports leave the revision out of the STEP; then only the file name ties the model to a revision.'),
    C('pn.match', 'Revisions', 'Part numbers agree', ['drw-tb-1', 'pd-cad-10'], 'The drawing\'s part number matches the file names, the STEP product and the BOM.'),
    C('model.read', 'Model', 'The model opens', ['pd-cad-3'], 'OpenCascade reads a solid from the STEP.'),
    C('model.solid', 'Model', 'One closed solid', ['pd-cad-4'], 'A single watertight body. Open edges or several bodies usually mean an export problem or a multibody part.'),
    C('model.units', 'Model', 'Model units are millimeters', ['pd-cad-5', 'drw-tb-5'], 'The STEP declares mm. Inch models are fine if the drawing agrees, but are a common source of 25.4× mistakes.'),
    C('dwg.text', 'Drawing', 'The drawing can be read', ['drw-rev-6'], 'A vector PDF with a text layer, exported from CAD. Scans and outlined text can\'t be checked.'),
    C('dwg.material', 'Drawing', 'Material is called out', ['drw-tb-3', 'drw-im-1', 'drw-sm-3'], 'Grade, standard or manufacturer and trade name.'),
    C('dwg.finish', 'Drawing', 'Finish is called out', ['drw-tb-4', 'drw-im-2'], 'Texture, plating, anodize or paint, or "none".'),
    C('dwg.tolerance', 'Drawing', 'General tolerances are stated', ['drw-tb-10'], 'A tolerance block or general tolerance note.'),
    C('dwg.standard', 'Drawing', 'The GD&T standard is named', ['drw-tb-11'], 'ASME Y14.5 (with its edition) or ISO GPS.'),
    C('dwg.units', 'Drawing', 'Units and projection are stated', ['drw-tb-5', 'drw-tb-6'], 'Drawing units, and first- or third-angle projection.'),
    C('dwg.signoff', 'Drawing', 'Drawn, checked and approved', ['drw-tb-9'], 'Names and dates in the title block. An RFQ can go out before approval; a release can\'t.'),
    C('dwg.revtable', 'Drawing', 'The revision table is current', ['drw-tb-2', 'drw-rev-1'], 'The newest row in the revision table is the title block\'s revision.'),
    C('mat.match', 'Material', 'Drawing and BOM name the same material', ['pd-cad-8', 'drw-tb-3', 'drw-im-1'], 'Same material family and grade on the drawing and in the BOM.'),
    C('mass.match', 'Material', 'Mass on the drawing matches the model', ['pd-cad-9', 'drw-tb-12'], 'Model volume × the material\'s density, against the mass in the title block (within 5%).'),
    C('sm.flat', 'Sheet metal', 'Flat pattern matches the model', ['drw-sm-1', 'pd-sm-3', 'drw-rev-6'], 'The DXF is at the part\'s revision and has the same number of holes as the 3D model.'),
    C('sm.notes', 'Sheet metal', 'Bend notes on the drawing', ['drw-sm-2'], 'Bend direction, angle and inside radius.'),
  ];
  const BY = Object.fromEntries(CATALOG.map(c => [c.id, c]));

  function run(pkg) {
    const out = [];
    const R = (check, part, sev, title, detail) => out.push({ check, part: part ? part.key : null, partLabel: part ? part.label : 'Package', sev, title, detail: detail || '', related: BY[check].related });
    const fab = p => p.process !== 'purchased';

    for (const p of pkg.parts) {
      const D = p.drawing, F = k => (D && D.fields[k] ? D.fields[k].value : '');
      // files
      if (!fab(p)) continue;
      if (p.bom && !p.files.length) {
        R('files.bom', p, 'error', 'In the BOM, but no files', 'BOM line ' + p.label + ' (' + (p.bom.desc || p.bom.type || 'fabricated') + ', rev ' + (p.bom.rev || '?') + ') has no model or drawing in the package.');
        continue;
      }
      if (!p.model) R('files.model', p, 'error', 'No 3D model', (p.files.some(f => f.kind === 'native') ? 'Only a native CAD file is here. Export a STEP from the CAD tool.' : 'Add a STEP for ' + p.label + '.'));
      else R('files.model', p, 'ok', p.model.label + ': ' + p.model.name);
      if (!p.drawingFile) R('files.drawing', p, p.process === 'printed' ? 'info' : 'error', 'No drawing', p.process === 'printed' ? 'Fine for a print from the model alone, if no fit or tolerance matters.' : 'The vendor will apply its own default tolerances, and material and finish are unstated.');
      else R('files.drawing', p, 'ok', p.drawingFile.name);
      if (p.process === 'sheet') {
        if (p.flatFile) R('files.flat', p, 'ok', p.flatFile.name);
        else R('files.flat', p, 'warn', 'No flat pattern (DXF)', D && D.flatNote ? 'The drawing mentions a flat pattern: check whether the shop is meant to make its own.' : 'Most shops want a DXF, or will make their own with their K-factor.');
      }
      const native = p.files.filter(f => f.kind === 'native');
      if (native.length) R('files.native', p, 'info', native.length + ' native CAD file' + (native.length > 1 ? 's' : ''), native.map(f => f.name).join(', ') + '. Not readable here; send STEP to vendors and keep these for the archive.');
      if (pkg.bom && !p.bom) R('files.bom', p, 'warn', 'Not in the BOM', p.label + ' has files in the package but no BOM line.');
      else if (p.bom) R('files.bom', p, 'ok', 'BOM line ' + p.bom.pn + (p.bom.rev ? ' rev ' + p.bom.rev : ''));

      // revisions
      const revs = p.revs.filter(r => r.rev);
      const distinct = [...new Set(revs.map(r => r.rev))];
      if (distinct.length > 1) {
        const want = p.rev;
        const odd = new Map();
        for (const r of revs.filter(r => r.rev !== want)) { const k = r.src + '\t' + r.rev; odd.set(k, (odd.get(k) || []).concat(r.how)); }
        R('rev.match', p, 'error', 'Revisions disagree: ' + distinct.join(' vs '), [...odd].map(([k, how]) => { const [src, rev] = k.split('\t'); return src + ' (' + how.join(', ') + ') says ' + rev; }).join('; ') + '; the part is rev ' + (want || '?') + '.');
      } else if (distinct.length === 1) R('rev.match', p, 'ok', 'All say rev ' + distinct[0] + ' (' + revs.length + ' sources)');
      else R('rev.match', p, 'warn', 'No revision anywhere', 'Name files <part number>_<rev>_<description> so the revision travels with them.');
      if (p.header) {
        if (p.header.revision) R('rev.step', p, 'ok', 'STEP says rev ' + p.header.revision);
        else R('rev.step', p, 'info', 'The STEP has no revision inside', 'Only its file name (' + (p.model.rev ? 'rev ' + p.model.rev : 'no revision') + ') ties it to a revision. Common for CAD exports.');
      }
      const pns = [];
      if (p.model && p.model.pn) pns.push(['file name', p.model.pn]);
      if (p.header && p.header.products[0] && /\d/.test(p.header.products[0].id)) pns.push(['STEP product', p.header.products[0].id.toUpperCase()]);
      if (F('part')) pns.push(['drawing', F('part').toUpperCase()]);
      if (p.bom) pns.push(['BOM', p.bom.pn]);
      const dp = [...new Set(pns.map(x => x[1]))];
      if (dp.length > 1) R('pn.match', p, 'error', 'Part numbers disagree', pns.map(x => x[0] + ': ' + x[1]).join(', '));
      else if (dp.length) R('pn.match', p, 'ok', dp[0] + ' (' + pns.map(x => x[0]).join(', ') + ')');

      // model
      if (p.model) {
        if (p.modelError) R('model.read', p, 'error', 'The model didn\'t open', p.modelError);
        else {
          R('model.read', p, 'ok', p.stats.triangles.toLocaleString('en-US') + ' triangles' + (p.readMs != null ? ' in ' + p.readMs + ' ms' : ''));
          const s = p.stats;
          // Judged body by body (mesh.stats). A handful of open edges on a solid is usually
          // tessellation, not a broken solid; an open surface body next to the solid is usually
          // construction geometry that came along with the export.
          const pl = (n, one, many) => n + ' ' + (n === 1 ? one : many);
          const gappy = s.bodies.filter(b => !b.closed && PC.mesh.nearlyClosed(b));
          if (!s.solids) R('model.solid', p, 'error', 'No closed solid', pl(s.surfaces, 'open surface body', 'open surface bodies') + ', ' + s.openEdges + ' open edges. Volume and mass can\'t be worked out, and shops will push back.');
          else if (s.surfaces || s.solids > 1) {
            const bits = [];
            if (s.surfaces) bits.push(pl(s.surfaces, 'open surface body', 'open surface bodies') + ' exported with the part: construction or reference geometry, probably. A vendor may quote or program it; leave it out of the export. Mass counts the solid' + (s.solids > 1 ? 's' : '') + ' only.');
            if (s.solids > 1) bits.push(pl(s.solids, 'solid', 'solids') + ' in one file: a multibody part or an assembly saved as a part. Check which body is the part.');
            R('model.solid', p, 'warn', [s.solids > 1 && pl(s.solids, 'solid', 'solids'), s.surfaces && pl(s.surfaces, 'surface body', 'surface bodies')].filter(Boolean).join(' and ') + ' in the file', bits.join(' '));
          } else if (gappy.length) R('model.solid', p, 'warn', 'Nearly closed: ' + (s.openEdges + s.nonManifold) + ' stray edges', 'Probably tessellation gaps rather than a broken solid; volume and mass are still close. Check the STEP in CAD if in doubt.');
          else R('model.solid', p, 'ok', 'One closed solid');
          if (p.header) {
            if (p.header.units === 'mm') R('model.units', p, 'ok', 'Millimeters');
            else R('model.units', p, p.header.units === 'inch' ? 'warn' : 'info', 'Model units: ' + p.header.units, p.header.units === 'inch' ? 'Make sure the drawing and the vendor agree on inches.' : 'Could not tell the units from the STEP.');
          }
        }
      }

      // drawing
      if (p.drawingFile) {
        if (p.drawingError) R('dwg.text', p, 'error', 'The drawing didn\'t open', p.drawingError);
        else if (!D.items.length) R('dwg.text', p, 'error', 'No text in the drawing', 'A scan, or text exported as outlines. Re-export from CAD as a vector PDF so it can be checked.');
        else {
          R('dwg.text', p, 'ok', D.pages + ' sheet' + (D.pages > 1 ? 's' : '') + ', ' + D.items.length + ' text items');
          const field = (check, key, sev, missing, detail) => (F(key) ? R(check, p, 'ok', F(key)) : R(check, p, sev, missing, detail));
          field('dwg.material', 'material', 'error', 'No material in the title block', 'State the grade and the manufacturer or standard.');
          field('dwg.finish', 'finish', 'warn', 'No finish in the title block', p.process === 'molded' ? 'For a molded part: texture per surface (SPI, VDI 3400 or a texture code), or "none".' : 'Plating, anodize, paint, or "none".');
          if (D.tolerance) R('dwg.tolerance', p, 'ok', D.tolerance); else R('dwg.tolerance', p, 'error', 'No general tolerances', 'Without a tolerance block every untoleranced dimension is open to the vendor\'s defaults.');
          if (D.standard) R('dwg.standard', p, 'ok', D.standard); else R('dwg.standard', p, 'warn', 'No GD&T standard named', 'Name ASME Y14.5 with its edition, or ISO GPS.');
          const inch = D.units && /INCH|\bIN\b/i.test(D.units), modelUnits = p.header && p.header.units;
          if (!D.units) R('dwg.units', p, 'warn', 'Drawing units not stated', D.projection ? '' : 'No projection text either; it may be shown only as a symbol.');
          else if (inch && modelUnits === 'mm') R('dwg.units', p, 'info', 'Drawing in inches, model in mm', 'Fine if intended (a STEP is often exported in mm). Make sure the vendor knows the drawing governs.');
          else if (!D.projection) R('dwg.units', p, 'info', 'Units ' + D.units + '; no projection text', 'Projection is often shown only as a symbol, which can\'t be read from text. Check the sheet.');
          else R('dwg.units', p, 'ok', D.units + ', ' + D.projection);
          const who = ['drawn', 'checked', 'approved'].filter(k => !F(k));
          if (!who.length) R('dwg.signoff', p, 'ok', ['drawn', 'checked', 'approved'].map(k => F(k)).join(' · '));
          else if (who.length === 1 && who[0] === 'approved') R('dwg.signoff', p, 'info', 'Not approved yet', 'Drawn and checked. Fine for an RFQ or prototype; approve it before release.');
          else R('dwg.signoff', p, 'warn', 'Missing: ' + who.join(', '));
          if (D.latestRev && F('rev') && D.latestRev !== F('rev').toUpperCase()) R('dwg.revtable', p, 'error', 'Revision table ends at ' + D.latestRev + ', title block says ' + F('rev'), 'Either the table wasn\'t updated or the title block wasn\'t.');
          else if (D.latestRev) R('dwg.revtable', p, 'ok', 'Rows ' + D.revs.join(', '));
          else R('dwg.revtable', p, 'info', 'No revision table found');
          if (p.process === 'sheet') {
            if (p.flatSheet) R('sm.notes', p, 'ok', 'Flat part: the model has no bends');
            else if (D.bendNote) R('sm.notes', p, 'ok', D.bendNote);
            else R('sm.notes', p, 'warn', 'No bend notes', 'Give direction, angle and inside radius for each bend.');
          }
        }
      }

      // material
      if (F('material') && p.bom && p.bom.material) {
        const same = PC.materials.same(F('material'), p.bom.material);
        if (same === false) R('mat.match', p, 'error', 'Drawing and BOM name different materials', 'Drawing: ' + F('material') + '. BOM: ' + p.bom.material + '.');
        else if (same === true) R('mat.match', p, 'ok', 'Both: ' + (PC.materials.match(F('material')) || {}).name + (PC.materials.grades(F('material'))[0] ? ' ' + PC.materials.grades(F('material'))[0] : ''));
        else R('mat.match', p, 'info', 'Couldn\'t compare the materials', 'Drawing: ' + F('material') + '. BOM: ' + p.bom.material + '.');
      }
      if (p.mass != null && p.drawingMass != null) {
        const d = (p.mass - p.drawingMass) / p.drawingMass;
        if (Math.abs(d) > 0.05) R('mass.match', p, 'warn', 'Model mass ' + PC.util.fmtMass(p.mass) + ', drawing says ' + PC.util.fmtMass(p.drawingMass), Math.round(d * 100) + '% apart, using ' + p.material.match.name + ' at ' + p.material.match.density + ' g/cm³.');
        else R('mass.match', p, 'ok', PC.util.fmtMass(p.mass) + ' vs ' + PC.util.fmtMass(p.drawingMass) + ' on the drawing');
      }

      // sheet metal: flat pattern against the model
      if (p.process === 'sheet' && p.flat) {
        const bits = [];
        let sev = 'ok';
        if (p.flatFile.rev && p.rev && p.flatFile.rev !== p.rev) { sev = 'error'; bits.push('The DXF is rev ' + p.flatFile.rev + '; the part is rev ' + p.rev + '.'); }
        if (p.stats && p.stats.holes != null && p.flat.holes !== p.stats.holes) { sev = 'error'; bits.push('The DXF has ' + p.flat.holes + ' holes; the 3D model has ' + p.stats.holes + '.'); }
        if (p.flat.openChains) { sev = sev === 'ok' ? 'warn' : sev; bits.push(p.flat.openChains + ' outline chain' + (p.flat.openChains > 1 ? 's don\'t' : ' doesn\'t') + ' close.'); }
        R('sm.flat', p, sev, sev === 'ok' ? 'Rev ' + (p.flatFile.rev || '?') + ', ' + p.flat.holes + ' holes, blank ' + PC.util.fmtSize(p.flat.size) : 'Flat pattern doesn\'t match the part', bits.join(' '));
      }
    }
    return out;
  }

  PC.checks = { CATALOG, BY, run };
})(window.PC = window.PC || {});
