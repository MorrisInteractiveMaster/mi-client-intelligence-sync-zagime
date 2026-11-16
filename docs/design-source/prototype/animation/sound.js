/* Subtle sound for Partnership Pulse. Every sound is synthesised with the browser's Web Audio API: no files, nothing installed.
   Cues are tied to the animation timeline, so they line up with what is on screen and are skipped when you jump ahead. */
(function () {
  const P = window.PULSE, { START, SCENES, E, clamp } = P;
  const SCALE = [293.66, 329.63, 369.99, 440, 493.88, 587.33, 659.25, 739.99, 880]; // D major pentatonic
  let ac = null, master = null, noiseBuf = null;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -24; comp.ratio.value = 6;
    master = ac.createGain(); master.gain.value = 0.16; master.connect(comp); comp.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const now = () => ac.currentTime + 0.02;
  function env(g, t, peak, attack, decay) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay); }
  function tone(freq, { type = 'sine', vol = .3, attack = .012, decay = .4, lp = 1600, t = now(), glideTo = null, glideDur = 0 } = {}) {
    const o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + glideDur);
    f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); f.connect(g); g.connect(master);
    env(g, t, vol, attack, decay); o.start(t); o.stop(t + attack + decay + .05);
  }
  function noise({ vol = .2, dur = .45, from = 400, to = 1800, type = 'bandpass', q = 1.2, attack = .12, t = now() } = {}) {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noiseBuf; f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    s.connect(f); f.connect(g); g.connect(master); env(g, t, vol, attack, dur); s.start(t); s.stop(t + attack + dur + .05);
  }
  const SFX = {
    whoosh: () => noise({ vol: .035, dur: .55, from: 250, to: 1100, attack: .18 }),
    pluck: p => { const f = SCALE[clamp(Math.round(p), 0, SCALE.length - 1)]; tone(f, { vol: .1, decay: .5 }); },
    bell: p => { const f = SCALE[clamp(Math.round(p), 0, SCALE.length - 1)]; tone(f, { vol: .06, decay: 1 }); },
    ping: () => tone(587.33, { vol: .05, decay: .7 }),
    low: () => { const t = now(); tone(220, { vol: .06, decay: .5, lp: 800, t }); tone(196, { vol: .05, decay: .7, lp: 800, t: t + .18 }); },
    count: d => tone(293.66, { vol: .04, attack: .3, decay: d, glideTo: 587.33, glideDur: d, lp: 1400 }),
    swell: () => { const t = now(); [146.83, 220].forEach((f, i) => tone(f, { vol: .03, attack: 1, decay: 1.6, lp: 900, t: t + i * .05 })); },
    chord: () => { const t = now(); [293.66, 369.99, 440].forEach((f, i) => tone(f, { vol: .035, attack: .5, decay: 2.2, lp: 1200, t: t + i * .07 })); },
    thump: () => tone(110, { vol: .07, decay: .22, glideTo: 55, glideDur: .2, lp: 500 }),
    paper: () => noise({ vol: .05, dur: .07, from: 4000, to: 3000, type: 'highpass', q: .7, attack: .005 }),
    shimmer: () => { const t = now(); for (let i = 0; i < 5; i++) tone(SCALE[5 + (i * 3) % 4] * 2, { vol: .025, decay: .5, t: t + i * .16 }); },
  };

  // Scene-relative cue times for each style, matched to that style's animation timing.
  const pitchOf = (v, max) => 1 + (v / (max || 1)) * 6;
  function invInOut(y) { let lo = 0, hi = 1; for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; (E.inOut(m) < y ? lo = m : hi = m); } return (lo + hi) / 2; }
  function cuesFor(style, S) {
    const c = [], at = (scene, lt, type, p) => { const i = SCENES.findIndex(s => s[0] === scene); c.push({ t: START[i] + lt, type, p }); };
    const max = Math.max(...S.monthly), n = S.n, ag = S.agreements.slice(0, 4), dec = S.decisions.slice(0, 3), up = S.upcoming.slice(0, 3);
    const scenes = SCENES.map(s => s[0]);
    const off = style === 'blocks' ? .45 : 0; // Blocks content starts after its colour wipe
    // One soft transition sound per scene change, then at most one or two sounds per scene.
    scenes.slice(1).forEach(k => at(k, 0, style === 'blocks' ? 'thump' : 'whoosh'));
    at('intro', .3, 'swell');
    at('total', off + 2.1, 'ping');
    { const i = n - 1, v = S.monthly[i]; let t;
      if (style === 'wave') t = .4 + i * (1.4 / n) + .5; else if (style === 'blocks') t = off + .1 + i * (1.1 / n) + .3;
      else if (style === 'editorial') t = .8 + 2.4; else t = 1.4;
      at('months', t, 'pluck', pitchOf(v, max)); }
    if (ag.length) at('agreements', style === 'blocks' ? off + .6 : 1.2, ag.some(a => a.hours > a.cap) ? 'low' : 'pluck', 3);
    at('status', style === 'blocks' ? off + .5 : style === 'dots' ? 1.1 : .8, 'bell', 4);
    at('decisions', style === 'blocks' ? off + .4 : .7, dec.length ? 'low' : 'ping');
    at('upcoming', style === 'blocks' ? off + .4 : .7, up.length ? 'pluck' : 'ping', 5);
    at('outro', .3, 'chord');
    return c.sort((a, b) => a.t - b.t);
  }

  window.PULSE_SOUND = {
    init, cuesFor,
    fire(cue) { if (!ac || !SFX[cue.type]) return; try { SFX[cue.type](cue.p); } catch (e) { /* never let sound break the animation */ } },
  };
})();
