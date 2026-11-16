/* Style 2 · Editorial: paper background, navy type that wipes in, a yellow highlighter, a line chart that draws itself. */
(function () {
  const P = window.PULSE, { W, H, C, F, T, fillRR, circle, prog, E, lerp, fmt, clamp, vis, STATUS_C, STATUS_L, dShort, font } = P;
  const INK = C.ink, MUTE = '#5E6B79', RULE = '#D9D3C4', L = 120;

  // Text revealed left to right by a moving clip.
  function wipe(ctx, s, x, y, o, k) {
    if (k <= 0) return; ctx.save(); font(ctx, o); const w = ctx.measureText(s).width + 20;
    ctx.beginPath(); ctx.rect(x - 10, y - (o.s || 24) * 1.2, w * E.out(k), (o.s || 24) * 1.6); ctx.clip();
    T(ctx, s, x, y, { c: INK, ...o }); ctx.restore();
  }
  function highlight(ctx, x, y, w, h, k) { if (k <= 0) return; ctx.save(); ctx.globalAlpha *= .9; ctx.fillStyle = C.yellow; ctx.beginPath();
    const ww = w * E.out(k); ctx.moveTo(x, y + 4); ctx.lineTo(x + ww, y); ctx.lineTo(x + ww + 6, y + h); ctx.lineTo(x - 4, y + h + 3); ctx.closePath(); ctx.fill(); ctx.restore(); }
  function kicker(ctx, n, s, S) {
    T(ctx, `${String(n).padStart(2, '0')}  ${s.toUpperCase()}`, L, 82, { s: 16, w: 700, c: MUTE, ls: 3 });
    T(ctx, `PARTNERSHIP PULSE · ${S.asOfLong.toUpperCase()}`, W - L, 82, { s: 14, w: 600, c: '#9A8F76', al: 'right', ls: 2 });
    ctx.fillStyle = RULE; ctx.fillRect(L, 100, W - 2 * L, 1.5);
  }

  P.styles.editorial = {
    name: 'Editorial', bg: C.paper,
    draw(ctx, S, sc, t, A) {
      ctx.fillStyle = C.paper; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(1,38,79,.035)'; for (let y = 140; y < H; y += 44) ctx.fillRect(L, y, W - 2 * L, 1);
      ctx.save(); ctx.globalAlpha = vis(sc.lt, sc.dur); this[sc.kind](ctx, S, sc.lt, sc.dur, A, sc.i); ctx.restore();
    },
    intro(ctx, S, lt, dur, A) {
      const a0 = ctx.globalAlpha;
      fillRR(ctx, L, 120, 330, 120, 10, C.navy, prog(lt, 0, .6));
      if (A.logo) { const w = 280, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .2, .6); ctx.drawImage(A.logo, L + 25, 180 - h / 2, w, h); ctx.globalAlpha = a0; }
      wipe(ctx, 'Partnership', L, 370, { s: 104, w: 700, f: F.serif }, prog(lt, .4, .8));
      wipe(ctx, 'Pulse', L, 480, { s: 104, w: 700, f: F.serif }, prog(lt, .7, .8));
      font(ctx, { s: 104, w: 700, f: F.serif }); highlight(ctx, L - 6, 488, ctx.measureText('Pulse').width + 12, 16, prog(lt, 1.3, .6));
      T(ctx, S.period, L, 560, { s: 28, w: 600, c: INK, a: prog(lt, 1.5, .6) });
      T(ctx, `${S.client} with ${S.partner}`, L, 600, { s: 22, c: MUTE, a: prog(lt, 1.7, .6) });
    },
    total(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Hours delivered', S);
      const k = E.out(prog(lt, .3, 2)), s = fmt(S.total * k);
      font(ctx, { s: 220, w: 800, f: F.head }); const w = ctx.measureText(fmt(S.total)).width;
      highlight(ctx, L - 10, 330, w + 20, 54, prog(lt, 1.8, .6));
      T(ctx, s, L, 380, { s: 220, w: 800, f: F.head, c: INK, ls: -8 });
      wipe(ctx, `hours of work, ${S.period}.`, L, 460, { s: 34, w: 600 }, prog(lt, 1, .8));
      T(ctx, `${S.agreements.length} ${S.agreements.length === 1 ? 'agreement' : 'agreements'} · ${S.counts.reduce((a, c) => a + c.n, 0)} projects`, L, 506, { s: 24, c: MUTE, a: prog(lt, 1.5, .6) });
    },
    months(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Month by month', S);
      wipe(ctx, S.change + '.', L, 168, { s: 38, w: 700, f: F.serif }, prog(lt, .2, 1));
      const x0 = L + 40, x1 = W - L - 40, y0 = 560, y1 = 230, max = Math.max(...S.monthly) * 1.1 || 1, n = S.n;
      const px = i2 => n === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i2 / (n - 1), py = v => y0 - (y0 - y1) * v / max;
      ctx.fillStyle = RULE; ctx.fillRect(x0 - 20, y0, x1 - x0 + 40, 2);
      const k = E.inOut(prog(lt, .8, 2.4)), reach = k * (n - 1);
      // area + line up to the current reach
      ctx.save(); ctx.beginPath(); ctx.moveTo(px(0), y0);
      for (let j = 0; j <= Math.floor(reach); j++) ctx.lineTo(px(j), py(S.monthly[j]));
      const fr = reach - Math.floor(reach), jn = Math.min(n - 1, Math.floor(reach) + 1);
      const ex = lerp(px(Math.floor(reach)), px(jn), fr), ey = lerp(py(S.monthly[Math.floor(reach)]), py(S.monthly[jn]), fr);
      ctx.lineTo(ex, ey); ctx.lineTo(ex, y0); ctx.closePath(); ctx.fillStyle = 'rgba(255,243,58,.45)'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(px(0), py(S.monthly[0])); for (let j = 1; j <= Math.floor(reach); j++) ctx.lineTo(px(j), py(S.monthly[j])); ctx.lineTo(ex, ey);
      ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke(); ctx.restore();
      S.monthly.forEach((v, j) => {
        const on = reach >= j - .001;
        T(ctx, S.months[j], px(j), y0 + 34, { s: n > 8 ? 16 : 19, c: MUTE, al: 'center' });
        if (on) { circle(ctx, px(j), py(v), 8, INK); circle(ctx, px(j), py(v), 4, C.paper); }
        if (on && (j === n - 1 || j === S.busiest || n <= 6)) T(ctx, fmt(v), px(j), py(v) - 20, { s: 20, w: 700, c: INK, al: 'center' });
      });
    },
    agreements(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Agreements', S);
      wipe(ctx, S.active.length ? `${S.active.length} active, measured against agreed hours.` : 'Every agreement is complete.', L, 168, { s: 38, w: 700, f: F.serif }, prog(lt, .2, 1));
      S.agreements.slice(0, 4).forEach((a, j) => {
        const y = 250 + j * 90, k = E.out(prog(lt, .6 + j * .3, 1.2)), r = a.hours / a.cap;
        ctx.fillStyle = RULE; ctx.fillRect(L, y + 52, W - 2 * L, 1.5);
        T(ctx, a.name, L, y + 10, { s: 28, w: 700, c: INK, max: 560, a: prog(lt, .4 + j * .3, .5) });
        T(ctx, `${a.wo} · ${STATUS_L[a.status]}`, L, y + 40, { s: 18, c: MUTE, a: prog(lt, .4 + j * .3, .5) });
        fillRR(ctx, 720, y - 6, 300, 8, 4, '#E4DCC9'); fillRR(ctx, 720, y - 6, 300 * Math.min(1, r) * k, 8, 4, r > 1 ? C.late : INK);
        T(ctx, `${Math.round(r * 100 * k)}%`, W - L, y + 10, { s: 30, w: 800, f: F.head, c: r > 1 ? C.late : INK, al: 'right' });
        T(ctx, `${fmt(a.hours)} of ${fmt(a.cap)} h`, 720, y + 40, { s: 18, c: MUTE, a: prog(lt, .8 + j * .3, .5) });
      });
      if (S.agreements.length > 4) T(ctx, `and ${S.agreements.length - 4} more`, L, 250 + 4 * 90 + 10, { s: 20, c: MUTE });
    },
    status(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Where things stand', S);
      const parts = S.counts.filter(c => c.n);
      parts.forEach((c, j) => {
        const y = 230 + j * 92, k = prog(lt, .3 + j * .35, .6);
        T(ctx, fmt(c.n), L, y + 50, { s: 84, w: 800, f: F.head, c: INK, a: k });
        circle(ctx, L + 150, y + 22, 10, STATUS_C[c.s], k);
        wipe(ctx, `${c.n === 1 ? 'project' : 'projects'} ${c.s === 'Completed' ? 'completed' : c.s === 'On track' ? 'on track' : c.s === 'Delayed' ? 'delayed' : c.n === 1 ? 'needs attention' : 'need attention'}`, L + 175, y + 36, { s: 34, w: 600 }, k);
      });
    },
    decisions(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Needs a decision', S);
      if (!S.decisions.length) { wipe(ctx, 'Nothing needs a decision right now.', L, 300, { s: 52, w: 700, f: F.serif }, prog(lt, .3, 1)); T(ctx, 'Every active project is on track.', L, 360, { s: 26, c: MUTE, a: prog(lt, 1, .6) }); return; }
      S.decisions.slice(0, 3).forEach((d, j) => {
        const y = 190 + j * 140, k = prog(lt, .3 + j * .45, .7);
        T(ctx, `${j + 1}.`, L, y + 46, { s: 56, w: 700, f: F.serif, c: STATUS_C[d.status], a: k });
        wipe(ctx, d.name, L + 80, y + 30, { s: 30, w: 700, max: 900 }, k);
        T(ctx, `${STATUS_L[d.status]}. ${d.text}`, L + 80, y + 66, { s: 21, c: MUTE, max: 920, a: prog(lt, .6 + j * .45, .5) });
        ctx.fillStyle = RULE; ctx.fillRect(L + 80, y + 96, W - 2 * L - 80, 1.5);
      });
      if (S.decisions.length > 3) T(ctx, `and ${S.decisions.length - 3} more`, L + 80, 190 + 3 * 140 + 10, { s: 20, c: MUTE, a: prog(lt, 1.8, .5) });
    },
    upcoming(ctx, S, lt, dur, A, i) {
      kicker(ctx, i, 'Coming up', S);
      if (!S.upcoming.length) { wipe(ctx, 'Nothing new is planned yet.', L, 300, { s: 52, w: 700, f: F.serif }, prog(lt, .3, 1)); T(ctx, 'A good moment to talk about what comes next.', L, 360, { s: 26, c: MUTE, a: prog(lt, 1, .6) }); return; }
      S.upcoming.slice(0, 3).forEach((u, j) => {
        const y = 200 + j * 130, k = prog(lt, .3 + j * .45, .7);
        font(ctx, { s: 40, w: 800, f: F.head }); highlight(ctx, L - 4, y + 26, ctx.measureText(dShort(u.start)).width + 8, 16, prog(lt, .6 + j * .45, .5));
        T(ctx, dShort(u.start), L, y + 40, { s: 40, w: 800, f: F.head, c: INK, a: k });
        wipe(ctx, u.name, L + 240, y + 26, { s: 30, w: 700, max: 780 }, k);
        T(ctx, `${fmt(u.cap)} planned hours. ${u.next}`, L + 240, y + 62, { s: 20, c: MUTE, max: 780, a: prog(lt, .6 + j * .45, .5) });
      });
    },
    outro(ctx, S, lt, dur, A) {
      const a0 = ctx.globalAlpha;
      fillRR(ctx, 0, 0, W, H, 0, C.navy, E.out(prog(lt, 0, .7)));
      if (A.logo) { const w = 420, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .4, .7); ctx.drawImage(A.logo, 640 - w / 2, 280 - h / 2, w, h); ctx.globalAlpha = a0; }
      T(ctx, `Hours from QuickBooks, updated ${S.asOfLong}`, 640, 440, { s: 22, c: '#DCE5F0', al: 'center', a: prog(lt, .8, .6) });
      T(ctx, 'Delivered with Morris Interactive', 640, 476, { s: 20, c: '#B9C7D9', al: 'center', a: prog(lt, 1, .6) });
    },
  };
})();
