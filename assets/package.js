// Reading a package: unzip, fingerprint, sort files by kind, read part numbers and revisions from
// names, read the BOM and the STEP headers, and group everything into parts.
(function (PC) {
  'use strict';
  const U = PC.util;

  const KINDS = [
    ['model', /\.(step|stp|p21)$/i, 'STEP model'],
    ['model', /\.(iges|igs)$/i, 'IGES model'],
    ['model', /\.brep$/i, 'OpenCascade BREP'],
    ['mesh', /\.stl$/i, 'STL mesh'],
    ['drawing', /\.pdf$/i, 'Drawing (PDF)'],
    ['flat', /\.dxf$/i, 'DXF (flat pattern or profile)'],
    ['bom', /\.csv$/i, 'BOM (CSV)'],
    ['native', /\.(sldprt|sldasm|slddrw|ipt|iam|idw|prt|asm|catpart|catproduct|x_t|x_b|f3d|3dm|par|psm|jt)$/i, 'Native CAD'],
    ['image', /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i, 'Image'],
    ['doc', /\.(docx?|xlsx?|pptx?|txt|md|rtf)$/i, 'Document'],
  ];
  function kindOf(name) {
    for (const [k, re, label] of KINDS) if (re.test(name)) return { kind: k, label };
    return { kind: 'other', label: 'Other' };
  }

  // Revisions look like A, B, AB, 01, 3, A1 (optionally "rev B").
  const REV = /^(?:rev(?:ision)?[-.]?)?([A-Z]{1,2}|\d{1,2}|[A-Z]\d)$/i;
  // "<part number>_<rev>_<description>.<ext>", the convention in the README. A part number is the
  // first token with at least three digits, such as 2100410-011 or BRK-200, that isn't a standard
  // or format tag (AP242, ASME1, ISO2768, v2).
  const NOT_PN = /^(ap\d{3}|asme\d*|iso\d*|din\d*|ansi\d*|y14|e\d+|v\d+|r\d+|rev|step|stp|copy\d*|final\d*|\d{4}-\d{2}-\d{2}|20\d{6})(\b|[-.]|$)/i;
  function parseName(path) {
    const base = path.split('/').pop().replace(/\.[^.]+$/, '');
    const toks = base.split(/[_\s]+/).filter(Boolean);
    let pn = null, rev = null, at = -1;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if ((t.match(/\d/g) || []).length >= 3 && /^[A-Z0-9]+(?:[-.][A-Z0-9]+)*$/i.test(t) && !REV.test(t) && !NOT_PN.test(t)) { pn = t.toUpperCase(); at = i; break; }
    }
    if (at >= 0 && toks[at + 1] && REV.test(toks[at + 1])) rev = toks[at + 1].match(REV)[1].toUpperCase();
    const m = base.match(/\brev(?:ision)?[\s._-]?([A-Z]{1,2}|\d{1,2})\b/i);
    if (!rev && m) rev = m[1].toUpperCase();
    const desc = toks.filter((t, i) => i !== at && !(rev && i === at + 1) && !/^rev/i.test(t)).join(' ').replace(/-/g, ' ');
    return { pn, rev, desc, base };
  }

  // ── STEP header: names, revision and units, read straight from the text ──
  const unq = s => s.replace(/''/g, "'").replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h) => String.fromCharCode(...h.match(/.{4}/g).map(x => parseInt(x, 16))));
  function stepHeader(text) {
    const head = text.slice(0, 40000);
    const fn = head.match(/FILE_NAME\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*\(([^)]*)\)\s*,\s*\(([^)]*)\)\s*,\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/);
    const schema = (head.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/) || [])[1] || '';
    const ap = /AP242|MANAGED_MODEL_BASED/i.test(schema) ? 'AP242' : /AUTOMOTIVE_DESIGN/i.test(schema) ? 'AP214' : /CONFIG_CONTROL_DESIGN/i.test(schema) ? 'AP203' : schema ? schema.split(/\s/)[0] : 'unknown';
    const products = [...text.matchAll(/=\s*PRODUCT\s*\(\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g)].map(m => ({ id: unq(m[1]), name: unq(m[2]) }));
    const formations = [...text.matchAll(/=\s*PRODUCT_DEFINITION_FORMATION(?:_WITH_SPECIFIED_SOURCE)?\s*\(\s*'((?:[^']|'')*)'/g)].map(m => unq(m[1]));
    let units = 'unknown';
    if (/SI_UNIT\s*\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/i.test(text)) units = 'mm';
    else if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(text)) units = 'inch';
    else if (/SI_UNIT\s*\(\s*\.CENTI\.\s*,\s*\.METRE\.\s*\)/i.test(text)) units = 'cm';
    else if (/SI_UNIT\s*\(\s*\$\s*,\s*\.METRE\.\s*\)/i.test(text)) units = 'm';
    const list = s => [...(s || '').matchAll(/'((?:[^']|'')*)'/g)].map(m => unq(m[1])).filter(Boolean);
    return {
      fileName: fn ? unq(fn[1]) : '', time: fn ? fn[2] : '', author: fn ? list(fn[3]) : [], org: fn ? list(fn[4]) : [],
      preprocessor: fn ? unq(fn[5]) : '', system: fn ? unq(fn[6]) : '', schema, ap, units, products,
      revision: formations.find(f => f && REV.test(f)) || '',
    };
  }

  // ── BOM (CSV): find the columns by their headings ──
  const COLS = {
    pn: /^(part\s*(no|number|#)\.?|p\/?n|item\s*number|number)$/i, rev: /^rev(ision)?\.?$/i, desc: /^(desc(ription)?|name|title)$/i,
    type: /^(type|make\s*\/\s*buy|make.?buy|process|source)$/i, material: /^material$/i, finish: /^(finish|coating)$/i, qty: /^(qty|quantity)\.?$/i,
  };
  function processOf(type) {
    const t = String(type || '');
    if (/purchas|\bbuy\b|cots|catalog|off.?the.?shelf/i.test(t)) return 'purchased';
    if (/mold|moulded|\bim\b/i.test(t)) return 'molded';
    if (/sheet|\bsm\b|formed|stamp/i.test(t)) return 'sheet';
    if (/machin|cnc|turn|mill/i.test(t)) return 'machined';
    if (/print|additive|\b3d\b|sla|sls|mjf|fdm/i.test(t)) return 'printed';
    if (/cast/i.test(t)) return 'cast';
    return null;
  }
  function parseBom(text) {
    const rows = U.parseCsv(text);
    const hi = rows.findIndex(r => r.some(c => COLS.pn.test(c.trim())));
    if (hi < 0) return null;
    const head = rows[hi].map(c => c.trim()), col = {};
    for (const [k, re] of Object.entries(COLS)) { const i = head.findIndex(h => re.test(h)); if (i >= 0) col[k] = i; }
    const out = rows.slice(hi + 1).map(r => {
      const g = k => (col[k] != null ? (r[col[k]] || '').trim() : '');
      return { pn: g('pn').toUpperCase(), rev: g('rev').toUpperCase(), desc: g('desc'), type: g('type'), material: g('material'), finish: g('finish'), qty: g('qty'), process: processOf(g('type')) };
    }).filter(r => r.pn);
    return { columns: Object.keys(col), rows: out };
  }

  // ── Opening ──
  async function expand(inputs, log) {
    const out = [];
    for (const f of inputs) {
      if (/\.zip$/i.test(f.path) && window.JSZip) {
        log && log('Unzipping ' + f.path);
        const z = await JSZip.loadAsync(f.bytes);
        const inner = [];
        for (const name of Object.keys(z.files)) {
          const e = z.files[name];
          if (e.dir || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) continue;
          inner.push({ path: name, bytes: await e.async('uint8array') });
        }
        out.push(...await expand(inner, log));
      } else out.push(f);
    }
    return out;
  }

  // Inputs → a package: { id, name, files, parts, bom, sha256 }. Parts are keyed by part number.
  async function build(name, inputs, log) {
    const files = await expand(inputs, log);
    files.sort((a, b) => a.path.localeCompare(b.path));
    let packSha = '';
    for (const f of files) {
      f.name = f.path.split('/').pop();
      f.size = f.bytes.length;
      f.sha256 = await U.sha256(f.bytes);
      Object.assign(f, kindOf(f.name), parseName(f.path));
      packSha += f.path + '\t' + f.sha256 + '\n';
    }
    const pkg = { id: 'k' + Date.now().toString(36), name, at: new Date().toISOString(), files, parts: [], bom: null, boms: [] };
    pkg.sha256 = await U.sha256(new TextEncoder().encode(packSha));
    for (const f of files.filter(f => f.kind === 'bom')) {
      const b = parseBom(new TextDecoder().decode(f.bytes));
      if (b) { b.file = f; pkg.boms.push(b); } else { f.kind = 'other'; f.label = 'CSV (not a BOM)'; }
    }
    pkg.bom = pkg.boms[0] || null;
    const byKey = new Map();
    const part = key => {
      if (!byKey.has(key)) byKey.set(key, { key, pn: key.startsWith('~') ? null : key, files: [], bom: null });
      return byKey.get(key);
    };
    const bomOwners = new Set(pkg.boms.map(b => b.file.pn));
    const loose = [];
    for (const f of files) {
      if (f.kind === 'bom' || f.kind === 'other' || f.kind === 'image' || f.kind === 'doc') continue;
      // the assembly's own files (the BOM's part number) stay package-level unless they hold a model
      if (f.pn && bomOwners.has(f.pn) && f.kind !== 'model' && f.kind !== 'mesh') continue;
      if (f.pn) part(f.pn).files.push(f); else loose.push(f);
    }
    // Files without a part number: each model anchors a part, and drawings and flat patterns join
    // the model whose name shares the longest leading run of words with theirs (so
    // nist_ctc_02_asme1_rc.pdf goes with nist_ctc_02_asme1_ap242-e2.stp, not with ctc_04).
    const words = f => f.base.toLowerCase().split(/[_\s-]+/).filter(Boolean);
    const common = (a, b) => { let n = 0; while (n < a.length && n < b.length && a[n] === b[n]) n++; return n; };
    const anchors = loose.filter(f => f.kind === 'model' || f.kind === 'mesh').map(f => ({ f, w: words(f), key: '~' + f.base.toLowerCase() }));
    for (const f of loose) {
      const a = anchors.find(x => x.f === f);
      if (a) { part(a.key).files.push(f); continue; }
      const w = words(f), scored = anchors.map(x => [common(w, x.w), x]).sort((p, q) => q[0] - p[0]);
      const best = scored[0];
      if (best && best[0] > 0 && (!scored[1] || scored[1][0] < best[0])) part(best[1].key).files.push(f);
      else part('~' + f.base.toLowerCase()).files.push(f);
    }
    for (const b of pkg.boms) for (const r of b.rows) {
      if (r.process === 'purchased' && !byKey.has(r.pn)) continue;
      part(r.pn).bom = r;
    }
    pkg.purchased = pkg.boms.flatMap(b => b.rows.filter(r => r.process === 'purchased' && !byKey.has(r.pn)));
    pkg.parts = [...byKey.values()].sort((a, b) => (a.pn || '~').localeCompare(b.pn || '~'));
    for (const p of pkg.parts) {
      p.label = p.pn || (p.files.find(f => f.kind === 'model' || f.kind === 'mesh') || p.files[0] || { base: p.key.slice(1) }).base;
      const named = p.files.find(f => f.kind === 'model') || p.files[0];
      p.desc = (p.bom && p.bom.desc) || (named && named.desc) || '';
    }
    return pkg;
  }

  PC.pkg = { build, parseName, stepHeader, parseBom, processOf, kindOf, REV };
})(window.PC = window.PC || {});
