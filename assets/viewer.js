// The 3D view (three.js): an orthographic, Z-up CAD-style view with turntable orbit, pan and zoom,
// colored by plain shading, draft for a pull direction, or wall thickness. Also renders the
// preview images (thumbnail, four-view sheet) off screen.
(function (PC) {
  'use strict';
  const T = () => window.THREE;
  const DEG = Math.PI / 180;

  const VIEWS = {
    iso: { az: -60, el: 30, label: 'Iso' }, front: { az: -90, el: 0, label: 'Front' }, back: { az: 90, el: 0, label: 'Back' },
    right: { az: 0, el: 0, label: 'Right' }, left: { az: 180, el: 0, label: 'Left' }, top: { az: -90, el: 89.5, label: 'Top' }, bottom: { az: -90, el: -89.5, label: 'Bottom' },
  };

  function baseColor(part) {
    const c = part.mesh && part.mesh.colors && part.mesh.colors[0];
    if (c) return c;
    const k = part.material && part.material.match && part.material.match.kind;
    if (k === 'metal') return [0.74, 0.76, 0.79];
    if (k === 'elastomer') return [0.3, 0.32, 0.35];
    return [0.93, 0.93, 0.91];
  }

  // Non-indexed geometry: every triangle corner gets its own normal and color, so heatmaps can
  // color faces independently.
  function geometry(part) {
    const THREE = T(), m = part.mesh, nt = m.idx.length / 3;
    const pos = new Float32Array(nt * 9), nrm = new Float32Array(nt * 9), col = new Float32Array(nt * 9), n = [0, 0, 0];
    for (let t = 0; t < nt; t++) {
      if (m.flat) PC.mesh.faceNormal(m.pos, m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2], n);
      for (let k = 0; k < 3; k++) {
        const v = m.idx[t * 3 + k], o = t * 9 + k * 3;
        pos[o] = m.pos[v * 3]; pos[o + 1] = m.pos[v * 3 + 1]; pos[o + 2] = m.pos[v * 3 + 2];
        if (m.flat) { nrm[o] = n[0]; nrm[o + 1] = n[1]; nrm[o + 2] = n[2]; }
        else { nrm[o] = m.nrm[v * 3]; nrm[o + 1] = m.nrm[v * 3 + 1]; nrm[o + 2] = m.nrm[v * 3 + 2]; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    paint(g, part, 'shaded');
    return g;
  }

  // ── Colors ──
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  const DRAFT_COLORS = { up: hex('#2bb3a3'), down: hex('#4b7bec'), low: hex('#f5a524'), zero: hex('#e5484d'), flat: hex('#c9ced6') };
  const RAMP = [[0.4, hex('#3b5bdb')], [0.8, hex('#22b8cf')], [1.0, hex('#40c057')], [1.3, hex('#fab005')], [1.7, hex('#fa5252')]];
  function ramp(r) {
    if (!isFinite(r)) return [0.6, 0.6, 0.62];
    if (r <= RAMP[0][0]) return RAMP[0][1];
    for (let i = 1; i < RAMP.length; i++) if (r <= RAMP[i][0]) {
      const [a, ca] = RAMP[i - 1], [b, cb] = RAMP[i], f = (r - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
    return RAMP[RAMP.length - 1][1];
  }

  function paint(g, part, mode) {
    const col = g.getAttribute('color').array, nt = col.length / 9;
    const set = (t, k, c) => { const o = t * 9 + k * 3; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; };
    if (mode === 'draft' && part.draftMap) {
      const d = part.draftMap;
      for (let t = 0; t < nt; t++) {
        const deg = d.deg[t];
        const c = deg >= 30 ? DRAFT_COLORS.flat : deg < 0.25 ? DRAFT_COLORS.zero : deg < d.minDeg ? DRAFT_COLORS.low : d.side[t] > 0 ? DRAFT_COLORS.up : DRAFT_COLORS.down;
        set(t, 0, c); set(t, 1, c); set(t, 2, c);
      }
    } else if (mode === 'thickness' && part.thick) {
      const th = part.thick, nom = th.nominal || 1;
      for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) set(t, k, ramp(th.val[t * 3 + k] / nom));
    } else {
      const c = baseColor(part);
      for (let t = 0; t < nt; t++) { set(t, 0, c); set(t, 1, c); set(t, 2, c); }
    }
    g.getAttribute('color').needsUpdate = true;
  }

  function sceneFor(part, geo, opts) {
    const THREE = T(), scene = new THREE.Scene();
    const metal = part.material && part.material.match && part.material.match.kind === 'metal';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: metal ? 0.42 : 0.62, metalness: metal ? 0.35 : 0.0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    let edges = null;
    if (opts.edges !== false && part.mesh.idx.length / 3 < 400000) {
      edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 28), new THREE.LineBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.32 }));
      scene.add(edges);
    }
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f99, 0.38));
    return { scene, mesh, edges, mat };
  }

  // Camera looking from (az, el), framed on the part's bounding sphere.
  function aim(cam, part, az, el, target, zoom, aspect) {
    const THREE = T(), b = part.stats.bbox;
    const c = target || new THREE.Vector3((b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2);
    const r = Math.max(b.diag / 2, 1e-3);
    const d = new THREE.Vector3(Math.cos(el * DEG) * Math.cos(az * DEG), Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG));
    cam.position.copy(c).addScaledVector(d, r * 4);
    cam.up.set(0, 0, 1);
    cam.lookAt(c);
    const h = r * 1.08 / (zoom || 1);
    cam.left = -h * aspect; cam.right = h * aspect; cam.top = h; cam.bottom = -h;
    cam.near = r * 0.5; cam.far = r * 8;
    cam.updateProjectionMatrix();
    return c;
  }

  function lightRig(THREE, cam, scene) {
    const key = new THREE.DirectionalLight(0xffffff, 0.75); key.position.set(-1, 1.4, 2);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28); fill.position.set(1.5, -0.6, 1);
    cam.add(key, fill);
    scene.add(cam);
  }

  class Viewer {
    constructor(host, part, opts = {}) {
      const THREE = T();
      this.host = host; this.part = part; this.mode = 'shaded';
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      host.appendChild(this.renderer.domElement);
      this.geo = geometry(part);
      Object.assign(this, sceneFor(part, this.geo, opts));
      this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
      lightRig(THREE, this.cam, this.scene);
      const v = part.heroView || VIEWS.iso;
      this.az = v.az; this.el = v.el; this.zoom = 1; this.target = null;
      this.bind();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(host);
      this.resize();
    }
    resize() {
      const w = this.host.clientWidth, h = this.host.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      this.draw();
    }
    draw() {
      const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
      this.target = aim(this.cam, this.part, this.az, this.el, this.target, this.zoom, w / h);
      if (this.edges) this.edges.material.color.set(document.documentElement.dataset.theme === 'dark' || (document.documentElement.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 0x000000 : 0x1d1d1f);
      this.renderer.render(this.scene, this.cam);
    }
    view(name) { const v = VIEWS[name]; if (!v) return; this.az = v.az; this.el = v.el; this.zoom = 1; this.target = null; this.draw(); }
    setMode(mode) { this.mode = mode; paint(this.geo, this.part, mode); this.draw(); }
    setEdges(on) { if (this.edges) this.edges.visible = on; this.draw(); }
    current() { return { az: this.az, el: this.el }; }
    bind() {
      const el = this.renderer.domElement;
      let drag = null;
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, pan: e.button !== 0 || e.shiftKey }; el.setPointerCapture(e.pointerId); });
      el.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        if (drag.pan) {
          const THREE = T(), h = (this.cam.top - this.cam.bottom) / this.host.clientHeight;
          const right = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 0), up = new THREE.Vector3().setFromMatrixColumn(this.cam.matrix, 1);
          this.target.addScaledVector(right, -dx * h).addScaledVector(up, dy * h);
        } else {
          this.az -= dx * 0.45;
          this.el = Math.max(-89.5, Math.min(89.5, this.el + dy * 0.45));
        }
        this.draw();
      });
      const end = () => { drag = null; };
      el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', e => { e.preventDefault(); this.zoom = Math.max(0.2, Math.min(40, this.zoom * Math.exp(-e.deltaY * 0.0015))); this.draw(); }, { passive: false });
      el.addEventListener('dblclick', () => this.view('iso'));
    }
    dispose() {
      this.ro.disconnect();
      this.geo.dispose(); this.mat.dispose();
      if (this.edges) { this.edges.geometry.dispose(); this.edges.material.dispose(); }
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
  }

  // ── Off-screen previews ──
  let shot = null;
  function shooter() {
    if (!shot) {
      const THREE = T();
      shot = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      shot.setPixelRatio(1);
    }
    return shot;
  }

  // PNG of one view: rendered at 2× and scaled down for clean edges.
  function snapshot(part, opts = {}) {
    const THREE = T(), w = opts.w || 320, h = opts.h || 240, ss = 2;
    const r = shooter();
    r.setSize(w * ss, h * ss, false);
    r.setClearColor(0x000000, 0);
    const geo = geometry(part);
    if (opts.mode) paint(geo, part, opts.mode);
    const s = sceneFor(part, geo, { edges: opts.edges !== false });
    if (s.edges) s.edges.material.opacity = 0.22;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    lightRig(THREE, cam, s.scene);
    const v = opts.view || part.heroView || VIEWS.iso;
    aim(cam, part, v.az, v.el, null, opts.zoom || 1.06, w / h);
    r.render(s.scene, cam);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(r.domElement, 0, 0, w, h);
    geo.dispose(); s.mat.dispose();
    if (s.edges) { s.edges.geometry.dispose(); s.edges.material.dispose(); }
    return opts.canvas ? c : c.toDataURL('image/png');
  }

  // Four views on one sheet: iso, front, top, right.
  function viewSheet(part, w = 640, h = 480) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    [['iso', 0, 0], ['top', 1, 0], ['front', 0, 1], ['right', 1, 1]].forEach(([name, i, j]) => {
      const img = snapshot(part, { w: w / 2, h: h / 2, view: name === 'iso' ? part.heroView || VIEWS.iso : VIEWS[name], canvas: true, zoom: 1.12 });
      ctx.drawImage(img, i * w / 2, j * h / 2);
      ctx.fillStyle = 'rgba(110,110,115,0.9)';
      ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(VIEWS[name].label.toUpperCase(), i * w / 2 + 10, j * h / 2 + 18);
    });
    return c.toDataURL('image/png');
  }

  PC.viewer = { Viewer, snapshot, viewSheet, VIEWS, DRAFT_COLORS, RAMP };
})(window.PC = window.PC || {});
