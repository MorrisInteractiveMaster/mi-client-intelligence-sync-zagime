/* V03 looks: one dashboard, eight visual styles. Same content and functions in every look; only the styling changes. */
(function () {
  const { esc, badge, paceChip, burnup, columns, hbars, meter } = window.ZC, { fmt, dShort, sum } = window.ZM;
  const LOOKS = [
    ['swiss', 'Swiss grid', 'International Typographic Style: strict grid, flush-left type, heavy rules, no decoration.'],
    ['brutal', 'Neo-brutalist', 'Thick black outlines, hard offset shadows, chunky type, yellow blocks.'],
    ['glass', 'Night glass', 'Deep navy night sky, frosted glass panels, a glowing sun.'],
    ['editorial', 'Editorial magazine', 'Financial-paper feel: warm paper, serif headlines, hairline rules.'],
    ['health', 'Health-app cards', 'Phone health-app style: soft grey, big rounded cards, friendly type.'],
    ['bauhaus', 'Bauhaus geometry', 'Circles, half-circles and solid blocks; the sun as a geometric motif.'],
    ['terminal', 'Terminal', 'Trading-terminal density: dark screen, monospace figures, yellow tickers.'],
    ['nordic', 'Nordic minimal', 'Calm and airy: lots of white, thin lines, soft yellow tint.'],
  ];
  function render(M, key, name) {
    const tg = M.capActive ? sum(M.active.map(a => a.timePct * a.cap)) / M.capActive : 0;
    const next = [...M.dueSoon.map(x => ({ t: x.e, x, k: 'Due', d: x.end })), ...M.upcoming.map(x => ({ t: x.s, x, k: 'Starts', d: x.start }))].sort((a, b) => a.t - b.t);
    const n = M.n, ch = M.prev == null ? '' : `${M.change >= 0 ? '▲' : '▼'} ${fmt(Math.abs(M.change))} on ${M.prevName}`;
    return `<div class="lk lk-${key}">
      <header class="lk-head"><span class="lk-deco d1" aria-hidden="true"></span><span class="lk-deco d2" aria-hidden="true"></span><span class="lk-deco d3" aria-hidden="true"></span>
        <div class="lk-in lk-head-in"><span class="lk-logo"><img src="${window.ZLOGO}" alt="Zagimē Anishinabēk"></span>
          <div class="lk-title"><span class="lk-k">Zagimē Anishinabēk × Morris Interactive</span><h1>Partnership dashboard</h1></div>
          <span class="lk-date">Hours from QuickBooks<br><b>Updated ${M.asOfLong}</b></span></div></header>
      <main class="lk-in lk-main">
        <div class="lk-a-glance lk-cq">${ZS.hero(M, 'lk-gh')}</div>
        <section class="lk-answer"><p class="lk-k">The short answer</p><h2>${esc(M.headline)}</h2></section>
        <div class="lk-a-kpis lk-cq"><section class="lk-kpis">
          <div class="lk-kpi"><span class="lk-kl">Hours delivered</span><b class="lk-kv">${fmt(M.total)}</b><span class="lk-ks">${fmt(M.last)} in ${esc(M.lastName)}${ch ? ` · ${ch}` : ''}</span></div>
          <div class="lk-kpi"><span class="lk-kl">Agreed hours used</span><b class="lk-kv">${Math.round(M.usedPct * 100)}<small>%</small></b>${M.active.length ? meter(M.usedActive, M.capActive, { time: tg }) : ''}<span class="lk-ks">${Math.round(tg * 100)}% of the time gone</span></div>
          <div class="lk-kpi"><span class="lk-kl">Decisions waiting</span><b class="lk-kv">${M.decisions.length}</b><span class="lk-ks">${M.decisions[0] ? esc(M.decisions[0].name) : 'Nothing needs a decision'}</span></div>
          <div class="lk-kpi"><span class="lk-kl">Next date</span><b class="lk-kv lk-kv-sm">${next[0] ? dShort(next[0].d) : '—'}</b><span class="lk-ks">${next[0] ? `${esc(next[0].x.name)} ${next[0].k === 'Due' ? 'due' : 'starts'}` : 'Nothing scheduled'}</span></div></section></div>
        <section class="lk-sec lk-a-pace"><div class="lk-sh"><h3>Are we on pace?</h3><p>Solid line: hours so far. Dashed: agreed hours. Dotted: even pace. Coloured dash: where the recent pace lands.</p></div>
          <div class="lk-pace">${M.agreements.map(a => `<button class="lk-pc" data-open="${a.id}"><span class="lk-pc-h"><span><span class="lk-wo">${esc(a.wo)}</span><b>${esc(a.name)}</b></span>${paceChip(a.pace)}</span>${burnup(M, a, { w: 440, h: 210, pr: 84 })}<span class="lk-pc-f">${fmt(a.hours)} of ${fmt(a.cap)} h · ${a.status === 'Completed' ? 'finished' : 'target'} ${dShort(a.end)}</span></button>`).join('')}</div></section>
        <div class="lk-a-trend lk-cq"><section class="lk-two"><div class="lk-card"><h3>Month by month</h3>${columns(M, M.monthly, { w: 620, h: 230 })}</div>
          <div class="lk-card"><h3>Who's doing the work</h3>${hbars(M.people.map(p => ({ label: p.name, value: p.hours })))}</div></section></div>
        <div class="lk-a-todo lk-cq"><section class="lk-two"><div class="lk-card"><h3>Needs a decision</h3>${M.decisions.length ? `<ul class="lk-list">${M.decisions.map(x => `<li><button data-open="${x.id}">${badge(x.status)}<b>${esc(x.name)}</b><span>${esc(x.risk || x.nextStep)}</span></button></li>`).join('')}</ul>` : '<p class="lk-empty">Nothing needs a decision right now.</p>'}</div>
          <div class="lk-card"><h3>Coming up</h3>${next.length ? `<ul class="lk-list lk-dates">${next.slice(0, 6).map(({ x, k, d }) => `<li><button data-open="${x.id}"><span class="lk-date-chip"><small>${k}</small>${dShort(d)}</span><b>${esc(x.name)}</b></button></li>`).join('')}</ul>` : '<p class="lk-empty">Nothing new is planned yet.</p>'}</div></section></div>
      </main><footer class="lk-in lk-foot">${esc(name)} · synthetic data for design review</footer></div>`;
  }
  LOOKS.forEach(([key, name, note]) => window.ZOPTIONS.push({ key, name, note, render: M => render(M, key, name) }));
})();
