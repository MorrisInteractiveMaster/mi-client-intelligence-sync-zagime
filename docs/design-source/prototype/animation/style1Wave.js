/* Style 1 · Wave: Zagimē navy, a yellow sun that travels between scenes, moving wave bands like zagime.ca. */
(function () {
  const P = window.PULSE, { W, H, C, F, T, para, fillRR, circle, prog, E, lerp, fmt, clamp, vis, STATUS_C, STATUS_L, dShort } = P;
  const SUN = { intro: [1040, 300, 150], total: [1120, 150, 70], months: [1150, 110, 48], agreements: [1150, 110, 48], status: [1150, 110, 48],
    decisions: [1150, 110, 48], upcoming: [1150, 110, 48], outro: [640, 210, 105] };

  function waves(ctx, t, a = 1) {
    const layers = [[600, 22, .9, C.yellow, .95], [628, 18, 1.3, '#0F3C73', 1], [650, 14, 1.7, '#0B2F5C', 1]];
    for (const [y0, amp, sp, col, al] of layers) {
      ctx.save(); ctx.globalAlpha = a * al; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 16) ctx.lineTo(x, y0 + Math.sin(x / 170 + t * sp) * amp + Math.sin(x / 61 + t * sp * 1.7) * amp * .25);
      ctx.lineTo(W, H); ctx.closePath(); ctx.fill(); ctx.restore();
    }
  }
  function title(ctx, s, a) { let z = 54; P.font(ctx, { s: z, w: 700, f: F.serif }); while (z > 34 && ctx.measureText(s).width > 940) { z -= 2; P.font(ctx, { s: z, w: 700, f: F.serif }); } T(ctx, s, 110, 120, { s: z, w: 700, f: F.serif, a }); }
  function eyebrow(ctx, s, a) { T(ctx, s.toUpperCase(), 112, 70, { s: 16, w: 700, c: '#B9C7D9', a, ls: 3 }); }

  P.styles.wave = {
    name: 'Wave', bg: C.navy,
    draw(ctx, S, sc, t, A) {
      const { kind, lt, dur, prev } = sc, v = vis(lt, dur);
      ctx.fillStyle = C.navy; ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(1050, 120, 10, 1050, 120, 700); g.addColorStop(0, 'rgba(70,120,190,.28)'); g.addColorStop(1, 'rgba(1,38,79,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // sun travels from the previous scene's spot to this one's
      const a = SUN[prev || kind], b = SUN[kind], k = E.inOut(prog(lt, 0, 1.1));
      let sy = lerp(a[1], b[1], k); if (kind === 'intro') sy = lerp(820, b[1], E.out(prog(lt, 0, 1.6)));
      circle(ctx, lerp(a[0], b[0], k), sy, lerp(a[2], b[2], k), C.yellow);
      waves(ctx, t, kind === 'months' ? .3 : 1);
      ctx.save(); ctx.globalAlpha = v;
      this[kind](ctx, S, lt, dur, A);
      ctx.restore();
    },
    intro(ctx, S, lt, dur, A) {
      const up = 30 * (1 - E.out(prog(lt, .2, 1))), a0 = ctx.globalAlpha;
      if (A.logo) { const w = 300, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .1, .8); ctx.drawImage(A.logo, 110, 120 + up, w, h); ctx.globalAlpha = a0; }
      T(ctx, 'Partnership Pulse', 110, 380 + up, { s: 92, w: 700, f: F.serif, a: prog(lt, .4, .8) });
      T(ctx, `${S.client} with ${S.partner}`, 112, 440 + up, { s: 26, c: '#DCE5F0', a: prog(lt, .7, .8) });
      T(ctx, S.period, 112, 480 + up, { s: 26, w: 700, c: C.yellow, a: prog(lt, .9, .8) });
    },
    total(ctx, S, lt) {
      eyebrow(ctx, 'Hours delivered', 1);
      const k = E.out(prog(lt, .3, 2));
      T(ctx, fmt(S.total * k), 104, 330, { s: 210, w: 800, f: P.F.head, c: C.yellow, ls: -6 });
      T(ctx, `hours of work, ${S.period}`, 112, 400, { s: 32, w: 600, a: prog(lt, 1, .7) });
      T(ctx, `across ${S.umbrellaCount} ${S.umbrellaCount === 1 ? 'agreement' : 'agreements'}`, 112, 446, { s: 26, c: '#C9D5E4', a: prog(lt, 1.4, .7) });
    },
    months(ctx, S, lt) {
      eyebrow(ctx, 'Month by month', 1); title(ctx, S.change, prog(lt, 2.2, .7));
      const n = S.n, x0 = 110, x1 = 1170, base = 520, top = 190, max = Math.max(...S.monthly) * 1.08 || 1;
      const slot = (x1 - x0) / n, bw = Math.min(70, slot * .62);
      S.monthly.forEach((v, i) => {
        const k = E.out(prog(lt, .4 + i * (1.4 / n), .9)), h = (base - top) * v / max * k, x = x0 + slot * i + (slot - bw) / 2;
        fillRR(ctx, x, base - h, bw, h + 6, 8, i === n - 1 ? C.yellow : '#E9E28A', i === n - 1 ? 1 : .8);
        T(ctx, S.months[i], x + bw / 2, base + 34, { s: n > 8 ? 17 : 20, al: 'center', c: '#C9D5E4' });
        if ((i === n - 1 || i === S.busiest || n <= 6) && k > .95) T(ctx, fmt(v), x + bw / 2, base - h - 14, { s: 20, w: 700, al: 'center', a: prog(lt, 1.6, .5) });
      });
    },
    agreements(ctx, S, lt) {
      eyebrow(ctx, 'Agreements', 1);
      const list = S.agreements.slice(0, 4), more = S.agreements.length - list.length;
      title(ctx, S.active.length ? `${S.active.length} active ${S.active.length === 1 ? 'agreement' : 'agreements'}` : 'All agreements complete', 1);
      list.forEach((a, i) => {
        const y = 210 + i * 92, k = E.out(prog(lt, .5 + i * .35, 1.3)), r = a.hours / a.cap;
        T(ctx, a.name, 112, y + 6, { s: 26, w: 700, max: 470, a: prog(lt, .3 + i * .35, .5) });
        T(ctx, `${a.wo} · ${STATUS_L[a.status]}`, 112, y + 38, { s: 18, c: '#B9C7D9', a: prog(lt, .3 + i * .35, .5) });
        fillRR(ctx, 620, y - 14, 440, 26, 13, 'rgba(255,255,255,.12)');
        fillRR(ctx, 620, y - 14, 440 * Math.min(1, r) * k, 26, 13, r > 1 ? C.late : C.yellow);
        T(ctx, `${fmt(a.hours * k)} of ${fmt(a.cap)} h`, 1076, y + 6, { s: 20, w: 700, a: prog(lt, .5 + i * .35, .6) });
      });
      if (more > 0) T(ctx, `and ${more} more`, 112, 210 + 4 * 92, { s: 20, c: '#B9C7D9', a: prog(lt, 2, .5) });
    },
    status(ctx, S, lt) {
      eyebrow(ctx, 'Where things stand', 1); title(ctx, 'Project status', 1);
      S.counts.forEach((c, i) => {
        const x = 112 + i * 270, k = E.back(prog(lt, .4 + i * .25, .8));
        circle(ctx, x + 16, 300, 12 * clamp(k, 0, 1.2), STATUS_C[c.s]);
        T(ctx, fmt(c.n), x, 430, { s: 130 * clamp(k, .2, 1.1), w: 800, f: F.head, c: c.n ? C.white : '#5B7393' });
        T(ctx, STATUS_L[c.s], x, 480, { s: 24, c: '#DCE5F0', a: prog(lt, .7 + i * .25, .5) });
      });
    },
    decisions(ctx, S, lt) {
      eyebrow(ctx, 'Needs a decision', 1);
      if (!S.decisions.length) { title(ctx, 'Nothing needs a decision right now.', 1); T(ctx, 'Every active project is on track.', 112, 180, { s: 26, c: '#C9D5E4', a: prog(lt, .6, .6) }); return; }
      title(ctx, `${S.decisions.length} ${S.decisions.length === 1 ? 'project needs' : 'projects need'} a conversation`, 1);
      S.decisions.slice(0, 3).forEach((d, i) => {
        const y = 175 + i * 128, dx = 60 * (1 - E.out(prog(lt, .4 + i * .4, .8)));
        ctx.save(); ctx.globalAlpha *= prog(lt, .4 + i * .4, .6);
        fillRR(ctx, 110 + dx, y, 1000, 108, 14, 'rgba(255,255,255,.08)'); fillRR(ctx, 110 + dx, y, 8, 108, 4, STATUS_C[d.status]);
        T(ctx, STATUS_L[d.status].toUpperCase(), 140 + dx, y + 34, { s: 14, w: 700, c: STATUS_C[d.status], ls: 2 });
        T(ctx, d.name, 140 + dx, y + 66, { s: 26, w: 700, max: 900 });
        T(ctx, d.text, 140 + dx, y + 94, { s: 19, c: '#C9D5E4', max: 940 });
        ctx.restore();
      });
      if (S.decisions.length > 3) T(ctx, `and ${S.decisions.length - 3} more`, 112, 175 + 3 * 128 + 10, { s: 20, c: '#B9C7D9', a: prog(lt, 1.8, .5) });
    },
    upcoming(ctx, S, lt) {
      eyebrow(ctx, 'Coming up', 1);
      if (!S.upcoming.length) { title(ctx, 'Nothing new is planned yet.', 1); T(ctx, 'A good moment to talk about what comes next.', 112, 180, { s: 26, c: '#C9D5E4', a: prog(lt, .6, .6) }); return; }
      title(ctx, 'What’s next', 1);
      S.upcoming.slice(0, 3).forEach((u, i) => {
        const y = 200 + i * 112, k = prog(lt, .4 + i * .4, .6);
        ctx.save(); ctx.globalAlpha *= k;
        fillRR(ctx, 110, y, 120, 54, 10, C.yellow); T(ctx, dShort(u.start), 170, y + 36, { s: 22, w: 800, c: C.navy, al: 'center' });
        T(ctx, u.name, 256, y + 24, { s: 28, w: 700, max: 820 }); T(ctx, `${fmt(u.cap)} planned hours. ${u.next}`, 256, y + 56, { s: 19, c: '#C9D5E4', max: 820 });
        ctx.restore();
      });
    },
    outro(ctx, S, lt, dur, A) {
      const a0 = ctx.globalAlpha;
      if (A.logo) { const w = 360, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .2, .8); ctx.drawImage(A.logo, 640 - w / 2, 345, w, h); ctx.globalAlpha = a0; }
      T(ctx, `Hours from QuickBooks, updated ${S.asOfLong}`, 640, 510, { s: 20, c: '#DCE5F0', al: 'center', a: prog(lt, .6, .6) });
    },
  };
})();
