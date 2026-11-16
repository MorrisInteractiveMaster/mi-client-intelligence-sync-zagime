/* Partnership Pulse: "At a glance" animation engine. Plain JavaScript drawing every frame on a canvas.
   No AI at run time: every number comes from the loaded data. */
(function () {
  const W = 1280, H = 720, SCALE = 1.5;
  const F = { head: 'Manrope, "DM Sans", sans-serif', body: '"DM Sans", sans-serif', serif: 'Georgia, "Times New Roman", serif' };
  const C = { navy: '#01264F', navy2: '#0A3463', yellow: '#FFF33A', white: '#FFFFFF', paper: '#F6F3EC', ink: '#01264F', mute: '#8FA3BC',
    ok: '#3FAE6E', warn: '#E9A82B', late: '#E0603F', done: '#9AAFC6', up: '#A992D6' };
  const STATUS_C = { 'On track': C.ok, 'Attention': C.warn, 'Delayed': C.late, 'Completed': C.done, 'Upcoming': C.up };
  const STATUS_L = { 'On track': 'On track', 'Attention': 'Needs attention', 'Delayed': 'Delayed', 'Completed': 'Completed', 'Upcoming': 'Coming up' };
  const SCENES = [['intro', 3], ['total', 3.5], ['months', 4.5], ['agreements', 4.5], ['status', 3.5], ['decisions', 4], ['upcoming', 4], ['outro', 3]];
  const SCENE_NAMES = { intro: 'Opening', total: 'Hours delivered', months: 'Month by month', agreements: 'Agreements', status: 'Status', decisions: 'Decisions', upcoming: 'Coming up', outro: 'Close' };
  let acc = 0; const START = SCENES.map(([, d]) => { const s = acc; acc += d; return s; }); const DURATION = acc;
  const RM = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- helpers ---------- */
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const prog = (t, a, d) => RM ? (t >= a ? 1 : 0) : clamp((t - a) / d);
  const E = {
    out: t => 1 - Math.pow(1 - t, 3), inOut: t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const sum = a => a.reduce((x, y) => x + y, 0);
  const fmt = n => n.toLocaleString('en-CA', { maximumFractionDigits: 4 });
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dLong = s => { const [y, m, d] = s.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
  const dShort = s => { const [, m, d] = s.split('-').map(Number); return `${MON[m - 1].slice(0, 3)} ${d}`; };
  function font(ctx, o) { ctx.font = `${o.w || 400} ${o.s || 24}px ${o.f || F.body}`; }
  function fit(ctx, s, max) { if (!max || ctx.measureText(s).width <= max) return s; while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1); return s.trimEnd() + '…'; }
  function T(ctx, s, x, y, o = {}) {
    ctx.save(); ctx.globalAlpha *= (o.a ?? 1); ctx.fillStyle = o.c || C.white; font(ctx, o);
    ctx.textAlign = o.al || 'left'; ctx.textBaseline = o.bl || 'alphabetic';
    if (o.ls) ctx.letterSpacing = o.ls + 'px';
    ctx.fillText(fit(ctx, String(s), o.max), x, y); ctx.restore();
  }
  function wrap(ctx, s, max, o) { font(ctx, o); const words = String(s).split(' '); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line); return lines; }
  function para(ctx, s, x, y, max, lh, o, maxLines = 3) { let lines = wrap(ctx, s, max, o); if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = fit(ctx, lines[maxLines - 1] + ' …', max); }
    lines.forEach((l, i) => T(ctx, l, x, y + i * lh, o)); return lines.length; }
  function rr(ctx, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function fillRR(ctx, x, y, w, h, r, c, a = 1) { if (w <= 0 || h <= 0) return; ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = c; rr(ctx, x, y, w, h, r); ctx.fill(); ctx.restore(); }
  function circle(ctx, x, y, r, c, a = 1) { ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ---------- story model: everything the animation says, computed from the data ---------- */
  function story(d) {
    const P = d.projects, work = P.filter(p => p.wo), kids = p => P.filter(c => c.parent === p.wo);
    const roll = p => sum(p.months) + sum(kids(p).map(k => sum(k.months)));
    const monthly = d.months.map((_, i) => sum(work.map(p => p.months[i])));
    const n = monthly.length, total = sum(monthly);
    const last = monthly[n - 1], prev = n > 1 ? monthly[n - 2] : null;
    const umbIdx = {}; const umbrellas = work.filter(p => !p.parent);
    umbrellas.forEach((u, i) => { umbIdx[u.wo] = i; kids(u).forEach(k => { umbIdx[k.wo] = i; }); });
    const agreements = umbrellas.map(u => ({ name: u.name, wo: u.wo, hours: roll(u), cap: u.cap, status: u.status, end: u.end, kids: kids(u).length }))
      .sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || b.hours - a.hours);
    const active = agreements.filter(a => a.status !== 'Completed');
    const counts = ['On track', 'Attention', 'Delayed', 'Completed'].map(s => ({ s, n: work.filter(p => p.status === s).length }));
    const decisions = work.filter(p => p.status === 'Attention' || p.status === 'Delayed')
      .sort((a, b) => (b.status === 'Delayed') - (a.status === 'Delayed')).map(p => ({ name: p.name, wo: p.wo, status: p.status, text: p.risk || p.nextStep }));
    const upcoming = P.filter(p => p.status === 'Upcoming').sort((a, b) => a.start.localeCompare(b.start)).map(p => ({ name: p.name, start: p.start, cap: p.cap, next: p.nextStep }));
    const ml = d.monthsLong, y0 = ml[0].split(' ')[1], y1 = ml[n - 1].split(' ')[1];
    const period = n === 1 ? ml[0] : y0 === y1 ? `${ml[0].split(' ')[0]} to ${ml[n - 1]}` : `${ml[0]} to ${ml[n - 1]}`;
    const lastName = ml[n - 1].split(' ')[0], prevName = n > 1 ? ml[n - 2].split(' ')[0] : '';
    const diff = prev == null ? 0 : last - prev;
    const change = prev == null ? `${fmt(last)} hours in ${lastName}` : diff > 0 ? `${fmt(last)} hours in ${lastName}, up ${fmt(diff)} on ${prevName}` : diff < 0 ? `${fmt(last)} hours in ${lastName}, down ${fmt(-diff)} from ${prevName}` : `${fmt(last)} hours in ${lastName}, the same as ${prevName}`;
    const busiest = monthly.indexOf(Math.max(...monthly));
    // Dots for the particle style: one dot per hour, or per few hours when totals are large.
    const unit = total > 2400 ? 5 : total > 1300 ? 2 : 1;
    const dots = [];
    const flagged = new Set(decisions.map(x => x.wo));
    work.forEach(p => p.months.forEach((h, m) => { const k = Math.round(h / unit); for (let j = 0; j < k; j++) dots.push({ m, u: umbIdx[p.wo], st: p.status, flag: flagged.has(p.wo) }); }));
    return { client: d.client, partner: d.partner, asOf: d.asOf, asOfLong: dLong(d.asOf), months: d.months, monthsLong: ml, monthly, total, n, last, prev, diff, change, busiest,
      period, agreements, active, completed: agreements.filter(a => a.status === 'Completed'), counts, decisions, upcoming, unit, dots,
      umbrellaCount: umbrellas.length, umbrellaOrder: umbrellas.map(u => u.wo), label: d.label || 'Current demo' };
  }

  /* ---------- timeline ---------- */
  function sceneAt(t) {
    let i = SCENES.length - 1; for (let k = 0; k < SCENES.length; k++) if (t < START[k] + SCENES[k][1]) { i = k; break; }
    return { i, kind: SCENES[i][0], lt: t - START[i], dur: SCENES[i][1], prev: i ? SCENES[i - 1][0] : null };
  }
  // Fade content in at the start of a scene and out at its end.
  const vis = (lt, dur) => RM ? 1 : Math.min(E.out(clamp(lt / .55)), clamp((dur - lt) / .35));

  window.PULSE = { W, H, SCALE, F, C, STATUS_C, STATUS_L, SCENES, START, DURATION, SCENE_NAMES, clamp, prog, E, lerp, sum, fmt, dLong, dShort, fit, T, wrap, para, rr, fillRR, circle, rng, font, story, sceneAt, vis, RM, styles: {} };
})();
