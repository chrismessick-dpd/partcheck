// Material callouts → a family, a density, and the process it usually implies. The first match
// wins, so blends and filled grades come before their base resins. Densities are typical datasheet
// values (g/cm³); a part's mass is only as good as this match, so the UI always says which row it used.
(function (PC) {
  'use strict';
  const M = (key, name, re, density, kind, process) => ({ key, name, re, density, kind, process });
  const LIST = [
    M('pcabs', 'PC/ABS', /\bPC\s*[\/+]\s*ABS\b|CYCOLOY|BAYBLEND/i, 1.15, 'plastic', 'molded'),
    M('pa66gf30', 'PA66 30% glass', /\b(PA\s*66|NYLON\s*6\/?6).{0,20}(GF\s*30|30\s*%\s*G)/i, 1.36, 'plastic', 'molded'),
    M('pa12', 'PA12 (SLS/MJF)', /\bPA\s*12\b|NYLON\s*12|\bMJF\b|\bSLS\b/i, 1.01, 'plastic', 'printed'),
    M('sla', 'SLA resin', /\bSLA\b|STEREOLITH|TOUGH\s*\d|RIGID\s*\d+K|ACCURA/i, 1.18, 'plastic', 'printed'),
    M('pa66', 'PA66', /\bPA\s*66\b|NYLON\s*6\/?6|ZYTEL/i, 1.14, 'plastic', 'molded'),
    M('pa6', 'PA6', /\bPA\s*6\b|NYLON\s*6\b/i, 1.13, 'plastic', 'molded'),
    M('pc', 'PC', /\bPC\b|POLYCARBONATE|LEXAN|MAKROLON/i, 1.20, 'plastic', 'molded'),
    M('abs', 'ABS', /\bABS\b/i, 1.05, 'plastic', 'molded'),
    M('pom', 'POM (acetal)', /\bPOM\b|ACETAL|DELRIN/i, 1.41, 'plastic', 'molded'),
    M('pbt', 'PBT', /\bPBT\b|VALOX/i, 1.31, 'plastic', 'molded'),
    M('pp', 'PP', /\bPP\b|POLYPROPYLENE/i, 0.905, 'plastic', 'molded'),
    M('pmma', 'PMMA (acrylic)', /\bPMMA\b|ACRYLIC/i, 1.19, 'plastic', 'molded'),
    M('peek', 'PEEK', /\bPEEK\b/i, 1.30, 'plastic', 'machined'),
    M('tpu', 'TPU', /\bTPU\b/i, 1.20, 'elastomer', 'molded'),
    M('tpe', 'TPE', /\bTPE\b|SANTOPRENE/i, 1.00, 'elastomer', 'molded'),
    M('lsr', 'Silicone (LSR)', /\bLSR\b|SILICONE/i, 1.12, 'elastomer', 'molded'),
    M('al6061', 'Aluminum 6061', /6061/, 2.70, 'metal', 'machined'),
    M('al5052', 'Aluminum 5052', /5052/, 2.68, 'metal', 'sheet'),
    M('al', 'Aluminum', /\bALUMIN(I)?UM\b|\bAL\b/i, 2.70, 'metal', 'machined'),
    M('ss', 'Stainless steel', /STAINLESS|\b30[34]\b|\b316L?\b|\b17-4\b/i, 8.00, 'metal', 'machined'),
    M('steel', 'Steel', /\bSTEEL\b|\bCRS\b|\bSAE\s*10\d\d\b|\bSPCC\b|\bDC0[14]\b/i, 7.85, 'metal', 'sheet'),
    M('brass', 'Brass', /\bBRASS\b|\bC360\b/i, 8.50, 'metal', 'machined'),
    M('copper', 'Copper', /\bCOPPER\b|\bC110\b/i, 8.96, 'metal', 'machined'),
    M('zinc', 'Zinc die-cast', /ZAMAK|\bZINC\s*ALLOY/i, 6.60, 'metal', 'cast'),
    M('mg', 'Magnesium', /MAGNESIUM|\bAZ91/i, 1.81, 'metal', 'cast'),
    M('ti', 'Titanium', /TITANIUM|TI-?6AL/i, 4.43, 'metal', 'machined'),
  ];

  function match(text) {
    if (!text) return null;
    for (const m of LIST) if (m.re.test(text)) return m;
    return null;
  }

  // Grade tokens: words with a digit (C1200HF, T85, 6061, 1008), the part of a callout that
  // decides whether two callouts mean the same resin or alloy.
  const grades = text => (String(text || '').toUpperCase().match(/[A-Z0-9-]*\d[A-Z0-9-]*/g) || [])
    .filter(t => !/^\d+(\.\d+)?$/.test(t) && !/^(CMF|RAL|MT)-?\d+/.test(t) && !/^\d+(\.\d+)?(MM|IN)$/.test(t));

  // Do two callouts name the same material? Unknown when either side doesn't match the table.
  function same(a, b) {
    const ma = match(a), mb = match(b);
    if (!ma || !mb) return null;
    if (ma.key !== mb.key) return false;
    const ga = grades(a), gb = grades(b);
    if (ga.length && gb.length && !ga.some(g => gb.includes(g))) return false;
    return true;
  }

  PC.materials = { LIST, match, same, grades };
})(window.PC = window.PC || {});
