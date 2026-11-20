// Send to Signoff ME (docs/send-to-signoff-me.md): store each part's pictures and a small mesh with
// the part's Signoff ME review, so Signoff PL shows ME parts with pictures and in 3D the way
// Fabcheck's board pictures show boards.
//
//   <dataPath>partcheck/<reviewId>/preview/index.json         Fabcheck's v: 1 index, plus `parts`
//   <dataPath>partcheck/<reviewId>/preview/<pk>-<view>.webp   iso, top, front, right (480 × 360)
//   <dataPath>partcheck/<reviewId>/preview/<pk>.plm.gz        Signoff PL's PLM1 mesh (≤ 60,000 triangles)
//
// The mesh and pictures come from Signoff PL's own model3d.js (assets/vendor), so they are what a STEP
// attached in PL would give. Writes go through the Signoff engine's GitHubStore.putFiles in one commit;
// files already there are skipped, and files no index entry names any more are removed.
(function (PC) {
  'use strict';
  const M3 = () => window.Signoff && window.Signoff.model3d;
  const NS = 'signoff-me.v1.', DEMO_NS = 'signoff-me.demo.';
  const LAST_KEY = 'partcheck.v1.sendTo';   // package name -> review id, the last one sent to
  const VIEW_W = 480, VIEW_H = 360;
  const OWNER = 'chrismessick-dpd', DATA_REPO = 'me_design_review_data';
  // The demo's Signoff ME reviews, when this browser hasn't opened Signoff ME's demo.
  const DEMO_REVIEWS = [
    { id: 'mdemo5', name: 'Enclosure', number: '2100410-001', demo: 'enclosure' },
    { id: 'mdemo13', name: 'Wall Bracket', number: '2100410-020', demo: 'bracket' },
  ];
  let fetchImpl = null;   // tests inject a fake GitHub here
  let testing = null;     // tests: { token, ns }, so they never touch this browser's real token or Signoff ME storage

  const ns = () => testing ? testing.ns : PC.DEMO ? DEMO_NS : NS;
  const load = (k, d, n) => { try { const v = localStorage.getItem((n || ns()) + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const token = () => { if (testing) return testing.token; try { return sessionStorage.getItem('signoff.token') || localStorage.getItem('signoff.token') || ''; } catch (e) { return ''; } };
  const json = o => JSON.stringify(o, null, 1);
  // Signoff ME keeps its reviews and their home repos in IndexedDB (its localstore.js, vendored here)
  // since 2026-11-19; localStorage still has them in a browser where ME hasn't opened since, so both
  // are read, the store winning. ready() reads the store; the Send window waits for it.
  const local = {};   // ns -> { projects, homes }
  function ready() {
    const n = ns();
    if (testing || !window.SignoffLocal) return Promise.resolve();
    return window.SignoffLocal.store(n).load().then(d => {
      if (d && d.backend === 'idb') local[n] = { projects: d.projects || {}, homes: d.homes || {} };
    }, () => { /* the store couldn't open: localStorage alone */ });
  }
  const kept = k => Object.assign({}, load(k, {}) || {}, (local[ns()] || {})[k] || {});

  // Sign in the way the Signoff tools do: one key, in this tab only or remembered.
  const cleanToken = t => String(t || '').replace(/[\s​-‍⁠﻿]/g, '');
  async function signIn(t, remember) {
    t = cleanToken(t);
    if (!t) throw new Error('paste a token first');
    const me = await new window.Signoff.GitHubAccount(t, fetchImpl || undefined).user();
    try {
      sessionStorage.removeItem('signoff.token'); localStorage.removeItem('signoff.token');
      (remember ? localStorage : sessionStorage).setItem('signoff.token', t);
    } catch (e) { /* storage blocked */ }
    probes.clear();
    return me && me.login;
  }

  // ── Which review, and where it lives ──
  // Signoff ME's reviews in this browser (its working copy), newest first.
  function reviews() {
    const all = kept('projects');
    const list = Object.keys(all).map(k => all[k]).filter(p => p && p.id && p.meta && !p.meta.archived && !p.meta.deleted)
      .map(p => ({ id: p.id, name: p.meta.name || p.id, number: p.meta.board || '', project: p.meta.project || '', at: p.meta.updatedAt || '' }))
      .sort((a, b) => b.at.localeCompare(a.at));
    if (PC.DEMO) DEMO_REVIEWS.forEach(d => { if (!list.some(r => r.id === d.id)) list.push(Object.assign({}, d)); });
    return list;
  }
  // The review a package most likely belongs to: the last one it was sent to, the demo's own, a
  // review whose number is the package's assembly or one of its parts, then one whose name matches.
  function suggest(pkg, list) {
    list = list || reviews();
    const last = load(LAST_KEY, {}, '')[pkg.name];
    const by = id => list.find(r => r.id === id);
    if (last && by(last)) return last;
    const demo = pkg.demoId && DEMO_REVIEWS.find(d => d.demo === pkg.demoId);
    if (demo && by(demo.id)) return demo.id;
    const nums = [pkg.bom && pkg.bom.file && pkg.bom.file.pn, ...pkg.parts.map(p => p.pn)].filter(Boolean).map(s => String(s).toLowerCase());
    const hit = list.find(r => r.number && nums.includes(r.number.toLowerCase()));
    if (hit) return hit.id;
    const name = pkg.name.toLowerCase();
    const named = list.find(r => r.name && name.includes(r.name.toLowerCase()));
    return named ? named.id : '';
  }
  function remember(pkg, reviewId) {
    if (testing) return;
    try { const m = load(LAST_KEY, {}, ''); m[pkg.name] = reviewId; localStorage.setItem(LAST_KEY, JSON.stringify(m)); } catch (e) { /* storage blocked */ }
  }

  // The review's home repo and its preview folder, as Signoff ME decides them.
  function home(reviewId) {
    const s = load('settings', {}) || {}, roster = load('roster', {}) || {}, homes = kept('homes');
    const owner = s.owner || OWNER, dataRepo = s.dataRepo || DATA_REPO;
    const shared = roster.shared && roster.shared[reviewId] && roster.shared[reviewId].repo;
    const repo = shared || homes[reviewId] || owner + '/' + dataRepo;
    const isData = repo.toLowerCase() === (owner + '/' + dataRepo).toLowerCase();
    const dataPath = isData && s.dataPath ? s.dataPath.replace(/\/+$/, '') + '/' : '';
    return { repo, dir: dataPath + 'partcheck/' + reviewId + '/preview/', branch: s.branch || 'main' };
  }
  function storeFor(repo, branch) {
    const [owner, name] = repo.split('/');
    return new window.Signoff.GitHubStore({ owner, repo: name, branch: branch || 'main', dataPath: '', token: token() }, fetchImpl || undefined);
  }
  function readiness(reviewId) {
    const h = home(reviewId);
    if (PC.DEMO) return { ok: false, demo: true, repo: h.repo, text: 'the demo doesn\'t write to GitHub' };
    if (!window.Signoff || !window.Signoff.GitHubStore || !M3()) return { ok: false, repo: h.repo, text: 'the Signoff engine did not load' };
    if (!token()) return { ok: false, repo: h.repo, signIn: true, text: 'you are not signed in to GitHub in this tab' };
    if (!(window.crypto && crypto.subtle)) return { ok: false, repo: h.repo, text: 'storing needs a secure page (http://localhost or https), not a file opened from disk' };
    return { ok: true, repo: h.repo };
  }
  const probes = new Map();
  function probe(reviewId) {
    const r = readiness(reviewId);
    if (!r.ok) return Promise.resolve(r);
    const M = window.Signoff.model;
    const key = r.repo + ' ' + (M && M.tokenTag ? M.tokenTag(token()) : token().length);
    if (!probes.has(key)) {
      probes.set(key, storeFor(r.repo).api('').then(info => info && info.permissions && info.permissions.push === false
        ? { ok: false, repo: r.repo, text: `this token can read ${r.repo} but not write to it` } : r,
      err => {
        if (!(err.status === 401 || err.status === 404 || err.status === 403)) probes.delete(key);
        return { ok: false, repo: r.repo, text: err.status === 401 ? 'GitHub rejected the token (expired or revoked?)'
          : err.status === 404 || err.status === 403 ? `this token can't open ${r.repo}` : `GitHub didn't answer (${err.message || err})` };
      }));
    }
    return probes.get(key);
  }

  // ── The files ──
  // A part number as a file-name key: lowercase a-z, 0-9 and dashes, at most 25 characters, so
  // "<key>-front" stays within the 32 the readers allow.
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 25).replace(/-+$/, ''); }
  function keysFor(parts) {
    const used = new Set(), out = new Map();
    parts.forEach((p, i) => {
      let k = slug(p.pn || p.label);
      if (!k || used.has(k)) k = 'p' + (i + 1);
      while (used.has(k)) k += 'x';
      used.add(k); out.set(p.key, k);
    });
    return out;
  }
  // The parts that can be sent: those whose model was read.
  const sendable = pkg => pkg.parts.filter(p => p.plMesh && p.stats);
  // The default hero: the largest part by its bounding box.
  function defaultHero(pkg) {
    const vol = p => p.stats.bbox.size.reduce((a, b) => a * b, 1);
    return sendable(pkg).slice().sort((a, b) => vol(b) - vol(a))[0] || null;
  }
  async function picture(mesh, view) {
    const c = document.createElement('canvas');
    c.width = VIEW_W; c.height = VIEW_H;
    c.getContext('2d').putImageData(M3().render(mesh, { w: VIEW_W, h: VIEW_H, az: view.az, el: view.el }), 0, 0);
    let b = await new Promise(r => c.toBlob(r, 'image/webp', 0.9));
    if (!b || b.type !== 'image/webp') b = await new Promise(r => c.toBlob(r, 'image/png'));
    if (!b) throw new Error('Couldn’t draw the pictures');
    return { bytes: new Uint8Array(await b.arrayBuffer()), type: b.type, ext: b.type === 'image/webp' ? 'webp' : 'png' };
  }
  const round = (v, d) => v == null || !isFinite(v) ? null : Math.round(v * d) / d;

  // Build the files for the chosen parts. opts: { keys: part keys to send (default all), hero: part
  // key, prev: the stored index.json (its other parts are kept), runId, at, say(text) }.
  // Resolves { index, files: [{ name, bytes | text }] } with names relative to the preview folder.
  async function build(pkg, opts = {}) {
    const say = opts.say || (() => {});
    const all = sendable(pkg), names = keysFor(all);
    const sent = all.filter(p => !opts.keys || opts.keys.includes(p.key));
    const files = [], images = [], parts = [];
    for (const p of sent) {
      const k = names.get(p.key);
      say('Simplifying and drawing ' + (p.pn || p.label));
      const mesh = M3().simplify(p.plMesh, M3().MAX_TRIS);
      const gz = await M3().encode(mesh);
      files.push({ name: k + '.plm.gz', bytes: gz });
      const views = {};
      for (const v of M3().VIEWS) {
        const pic = await picture(mesh, v), key = k + '-' + v.key, file = key + '.' + pic.ext;
        files.push({ name: file, bytes: pic.bytes });
        images.push({ key, file, type: pic.type, w: VIEW_W, h: VIEW_H });
        views[v.key] = key;
        await PC.util.nextFrame();
      }
      const box = M3().bbox(p.plMesh.pos).size.map(x => round(x, 10));
      const mass = p.drawingMass != null ? p.drawingMass : p.mass;
      parts.push({ key: k, partNumber: p.pn || p.label || '', revision: p.rev || '', name: p.name || '', views,
        mesh: { file: k + '.plm.gz', size: gz.length, tris: mesh.idx.length / 3, srcTris: p.plMesh.idx.length / 3, bboxMm: box },
        massG: round(mass, 100), material: (p.material && p.material.match && p.material.match.name) || (p.material && p.material.text) || '' });
    }
    // Parts stored before and not sent this time stay, with their files.
    const prev = opts.prev && Array.isArray(opts.prev.parts) ? opts.prev : null;
    if (prev) {
      const prevImg = new Map((prev.images || []).map(i => [i.key, i]));
      // Signoff PL and Signoff ME write parts here too (signoff_pl/docs/part-models.md): a part with the same
      // number is replaced, whoever wrote it.
      const pn = s => String(s || '').trim().toLowerCase();
      prev.parts.filter(x => x && !parts.some(y => y.key === x.key || pn(y.partNumber) === pn(x.partNumber))).forEach(x => {
        const keep = Object.values(x.views || {}).map(k => prevImg.get(k)).filter(Boolean);
        keep.forEach(i => images.push(i));
        parts.push(x);
      });
    }
    const heroPart = parts.find(x => x.key === names.get(opts.hero)) || parts.find(x => prev && x.views.iso === prev.hero) || parts[0];
    const index = {
      v: 1, tool: 'partcheck', runId: opts.runId || pkg.id, at: opts.at != null ? opts.at : new Date().toISOString(),
      hero: heroPart ? heroPart.views.iso || Object.values(heroPart.views)[0] : (images[0] && images[0].key),
      images, parts, package: { name: pkg.name, sha256: pkg.sha256 || '' },
    };
    files.push({ name: 'index.json', text: json(index) });
    return { index, files };
  }
  // The files an index names (for removing the ones it no longer does).
  // (A part kept from Signoff PL or Signoff ME may have its STEP stored too: model3d.parts.named.)
  function named(index) {
    return new Set(Object.keys(M3().parts.named(index)));
  }

  // Store the chosen parts with the review. Never throws; resolves { ok, repo, dir, res, index } or
  // { ok: false, why }. progress(text, fraction) drives the busy card.
  async function store(pkg, reviewId, opts = {}) {
    const progress = opts.progress || (() => {});
    const ready = readiness(reviewId);
    if (!ready.ok) return { ok: false, why: ready.text };
    const h = home(reviewId), st = storeFor(h.repo, h.branch);
    try {
      progress('Reading what ' + h.repo + ' holds…', 0.05);
      const entries = await st.listTree(h.dir);
      const at = entries.find(e => e.path === h.dir + 'index.json');
      let prev = null;
      if (at) try { prev = JSON.parse(new TextDecoder().decode(await st.blobBytes(at.sha))); } catch (e) { prev = null; }
      const built = await build(pkg, Object.assign({}, opts, { prev, say: t => progress(t, 0.2) }));
      const keep = named(built.index);
      const files = built.files.map(f => Object.assign({ path: h.dir + f.name }, f.bytes ? { bytes: f.bytes } : { text: f.text }))
        .concat(entries.filter(e => !keep.has(e.path.slice(h.dir.length))).map(e => ({ path: e.path, remove: true })));
      const bytes = built.files.reduce((n, f) => n + (f.bytes ? f.bytes.length : f.text.length), 0);
      progress(`Uploading to ${h.repo} (${(bytes / 1048576).toFixed(2)} MB)…`, 0.5);
      const n = built.index.parts.length;
      const res = await st.putFiles(files, {
        message: `Partcheck: pictures and models for ${n} part${n === 1 ? '' : 's'} (${pkg.name})`,
        onProgress: (done, total) => progress(`Uploading to ${h.repo}: ${done} of ${total} new files…`, 0.5 + 0.45 * (total ? done / total : 1)),
        onRetry: k => progress(`Someone else pushed first; retrying (${k})…`),
      });
      remember(pkg, reviewId);
      return { ok: true, repo: h.repo, dir: h.dir, res, index: built.index };
    } catch (err) {
      return { ok: false, why: err.status === 404 || err.status === 403 ? `this token can't write to ${h.repo}` : (err.message || String(err)) };
    }
  }

  // ── Signoff PL's demo ──
  // Both demo packages as a Send stores them, for Signoff PL's and Signoff ME's demos
  // (tools/pl_demo.html writes them out; tests/test.html checks they are current).
  // Resolves { reviewId: { index, files } }, with a fixed runId and no date.
  async function demoPreviews(pkgs) {
    const out = {};
    for (const pkg of pkgs) {
      const d = DEMO_REVIEWS.find(x => x.demo === pkg.demoId);
      if (!d) continue;
      const hero = defaultHero(pkg);
      out[d.id] = await build(pkg, { runId: 'demo-' + d.demo, at: '', hero: hero && hero.key });
    }
    return out;
  }
  // A git blob sha (what a repo tree lists), so the demo can serve the files the way PL reads them.
  async function gitSha(bytes) {
    const head = new TextEncoder().encode('blob ' + bytes.length + '\0'), all = new Uint8Array(head.length + bytes.length);
    all.set(head); all.set(bytes, head.length);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
    return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // The demo files, by path from the tools folder (tools/pl_demo.html saves them):
  //   signoff_pl/assets/demo-partcheck/<review>/<file>   what a Send stores (not index.json)
  //   signoff_pl/assets/demo-partcheck.js               each review's index.json and its files' blob shas
  //   me_design_review/assets/demo-previews/<review>-<view>.webp   the hero part's views, for ME's overview
  async function demoBundle(pkgs) {
    const built = await demoPreviews(pkgs), files = {}, snap = {};
    for (const id of Object.keys(built)) {
      const { index } = built[id], shas = {};
      for (const f of built[id].files) {
        if (!f.bytes) continue;
        shas[f.name] = await gitSha(f.bytes);
        files['signoff_pl/assets/demo-partcheck/' + id + '/' + f.name] = f.bytes;
      }
      snap[id] = { index, shas };
      // Signoff ME's demo reads the whole folder (index.json, pictures, and meshes) through the same code as a
      // repo (its config.demo.pictures { folder: true }), for its overview's pictures and 3D view.
      built[id].files.forEach(f => {
        files['me_design_review/assets/demo-previews/' + id + '/' + f.name] = f.bytes || new TextEncoder().encode(f.text);
      });
    }
    files['signoff_pl/assets/demo-partcheck.js'] = new TextEncoder().encode(
      '/* Generated by partcheck/tools/pl_demo.html: what Partcheck\'s Send to Signoff ME stores for the demo\n' +
      '   reviews (partcheck/docs/send-to-signoff-me.md). The files are in assets/demo-partcheck/<review>/;\n' +
      '   demo.js reads them through reader.js cleanPreview, as a real sync would. Don\'t edit by hand. */\n' +
      'window.SIGNOFF_PL_DEMO_PARTCHECK = ' + JSON.stringify(snap, null, 1) + ';\n');
    return { files, snap };
  }

  PC.send = {
    signIn, ready, reviews, suggest, home, readiness, probe, store, build, named, slug, keysFor, sendable, defaultHero, demoPreviews, demoBundle, gitSha,
    hasToken: () => !!token(), DEMO_REVIEWS, VIEW_W, VIEW_H,
    _test: t => { testing = t ? { token: t.token, ns: t.ns } : null; fetchImpl = (t && t.fetch) || null; probes.clear(); },
  };
})(window.PC = window.PC || {});
