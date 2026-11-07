// Partcheck UI: open a package, see each part (3D view, facts, drawing, flat pattern), the package
// checks, and export previews and mesh files. Everything stays in this tab: nothing is uploaded.
(function (PC) {
  'use strict';
  const U = PC.util, esc = U.esc;
  const $ = s => document.querySelector(s);
  const DEMO = /[?&]demo\b/.test(location.search);
  PC.DEMO = DEMO;

  const state = { pkgs: [], active: null, view: 'home', part: null, busy: null, filter: 'all', conv: [], convBusy: null, mode: 'shaded', pull: '+Z', minDraft: 1, edges: true };
  let viewer = null;
  const active = () => state.pkgs.find(p => p.id === state.active) || null;
  const partOf = (pkg, key) => pkg && pkg.parts.find(p => p.key === key);

  // Demo packages belong to Signoff ME's demo reviews, so finding chips can open the right check there.
  const DEMO_REVIEW = { enclosure: 'mdemo5', bracket: 'mdemo13' };
  const ME = '../me_design_review/index.html';

  // ── Theme: shared with the rest of Signoff (same key) ──
  const SETTINGS_KEY = (DEMO ? 'signoff.demo.' : 'signoff.v1.') + 'settings';
  const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function readTheme() { try { return (JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}).theme || 'auto'; } catch (e) { return 'auto'; } }
  function writeTheme(t) { try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; s.theme = t; localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ } }
  const isDark = t => t === 'dark' || (t !== 'light' && !!(darkQuery && darkQuery.matches));
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    const b = $('#theme-btn');
    if (b) { b.innerHTML = isDark(t) ? ICON.sun : ICON.moon; b.title = isDark(t) ? 'Light mode' : 'Dark mode'; }
    if (viewer) viewer.draw();
  }
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', () => applyTheme(readTheme()));

  // ── Sidebar ──
  // As in Signoff EE and Fabcheck: on wide windows the corner button, the toolbar's menu button or
  // [ hides it until opened again (kept in this browser); on narrow ones it slides over the page,
  // and a tap outside it (on its scrim, suite.css) closes it and goes no further.
  const SIDE_KEY = (DEMO ? 'partcheck.demo.' : 'partcheck.v1.') + 'sideCollapsed';
  const narrow = window.matchMedia ? matchMedia('(max-width: 860px)') : { matches: false };
  function toggleSidebar() {
    if (narrow.matches) { $('#app').classList.toggle('nav-open'); return; }
    const on = !$('#app').classList.contains('side-collapsed');
    $('#app').classList.toggle('side-collapsed', on);
    try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }
  document.addEventListener('click', e => {
    const app = $('#app');
    if (!app.classList.contains('nav-open') || e.target !== app) return; // the scrim is #app's ::after
    app.classList.remove('nav-open'); e.preventDefault(); e.stopPropagation();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    e.preventDefault(); toggleSidebar();
  });

  const ICON = {
    sun: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10" cy="10" r="3.4"/><path d="M10 2.5v1.8M10 15.7v1.8M2.5 10h1.8M15.7 10h1.8M4.7 4.7l1.3 1.3M14 14l1.3 1.3M4.7 15.3 6 14M14 6l1.3-1.3"/></svg>',
    moon: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M16 12.3A6.5 6.5 0 0 1 7.7 4a6.5 6.5 0 1 0 8.3 8.3z"/></svg>',
    part: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6z"/><path d="M3.5 6 10 9.5 16.5 6M10 9.5v8"/></svg>',
    box: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="5" width="14" height="11" rx="2"/><path d="M3 8.5h14M8 11.5h4"/></svg>',
    convert: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11l-3-3M16 13H5l3 3"/></svg>',
    download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  };
  const SEV = { error: 'Error', warn: 'Warning', info: 'Note', ok: 'OK' };

  // ── Opening packages ──
  async function openInputs(name, inputs, opts = {}) {
    const log = [];
    state.busy = { label: 'Reading ' + name, log };
    state.view = 'overview';
    renderAll();
    const say = s => { log.push(s); const el = $('#busy-log'); if (el) { el.textContent = log.slice(-14).join('\n'); } };
    try {
      const pkg = await PC.pkg.build(name, inputs, say);
      pkg.demoId = opts.demoId || null;
      if (pkg.parts.some(p => p.files.some(f => f.kind === 'model'))) say('Loading the STEP reader (OpenCascade, about 2.5 MB, cached after the first time)');
      await PC.analyze.analyze(pkg, say);
      say('Rendering previews');
      for (const p of pkg.parts) if (p.mesh && p.stats) { p.thumb = PC.viewer.snapshot(p); await U.nextFrame(); }
      state.pkgs = state.pkgs.filter(p => p.name !== pkg.name).concat(pkg);
      if (!opts.background) { state.active = pkg.id; state.view = 'overview'; state.part = null; }
    } catch (e) {
      console.error(e);
      toast('Could not read ' + name + ': ' + (e.message || e), 'error');
      if (!state.pkgs.length) state.view = 'home';
    }
    state.busy = null;
    renderAll();
  }

  async function readFileList(list) {
    const out = [];
    for (const f of list) out.push({ path: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return out;
  }
  function nameFor(inputs) {
    if (inputs.length === 1) return inputs[0].path.split('/').pop();
    const top = inputs[0].path.split('/')[0];
    if (inputs.every(f => f.path.split('/')[0] === top) && inputs[0].path.includes('/')) return top;
    const pn = inputs.map(f => PC.pkg.parseName(f.path).pn).find(Boolean);
    return (pn || 'Package') + ' (' + inputs.length + ' files)';
  }

  // Dropped folders: walk them with the entries API.
  async function dropped(dt) {
    const out = [];
    const walk = (entry, path) => new Promise(resolve => {
      if (entry.isFile) entry.file(async f => { out.push({ path: path + f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); resolve(); }, () => resolve());
      else if (entry.isDirectory) {
        const r = entry.createReader(), all = [];
        const more = () => r.readEntries(async es => { if (!es.length) { for (const e of all) await walk(e, path + entry.name + '/'); resolve(); } else { all.push(...es); more(); } }, () => resolve());
        more();
      } else resolve();
    });
    const entries = [...dt.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (entries.length) { for (const e of entries) await walk(e, ''); return out; }
    return readFileList(dt.files);
  }

  async function loadDemo(id) {
    if (!window.PartcheckDemo) {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'demo/demo-package.js'; s.onload = res; s.onerror = () => rej(new Error('demo files missing')); document.head.appendChild(s); });
    }
    const d = window.PartcheckDemo, list = id ? d.packages.filter(p => p.id === id) : d.packages;
    for (const pk of list) {
      await openInputs(pk.name, pk.files.map(f => ({ path: f.path, bytes: U.b64ToBytes(f.b64) })), { demoId: pk.id, background: pk !== list[0] });
    }
    const first = state.pkgs.find(p => p.demoId === list[0].id);
    if (first) { state.active = first.id; state.view = 'overview'; renderAll(); }
  }

  // ── Converter (files that aren't a package: just turn them into other formats) ──
  async function convertInputs(inputs) {
    state.convBusy = 'Reading ' + inputs.length + ' file' + (inputs.length > 1 ? 's' : '');
    renderAll();
    for (const f of inputs) {
      Object.assign(f, { name: f.path.split('/').pop(), size: f.bytes.length }, PC.pkg.kindOf(f.path.split('/').pop()), PC.pkg.parseName(f.path));
      const item = { id: 'c' + Math.random().toString(36).slice(2, 8), file: f, label: f.pn || f.base, rev: f.rev, desc: f.desc, material: { match: null }, key: f.name };
      if (f.kind === 'model' || f.kind === 'mesh') {
        try {
          const r = await PC.analyze.readModel(f);
          item.mesh = r.mesh; item.stats = PC.mesh.stats(r.mesh); item.thumb = PC.viewer.snapshot(item);
        } catch (e) { item.error = e.message || String(e); }
      } else if (f.kind === 'native') item.error = 'Native CAD: can\'t be read in a browser (see below).';
      else item.error = 'Not a 3D model (' + f.label + ').';
      state.conv.unshift(item);
      await U.nextFrame();
    }
    state.convBusy = null;
    renderAll();
  }

  // ── Rendering ──
  function renderAll() {
    renderSidebar();
    renderToolbar();
    const v = $('#view');
    if (viewer) { viewer.dispose(); viewer = null; }
    const pkg = active();
    let h = '';
    if (state.view === 'convert') h = viewConvert();
    else if (state.busy) h = viewBusy();
    else if (!pkg || state.view === 'home') h = viewHome();
    else if (state.view === 'part' && partOf(pkg, state.part)) h = viewPart(pkg, partOf(pkg, state.part));
    else if (state.view === 'findings') h = viewFindings(pkg);
    else if (state.view === 'files') h = viewFiles(pkg);
    else if (state.view === 'export') h = viewExport(pkg);
    else h = viewOverview(pkg);
    v.innerHTML = h;
    if (state.view === 'part' && pkg && !state.busy) mountViewer(partOf(pkg, state.part));
    if (state.view === 'part' && pkg) mountDrawing(partOf(pkg, state.part));
    $('#main').scrollTop = 0;
  }

  function renderSidebar() {
    const list = $('#pkg-list');
    if (!state.pkgs.length) { list.innerHTML = '<div class="side-empty">No packages open. Drop files anywhere, or open the demo.</div>'; }
    else list.innerHTML = state.pkgs.map(pkg => {
      const n = sev => pkg.findings.filter(f => f.sev === sev).length;
      const on = pkg.id === state.active && state.view !== 'convert';
      return `<button class="proj${on && state.view !== 'part' ? ' active' : ''}" data-act="pkg" data-id="${pkg.id}">
          <span class="pc-ico">${ICON.box}</span>
          <span class="proj-body"><span class="proj-name">${esc(pkg.name)}</span><span class="proj-sub">${pkg.parts.length} part${pkg.parts.length === 1 ? '' : 's'} · ${n('error')} errors · ${n('warn')} warnings</span></span>
        </button>` + (on ? `<div class="pc-subparts">${pkg.parts.map(p => `<button class="pc-subpart${state.view === 'part' && state.part === p.key ? ' active' : ''}" data-act="part" data-key="${esc(p.key)}">
          ${p.thumb ? `<img src="${p.thumb}" alt="">` : `<span class="pc-nothumb">${ICON.part}</span>`}<span><b>${esc(p.label)}</b>${esc(p.name && p.name !== p.label ? p.name : '')}</span></button>`).join('')}</div>` : '');
    }).join('');
    $('#convert-link').classList.toggle('active', state.view === 'convert');
  }

  function renderToolbar() {
    const pkg = active(), seg = $('#view-seg');
    if (!pkg || state.view === 'convert' || state.busy || state.view === 'home') { seg.innerHTML = ''; seg.hidden = true; return; }
    seg.hidden = false;
    const n = pkg.findings.filter(f => f.sev === 'error' || f.sev === 'warn').length;
    const tabs = [['overview', 'Overview'], ['findings', 'Findings', n], ['files', 'Files', pkg.files.length], ['export', 'Previews & export']];
    seg.innerHTML = tabs.map(([k, l, c]) => `<button class="${state.view === k || (k === 'overview' && state.view === 'part') ? 'on' : ''}" data-act="view" data-view="${k}">${l}${c != null ? ` <span class="count">${c}</span>` : ''}</button>`).join('');
  }

  function viewBusy() {
    return `<div class="page"><div class="eyebrow">Working</div><h1 class="page-title">${esc(state.busy.label)}</h1>
      <div class="card pc-busy"><div class="pc-spin"></div><pre id="busy-log">${esc(state.busy.log.join('\n'))}</pre></div></div>`;
  }

  function viewHome() {
    return `<div class="page">
      <div class="eyebrow">Dovetail Signoff · prototype</div>
      <h1 class="page-title">Partcheck</h1>
      <p class="pc-lede">Open a mechanical fab package (STEP models, drawing PDFs, DXF flat patterns and a BOM) and see what a molder or shop would get: every part in 3D, its mass and size, and whether the files agree with each other. Nothing leaves this browser tab.</p>
      <div class="card pc-drop" data-act="open">
        <div class="pc-drop-ico">${ICON.part}</div>
        <div><b>Drop a package here</b>, a zip, a folder or loose files, or <button class="btn-plain btn" data-act="open">choose files</button> <button class="btn-plain btn" data-act="open-dir">choose a folder</button></div>
        <div class="pc-muted">STEP, IGES, STL, PDF, DXF and CSV. Name files &lt;part number&gt;_&lt;rev&gt;_&lt;description&gt;, like 2100410-011_B_front-cover.step.</div>
      </div>
      <div class="pc-demo-row">
        <button class="btn btn-primary" data-act="demo">Open the demo</button>
        <span class="pc-muted">The made-up Smart Thermostat: the enclosure package for the molder, and the wall bracket for the sheet-metal shop.</span>
      </div>
      <h2 class="section-title">What it does</h2>
      <div class="grid grid-3">
        ${[['Package checks', 'Revisions and part numbers agree across file names, STEP, drawing and BOM. Title blocks carry material, finish, tolerances and the GD&T standard. Flat patterns match the model. Each finding names the Signoff ME checks it supports.'],
          ['Part facts and previews', 'Mass from the model\'s volume and the material on the drawing, bounding box, bodies and through-holes, plus a thumbnail and a four-view sheet: the preview pack Signoff PL would show next to each part.'],
          ['Analysis views', 'Draft for a chosen pull direction, and wall thickness by ray casting, as color maps for an ME to read. They\'re views, not pass/fail checks.'],
        ].map(([t, d]) => `<div class="card pc-what"><div class="cl-card-title">${t}</div><p>${d}</p></div>`).join('')}
      </div>
      <h2 class="section-title">What it doesn't do (yet)</h2>
      <p class="pc-muted pc-narrow">Real geometry DFM: minimum internal radii, bend radius against thickness, hole-to-bend distance, undercuts, rib ratios. Those need exact surfaces, not triangles, which means a Python step on OpenCascade. It also can't open native CAD (SolidWorks, Creo, Inventor): export STEP first. See <b>Convert</b> for turning a STEP into STL, OBJ, GLB or images.</p>
    </div>`;
  }

  const sevDot = sev => `<span class="pc-sev pc-sev-${sev}" title="${SEV[sev]}"></span>`;
  // An overview stat card that opens Findings filtered to its severity (a plain card when there are none).
  function statLink(n, sev, cls, inner) {
    const label = sev === 'error' ? 'errors' : sev === 'warn' ? 'warnings' : 'notes';
    return n ? `<button class="${cls} stat-link" data-act="findings" data-f="${sev}" title="Show the ${label} in Findings">${inner}</button>` : `<div class="${cls}">${inner}</div>`;
  }
  function counts(pkg, key) {
    const f = pkg.findings.filter(x => key == null || x.part === key);
    return ['error', 'warn', 'info'].map(s => [s, f.filter(x => x.sev === s).length]);
  }

  function viewOverview(pkg) {
    const [e, w, i] = counts(pkg).map(c => c[1]);
    const parts = pkg.parts;
    return `<div class="page">
      <div class="page-head"><div class="page-head-text">
        <div class="eyebrow">Package${pkg.demoId ? ' · demo' : ''}</div>
        <h1 class="page-title">${esc(pkg.name)}</h1>
        <div class="page-sub"><span>${parts.length} part${parts.length === 1 ? '' : 's'}</span><span class="sep">·</span><span>${pkg.files.length} files, ${U.fmtBytes(pkg.files.reduce((s, f) => s + f.size, 0))}</span><span class="sep">·</span><span class="pc-mono" title="SHA-256 of the package: every file's path and hash">${pkg.sha256.slice(0, 12)}</span></div>
      </div></div>
      <div class="grid grid-4">
        <div class="card stat"><div class="stat-num">${parts.filter(p => p.mesh).length}</div><div class="stat-label">Parts with a model</div></div>
        ${statLink(e, 'error', `card stat ${e ? 'issue' : 'pass'}`, `<div class="stat-num">${e}</div><div class="stat-label">Errors</div>`)}
        ${statLink(w, 'warn', 'card stat', `<div class="stat-num" style="color:${w ? 'var(--warn)' : ''}">${w}</div><div class="stat-label">Warnings</div>`)}
        ${statLink(i, 'info', 'card stat', `<div class="stat-num">${i}</div><div class="stat-label">Notes</div>`)}
      </div>
      <h2 class="section-title">Parts</h2>
      <div class="pc-parts">${parts.map(p => partCard(pkg, p)).join('')}</div>
      ${pkg.purchased && pkg.purchased.length ? `<h2 class="section-title">Purchased parts in the BOM</h2>
        <div class="card"><table class="pc-table"><thead><tr><th>Part number</th><th>Description</th><th>Material</th><th>Qty</th></tr></thead><tbody>
        ${pkg.purchased.map(r => `<tr><td class="pc-mono">${esc(r.pn)}</td><td>${esc(r.desc)}</td><td>${esc(r.material)}</td><td>${esc(r.qty)}</td></tr>`).join('')}</tbody></table>
        <div class="pc-foot">No files expected for purchased parts.</div></div>` : ''}
      <h2 class="section-title">Checks run</h2>
      ${checkSummary(pkg)}
    </div>`;
  }

  function partCard(pkg, p) {
    const s = p.stats, c = counts(pkg, p.key).filter(x => x[1]);
    return `<button class="card pc-part" data-act="part" data-key="${esc(p.key)}">
      <div class="pc-thumb">${p.thumb ? `<img src="${p.thumb}" alt="${esc(p.label)}">` : `<div class="pc-nomodel">${ICON.part}<span>${p.modelError ? 'Model didn\'t open' : 'No model'}</span></div>`}</div>
      <div class="pc-part-body">
        <div class="pc-part-pn"><span class="pc-mono">${esc(p.label)}</span>${p.rev ? `<span class="chip">rev ${esc(p.rev)}</span>` : ''}</div>
        <div class="pc-part-name">${esc(p.name || '')}</div>
        <div class="pc-part-facts">
          <span>${esc(p.processLabel || '')}${p.material.match ? ' · ' + esc(p.material.match.name) : ''}</span>
          ${s ? `<span>${U.fmtMass(p.mass)}${p.mass != null ? '' : ' (material unknown)'}</span><span>${s.bbox.size.map(v => v.toFixed(1)).join(' × ')} mm</span>` : ''}
        </div>
        <div class="pc-part-sev">${c.length ? c.map(([sev, n]) => `<span class="pc-pill pc-pill-${sev}">${n} ${SEV[sev].toLowerCase()}${n > 1 ? 's' : ''}</span>`).join('') : '<span class="pc-pill pc-pill-ok">All checks clean</span>'}</div>
      </div></button>`;
  }

  function checkSummary(pkg) {
    const rows = PC.checks.CATALOG.map(c => {
      const r = pkg.results.filter(x => x.check === c.id);
      if (!r.length) return '';
      const worst = ['error', 'warn', 'info', 'ok'].find(s => r.some(x => x.sev === s));
      return `<tr><td>${sevDot(worst)}</td><td><b>${esc(c.title)}</b><div class="pc-muted">${esc(c.what)}</div></td><td class="pc-num">${r.filter(x => x.sev === 'ok').length}/${r.length}</td><td>${relatedChips(pkg, c.related)}</td></tr>`;
    }).join('');
    return `<div class="card"><table class="pc-table pc-checks"><thead><tr><th></th><th>Check</th><th title="Parts clean / parts checked">Clean</th><th>Signoff ME checks it supports</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }

  function relatedChips(pkg, ids) {
    const rev = pkg && pkg.demoId && DEMO_REVIEW[pkg.demoId];
    return `<span class="pc-related">${ids.map(id => rev
      ? `<a class="chip accent" href="${ME}?demo&project=${rev}&item=${encodeURIComponent(id)}" title="Open this check in Signoff ME's demo review">${esc(id)}</a>`
      : `<span class="chip">${esc(id)}</span>`).join('')}</span>`;
  }

  function viewFindings(pkg) {
    const f = pkg.findings.filter(x => state.filter === 'all' || x.sev === state.filter);
    const n = s => pkg.findings.filter(x => x.sev === s).length;
    return `<div class="page">
      <div class="page-head"><div class="page-head-text"><div class="eyebrow">Findings</div><h1 class="page-title">${esc(pkg.name)}</h1>
      <div class="page-sub">Package problems only. Design review stays in Signoff ME; each finding names the checks it gives evidence for.</div></div></div>
      <div class="seg pc-filter">${[['all', 'All', pkg.findings.length], ['error', 'Errors', n('error')], ['warn', 'Warnings', n('warn')], ['info', 'Notes', n('info')]].map(([k, l, c]) => `<button class="${state.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l} <span class="count">${c}</span></button>`).join('')}</div>
      <div class="card"><table class="pc-table"><thead><tr><th></th><th>Part</th><th>Finding</th><th>Signoff ME</th></tr></thead><tbody>
      ${f.map(x => `<tr><td>${sevDot(x.sev)}</td><td><button class="pc-link pc-mono" data-act="part" data-key="${esc(x.part)}">${esc(x.partLabel)}</button></td>
        <td><b>${esc(x.title)}</b>${x.detail ? `<div class="pc-muted">${esc(x.detail)}</div>` : ''}<div class="pc-check-id">${esc(PC.checks.BY[x.check].title)}</div></td><td>${relatedChips(pkg, x.related)}</td></tr>`).join('') || '<tr><td colspan="4" class="pc-muted">Nothing here.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function viewFiles(pkg) {
    const owner = f => { const p = pkg.parts.find(p => p.files.includes(f)); return p ? p.label : f.kind === 'bom' ? 'Package (BOM)' : '—'; };
    return `<div class="page"><div class="page-head"><div class="page-head-text"><div class="eyebrow">Files</div><h1 class="page-title">${esc(pkg.name)}</h1>
      <div class="page-sub">Every file, how it was read and which part it belongs to. Hashes let a later run prove the same files were sent.</div></div></div>
      <div class="card"><table class="pc-table"><thead><tr><th>File</th><th>Kind</th><th>Part</th><th>Rev</th><th class="pc-num">Size</th><th>SHA-256</th></tr></thead><tbody>
      ${pkg.files.map(f => `<tr><td>${esc(f.path)}</td><td>${esc(f.label)}</td><td class="pc-mono">${esc(owner(f))}</td><td>${esc(f.rev || '')}</td><td class="pc-num">${U.fmtBytes(f.size)}</td><td class="pc-mono pc-muted">${f.sha256.slice(0, 12)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ── Part page ──
  function viewPart(pkg, p) {
    const s = p.stats, D = p.drawing, F = k => (D && D.fields[k] ? D.fields[k].value : '');
    const res = pkg.results.filter(r => r.part === p.key);
    const fact = (k, v) => `<div class="pc-fact"><dt>${k}</dt><dd>${v}</dd></div>`;
    const idx = pkg.parts.indexOf(p), prev = pkg.parts[idx - 1], next = pkg.parts[idx + 1];
    return `<div class="page pc-wide">
      <div class="page-head"><div class="page-head-text">
        <div class="eyebrow"><button class="pc-link" data-act="view" data-view="overview">${esc(pkg.name)}</button> · part ${idx + 1} of ${pkg.parts.length}</div>
        <h1 class="page-title">${esc(p.name || p.label)}</h1>
        <div class="page-sub"><span class="pc-mono">${esc(p.label)}</span>${p.rev ? `<span class="chip">rev ${esc(p.rev)}</span>` : ''}<span class="chip accent">${esc(p.processLabel)}</span>${p.material.text ? `<span>${esc(p.material.text)}</span>` : ''}</div>
      </div><div class="pc-head-actions">
        ${prev ? `<button class="btn" data-act="part" data-key="${esc(prev.key)}">‹ ${esc(prev.label)}</button>` : ''}${next ? `<button class="btn" data-act="part" data-key="${esc(next.key)}">${esc(next.label)} ›</button>` : ''}
      </div></div>
      ${p.mesh ? `<div class="pc-part-grid">
        <div class="card pc-stage-card">
          <div class="pc-stage-bar">
            <div class="seg">${['iso', 'front', 'top', 'right', 'back', 'bottom'].map(v => `<button data-act="cam" data-v="${v}">${PC.viewer.VIEWS[v].label}</button>`).join('')}</div>
            <div class="seg">${[['shaded', 'Shaded'], ['draft', 'Draft'], ['thickness', 'Wall thickness']].map(([k, l]) => `<button class="${state.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}">${l}</button>`).join('')}</div>
          </div>
          <div class="pc-stage" id="stage"></div>
          <div class="pc-stage-foot" id="stage-foot">${stageFoot(p)}</div>
        </div>
        <div class="pc-side">
          <div class="card pc-facts"><dl>
            ${fact('Mass', U.fmtMass(p.mass) + (p.mass != null ? `<div class="pc-muted">${p.material.match.name} at ${p.material.match.density} g/cm³, from the ${esc(p.material.source)}</div>` : '<div class="pc-muted">No material matched, so no mass</div>'))}
            ${p.drawingMass != null ? fact('On the drawing', U.fmtMass(p.drawingMass)) : ''}
            ${fact('Size', U.fmtSize(s.bbox.size))}
            ${fact('Volume', U.fmtVol(s.volume))}
            ${fact('Surface', U.fmtArea(s.area))}
            ${fact('Center of mass', s.centroid ? s.centroid.map(v => v.toFixed(1)).join(', ') + ' mm' : '—')}
            ${fact('Bodies', (s.solids === 1 && !s.surfaces ? (s.closed ? 'One closed solid' : 'One solid, nearly closed') : [s.solids && s.solids + ' solid' + (s.solids > 1 ? 's' : ''), s.surfaces && s.surfaces + ' open surface' + (s.surfaces > 1 ? 's' : '')].filter(Boolean).join(', ')) + (s.holes != null ? ', ' + s.holes + ' through-hole' + (s.holes === 1 ? '' : 's') : ''))}
            ${fact('Mesh', s.triangles.toLocaleString('en-US') + ' triangles' + (p.readMs != null ? ', read in ' + p.readMs + ' ms' : ''))}
            ${p.header ? fact('STEP', esc(p.header.ap + ', ' + p.header.units + (p.header.system ? ', from ' + p.header.system : '') + (p.header.products[0] && p.header.products[0].id ? '. Product "' + p.header.products[0].id + '"' : '') + (p.header.revision ? ', rev ' + p.header.revision : ', no revision inside'))) : ''}
          </dl>
          <div class="pc-side-actions"><button class="btn" data-act="hero" title="Use the current view for this part's thumbnail and preview">Use this view for the thumbnail</button></div></div>
          <div class="card pc-export-mini"><div class="pc-card-title">Export this part</div>
            <div class="pc-btns">${Object.entries(PC.export.FORMATS).map(([k, f]) => `<button class="btn" data-act="export-part" data-fmt="${k}" title="${esc(f.what)}">${ICON.download}${f.label}</button>`).join('')}</div></div>
        </div>
      </div>` : `<div class="card pc-nomodel-big">${ICON.part}<div>${p.modelError ? 'The model didn\'t open: ' + esc(p.modelError) : 'No 3D model for this part in the package.'}</div></div>`}
      <h2 class="section-title">Checks</h2>
      <div class="card"><table class="pc-table">
        <tbody>${res.map(r => `<tr><td>${sevDot(r.sev)}</td><td><b>${esc(PC.checks.BY[r.check].title)}</b><div class="${r.sev === 'ok' ? 'pc-muted' : ''}">${esc(r.title)}${r.detail ? ` <span class="pc-muted">${esc(r.detail)}</span>` : ''}</div></td><td>${relatedChips(pkg, r.related)}</td></tr>`).join('') || '<tr><td class="pc-muted">No checks apply (a purchased part).</td></tr>'}</tbody></table></div>
      ${D ? `<h2 class="section-title">Drawing <span class="pc-title-actions"><button class="btn" data-act="open-pdf">Open the PDF</button></span></h2>
        <div class="pc-dwg-grid">
          <div class="card pc-dwg"><div id="dwg-img" class="pc-dwg-img"><div class="pc-muted">Rendering…</div></div></div>
          <div class="card"><table class="pc-table pc-tb"><tbody>
            ${[['Part number', 'part'], ['Revision', 'rev'], ['Title', 'title'], ['Material', 'material'], ['Finish', 'finish'], ['Mass', 'mass'], ['Scale', 'scale'], ['Sheet', 'sheet'], ['Drawn', 'drawn'], ['Checked', 'checked'], ['Approved', 'approved']]
              .map(([l, k]) => `<tr><th>${l}</th><td>${F(k) ? esc(F(k)) : `<span class="pc-missing">${D.fields[k] ? 'blank' : 'not found'}</span>`}</td></tr>`).join('')}
            <tr><th>Units</th><td>${D.units ? esc(D.units) : '<span class="pc-missing">not found</span>'}</td></tr>
            <tr><th>Projection</th><td>${D.projection ? esc(D.projection) : '<span class="pc-missing">not found</span>'}</td></tr>
            <tr><th>Tolerances</th><td>${D.tolerance ? esc(D.tolerance) : '<span class="pc-missing">not found</span>'}</td></tr>
            <tr><th>Standard</th><td>${D.standard ? esc(D.standard) : '<span class="pc-missing">not found</span>'}</td></tr>
            <tr><th>Revision table</th><td>${D.revs.length ? esc(D.revs.join(', ')) : '<span class="pc-missing">not found</span>'}</td></tr>
          </tbody></table><div class="pc-foot">Read from the PDF's text layer by label. A different title-block template may need its labels added.</div></div>
        </div>` : ''}
      ${p.flat ? `<h2 class="section-title">Flat pattern</h2>
        <div class="pc-dwg-grid"><div class="card pc-dwg">${PC.drawing.dxfSvg(p.flat)}</div>
        <div class="card"><table class="pc-table pc-tb"><tbody>
          <tr><th>File</th><td>${esc(p.flatFile.name)}</td></tr><tr><th>Blank</th><td>${U.fmtSize(p.flat.size)}</td></tr>
          <tr><th>Holes</th><td>${p.flat.holes}${p.stats && p.stats.holes != null ? ` <span class="pc-muted">(model: ${p.stats.holes})</span>` : ''}</td></tr>
          <tr><th>Bend lines</th><td>${p.flat.bends}</td></tr><tr><th>Revision</th><td>${esc(p.flatFile.rev || p.flat.rev || '—')}</td></tr>
        </tbody></table></div></div>` : ''}
      <h2 class="section-title">Files</h2>
      <div class="card"><table class="pc-table"><tbody>${p.files.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.label)}</td><td>${esc(f.rev || '')}</td><td class="pc-num">${U.fmtBytes(f.size)}</td></tr>`).join('') || '<tr><td class="pc-muted">No files.</td></tr>'}</tbody></table></div>
    </div>`;
  }

  function stageFoot(p) {
    const C = PC.viewer.DRAFT_COLORS, sw = c => `<i style="background:rgb(${c.map(v => Math.round(v * 255)).join(',')})"></i>`;
    if (state.mode === 'draft') {
      const d = p.draftMap, pct = d && d.wallArea ? Math.round(d.lowArea / d.wallArea * 100) : 0;
      return `<div class="pc-legend">${sw(C.up)}Drafted, facing the pull ${sw(C.down)}Drafted, facing away ${sw(C.low)}Under ${state.minDraft}° ${sw(C.zero)}No draft ${sw(C.flat)}Faces the pull</div>
        <div class="pc-ctl"><label>Pull <select data-act="pull">${['+Z', '-Z', '+X', '-X', '+Y', '-Y'].map(x => `<option${x === state.pull ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Minimum <input type="number" min="0.1" max="10" step="0.1" value="${state.minDraft}" data-act="min-draft"> °</label>
        ${d ? `<span class="pc-muted">${pct}% of wall area under ${state.minDraft}°${d.zeroArea ? ', ' + U.fmtArea(d.zeroArea) + ' with none' : ''}.</span>` : ''}</div>
        <div class="pc-note">A view for the ME, not a check: shut-offs and faces meant to be square read red too.</div>`;
    }
    if (state.mode === 'thickness') {
      const t = p.thick;
      if (!t) return `<div class="pc-muted" id="thick-progress">Measuring wall thickness…</div>`;
      const stops = PC.viewer.RAMP.map(([r, c]) => `rgb(${c.map(v => Math.round(v * 255)).join(',')}) ${Math.round((r - 0.4) / 1.3 * 100)}%`).join(',');
      return `<div class="pc-ramp"><span>${U.fmtLen(t.nominal * 0.4)}</span><b style="background:linear-gradient(90deg,${stops})"></b><span>${U.fmtLen(t.nominal * 1.7)}</span></div>
        <div class="pc-ctl"><span>Nominal wall <b>${U.fmtLen(t.nominal, 2)}</b></span><span class="pc-muted">5–95%: ${t.p05.toFixed(2)}–${t.p95.toFixed(2)} mm. Over 1.5× nominal: ${Math.round(t.thickArea / t.area * 100)}% of the surface${p.process === 'molded' ? ' (where sink and voids show up)' : ''}.</span></div>
        <div class="pc-note">The largest ball that fits in the wall at each point ("rolling ball"), measured on the triangle mesh. Rib and boss roots read thick, as they do in CAD tools; read it as a map, not a verdict.</div>`;
    }
    return `<div class="pc-muted">Drag to orbit, right-drag or shift-drag to pan, scroll to zoom, double-click to reset.</div>`;
  }

  const PULL = { '+Z': [0, 0, 1], '-Z': [0, 0, -1], '+X': [1, 0, 0], '-X': [-1, 0, 0], '+Y': [0, 1, 0], '-Y': [0, -1, 0] };
  async function applyMode(p) {
    if (state.mode === 'draft') p.draftMap = PC.mesh.draft(p.mesh, PULL[state.pull], state.minDraft);
    if (state.mode === 'thickness' && !p.thick) {
      const foot = $('#stage-foot');
      if (foot) foot.innerHTML = stageFoot(p);
      const t0 = performance.now();
      const t = await PC.mesh.thickness(p.mesh, f => {
        const el = $('#thick-progress'), left = f > 0.03 ? (performance.now() - t0) / f * (1 - f) / 1000 : null;
        if (el) el.textContent = 'Measuring wall thickness on ' + (p.mesh.idx.length / 3).toLocaleString('en-US') + ' triangles… ' + Math.round(f * 100) + '%' + (left != null && left > 3 ? ', about ' + Math.ceil(left) + ' s left' : '');
      });
      p.thick = t;
    }
    if (viewer && viewer.part === p) { viewer.setMode(state.mode); const foot = $('#stage-foot'); if (foot) foot.innerHTML = stageFoot(p); }
  }

  function mountViewer(p) {
    const host = $('#stage');
    if (!host || !p.mesh) return;
    viewer = new PC.viewer.Viewer(host, p);
    if (state.mode !== 'shaded') applyMode(p);
  }

  async function mountDrawing(p) {
    if (!p || !p.drawing) return;
    try {
      if (!p.drawingImg) p.drawingImg = await PC.drawing.renderPage(p.drawing, 1100);
      const el = $('#dwg-img');
      if (el) el.innerHTML = `<img src="${p.drawingImg}" alt="Drawing, sheet 1" data-act="open-pdf">`;
    } catch (e) { const el = $('#dwg-img'); if (el) el.innerHTML = '<div class="pc-muted">Could not render: ' + esc(e.message) + '</div>'; }
  }

  // ── Export page ──
  function viewExport(pkg) {
    const parts = pkg.parts.filter(p => p.mesh);
    pkg.hero = pkg.hero || (parts[0] && parts[0].key);
    return `<div class="page">
      <div class="page-head"><div class="page-head-text"><div class="eyebrow">Previews & export</div><h1 class="page-title">${esc(pkg.name)}</h1>
      <div class="page-sub">What Signoff PL would show next to each part, and mesh files for anyone without CAD.</div></div></div>
      <h2 class="section-title">Preview pack <span class="pc-title-actions"><button class="btn btn-primary" data-act="pack">${ICON.download}Download preview pack</button><button class="btn" data-act="run-json">${ICON.download}Run record (JSON)</button></span></h2>
      <p class="pc-muted pc-narrow">Per part: a 320 × 240 thumbnail, a four-view sheet and a small JSON (mass, size, material, findings), plus an <span class="pc-mono">index.json</span> naming the hero part. In the full design these go to the part's private repo next to the run, under <span class="pc-mono">partcheck/&lt;review&gt;/preview/</span>, for Signoff PL to read. This prototype only downloads them.</p>
      <div class="pc-previews">${parts.map(p => `<label class="card pc-preview${pkg.hero === p.key ? ' on' : ''}">
        <img src="${p.thumb}" alt=""><div><input type="radio" name="hero" data-act="hero-pick" data-key="${esc(p.key)}"${pkg.hero === p.key ? ' checked' : ''}> <b class="pc-mono">${esc(p.label)}</b> ${esc(p.name || '')}
        <div class="pc-muted">${U.fmtMass(p.mass)} · ${p.stats.bbox.size.map(v => v.toFixed(0)).join(' × ')} mm</div></div></label>`).join('')}</div>
      <h2 class="section-title">Mesh files</h2>
      <div class="card"><table class="pc-table"><tbody>
        ${parts.map(p => `<tr><td><b class="pc-mono">${esc(p.label)}</b> ${esc(p.name || '')}</td><td class="pc-btns">${Object.entries(PC.export.FORMATS).map(([k, f]) => `<button class="btn" data-act="export-part" data-key="${esc(p.key)}" data-fmt="${k}" title="${esc(f.what)}">${f.label}</button>`).join('')}</td></tr>`).join('')}
      </tbody></table>
      <div class="pc-foot">${Object.values(PC.export.FORMATS).map(f => `<b>${f.label}</b>: ${esc(f.what)}`).join(' ')}</div></div>
    </div>`;
  }

  // ── Convert page ──
  function viewConvert() {
    return `<div class="page">
      <div class="eyebrow">Convert</div><h1 class="page-title">STEP to STL, OBJ, GLB or images</h1>
      <p class="pc-lede">For a quick look or a print without CAD: drop STEP, IGES or STL files and download them as mesh files or pictures. Nothing is uploaded.</p>
      <div class="card pc-drop" data-act="open-conv">
        <div class="pc-drop-ico">${ICON.convert}</div>
        <div><b>Drop models here</b> or <button class="btn btn-plain" data-act="open-conv">choose files</button></div>
        <div class="pc-muted">STEP (.step, .stp), IGES (.igs), BREP or STL.</div>
      </div>
      ${state.convBusy ? `<div class="card pc-busy"><div class="pc-spin"></div><pre>${esc(state.convBusy)}</pre></div>` : ''}
      ${state.conv.length ? `<div class="card"><table class="pc-table"><tbody>${state.conv.map(c => `<tr>
        <td class="pc-conv-thumb">${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}</td>
        <td><b>${esc(c.file.name)}</b><div class="pc-muted">${c.error ? esc(c.error) : U.fmtSize(c.stats.bbox.size) + ' · ' + c.stats.triangles.toLocaleString('en-US') + ' triangles · ' + U.fmtVol(c.stats.volume)}</div></td>
        <td class="pc-btns">${c.mesh ? Object.entries(PC.export.FORMATS).map(([k, f]) => `<button class="btn" data-act="conv-dl" data-id="${c.id}" data-fmt="${k}" title="${esc(f.what)}">${f.label}</button>`).join('') : ''}</td></tr>`).join('')}</tbody></table>
        ${state.conv.filter(c => c.mesh).length > 1 ? `<div class="pc-foot pc-btns">Everything as one zip: ${Object.entries(PC.export.FORMATS).map(([k, f]) => `<button class="btn" data-act="conv-all" data-fmt="${k}">${f.label}</button>`).join('')}</div>` : ''}</div>` : ''}
      <h2 class="section-title">SolidWorks files (.sldprt)</h2>
      <div class="card pc-what"><p>A browser can't open them: SLDPRT is a closed format, and no open-source library, OpenCascade included, reads it. Ways to get a STEP:</p>
        <ul><li><b>Ask the ME</b> for STEP with the drawing. It's what vendors need anyway, and it keeps the revision with the file.</li>
        <li><b>SolidWorks</b> (or a viewer seat): File › Save As › STEP AP214 or AP242.</li>
        <li><b>Onshape</b> (free account): import the SLDPRT, then right-click the Part Studio › Export › STEP.</li>
        <li><b>eDrawings</b> views SLDPRT but can't save STEP; it can save STL from some versions.</li></ul>
        <p class="pc-muted">A converter for native CAD would have to run on a machine with SolidWorks installed (its API), or use a paid SDK such as CAD Exchanger or HOOPS.</p></div>
    </div>`;
  }

  // ── Events ──
  const fileInput = () => $('#file-input'), dirInput = () => $('#dir-input');
  let fileTarget = 'pkg';
  async function onFiles(list) {
    const inputs = await readFileList(list);
    if (!inputs.length) return;
    if (fileTarget === 'conv' || state.view === 'convert') convertInputs(inputs);
    else openInputs(nameFor(inputs), inputs);
  }

  function exportPart(p, fmt) {
    const f = PC.export.FORMATS[fmt];
    U.download(f.make(p), PC.export.baseName(p) + (fmt === 'png' ? '_views' : '') + '.' + f.ext);
  }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, pkg = active();
    // Picking something in the open menu on a narrow window closes it.
    if (el.closest('#sidebar') && /^(home|pkg|part|convert|open|open-dir)$/.test(act)) $('#app').classList.remove('nav-open');
    switch (act) {
      case 'open': fileTarget = 'pkg'; e.stopPropagation(); fileInput().click(); break;
      case 'open-dir': fileTarget = 'pkg'; e.stopPropagation(); dirInput().click(); break;
      case 'open-conv': fileTarget = 'conv'; e.stopPropagation(); fileInput().click(); break;
      case 'demo': loadDemo(); break;
      case 'nav': toggleSidebar(); break;
      case 'home': state.view = state.pkgs.length ? 'overview' : 'home'; if (!state.pkgs.length) state.active = null; renderAll(); break;
      case 'pkg': state.active = el.dataset.id; state.view = 'overview'; renderAll(); break;
      case 'part': state.part = el.dataset.key; state.view = 'part'; renderAll(); break;
      case 'view': state.view = el.dataset.view; renderAll(); break;
      case 'convert': state.view = 'convert'; renderAll(); break;
      case 'filter': state.filter = el.dataset.f; renderAll(); break;
      case 'findings': state.filter = el.dataset.f; state.view = 'findings'; renderAll(); break;
      case 'theme': { const t = isDark(readTheme()) ? 'light' : 'dark'; writeTheme(t); applyTheme(t); break; }
      case 'cam': if (viewer) viewer.view(el.dataset.v); break;
      case 'mode': {
        state.mode = el.dataset.mode;
        el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
        const p = partOf(pkg, state.part);
        if (p) applyMode(p);
        break;
      }
      case 'hero': {
        const p = partOf(pkg, state.part);
        if (p && viewer) { p.heroView = viewer.current(); p.thumb = PC.viewer.snapshot(p); renderSidebar(); toast('Thumbnail updated'); }
        break;
      }
      case 'hero-pick': pkg.hero = el.dataset.key; document.querySelectorAll('.pc-preview').forEach(c => c.classList.toggle('on', c.contains(el))); break;
      case 'export-part': exportPart(el.dataset.key ? partOf(pkg, el.dataset.key) : partOf(pkg, state.part), el.dataset.fmt); break;
      case 'pack': U.download(await PC.export.previewPack(pkg, pkg.hero), PC.export.safe(pkg.name.replace(/\.zip$/i, '')) + '_preview.zip'); break;
      case 'run-json': U.download(new Blob([JSON.stringify(PC.export.runRecord(pkg), null, 2)], { type: 'application/json' }), PC.export.safe(pkg.name.replace(/\.zip$/i, '')) + '_partcheck-run.json'); break;
      case 'open-pdf': {
        const p = partOf(pkg, state.part);
        if (p && p.drawingFile) window.open(URL.createObjectURL(new Blob([p.drawingFile.bytes], { type: 'application/pdf' })), '_blank');
        break;
      }
      case 'conv-dl': { const c = state.conv.find(x => x.id === el.dataset.id); if (c) exportPart(c, el.dataset.fmt); break; }
      case 'conv-all': {
        const f = PC.export.FORMATS[el.dataset.fmt], z = new JSZip();
        for (const c of state.conv.filter(x => x.mesh)) z.file(PC.export.baseName(c) + '.' + f.ext, await f.make(c).arrayBuffer());
        U.download(await z.generateAsync({ type: 'blob' }), 'partcheck_' + f.ext + '.zip');
        break;
      }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target, pkg = active(), p = partOf(pkg, state.part);
    if (el.id === 'file-input' || el.id === 'dir-input') { onFiles([...el.files]); el.value = ''; return; }
    if (el.dataset.act === 'pull') { state.pull = el.value; if (p) applyMode(p); }
    if (el.dataset.act === 'min-draft') { state.minDraft = Math.max(0.1, Math.min(10, +el.value || 1)); if (p) applyMode(p); }
  });

  // Drag and drop anywhere.
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('pc-dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('pc-dragging'); } });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', async e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('pc-dragging');
    const inputs = await dropped(e.dataTransfer);
    if (!inputs.length) return;
    if (state.view === 'convert') convertInputs(inputs);
    else openInputs(nameFor(inputs), inputs);
  });

  function toast(msg, tone) {
    const t = document.createElement('div');
    t.className = 'toast' + (tone === 'error' ? ' pc-toast-error' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), tone === 'error' ? 8000 : 2600);
  }

  // ── Tool updates (as in Signoff EE) ──
  // A page left open keeps running the version it loaded. Now and then (5 s after opening, every
  // 5 minutes, when the tab comes back into view) it asks this site which version it serves now.
  // If that's another one, it reloads into it, but only while nothing is open or running: a
  // loaded package isn't kept across a reload, so with one open it waits and asks again later.
  // The new page says "Tool updated". If the site serves the same version, or can't be reached,
  // the page stays as it is. A version it already reloaded for is never tried twice.
  // The scripts carry no ?v= stamp, so the browser's copies are refreshed before the reload.
  const UPDATE_KEY = 'signoff.toolUpdate.' + location.pathname;   // sessionStorage: { tried, from }
  const haveVersion = () => PC.VERSION;
  let updateWaiting = '', updateBusy = false;
  function updateMemo(v) {
    try {
      if (v === undefined) return JSON.parse(sessionStorage.getItem(UPDATE_KEY) || '{}') || {};
      sessionStorage.setItem(UPDATE_KEY, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function pageIdle() {
    const a = document.activeElement;
    const typing = a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable);
    return !typing && !document.hidden && !document.querySelector('.sheet-wrap, .menu, dialog[open]') && !state.busy && !state.convBusy && !state.conv.length && (DEMO || !state.pkgs.length);
  }
  async function reloadWhenIdle() {
    if (!updateWaiting) return;
    if (!pageIdle()) { setTimeout(reloadWhenIdle, 30000); return; }
    if (updateMemo({ tried: updateWaiting, from: haveVersion() }) === null) { updateWaiting = ''; return; }
    const own = u => { try { return new URL(u, location.href).origin === location.origin; } catch (e) { return false; } };
    const urls = [location.href.split('#')[0]]
      .concat([...document.scripts].map(s => s.src), [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href))
      .filter(u => u && own(u));
    await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => null)));
    location.reload();
  }
  function checkForUpdate() {
    const have = haveVersion();
    if (!have || updateBusy || updateWaiting || !window.fetch) return;
    updateBusy = true;
    fetch('assets/version.js?nc=' + Date.now(), { cache: 'no-store' })
      .then(r => r.ok ? r.text() : '')
      .then(text => {
        updateBusy = false;
        const m = /(?:hash"?\s*:\s*|VERSION\s*=\s*)["']([0-9a-f]+)["']/.exec(text || '');
        if (!m || m[1] === have || (updateMemo() || {}).tried === m[1]) return;
        updateWaiting = m[1];
        reloadWhenIdle();
      }, () => { updateBusy = false; });
  }
  {
    const memo = updateMemo() || {};
    if (memo.from && memo.from !== haveVersion()) { updateMemo({ tried: memo.tried }); setTimeout(() => toast('Tool updated'), 300); }
    setTimeout(checkForUpdate, 5000);
    setInterval(checkForUpdate, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  }

  // ── Start ──
  applyTheme(readTheme());
  // Start with the sidebar as it was left, without playing the slide. Applied on narrow windows
  // too (suite.css only hides it above 860 px), so widening the window later shows it as it was left.
  try {
    if (localStorage.getItem(SIDE_KEY) === '1') {
      const app = $('#app');
      app.style.transition = 'none'; app.classList.add('side-collapsed'); void app.offsetWidth; app.style.transition = '';
    }
  } catch (e) { /* storage blocked */ }
  if (DEMO) {
    const b = $('#demo-banner');
    b.hidden = false; document.body.classList.add('has-banner');
    b.innerHTML = 'Demo: the made-up Smart Thermostat for Acme Climate. The files are generated, and a few problems are planted for the checks to find. <a href="./">Leave the demo</a>';
    document.querySelectorAll('[data-demo-href]').forEach(a => { a.href = a.getAttribute('href') + '?demo'; });
  }
  $('#version').textContent = 'Build ' + (PC.VERSION || 'dev');
  renderAll();
  if (DEMO) loadDemo();
})(window.PC = window.PC || {});
