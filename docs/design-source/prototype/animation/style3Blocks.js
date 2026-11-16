/* Style 3 · Blocks: full-screen colour blocks that wipe across, giant numerals, bars that land with a bounce. */
(function () {
  const P = window.PULSE, { W, H, C, F, T, fillRR, circle, prog, E, lerp, fmt, clamp, vis, STATUS_C, STATUS_L, dShort, font, SCENES } = P;
  const BG = { intro: C.navy, total: C.yellow, months: C.white, agreements: C.navy, status: C.yellow, decisions: C.white, upcoming: C.yellow, outro: C.navy };
  const ink = bg => bg === C.navy ? C.white : C.navy, sub = bg => bg === C.navy ? '#B9C7D9' : '#41536A';
  const L = 90;

  P.styles.blocks = {
    name: 'Blocks', bg: C.navy,
    draw(ctx, S, sc, t, A) {
      const bg = BG[sc.kind], pb = sc.prev ? BG[sc.prev] : bg;
      ctx.fillStyle = pb; ctx.fillRect(0, 0, W, H);
      const k = E.inOut(prog(sc.lt, 0, .55));
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W * k, H);
      // a thin accent stripe rides the wipe edge
      if (k < 1) { ctx.fillStyle = bg === C.yellow ? C.navy : C.yellow; ctx.fillRect(W * k - 14, 0, 14, H); }
      ctx.save(); ctx.globalAlpha = sc.lt < .45 && !P.RM ? 0 : vis(sc.lt - .45, sc.dur - .45);
      this[sc.kind](ctx, S, sc.lt - .45, sc.dur - .45, A, bg); ctx.restore();
    },
    label(ctx, s, bg) { fillRR(ctx, L, 56, 0, 0, 0, bg); T(ctx, s.toUpperCase(), L, 84, { s: 18, w: 800, c: sub(bg), ls: 4 }); },
    intro(ctx, S, lt, dur, A, bg) {
      const a0 = ctx.globalAlpha, s = E.back(prog(lt, 0, .7));
      T(ctx, 'PARTNERSHIP', L, 300, { s: 120 * clamp(s, 0, 1.05), w: 800, f: F.head, c: C.white, ls: -3 });
      T(ctx, 'PULSE', L, 420, { s: 120 * clamp(E.back(prog(lt, .2, .7)), 0, 1.05), w: 800, f: F.head, c: C.yellow, ls: -3 });
      fillRR(ctx, L, 460, 520 * E.out(prog(lt, .5, .6)), 10, 0, C.yellow);
      T(ctx, S.period, L, 520, { s: 30, w: 700, c: C.white, a: prog(lt, .7, .5) });
      if (A.logo) { const w = 300, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * prog(lt, .9, .6); ctx.drawImage(A.logo, W - L - w, H - 70 - h, w, h); ctx.globalAlpha = a0; }
    },
    total(ctx, S, lt, dur, A, bg) {
      this.label(ctx, 'Hours delivered', bg);
      const k = E.out(prog(lt, 0, 1.6)), sc = clamp(E.back(prog(lt, 0, .6)), 0, 1.06);
      const size = S.total >= 1000 ? 300 : 340;
      T(ctx, fmt(S.total * k), L - 10, 410, { s: size * sc, w: 800, f: F.head, c: C.navy, ls: -14 });
      fillRR(ctx, L, 450, W - 2 * L, 10, 0, C.navy, prog(lt, .8, .4));
      T(ctx, 'HOURS', L, 530, { s: 56, w: 800, f: F.head, c: C.navy, a: prog(lt, .9, .4) });
      T(ctx, S.period, W - L, 530, { s: 30, w: 700, c: C.navy, al: 'right', a: prog(lt, 1, .4) });
    },
    months(ctx, S, lt, dur, A, bg) {
      this.label(ctx, 'Month by month', bg);
      T(ctx, S.change, L, 150, { s: 40, w: 800, f: F.head, c: C.navy, max: W - 2 * L, a: prog(lt, 1.6, .5) });
      const n = S.n, x0 = L, x1 = W - L, base = 610, top = 200, max = Math.max(...S.monthly) || 1, slot = (x1 - x0) / n, bw = slot - 8;
      S.monthly.forEach((v, i) => {
        const k = clamp(E.back(prog(lt, .1 + i * (1.1 / n), .55)), 0, 1.08), h = (base - top) * v / max * k, x = x0 + slot * i + 4;
        const hot = i === n - 1;
        ctx.fillStyle = hot ? C.navy : '#C8D3E1'; ctx.fillRect(x, base - h, bw, h);
        T(ctx, S.months[i].toUpperCase(), x + 10, base - 14, { s: n > 8 ? 13 : 16, w: 800, c: hot ? C.yellow : C.navy, a: k > .3 ? 1 : 0 });
        if (hot || n <= 6) T(ctx, fmt(v), x + 10, base - h + (n > 8 ? 28 : 36), { s: n > 8 ? 20 : 30, w: 800, f: F.head, c: hot ? C.white : C.navy, a: prog(lt, .9 + i * .05, .3) });
      });
    },
    agreements(ctx, S, lt, dur, A, bg) {
      this.label(ctx, S.active.length ? `${S.active.length} active ${S.active.length === 1 ? 'agreement' : 'agreements'}` : 'All agreements complete', bg);
      const list = S.agreements.slice(0, 4), rowH = list.length > 3 ? 120 : 150;
      list.forEach((a, i) => {
        const y = 130 + i * rowH, k = clamp(E.back(prog(lt, .1 + i * .25, .7)), 0, 1.04), r = a.hours / a.cap, wFull = W - 2 * L;
        ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(L, y, wFull, rowH - 24);
        const fw = wFull * Math.min(1, r) * k;
        ctx.fillStyle = r > 1 ? C.late : C.yellow; ctx.fillRect(L, y, fw, rowH - 24);
        // two-tone text: white over navy, navy over the fill
        for (const [col, clipX, clipW] of [[C.white, L + fw, wFull], [C.navy, L, fw]]) {
          ctx.save(); ctx.beginPath(); ctx.rect(clipX, y, clipW, rowH - 24); ctx.clip();
          T(ctx, a.name, L + 22, y + 46, { s: 30, w: 800, f: F.head, c: col, max: wFull * .62 });
          T(ctx, `${a.wo} · ${STATUS_L[a.status]} · ${fmt(a.hours)} of ${fmt(a.cap)} h`, L + 22, y + 78, { s: 18, w: 600, c: col, a: .85 });
          T(ctx, `${Math.round(r * 100)}%`, L + wFull - 22, y + 62, { s: 48, w: 800, f: F.head, c: col, al: 'right', a: prog(lt, .4 + i * .25, .3) });
          ctx.restore();
        }
      });
      if (S.agreements.length > 4) T(ctx, `+ ${S.agreements.length - 4} more`, L, 130 + 4 * rowH + 10, { s: 22, w: 700, c: '#B9C7D9' });
    },
    status(ctx, S, lt, dur, A, bg) {
      this.label(ctx, 'Project status', bg);
      S.counts.forEach((c, i) => {
        const col = i % 2, row = Math.floor(i / 2), x = L + col * 560, y = 140 + row * 250, k = clamp(E.back(prog(lt, .1 + i * .18, .6)), 0, 1.06);
        ctx.fillStyle = C.navy; ctx.globalAlpha *= 1; ctx.fillRect(x, y, 520 * clamp(k, 0, 1), 220);
        T(ctx, fmt(c.n), x + 30, y + 160, { s: 150 * clamp(k, 0, 1), w: 800, f: F.head, c: C.white });
        circle(ctx, x + 300, y + 66, 14, STATUS_C[c.s], prog(lt, .4 + i * .18, .3));
        T(ctx, STATUS_L[c.s].toUpperCase(), x + 300, y + 150, { s: 22, w: 800, c: C.yellow, max: 200, a: prog(lt, .4 + i * .18, .3) });
      });
    },
    decisions(ctx, S, lt, dur, A, bg) {
      this.label(ctx, 'Needs a decision', bg);
      if (!S.decisions.length) { T(ctx, 'NOTHING', L, 330, { s: 150, w: 800, f: F.head, c: C.navy, a: prog(lt, 0, .4) }); T(ctx, 'needs a decision right now.', L, 400, { s: 40, w: 700, c: C.navy, a: prog(lt, .3, .4) }); return; }
      S.decisions.slice(0, 3).forEach((d, i) => {
        const y = 130 + i * 160, k = E.out(prog(lt, .1 + i * .3, .5));
        ctx.fillStyle = STATUS_C[d.status]; ctx.fillRect(L, y, 18, 130);
        ctx.fillStyle = C.navy; ctx.fillRect(L + 18, y, (W - 2 * L - 18) * k, 130);
        ctx.save(); ctx.globalAlpha *= prog(lt, .35 + i * .3, .3);
        T(ctx, STATUS_L[d.status].toUpperCase(), L + 48, y + 40, { s: 16, w: 800, c: C.yellow, ls: 3 });
        T(ctx, d.name, L + 48, y + 80, { s: 32, w: 800, f: F.head, c: C.white, max: W - 2 * L - 80 });
        T(ctx, d.text, L + 48, y + 112, { s: 19, c: '#C9D5E4', max: W - 2 * L - 80 }); ctx.restore();
      });
      if (S.decisions.length > 3) T(ctx, `+ ${S.decisions.length - 3} MORE`, L, 130 + 3 * 160 + 4, { s: 20, w: 800, c: C.navy, a: prog(lt, 1.4, .4) });
    },
    upcoming(ctx, S, lt, dur, A, bg) {
      this.label(ctx, 'Coming up', bg);
      if (!S.upcoming.length) { T(ctx, 'NOTHING NEW', L, 330, { s: 130, w: 800, f: F.head, c: C.navy, a: prog(lt, 0, .4) }); T(ctx, 'is planned yet. Time to talk about what’s next.', L, 400, { s: 36, w: 700, c: C.navy, a: prog(lt, .3, .4) }); return; }
      const list = S.upcoming.slice(0, 3), cw = (W - 2 * L - 20 * (list.length - 1)) / list.length;
      list.forEach((u, i) => {
        const x = L + i * (cw + 20), k = clamp(E.back(prog(lt, .1 + i * .25, .6)), 0, 1.04), y = 140 + 40 * (1 - clamp(k, 0, 1));
        ctx.fillStyle = C.navy; ctx.fillRect(x, y, cw, 420);
        ctx.save(); ctx.globalAlpha *= clamp(k, 0, 1);
        T(ctx, dShort(u.start).toUpperCase(), x + 28, y + 90, { s: 58, w: 800, f: F.head, c: C.yellow, max: cw - 50 });
        P.para(ctx, u.name, x + 28, y + 170, cw - 56, 40, { s: 32, w: 800, f: F.head, c: C.white }, 3);
        T(ctx, `${fmt(u.cap)} PLANNED HOURS`, x + 28, y + 380, { s: 18, w: 800, c: '#B9C7D9', ls: 2 }); ctx.restore();
      });
    },
    outro(ctx, S, lt, dur, A, bg) {
      const a0 = ctx.globalAlpha;
      if (A.logo) { const w = 460, h = w * A.logo.height / A.logo.width; ctx.globalAlpha = a0 * clamp(E.back(prog(lt, 0, .6)), 0, 1); ctx.drawImage(A.logo, 640 - w / 2, 250 - h / 2, w, h); ctx.globalAlpha = a0; }
      fillRR(ctx, 640 - 200 * E.out(prog(lt, .4, .5)), 360, 400 * E.out(prog(lt, .4, .5)), 8, 0, C.yellow);
      T(ctx, `HOURS FROM QUICKBOOKS · UPDATED ${S.asOfLong.toUpperCase()}`, 640, 430, { s: 18, w: 800, c: C.white, al: 'center', ls: 2, a: prog(lt, .6, .4) });
      T(ctx, 'DELIVERED WITH MORRIS INTERACTIVE', 640, 466, { s: 16, w: 700, c: '#B9C7D9', al: 'center', ls: 3, a: prog(lt, .8, .4) });
    },
  };
})();
