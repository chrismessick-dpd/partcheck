// Third-party libraries, loaded only when first needed, each pinned and checked by its hash.
// three.js and JSZip load from index.html; OpenCascade (STEP reading) and pdf.js load here.
(function (PC) {
  'use strict';
  const JSD = 'https://cdn.jsdelivr.net/npm/';
  const LIBS = {
    occt: { js: JSD + 'occt-import-js@0.0.23/dist/occt-import-js.js', jsSri: 'sha384-Z8pO9JEhFZF+mvDKxMuLvPT85VP7nly8CqYjBatl0bMeW9OsaKCes4gEUPL4nihc',
      wasm: JSD + 'occt-import-js@0.0.23/dist/occt-import-js.wasm', wasmSri: 'sha384-6BbVZ7iPDgcRszsoavxGz4TaYCwC2EkeYCy1aR9XFwqMZYXDQP+0vZSTP6Yw35iD' },
    pdf: { js: JSD + 'pdfjs-dist@3.11.174/build/pdf.min.js', jsSri: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e',
      worker: JSD + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js', workerSri: 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2',
      fonts: JSD + 'pdfjs-dist@3.11.174/standard_fonts/' },
  };

  function script(src, integrity) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.integrity = integrity; s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src.replace(JSD, '') + ' (offline, or blocked?)'));
      document.head.appendChild(s);
    });
  }

  let worker = null, pdf = null, seq = 0;
  const pending = new Map();

  // OpenCascade compiled to WebAssembly (occt-import-js), in assets/occt-worker.js: reads STEP,
  // IGES and BREP into triangle meshes. Needs http(s); a page opened from disk can't start it.
  function cadWorker() {
    if (!worker) {
      if (location.protocol === 'file:') throw new Error('Reading STEP needs the hosted page or a local server (python -m http.server); a page opened from disk can\'t start the STEP reader.');
      worker = new Worker('assets/occt-worker.js');
      worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error)); };
      worker.onerror = e => { for (const p of pending.values()) p.reject(new Error('The STEP reader stopped: ' + (e.message || 'worker error'))); pending.clear(); worker = null; };
    }
    return worker;
  }
  function readCad(kind, bytes, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const copy = bytes ? bytes.slice() : null;
      cadWorker().postMessage({ id, lib: LIBS.occt, kind, bytes: copy, params }, copy ? [copy.buffer] : []);
    });
  }

  PC.libs = {
    LIBS,
    readCad,
    warmCad() { return readCad('init', null, null); },
    // pdf.js. Its worker has to be same-origin, so it runs from a Blob of the checked file.
    pdf() {
      if (!pdf) {
        pdf = (async () => {
          await script(LIBS.pdf.js, LIBS.pdf.jsSri);
          const res = await fetch(LIBS.pdf.worker, { integrity: LIBS.pdf.workerSri });
          if (!res.ok) throw new Error('Could not load the PDF reader (HTTP ' + res.status + ')');
          const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/javascript' }));
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = url;
          return window.pdfjsLib;
        })();
        pdf.catch(() => { pdf = null; });
      }
      return pdf;
    },
  };
})(window.PC = window.PC || {});
