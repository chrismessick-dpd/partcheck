// Small shared helpers: escaping, units (metric first, imperial in parentheses), hashing, CSV, downloads.
(function (PC) {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const num = (v, d) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en-US') : v.toFixed(d));
  // "90.0 mm (3.54 in)"; small lengths get mil like the checklists do.
  function fmtLen(mm, d = 1) {
    if (mm == null || !isFinite(mm)) return '—';
    const inch = mm / 25.4;
    return num(mm, d) + ' mm (' + (inch < 0.1 ? (inch * 1000).toFixed(1) + ' mil' : inch.toFixed(inch < 1 ? 3 : 2) + ' in') + ')';
  }
  function fmtSize(b) {
    if (!b) return '—';
    return b.map(v => num(v, 1)).join(' × ') + ' mm (' + b.map(v => (v / 25.4).toFixed(2)).join(' × ') + ' in)';
  }
  function fmtMass(g) {
    if (g == null || !isFinite(g)) return '—';
    return (g >= 1000 ? (g / 1000).toFixed(2) + ' kg' : g.toFixed(1) + ' g') + ' (' + (g / 28.3495).toFixed(2) + ' oz)';
  }
  const fmtVol = mm3 => (mm3 == null ? '—' : (mm3 / 1000).toFixed(2) + ' cm³ (' + (mm3 / 16387.064).toFixed(3) + ' in³)');
  const fmtArea = mm2 => (mm2 == null ? '—' : (mm2 / 100).toFixed(1) + ' cm² (' + (mm2 / 645.16).toFixed(2) + ' in²)');
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' kB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  async function sha256(bytes) {
    const h = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF.
  function parseCsv(text) {
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
        else if (c === '"') q = false;
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(f); f = '';
        if (row.some(x => x.trim())) rows.push(row);
        row = [];
      } else f += c;
    }
    row.push(f);
    if (row.some(x => x.trim())) rows.push(row);
    return rows;
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  const dataUrlToBytes = url => Uint8Array.from(atob(url.split(',')[1]), c => c.charCodeAt(0));
  const b64ToBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const nextFrame = () => new Promise(r => setTimeout(r, 0));

  PC.util = { esc, fmtLen, fmtSize, fmtMass, fmtVol, fmtArea, fmtBytes, sha256, parseCsv, download, dataUrlToBytes, b64ToBytes, nextFrame };
})(window.PC = window.PC || {});
