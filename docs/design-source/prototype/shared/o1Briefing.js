/* Option 1 · Briefing: reads like a one-page leadership briefing. Answer first, evidence underneath. */
(function () {
  const { esc, badge, paceChip, burnup, columns, hbars, meter } = window.ZC, { fmt, dShort, dLong, sum } = window.ZM;
  let sel = null;
  const weightedTime = M => M.capActive ? sum(M.active.map(a => a.timePct * a.cap)) / M.capActive : 0;
  function paceBlock(M, it) {
    return `<div class="b-pace-chart">${burnup(M, it, { w: 720, h: 290 })}</div>
      <aside class="b-pace-side"><p class="b-k">${esc(it.wo)}</p><h3>${esc(it.name)}</h3><div class="b-chips">${paceChip(it.pace)}${badge(it.status)}</div>
        <p class="b-note">${esc(it.paceNote)}.</p>
        <dl><div><dt>Used</dt><dd>${fmt(it.hours)} <small>of ${fmt(it.cap)} h</small></dd></div><div><dt>Time gone</dt><dd>${Math.round(it.timePct * 100)}%</dd></div>
        <div><dt>Recent pace</dt><dd>${fmt(it.recent)} <small>h a month</small></dd></div><div><dt>${it.status === 'Completed' ? 'Finished' : 'Target'}</dt><dd>${dShort(it.end)}</dd></div></dl>
        <button class="b-more" data-open="${it.id}">Open the full project →</button>
        <p class="b-legend"><span class="lg act"></span>Hours so far <span class="lg cap"></span>Agreed <span class="lg even"></span>Even pace <span class="lg proj"></span>At recent pace</p></aside>`;
  }
  window.ZOPTIONS.push({
    key: 'briefing', name: 'Briefing', note: 'Answer first, evidence underneath. Click an agreement to switch the pace chart.',
    render(M) {
      const firstAg = M.active[0] || M.agreements[0]; if (!sel || !M.byId[sel]) sel = firstAg && firstAg.id;
      const tg = weightedTime(M), next = [...M.dueSoon.map(x => ({ t: x.e, what: `${x.name} due`, id: x.id })), ...M.upcoming.map(x => ({ t: x.s, what: `${x.name} starts`, id: x.id }))].sort((a, b) => a.t - b.t);
      const hl = M.headline.replace(/^([\d,]+ hours)/, '<mark>$1</mark>');
      return `<div class="o-brief">
      <header class="b-mast"><div class="b-wrap"><img src="${window.ZLOGO}" alt="Zagimē Anishinabēk"><div class="b-mast-r"><span>Partnership briefing<br><b>As of ${M.asOfLong}</b></span></div></div></header>
      <main class="b-wrap">${ZS.hero(M)}
        <section class="b-lede"><p class="b-k">Zagimē Anishinabēk with Morris Interactive</p><h1>${hl}</h1>
          <p class="b-sync">Hours come straight from QuickBooks and were last updated ${M.asOfLong}, 9:00 am. Agreed hours and progress come from the Morris project leads.</p></section>
        <section class="b-three">
          <div><p class="b-q">Are we on pace?</p><p class="b-a"><b>${Math.round(M.usedPct * 100)}%</b> of agreed hours used, with <b>${Math.round(tg * 100)}%</b> of the time gone.</p>${M.active.length ? meter(M.usedActive, M.capActive, { time: tg }) : ''}<p class="b-s">${M.hot.length ? `${M.hot.length} ${M.hot.length === 1 ? 'project is' : 'projects are'} using hours faster than planned.` : M.active.length ? 'No project is on course to run over its agreed hours.' : 'All agreements are complete.'}</p></div>
          <div><p class="b-q">What needs a decision?</p><p class="b-a">${M.decisions.length ? `<b>${M.decisions.length}</b> ${M.decisions.length === 1 ? 'project' : 'projects'} waiting on a conversation.` : 'Nothing right now.'}</p><ul>${M.decisions.slice(0, 3).map(x => `<li><button data-open="${x.id}">${esc(x.name)}</button></li>`).join('')}</ul></div>
          <div><p class="b-q">What's next?</p><p class="b-a">${next.length ? `<b>${dShort(new Date(next[0].t).toISOString().slice(0, 10))}</b> ${esc(next[0].what)}.` : 'Nothing scheduled yet.'}</p><ul>${next.slice(1, 4).map(x => `<li><button data-open="${x.id}"><span class="dt">${dShort(new Date(x.t).toISOString().slice(0, 10))}</span>${esc(x.what)}</button></li>`).join('')}</ul></div>
        </section>
        <section class="b-sec"><h2>Are we on pace?</h2><p class="b-intro">Each line shows hours used so far against the hours each agreement allows. The dashed line shows where it lands if the last three months' pace continues.</p>
          <div class="b-tabs" role="tablist">${M.agreements.map(a => `<button role="tab" data-ag="${a.id}" aria-selected="${a.id === sel}"><span>${esc(a.name)}</span>${paceChip(a.pace)}</button>`).join('')}</div>
          <div class="b-pace" id="b-pace">${sel ? paceBlock(M, M.byId[sel]) : ''}</div></section>
        <section class="b-sec b-cols"><div><h2>Month by month</h2><p class="b-intro">${M.prev == null ? `${fmt(M.last)} hours in ${M.lastName}.` : `${fmt(M.last)} hours in ${M.lastName}, ${M.change >= 0 ? 'up' : 'down'} ${fmt(Math.abs(M.change))} on ${M.prevName}. ${M.monthly.indexOf(Math.max(...M.monthly)) === M.n - 1 ? `${M.lastName} was the busiest month so far.` : `The busiest month was ${M.monthsLong[M.monthly.indexOf(Math.max(...M.monthly))]}.`}`}</p>${columns(M, M.monthly, { w: 640, h: 240 })}</div>
          <div><h2>Who's doing the work</h2><p class="b-intro">Hours by Morris team member, ${M.period}.</p>${hbars(M.people.map(p => ({ label: p.name, value: p.hours })))}</div></section>
        <section class="b-sec"><h2>What needs a decision?</h2>${M.decisions.length ? `<ol class="b-dec">${M.decisions.map(x => `<li><div class="b-dec-h">${badge(x.status)}<button data-open="${x.id}">${esc(x.name)}</button><span class="muted">${esc(x.wo)} · target ${dShort(x.end)}</span></div><p>${esc(x.risk || x.nextStep)}</p><p class="b-ask"><b>Suggested next step:</b> ${esc(x.nextStep)}</p></li>`).join('')}</ol>` : '<p class="b-none">Nothing needs a decision right now. Every active project is on track.</p>'}</section>
        <section class="b-sec"><h2>What's next</h2>${next.length ? `<ol class="b-next">${next.slice(0, 6).map(x => `<li><span class="dt">${dLong(new Date(x.t).toISOString().slice(0, 10))}</span><button data-open="${x.id}">${esc(x.what)}</button></li>`).join('')}</ol>${next.length > 6 ? `<p class="muted" style="margin-top:10px">and ${next.length - 6} more dates after that</p>` : ''}` : '<p class="b-none">Nothing new is planned yet. A good moment to talk about what comes next.</p>'}</section>
      </main>
      <footer class="b-foot b-wrap">Prepared by Morris Interactive for Zagimē Anishinabēk · Design option 1 · Synthetic data</footer></div>`;
    },
    after(M, root) {
      root.querySelectorAll('[data-ag]').forEach(b => b.addEventListener('click', () => { sel = b.dataset.ag; root.querySelectorAll('[data-ag]').forEach(x => x.setAttribute('aria-selected', x === b)); root.querySelector('#b-pace').innerHTML = paceBlock(M, M.byId[sel]); }));
    },
  });
})();
