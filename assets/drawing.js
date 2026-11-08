// Drawings (PDF) and flat patterns (DXF). A drawing is read through its text layer: title-block
// fields by their labels, the revision table, and keywords in the notes. Positions matter, so this
// works on vector PDFs exported from CAD; a scan, or text exported as outlines, has nothing to read.
(function (PC) {
  'use strict';

  async function readPdf(bytes) {
    const pdfjs = await PC.libs.pdf();
    const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl: PC.libs.LIBS.pdf.fonts }).promise;
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      for (const it of tc.items) {
        const s = (it.str || '').trim();
        if (!s) continue;
        const [a, b, , , x, y] = it.transform;
        items.push({ s, x, y, w: it.width, h: Math.hypot(a, b), page: p });
      }
    }
    const first = await doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    const out = { pages: doc.numPages, items, size: [vp.width, vp.height], doc };
    Object.assign(out, parse(items));
    return out;
  }

  // Render page 1 at a given width (CSS pixels) to a PNG data URL.
  async function renderPage(d, width) {
    const page = await d.doc.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = width / vp1.width;
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    // 'print' renders in one go instead of pacing on animation frames, which stop in a background tab.
    await page.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise;
    return c.toDataURL('image/png');
  }

  // Title-block labels. A value sits under its label in the same cell, or to its right.
  const LABELS = {
    part: /^(PART\s*(NO|NUMBER|#)|P\/N|DWG\.?\s*NO|DRAWING\s*(NO|NUMBER)|DOC(UMENT)?\s*(NO|NUMBER))\.?:?$/,
    rev: /^REV(ISION)?\.?:?$/,
    title: /^(TITLE|PART\s*NAME)\.?:?$/,
    material: /^MAT(ERIA)?L\.?:?$/,
    finish: /^(FINISH|SURFACE\s*FINISH|COATING|TREATMENT)\.?:?$/,
    scale: /^SCALE\b/,
    sheet: /^SHEET\b/,
    units: /^UNITS\.?:?$/,
    mass: /^(MASS|WEIGHT|WT)\.?:?$/,
    drawn: /^(DRAWN|DRN|DRAWN\s*BY)\.?:?$/,
    checked: /^(CHECKED|CHK|CHKD|CHECKED\s*BY)\.?:?$/,
    approved: /^(APPROVED|APPR|ENG\.?\s*APPR|APPROVED\s*BY)\.?:?$/,
    projection: /^PROJECTION\.?:?$/,
  };

  function parse(items) {
    const U = s => s.toUpperCase();
    const isLabel = it => Object.values(LABELS).some(re => re.test(U(it.s))) || /^(REV|DESCRIPTION|DATE|ECO|ECN|COMPANY|SIZE)$/.test(U(it.s));
    const sameLine = (a, b) => a.page === b.page && Math.abs(a.y - b.y) < 2.5;
    // the revision table's REV heading has DESCRIPTION beside it; the title block's doesn't
    const revHead = items.find(it => U(it.s) === 'REV' && items.some(o => sameLine(o, it) && /^DESCRIPTION$/i.test(o.s) && o.x > it.x));
    const fields = {};
    for (const [key, re] of Object.entries(LABELS)) {
      const label = items.find(it => re.test(U(it.s)) && it !== revHead);
      if (!label) continue;
      let value = '';
      const inline = label.s.match(/^[^:]+:\s*(.+)$/) || (key === 'scale' || key === 'sheet' ? label.s.match(/^(?:SCALE|SHEET)\s+(.+)$/i) : null);
      if (inline) value = inline[1].trim();
      if (!value) {
        const below = items.filter(it => it.page === label.page && it !== label && !isLabel(it) && label.y - it.y > 1 && label.y - it.y < 26 && it.x - label.x > -6 && it.x - label.x < 60)
          .sort((a, b) => (label.y - a.y) - (label.y - b.y) || Math.abs(a.x - label.x) - Math.abs(b.x - label.x));
        const right = items.filter(it => sameLine(it, label) && it !== label && !isLabel(it) && it.x > label.x + label.w - 1 && it.x < label.x + label.w + 220)
          .sort((a, b) => a.x - b.x);
        value = (below[0] || right[0] || { s: '' }).s;
      }
      fields[key] = { label: label.s, value };
    }
    const text = items.map(i => i.s).join('\n');
    const T = text.toUpperCase();
    // Label and value in one text item: "Rev D", "MATERIAL: AL 6061-T6", "5. FINISH: CLEAR ANODIZE".
    // Notes often run on to the next line; take it too unless it starts a new note.
    const lines = text.split('\n');
    const INLINE = {
      rev: /^REV(?:ISION)?\.?:?\s+([A-Z]{1,2}\d?|\d{1,2})$/i,
      material: /^(?:\d+\.\s*)?MAT(?:ERIA)?L\.?\s*:\s*(.+)$/i,
      finish: /^(?:\d+\.\s*)?(?:FINISH|SURFACE\s+FINISH|COATING)\s*:\s*(.+)$/i,
      mass: /^(?:MASS|WEIGHT)\s*:?\s*([\d.,]+\s*(?:kg|g|lbs?|oz)\b.*)$/i,
    };
    for (const [key, re] of Object.entries(INLINE)) {
      if (fields[key] && fields[key].value) continue;
      const i = lines.findIndex(l => re.test(l.trim()));
      if (i < 0) continue;
      let value = lines[i].trim().match(re)[1].trim();
      const next = (lines[i + 1] || '').trim();
      if (key !== 'rev' && next && !/^\d+\.|^[A-Z ]+:/.test(next) && !/[.]$/.test(value)) value += ' ' + next;
      fields[key] = { label: lines[i].trim(), value: value.replace(/\.$/, '') };
    }
    // revision table rows: entries in the REV column under its heading
    let revs = [];
    if (revHead) {
      revs = items.filter(it => it.page === revHead.page && Math.abs(it.x - revHead.x) < 12 && it.y < revHead.y - 1 && it.y > revHead.y - 260 && PC.pkg.REV.test(it.s))
        .sort((a, b) => b.y - a.y).map(it => it.s.toUpperCase());
    }
    const latestRev = revs.length ? revs.slice().sort(revCmp).pop() : '';
    const has = re => (T.match(re) || [null])[0];
    return {
      fields, text, revs, latestRev,
      units: (fields.units && fields.units.value) || (T.match(/\bUNITS\s*:\s*(MM|MILLIMETERS?|INCH(ES)?|IN)\b/) || [])[1] || has(/DIMENSIONS\s+(ARE\s+)?IN\s+(MM|MILLIMETERS|INCHES)|\bMILLIMETERS\b|\bINCHES\b/),
      projection: has(/(THIRD|FIRST|3RD|1ST)[\s-]*ANGLE/),
      tolerance: has(/UNLESS\s+OTHERWISE\s+SPECIFIED|GENERAL\s+TOLERANCES?|TOLERANCES?\s*:|ISO\s*2768-?[A-Z]*/),
      standard: has(/ASME\s*Y14\.5M?(-?\d{4})?|ANSI\s*Y14\.5M?|ISO\s*(GPS|1101|8015)/),
      flatNote: has(/FLAT\s*PATTERN/),
      bendNote: has(/\b(UP|DOWN)\s*\d+(\.\d+)?\s*°|\bBEND(S)?\b|K-?FACTOR/),
      draftNote: has(/\bDRAFT\b/),
      textureNote: has(/TEXTURE|SPI\s*[A-D]-?\d|VDI\s*\d+|MT-?\d{4,5}/),
    };
  }

  // Revision order: numbers numerically, letters by length then alphabet (Z < AA).
  function revCmp(a, b) {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return +a - +b;
    if (na !== nb) return na ? -1 : 1;
    return a.length - b.length || a.localeCompare(b);
  }

  // Mass on a drawing → grams.
  function massGrams(s) {
    const m = String(s || '').replace(',', '.').match(/([\d.]+)\s*(kg|g|lbs?|oz)\b/i);
    if (!m) return null;
    const v = +m[1], u = m[2].toLowerCase();
    return u === 'kg' ? v * 1000 : u === 'g' ? v : u.startsWith('lb') ? v * 453.592 : v * 28.3495;
  }

  // ── DXF (R12 and later ENTITIES): lines, arcs, circles, polylines, and text ──
  function readDxf(text) {
    const lines = text.split(/\r?\n/);
    const ents = [];
    let i = 0, inEnt = false, cur = null;
    const flush = () => { if (cur) ents.push(cur); cur = null; };
    while (i < lines.length - 1) {
      const code = +lines[i].trim(), val = lines[i + 1].trim();
      i += 2;
      if (code === 0 && val === 'SECTION') continue;
      if (code === 2 && val === 'ENTITIES') { inEnt = true; continue; }
      if (code === 0 && val === 'ENDSEC') { flush(); inEnt = false; continue; }
      if (!inEnt) continue;
      if (code === 0) { flush(); cur = { type: val, layer: '0', g: [] }; continue; }
      if (!cur) continue;
      if (code === 8) cur.layer = val;
      cur.g.push([code, val]);
    }
    flush();
    const segs = [], circles = [], texts = [], polys = [];
    const get = (e, c) => { const x = e.g.find(g => g[0] === c); return x ? +x[1] : 0; };
    const skipLayer = l => /BEND|NOTE|DIM|TEXT|CENT|ANNOT|TITLE/i.test(l);
    for (const e of ents) {
      if (e.type === 'TEXT' || e.type === 'MTEXT') { texts.push(e.g.filter(g => g[0] === 1).map(g => g[1]).join(' ')); continue; }
      const bend = /BEND/i.test(e.layer);
      if (e.type === 'LINE') segs.push({ a: [get(e, 10), get(e, 20)], b: [get(e, 11), get(e, 21)], bend, skip: skipLayer(e.layer) });
      else if (e.type === 'ARC') {
        const cx = get(e, 10), cy = get(e, 20), r = get(e, 40); let a0 = get(e, 50), a1 = get(e, 51);
        if (a1 < a0) a1 += 360;
        const R = d => [cx + r * Math.cos(d * Math.PI / 180), cy + r * Math.sin(d * Math.PI / 180)];
        segs.push({ a: R(a0), b: R(a1), arc: { cx, cy, r, a0, a1 }, skip: skipLayer(e.layer) });
      } else if (e.type === 'CIRCLE') { if (!skipLayer(e.layer)) circles.push({ cx: get(e, 10), cy: get(e, 20), r: get(e, 40) }); }
      else if (e.type === 'LWPOLYLINE') {
        const xs = e.g.filter(g => g[0] === 10).map(g => +g[1]), ys = e.g.filter(g => g[0] === 20).map(g => +g[1]);
        const closed = (get(e, 70) & 1) === 1;
        const pts = xs.map((x, k) => [x, ys[k]]);
        if (!skipLayer(e.layer)) polys.push({ pts, closed });
      }
    }
    // chain cut segments into closed loops
    const cut = segs.filter(s => !s.skip && !s.bend);
    const key = p => Math.round(p[0] * 1000) + ',' + Math.round(p[1] * 1000);
    const deg = new Map(), parent = new Map();
    const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    for (const s of cut) for (const p of [s.a, s.b]) { const k = key(p); if (!parent.has(k)) parent.set(k, k); deg.set(k, (deg.get(k) || 0) + 1); }
    for (const s of cut) { const a = find(key(s.a)), b = find(key(s.b)); if (a !== b) parent.set(a, b); }
    const comps = new Map();
    for (const k of parent.keys()) { const r = find(k); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(k); }
    let loops = 0, openEnds = 0;
    for (const ks of comps.values()) { if (ks.every(k => deg.get(k) === 2)) loops++; else openEnds++; }
    loops += circles.length + polys.filter(p => p.closed).length;
    const xs = [], ys = [];
    for (const s of cut) { xs.push(s.a[0], s.b[0]); ys.push(s.a[1], s.b[1]); }
    for (const c of circles) { xs.push(c.cx - c.r, c.cx + c.r); ys.push(c.cy - c.r, c.cy + c.r); }
    for (const p of polys) for (const q of p.pts) { xs.push(q[0]); ys.push(q[1]); }
    const ext = xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null;
    const revText = texts.map(t => (t.match(/\bREV(?:ISION)?\s*([A-Z]{1,2}|\d{1,2})\b/i) || [])[1]).find(Boolean);
    return {
      segs, circles, polys, texts, loops, openChains: openEnds, holes: Math.max(0, loops - 1),
      bends: segs.filter(s => s.bend).length, extents: ext, size: ext ? [ext.x1 - ext.x0, ext.y1 - ext.y0] : null,
      rev: revText ? revText.toUpperCase() : '',
    };
  }

  // Flat pattern → SVG (cut lines solid, bend lines dashed).
  function dxfSvg(d) {
    if (!d.extents) return '';
    const { x0, x1, y0, y1 } = d.extents, pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    const f = n => n.toFixed(3), Y = y => f(y0 + y1 - y);
    let p = '';
    for (const s of d.segs) {
      if (s.skip && !s.bend) continue;
      if (s.arc) {
        const { r, a0, a1 } = s.arc, large = (a1 - a0) > 180 ? 1 : 0;
        p += `<path d="M${f(s.a[0])} ${Y(s.a[1])}A${f(r)} ${f(r)} 0 ${large} 0 ${f(s.b[0])} ${Y(s.b[1])}" class="cut"/>`;
      } else p += `<line x1="${f(s.a[0])}" y1="${Y(s.a[1])}" x2="${f(s.b[0])}" y2="${Y(s.b[1])}" class="${s.bend ? 'bend' : 'cut'}"/>`;
    }
    for (const c of d.circles) p += `<circle cx="${f(c.cx)}" cy="${Y(c.cy)}" r="${f(c.r)}" class="cut"/>`;
    for (const q of d.polys) p += `<polyline points="${q.pts.map(v => f(v[0]) + ',' + Y(v[1])).join(' ')}${q.closed ? ' ' + f(q.pts[0][0]) + ',' + Y(q.pts[0][1]) : ''}" class="cut"/>`;
    return `<svg class="dxf-svg" viewBox="${f(x0 - pad)} ${f(y0 - pad)} ${f(x1 - x0 + 2 * pad)} ${f(y1 - y0 + 2 * pad)}" preserveAspectRatio="xMidYMid meet">${p}</svg>`;
  }

  PC.drawing = { readPdf, renderPage, parse, readDxf, dxfSvg, massGrams, revCmp };
})(window.PC = window.PC || {});
