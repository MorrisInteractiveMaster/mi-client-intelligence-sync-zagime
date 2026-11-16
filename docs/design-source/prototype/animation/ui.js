/* Page and player: review bar (hidden for clients), the At a glance button, and the canvas player. */
(function () {
  const P = window.PULSE, SETS = window.PULSE_DATA, $ = s => document.querySelector(s);
  const order = ['dots', 'wave', 'blocks', 'editorial'].filter(k => P.styles[k]);
  const state = { style: 'dots', data: 'random', t: 0, playing: false, S: null, label: '', last: -1, sound: true, cues: [], prevT: -1 };
  const SND = window.PULSE_SOUND;
  const recue = () => { state.cues = state.S ? SND.cuesFor(state.style, state.S) : []; };
  // Jumping skips the sounds in between; only playing through fires them.
  const seek = t => { state.t = t; state.prevT = t; draw(); };
  const canvas = $('#stage'), ctx = canvas.getContext('2d');
  canvas.width = P.W * P.SCALE; canvas.height = P.H * P.SCALE;
  const A = {};
  const img = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; });

  // Review bar is for Dan and Dev only. Add ?client to the address to see the page exactly as a client would.
  if (/[?&]client\b/.test(location.search)) document.body.classList.add('client');
  const styleBtns = $('#styles'), dataBtns = $('#datasets');
  styleBtns.innerHTML = order.map((k, i) => `<button data-style="${k}" aria-pressed="${k === state.style}">${i + 1} · ${P.styles[k].name}</button>`).join('');
  dataBtns.innerHTML = `<button data-set="random" aria-pressed="true">Random</button>` + SETS.map((d, i) => `<button data-set="${i}" aria-pressed="false">${d.label || 'Current demo'}</button>`).join('');
  styleBtns.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.style = b.dataset.style; press(styleBtns, b); if (state.S) { recue(); seek(0); state.prevT = -1; } });
  dataBtns.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; state.data = b.dataset.set; press(dataBtns, b); });
  const press = (group, b) => group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));

  function pick() {
    if (state.data !== 'random') return +state.data;
    let i; do { i = Math.floor(Math.random() * SETS.length); } while (SETS.length > 1 && i === state.last);
    return i;
  }
  // progress bar with one segment per scene
  $('#segs').innerHTML = P.SCENES.map(([k, d]) => `<button class="seg" style="flex:${d}" data-k="${k}" aria-label="Jump to ${P.SCENE_NAMES[k]}"><span></span><em>${P.SCENE_NAMES[k]}</em></button>`).join('');
  $('#segs').addEventListener('click', e => { const b = e.target.closest('.seg'); if (!b) return; const i = P.SCENES.findIndex(s => s[0] === b.dataset.k); seek(P.START[i] + .01); });

  function draw() {
    const st = P.styles[state.style]; const sc = P.sceneAt(Math.min(state.t, P.DURATION - .001));
    ctx.setTransform(P.SCALE, 0, 0, P.SCALE, 0, 0); ctx.globalAlpha = 1; ctx.clearRect(0, 0, P.W, P.H);
    st.draw(ctx, state.S, sc, state.t, A);
    document.querySelectorAll('.seg').forEach((s, i) => { const a = P.START[i], d = P.SCENES[i][1]; s.firstChild.style.width = (P.clamp((state.t - a) / d) * 100) + '%'; });
    $('#time').textContent = `${Math.floor(state.t)}s / ${Math.round(P.DURATION)}s`;
  }
  let lastTs = 0;
  function loop(ts) {
    if (!state.playing) return;
    const dt = lastTs ? Math.min(.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
    state.t += dt;
    if (state.sound) for (const c of state.cues) if (c.t > state.prevT && c.t <= state.t) SND.fire(c);
    state.prevT = state.t;
    if (state.t >= P.DURATION) { state.t = P.DURATION; state.playing = false; setPlayLabel(); }
    draw(); if (state.playing) requestAnimationFrame(loop);
  }
  const setPlayLabel = () => { $('#pp').textContent = state.playing ? 'Pause' : state.t >= P.DURATION ? 'Replay' : 'Play'; };
  function play() { if (state.t >= P.DURATION) { state.t = 0; state.prevT = -1; } state.playing = true; lastTs = 0; setPlayLabel(); requestAnimationFrame(loop); }
  function pause() { state.playing = false; setPlayLabel(); }

  async function open() {
    SND.init();
    const i = pick(); state.last = i; state.S = P.story(SETS[i]); state.t = 0; state.prevT = -1; recue();
    $('#now').textContent = `Showing: ${SETS[i].label || 'Current demo'} · ${P.styles[state.style].name}`;
    $('#player').hidden = false; document.body.classList.add('playing');
    $('#pp').focus(); play();
  }
  function close() { pause(); $('#player').hidden = true; document.body.classList.remove('playing'); $('#glance').focus(); }
  $('#glance').addEventListener('click', open);
  $('#pp').addEventListener('click', () => state.playing ? pause() : play());
  $('#restart').addEventListener('click', () => { seek(0); state.prevT = -1; play(); });
  $('#snd').addEventListener('click', () => { state.sound = !state.sound; SND.init(); const b = $('#snd'); b.setAttribute('aria-pressed', !state.sound); b.textContent = state.sound ? 'Sound on' : 'Sound off'; });
  $('#close').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if ($('#player').hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === ' ' && e.target.tagName !== 'BUTTON') { e.preventDefault(); state.playing ? pause() : play(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const sc = P.sceneAt(state.t), j = P.clamp(sc.i + (e.key === 'ArrowRight' ? 1 : -1), 0, P.SCENES.length - 1); seek(P.START[j] + .01); }
  });
  // test hook: render a given style/data set at a given second without playing
  window.__pulseSeek = (style, set, t) => { state.style = style; state.S = P.story(SETS[set]); state.t = t; state.playing = false; $('#player').hidden = false; document.body.classList.add('playing'); draw(); };

  (async () => {
    await Promise.all([document.fonts.load('800 40px Manrope', 'Zagimē 0123'), document.fonts.load('700 40px Manrope', 'Zagimē'), document.fonts.load('400 20px "DM Sans"', 'Zagimē'), document.fonts.load('700 20px "DM Sans"', 'Zagimē')]).catch(() => {});
    A.logo = await img(window.PULSE_ASSETS.zagime); A.mi = await img(window.PULSE_ASSETS.mi);
    document.body.classList.add('ready');
  })();
})();
