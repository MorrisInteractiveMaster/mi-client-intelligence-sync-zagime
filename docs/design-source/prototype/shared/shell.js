/* V02 shell: review bar, rendering, project panel, tooltips and the At a glance player (Dots style + subtle sound). */
(function () {
  const SETS = window.ZDATA, OPTS = window.ZOPTIONS, { esc, badge, paceChip, burnup, columns, hbars, meter } = window.ZC, { fmt, dLong, dShort } = window.ZM;
  const $ = s => document.querySelector(s), root = $('#app');
  const state = { opt: 0, set: 0, M: null, anim: 'dots' };
  window.ZS = { glance, hero: glanceHero, open: openPanel, state };

  /* ---------- review bar (hidden with ?client) ---------- */
  if (/[?&]client\b/.test(location.search)) document.body.classList.add('client');
  $('#rv-opts').innerHTML = OPTS.map((o, i) => `<button data-opt="${i}" aria-pressed="${i === 0}">${i + 1} · ${o.name}</button>`).join('');
  $('#rv-sets').innerHTML = SETS.map((d, i) => `<button data-set="${i}" aria-pressed="${i === 0}">${esc(d.label || 'Current demo')}</button>`).join('');
  // Animation picker (only on pages that include it). Order follows Dan's ranking: Dots, Wave, Blocks, Editorial.
  const ANIMS = [['dots', 'Dots'], ['wave', 'Wave'], ['blocks', 'Blocks'], ['editorial', 'Editorial']].filter(([k]) => window.PULSE.styles[k]);
  if ($('#rv-anim')) $('#rv-anim').innerHTML = ANIMS.map(([k, n], i) => `<button data-anim="${k}" aria-pressed="${i === 0}">${i + 1} · ${n}</button>`).join('');
  $('.review').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.anim) { state.anim = b.dataset.anim; b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); preview.start(); return; }
    if (b.dataset.opt) state.opt = +b.dataset.opt; if (b.dataset.set) state.set = +b.dataset.set;
    b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b)); render(); });

  function render() {
    state.M = ZM.model(SETS[state.set]); const o = OPTS[state.opt];
    document.body.dataset.opt = o.key; root.innerHTML = o.render(state.M); if (o.after) o.after(state.M, root);
    $('#rv-note').textContent = o.note || '';
    preview.start();
  }
  let rz, lastW = innerWidth; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 60 && state.M) { lastW = innerWidth; const y = scrollY; render(); scrollTo(0, y); } }, 250); });
  /* The At a glance banner: the first thing on every design. A silent live preview plays inside it. */
  function glanceHero(M, cls = '') {
    return `<section class="gh ${cls}" data-glance role="button" tabindex="0" aria-label="Play At a glance, the 30-second recap with sound">
      <div class="gh-copy"><span class="gh-k">Partnership Pulse</span><h2>At a glance</h2>
        <p>${esc(M.period)} in 30 seconds: hours delivered, agreements, decisions and what's next.</p>
        <span class="gh-btn"><span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span>Play the recap</span>
        <span class="gh-meta">30 seconds · sound on · built from the latest QuickBooks hours</span></div>
      <div class="gh-prev"><canvas class="g-prev" width="960" height="540" aria-hidden="true"></canvas><span class="gh-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span><span class="gh-dur">0:30</span><span class="gh-mute">Preview · muted</span></div></section>`;
  }
  function glance(cls = '') { return `<button class="glance ${cls}" type="button" data-glance><span class="play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l11-6.5z"/></svg></span><span class="glance-txt"><b>At a glance</b><small>30-second recap</small></span></button>`; }

  /* ---------- project panel ---------- */
  function openPanel(id) {
    const M = state.M, it = M.byId[id]; if (!it) return;
    const par = it.parent ? M.byId[M.items.find(x => x.wo === it.parent).id] : null;
    const contrib = M.d.people.map((pp, i) => ({ label: pp.name, value: it.people[i] })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    const up = it.status === 'Upcoming';
    $('#panel-body').innerHTML = `<div class="pn-head"><span class="pn-wo">${esc(it.wo || 'Planned, no work order yet')}${par ? ` · part of <button class="linkish" data-open="${par.id}">${esc(par.wo)} ${esc(par.name)}</button>` : ''}</span>
        <h2 id="panel-title">${esc(it.name)}</h2><div class="pn-tags">${badge(it.status)}${paceChip(it.pace)}<span class="pn-cat">${esc(it.category)}</span></div></div>
      ${up ? `<p class="pn-lead">${esc(it.description || it.summary)}</p><dl class="pn-facts"><div><dt>Starts</dt><dd>${dLong(it.start)}</dd></div><div><dt>Planned hours</dt><dd>${fmt(it.cap)}</dd></div><div><dt>Lead</dt><dd>${esc(M.d.people[it.manager].name)}</dd></div></dl><div class="pn-note"><b>Next step</b><p>${esc(it.nextStep)}</p></div>` : `
      <dl class="pn-facts"><div><dt>Hours used</dt><dd>${fmt(it.hours)} <small>of ${fmt(it.cap)}</small></dd></div><div><dt>Time elapsed</dt><dd>${Math.round(it.timePct * 100)}%</dd></div><div><dt>Reported progress</dt><dd>${it.progress}%</dd></div><div><dt>${it.status === 'Completed' ? 'Finished' : 'Target'}</dt><dd>${dShort(it.end)}</dd></div></dl>
      <section><h3>Are we on pace?</h3><p class="pn-sub">${esc(it.paceNote)}.</p>${burnup(M, it, { w: 560, h: 230 })}</section>
      <section><h3>Hours by month</h3>${columns(M, it.months, { w: 560, h: 170, label: 'Hours by month for ' + it.name })}</section>
      ${it.risk ? `<div class="pn-note risk"><b>Watch</b><p>${esc(it.risk)}</p></div>` : ''}<div class="pn-note"><b>Next step</b><p>${esc(it.nextStep)}</p></div>
      ${it.milestones && it.milestones.length ? `<section><h3>Milestones</h3><ol class="pn-ms">${it.milestones.map(m => `<li class="${m.done ? 'done' : ''}"><i></i>${esc(m.name)}</li>`).join('')}</ol></section>` : ''}
      ${contrib.length ? `<section><h3>Who's working on it</h3>${hbars(contrib)}</section>` : ''}
      ${it.kids.length ? `<section><h3>Projects under this agreement</h3><ul class="pn-kids">${it.kids.map(k => `<li><button data-open="${k.id}"><span><b>${esc(k.name)}</b><small>${esc(k.wo)} · ${fmt(k.hours)} of ${fmt(k.cap)} h</small></span>${paceChip(k.pace)}</button></li>`).join('')}</ul></section>` : ''}`}`;
    $('#panel').hidden = false; document.body.classList.add('panel-open'); $('#panel').scrollTop = 0; $('#panel-close').focus();
  }
  const closePanel = () => { $('#panel').hidden = true; document.body.classList.remove('panel-open'); };
  $('#panel-close').addEventListener('click', closePanel);
  $('#panel-scrim').addEventListener('click', closePanel);
  document.addEventListener('click', e => { const o = e.target.closest('[data-open]'); if (o) { openPanel(o.dataset.open); return; } if (e.target.closest('[data-glance]')) openPlayer(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('[data-open]:not(button)')) openPanel(e.target.dataset.open);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('section[data-glance]')) { e.preventDefault(); openPlayer(); }
    if (e.key === 'Escape') { if (!$('#player').hidden) closePlayer(); else if (!$('#panel').hidden) closePanel(); }
  });

  /* ---------- tooltip ---------- */
  const tip = $('#tip');
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(innerWidth - r.width - 8, Math.max(8, x - r.width / 2)) + 'px'; tip.style.top = Math.max(8, y - r.height - 12) + 'px'; };
  document.addEventListener('mousemove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el, e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip]'); if (el) { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.top); } });
  addEventListener('scroll', () => { tip.hidden = true; }, true);

  /* ---------- At a glance player: plays the data set currently on screen ---------- */
  const P = window.PULSE, SND = window.PULSE_SOUND, canvas = $('#stage'), ctx = canvas.getContext('2d'), A = {};
  canvas.width = P.W * P.SCALE; canvas.height = P.H * P.SCALE;
  const pl = { t: 0, prev: -1, playing: false, S: null, cues: [], sound: true, last: 0 };
  $('#segs').innerHTML = P.SCENES.map(([k, d]) => `<button class="seg" style="flex:${d}" data-k="${k}" aria-label="Jump to ${P.SCENE_NAMES[k]}"><span></span></button>`).join('');
  $('#segs').addEventListener('click', e => { const b = e.target.closest('.seg'); if (!b) return; const i = P.SCENES.findIndex(s => s[0] === b.dataset.k); pl.t = pl.prev = P.START[i] + .01; draw(); });
  function draw() {
    const sc = P.sceneAt(Math.min(pl.t, P.DURATION - .001)); ctx.setTransform(P.SCALE, 0, 0, P.SCALE, 0, 0); ctx.globalAlpha = 1;
    P.styles[state.anim].draw(ctx, pl.S, sc, pl.t, A);
    document.querySelectorAll('.seg').forEach((s, i) => { s.firstChild.style.width = (P.clamp((pl.t - P.START[i]) / P.SCENES[i][1]) * 100) + '%'; });
  }
  function loop(ts) { if (!pl.playing) return; const dt = pl.last ? Math.min(.1, (ts - pl.last) / 1000) : 0; pl.last = ts; pl.t += dt;
    if (pl.sound) for (const c of pl.cues) if (c.t > pl.prev && c.t <= pl.t) SND.fire(c); pl.prev = pl.t;
    if (pl.t >= P.DURATION) { pl.t = P.DURATION; pl.playing = false; } label(); draw(); if (pl.playing) requestAnimationFrame(loop); }
  const label = () => { $('#pp').textContent = pl.playing ? 'Pause' : pl.t >= P.DURATION ? 'Replay' : 'Play'; };
  function play() { if (pl.t >= P.DURATION) { pl.t = 0; pl.prev = -1; } pl.playing = true; pl.last = 0; label(); requestAnimationFrame(loop); }
  function openPlayer() { preview.stop(); SND.init(); pl.S = P.story(SETS[state.set]); pl.cues = SND.cuesFor(state.anim, pl.S); pl.t = 0; pl.prev = -1; $('#player').hidden = false; $('#pp').focus(); play(); }
  function closePlayer() { pl.playing = false; $('#player').hidden = true; preview.start(); const g = document.querySelector('[data-glance]'); if (g) g.focus(); }
  $('#pp').addEventListener('click', () => { if (pl.playing) { pl.playing = false; label(); } else play(); });
  $('#restart').addEventListener('click', () => { pl.t = 0; pl.prev = -1; play(); });
  $('#snd').addEventListener('click', e => { pl.sound = !pl.sound; e.target.textContent = pl.sound ? 'Sound on' : 'Sound off'; e.target.setAttribute('aria-pressed', !pl.sound); });
  $('#pclose').addEventListener('click', closePlayer);
  /* Silent preview loop inside the banner: real animation, ~30 fps, only while visible. */
  const preview = (() => {
    let raf = 0, t = 0, last = 0, cv = null, c2 = null, S = null, visible = true, io = null;
    function frame(ts) {
      if (!cv || !document.body.contains(cv)) return stop();
      if (ts - last < 33) { raf = requestAnimationFrame(frame); return; }
      const dt = last ? Math.min(.1, (ts - last) / 1000) : 0; last = ts; t += dt; if (t >= P.DURATION) t = P.START[1]; // loop skips the dark opening
      c2.setTransform(cv.width / P.W, 0, 0, cv.height / P.H, 0, 0); c2.globalAlpha = 1;
      P.styles[state.anim].draw(c2, S, P.sceneAt(t), t, A); raf = requestAnimationFrame(frame);
    }
    function stop() { cancelAnimationFrame(raf); raf = 0; }
    function start() {
      stop(); cv = document.querySelector('.g-prev'); if (!cv || !A.logo) return; c2 = cv.getContext('2d'); S = P.story(SETS[state.set]); last = 0; t = P.START[1] + 2.4; // open on the big hours number, after the count finishes
      if (P.RM) { t = 5; c2.setTransform(cv.width / P.W, 0, 0, cv.height / P.H, 0, 0); P.styles[state.anim].draw(c2, S, P.sceneAt(t), t, A); return; }
      if (io) io.disconnect(); io = new IntersectionObserver(es => { visible = es[0].isIntersecting; if (visible && $('#player').hidden) { if (!raf) raf = requestAnimationFrame(frame); } else stop(); }); io.observe(cv);
    }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (visible && $('#player').hidden) start(); });
    return { start, stop };
  })();
  window.__seekGlance = t => { pl.S = P.story(SETS[state.set]); pl.t = t; $('#player').hidden = false; draw(); };

  (async () => {
    await Promise.all(['800 40px Manrope', '700 40px Manrope', '400 20px "DM Sans"', '700 20px "DM Sans"'].map(f => document.fonts.load(f, 'Zagimē 0123'))).catch(() => {});
    await new Promise(r => { const i = new Image(); i.onload = () => { A.logo = i; r(); }; i.onerror = r; i.src = window.ZLOGO; });
    render(); document.body.classList.add('ready');
  })();
})();
