/* Style 4 · Dots: every dot is an hour (or a few hours). The same dots regroup scene by scene. */
(function () {
  const P = window.PULSE, { W, H, C, F, T, fillRR, circle, prog, E, lerp, fmt, clamp, vis, STATUS_C, STATUS_L, dShort, rng } = P;
  const GA = Math.PI * (3 - Math.sqrt(5));
  let L = {};

  // Pack k dots into a sunflower around (cx, cy) with spacing c.
  const sunflower = (k, cx, cy, c) => Array.from({ length: k }, (_, i) => { const r = c * Math.sqrt(i + .5), a = i * GA; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  function layouts(S) {
    const D = S.dots, N = D.length, R = rng(7), out = {};
    // scatter: a starry field
    out.intro = D.map(() => [R() * W, 90 + R() * (H - 140)]);
    // block: a tidy rectangle on the left
    { const x0 = 110, y0 = 210, w = 520, h = 360, cols = Math.max(1, Math.ceil(Math.sqrt(N * w / h))), s = Math.min(w / cols, 18);
      out.total = D.map((_, i) => [x0 + (i % cols) * s + s / 2, y0 + h - Math.floor(i / cols) * s - s / 2]); }
    // months: one dot column per month
    { const n = S.n, x0 = 110, x1 = 1170, base = 560, top = 210, slot = (x1 - x0) / n, colW = slot * .72;
      const per = Array(n).fill(0); D.forEach(d => per[d.m]++); const mx = Math.max(...per, 1);
      let s = 16; while (s > 2 && Math.ceil(mx / Math.max(1, Math.floor(colW / s))) * s > base - top) s -= .5;
      const k = Math.max(1, Math.floor(colW / s)), seen = Array(n).fill(0);
      out.months = D.map(d => { const j = seen[d.m]++; const x = x0 + slot * d.m + (slot - k * s) / 2 + (j % k) * s + s / 2; return [x, base - Math.floor(j / k) * s - s / 2]; });
      out.monthsMeta = { s, x0, slot, base, per, k }; }
    // agreements: dots fill rows inside each agreement's agreed-hours outline
    { const list = S.agreements.slice(0, 5), x0 = 520, w = 640, rowH = Math.min(86, 400 / Math.max(1, list.length)), lines = 4;
      const maxU = Math.max(...list.map(a => Math.max(a.cap, a.hours) / S.unit), 1); const s = Math.min(14, (w * lines) / maxU, (rowH - 30) / lines);
      const umbOrder = S.agreementsByUmb; // umbrella index -> agreement row
      // simpler, explicit fill: column-major in 'lines' rows
      const seen2 = {};
      out.agreements = D.map(d => { const row = umbOrder[d.u]; if (row == null || row >= list.length) return [W + 40, H / 2]; const j = seen2[row] = (seen2[row] || 0) + 1;
        const col = Math.floor((j - 1) / lines), ln = (j - 1) % lines; return [x0 + col * s + s / 2, 190 + row * rowH + ln * s + s / 2]; });
      out.agreeMeta = { list, x0, s, lines, rowH }; }
    // status: one sunflower per status
    { const sts = ['On track', 'Attention', 'Delayed', 'Completed'], cnt = sts.map(st => D.filter(d => d.st === st).length), mx = Math.max(...cnt, 1);
      const c = Math.min(9, 130 / Math.sqrt(mx)), pos = sts.map((_, i) => [210 + i * 290, 380]), packs = sts.map((st, i) => sunflower(cnt[i], pos[i][0], pos[i][1], c)), seen = sts.map(() => 0);
      out.status = D.map(d => { const i = sts.indexOf(d.st); return packs[i][seen[i]++]; }); out.statusMeta = { sts, cnt, pos, c }; }
    // decisions: one sunflower on the left, flagged dots in the centre
    { const order = D.map((d, i) => i).sort((a, b) => (D[b].flag - D[a].flag)), c = Math.min(8, 200 / Math.sqrt(N)), pack = sunflower(N, 300, 390, c), res = Array(N);
      order.forEach((di, j) => { res[di] = pack[j]; }); out.decisions = res; }
    // upcoming: a river along the bottom
    out.upcoming = D.map((_, i) => { const x = (i / Math.max(1, N - 1)) * (W + 80) - 40; return [x, 640 + Math.sin(i * .37) * 26 + (R() - .5) * 18]; });
    // outro: the sun
    { const c = Math.min(7, 150 / Math.sqrt(N)); out.outro = sunflower(N, 640, 260, c); }
    return out;
  }
  const dotR = S => S.dots.length > 900 ? 2.6 : S.dots.length > 400 ? 3.2 : 4.5;

  P.styles.dots = {
    name: 'Dots', bg: '#011A36',
    draw(ctx, S, sc, t, A) {
      const key = JSON.stringify(S);
      if (L.__for !== key) { S.agreementsByUmb = buildUmbMap(S); L = layouts(S); L.__for = key; }
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#022552'); g.addColorStop(1, '#010F22'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const { kind, lt, prev } = sc, from = L[prev || 'intro'], to = L[kind], N = S.dots.length, r = dotR(S);
      for (let i = 0; i < N; i++) {
        const d = S.dots[i], delay = (i % 89) / 89 * .5, k = E.inOut(prog(lt, delay, 1.1));
        let x = lerp(from[i][0], to[i][0], k), y = lerp(from[i][1], to[i][1], k);
        let col = C.yellow, a = .95;
        if (kind === 'intro' || kind === 'upcoming') { a = (kind === 'intro' ? .15 : .35) + (kind === 'intro' ? .35 : .6) * (.5 + .5 * Math.sin(t * 2 + i)); x += Math.sin(t * .6 + i) * 3; }
        if (kind === 'status') col = STATUS_C[d.st];
        if (kind === 'decisions') { col = d.flag ? STATUS_C[d.st] : '#3B5D86'; a = d.flag ? 1 : .55; }
        if (kind === 'months' && d.m === S.n - 1) col = '#FFFFFF';
        circle(ctx, x, y, r, col, a);
      }
      ctx.save(); ctx.globalAlpha = vis(lt, sc.dur); this[kind](ctx, S, lt, sc.dur, A); ctx.restore();
      if (kind !== 'intro' && kind !== 'outro') T(ctx, `Each dot is ${S.unit === 1 ? 'one hour' : `about ${S.unit} hours`}`, W - 40, H - 24, { s: 15, c: '#7E95B2', al: 'right' });
    },
    intro(ctx, S, lt, dur, A) {
      const a0 = ctx.globalAlpha;
      if (A.logo) { const w = 300, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .3, .8); ctx.drawImage(A.logo, 640 - w / 2, 170, w, h); ctx.globalAlpha = a0; }
      T(ctx, 'Partnership Pulse', 640, 400, { s: 90, w: 700, f: F.serif, al: 'center', a: prog(lt, .6, .8) });
      T(ctx, S.period, 640, 460, { s: 28, w: 700, c: C.yellow, al: 'center', a: prog(lt, .9, .8) });
    },
    total(ctx, S, lt) {
      T(ctx, 'HOURS DELIVERED', 700, 250, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      T(ctx, fmt(S.total * E.out(prog(lt, .2, 1.8))), 694, 420, { s: 170, w: 800, f: F.head, c: C.yellow, ls: -5 });
      T(ctx, S.period, 700, 480, { s: 28, w: 600, a: prog(lt, 1, .6) });
    },
    months(ctx, S, lt) {
      T(ctx, 'MONTH BY MONTH', 110, 80, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      T(ctx, S.change, 110, 130, { s: 38, w: 700, f: F.serif, max: 1060, a: prog(lt, 1.3, .6) });
      const m = L.monthsMeta; S.months.forEach((mo, i) => { const x = m.x0 + m.slot * i + m.slot / 2; T(ctx, mo, x, m.base + 34, { s: S.n > 8 ? 16 : 19, c: '#B9C7D9', al: 'center' });
        if (i === S.n - 1 || i === S.busiest || S.n <= 6) T(ctx, fmt(S.monthly[i]), x, m.base - Math.ceil(m.per[i] / m.k) * m.s - 14, { s: 19, w: 700, al: 'center', a: prog(lt, 1.4, .5) }); });
    },
    agreements(ctx, S, lt) {
      T(ctx, 'AGREEMENTS', 110, 80, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      T(ctx, S.active.length ? `${S.active.length} active, filling their agreed hours` : 'All agreements complete', 110, 130, { s: 38, w: 700, f: F.serif, a: prog(lt, .3, .6) });
      const m = L.agreeMeta;
      m.list.forEach((a, row) => {
        const y = 190 + row * m.rowH, capW = a.cap / S.unit / m.lines * m.s;
        ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.globalAlpha *= prog(lt, .8, .6);
        ctx.strokeRect(m.x0 - 3, y - 3, Math.min(capW, 700) + 6, m.lines * m.s + 6); ctx.restore();
        T(ctx, a.name, 110, y + 18, { s: 22, w: 700, max: 380, a: prog(lt, .4 + row * .15, .5) });
        T(ctx, `${fmt(a.hours)} of ${fmt(a.cap)} h · ${STATUS_L[a.status]}`, 110, y + 44, { s: 17, c: a.hours > a.cap ? '#FF9B83' : '#B9C7D9', max: 380, a: prog(lt, .5 + row * .15, .5) });
      });
      T(ctx, 'Dashed outline = agreed hours', 520, 190 + m.list.length * m.rowH + 10, { s: 15, c: '#7E95B2', a: prog(lt, 1.2, .5) });
    },
    status(ctx, S, lt) {
      T(ctx, 'WHERE THINGS STAND', 110, 80, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      T(ctx, 'Hours by project status', 110, 130, { s: 38, w: 700, f: F.serif });
      const m = L.statusMeta; m.sts.forEach((st, i) => {
        const proj = S.counts.find(c => c.s === st).n;
        T(ctx, `${proj} ${proj === 1 ? 'project' : 'projects'}`, m.pos[i][0], 600, { s: 26, w: 700, al: 'center', a: prog(lt, 1, .5) });
        T(ctx, STATUS_L[st], m.pos[i][0], 632, { s: 19, c: STATUS_C[st], al: 'center', a: prog(lt, 1.1, .5) });
      });
    },
    decisions(ctx, S, lt) {
      T(ctx, 'NEEDS A DECISION', 620, 120, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      if (!S.decisions.length) { T(ctx, 'Nothing needs a', 620, 220, { s: 46, w: 700, f: F.serif, a: prog(lt, .6, .6) }); T(ctx, 'decision right now.', 620, 276, { s: 46, w: 700, f: F.serif, a: prog(lt, .7, .6) }); return; }
      S.decisions.slice(0, 3).forEach((d, i) => {
        const y = 180 + i * 130, k = prog(lt, .8 + i * .35, .6);
        circle(ctx, 632, y + 16, 9, STATUS_C[d.status], k);
        T(ctx, d.name, 656, y + 24, { s: 26, w: 700, max: 540, a: k });
        P.para(ctx, `${STATUS_L[d.status]}. ${d.text}`, 656, y + 56, 540, 26, { s: 19, c: '#C9D5E4', a: k }, 2);
      });
      if (S.decisions.length > 3) T(ctx, `and ${S.decisions.length - 3} more`, 656, 180 + 3 * 130 + 10, { s: 20, c: '#B9C7D9', a: prog(lt, 1.8, .5) });
      T(ctx, 'Bright dots are the hours on these projects', 120, 660, { s: 15, c: '#7E95B2', a: prog(lt, 1.2, .5) });
    },
    upcoming(ctx, S, lt) {
      T(ctx, 'COMING UP', 110, 100, { s: 18, w: 700, c: '#B9C7D9', ls: 3 });
      if (!S.upcoming.length) { T(ctx, 'Nothing new is planned yet.', 110, 200, { s: 50, w: 700, f: F.serif, a: prog(lt, .4, .6) }); T(ctx, 'A good moment to talk about what comes next.', 110, 250, { s: 24, c: '#C9D5E4', a: prog(lt, .8, .6) }); return; }
      S.upcoming.slice(0, 3).forEach((u, i) => {
        const y = 170 + i * 120, k = prog(lt, .5 + i * .35, .6), w = Math.min(400, u.cap / S.unit * 1.2);
        ctx.save(); ctx.strokeStyle = C.yellow; ctx.setLineDash([5, 5]); ctx.globalAlpha *= k; ctx.lineWidth = 2; ctx.strokeRect(110, y, 150, 70); ctx.restore();
        T(ctx, dShort(u.start), 185, y + 45, { s: 26, w: 800, f: F.head, c: C.yellow, al: 'center', a: k });
        T(ctx, u.name, 290, y + 30, { s: 28, w: 700, max: 860, a: k });
        T(ctx, `${fmt(u.cap)} planned hours. ${u.next}`, 290, y + 62, { s: 19, c: '#C9D5E4', max: 860, a: k });
      });
    },
    outro(ctx, S, lt, dur, A) {
      const a0 = ctx.globalAlpha;
      if (A.logo) { const w = 340, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .6, .7); ctx.drawImage(A.logo, 640 - w / 2, 470, w, h); ctx.globalAlpha = a0; }
      T(ctx, `${fmt(S.total)} hours · synthetic reporting, updated ${S.asOfLong}`, 640, 640, { s: 19, c: '#DCE5F0', al: 'center', a: prog(lt, .9, .6) });
    },
  };
  // Dots carry the umbrella's index in the original project order. Map it to the agreement's row on screen.
  function buildUmbMap(S) {
    const map = {}; const rows = S.agreements; // sorted
    S.umbrellaOrder.forEach((wo, u) => { map[u] = rows.findIndex(a => a.wo === wo); });
    return map;
  }
})();
