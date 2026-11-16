/* V02 charts: hand-built SVG/HTML. Tooltips via data-tip. One measure per chart, recessive axes, labels never colour-only. */
(function () {
  const { fmt, dShort, dMon, MON, clamp, sum } = window.ZM;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Draw charts at the width they will actually appear on small screens, so text stays readable.
  const fitW = w => Math.min(w, Math.max(300, innerWidth - 56));
  const PACE = { 'On pace': 'ok', 'Running hot': 'warn', 'Over': 'late', 'Room to spare': 'calm', 'Complete': 'done', 'Not started': 'up' };
  const STATUS = { 'On track': 'ok', 'Attention': 'warn', 'Delayed': 'late', 'Completed': 'done', 'Upcoming': 'up' };
  const ICON = { ok: '<path d="M3 8.5l3 3 7-7"/>', warn: '<path d="M8 3.5v5.5M8 12v.5"/>', late: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>', done: '<path d="M3 8.5l3 3 7-7"/>', up: '<path d="M6 3.5l4.5 4.5L6 12.5"/>', calm: '<path d="M3 8h10"/>' };
  const badge = s => { const k = STATUS[s] || 'done'; return `<span class="badge k-${k}"><svg viewBox="0 0 16 16" aria-hidden="true">${ICON[k]}</svg>${esc(s === 'Attention' ? 'Needs attention' : s)}</span>`; };
  const paceChip = p => { const k = PACE[p] || 'done'; return `<span class="pace k-${k}"><i></i>${esc(p)}</span>`; };

  /* The "are we on pace?" chart: cumulative hours against agreed hours, an even-pace guide, today, and a projection. */
  function burnup(M, it, o = {}) {
    const W = fitW(o.w || 640), H = o.h || 250, pl = 50, pr = Math.min(o.pr ?? 104, W * .2), pt = 20, pb = 32;
    const x0 = it.s, x1 = Math.max(it.e, M.asOfT), ymax = Math.max(it.cap, it.projected, it.hours, 1) * 1.14;
    const X = t => pl + (t - x0) / ((x1 - x0) || 1) * (W - pl - pr), Y = v => pt + (H - pt - pb) * (1 - v / ymax);
    let g = '';
    const step = ymax > 2000 ? 1000 : ymax > 800 ? 250 : ymax > 300 ? 100 : ymax > 120 ? 50 : 25;
    for (let v = 0; v <= ymax; v += step) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    // month ticks
    const d0 = new Date(x0), span = (x1 - x0) / (30.44 * 864e5), every = span > 14 ? 3 : span > 7 ? 2 : 1;
    for (let k = 0, t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1); t <= x1; k++) {
      const dd = new Date(t); if (k % every === 0) g += `<text class="ax" x="${X(t)}" y="${H - 10}" text-anchor="middle">${MON[dd.getUTCMonth()].slice(0, 3)}</text><line class="tick" x1="${X(t)}" x2="${X(t)}" y1="${H - pb}" y2="${H - pb + 4}"/>`;
      t = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth() + 1, 1);
    }
    g += `<line class="base" x1="${pl}" x2="${W - pr}" y1="${H - pb}" y2="${H - pb}"/>`;
    // agreed hours line + even pace guide
    g += `<line class="cap" x1="${pl}" x2="${W - pr}" y1="${Y(it.cap)}" y2="${Y(it.cap)}"/><text class="lbl" x="${W - pr + 8}" y="${Y(it.cap) + 4}">Agreed ${fmt(it.cap)}</text>`;
    if (it.status !== 'Upcoming') g += `<line class="even" x1="${X(it.s)}" y1="${Y(0)}" x2="${X(it.e)}" y2="${Y(it.cap)}"/>`;
    // actual cumulative
    const pts = [[X(it.s), Y(0), null]];
    M.monthEnd.forEach((t, i) => { if (t >= it.s && M.monthStart[i] <= Math.min(it.e, M.asOfT) && it.status !== 'Upcoming') pts.push([X(Math.min(t, it.e)), Y(it.cum[i]), i]); });
    if (pts.length > 1) {
      const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
      g += `<polygon class="area" points="${pts[0][0]},${Y(0)} ${line} ${pts[pts.length - 1][0]},${Y(0)}"/><polyline class="act" points="${line}"/>`;
      // projection at recent pace
      if (it.status !== 'Completed' && it.e > M.asOfT) { const lp = pts[pts.length - 1]; g += `<line class="proj k-${PACE[it.pace]}" x1="${lp[0]}" y1="${lp[1]}" x2="${X(it.e)}" y2="${Y(it.projected)}"/><circle class="projdot k-${PACE[it.pace]}" cx="${X(it.e)}" cy="${Y(it.projected)}" r="5"/><text class="lbl strong" x="${X(it.e) + 8}" y="${Y(it.projected) + (Math.abs(Y(it.projected) - Y(it.cap)) < 16 ? 18 : 4)}">≈ ${fmt(it.projected)}</text>`; }
      pts.slice(1).forEach(p => { const i = p[2]; g += `<circle class="pt" cx="${p[0]}" cy="${p[1]}" r="4"/><circle class="hit" cx="${p[0]}" cy="${p[1]}" r="14" data-tip="${esc(M.monthsLong[i])}: ${fmt(it.cum[i])} hours so far (${fmt(it.months[i])} that month)"/>`; });
      const lp = pts[pts.length - 1]; g += `<text class="lbl strong" x="${lp[0] - 6}" y="${lp[1] - 12}" text-anchor="end">${fmt(it.hours)}</text>`;
    }
    if (M.asOfT >= x0 && M.asOfT <= x1) g += `<line class="today" x1="${X(M.asOfT)}" x2="${X(M.asOfT)}" y1="${pt - 6}" y2="${H - pb}"/><text class="lbl" x="${X(M.asOfT)}" y="${pt - 9}" text-anchor="middle">Today</text>`;
    return `<svg class="chart burnup" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(it.name)}: ${fmt(it.hours)} of ${fmt(it.cap)} agreed hours used. ${esc(it.paceNote)}.">${g}</svg>`;
  }

  /* Monthly columns. Direct labels only on the latest and busiest month; every bar has a tooltip. */
  function columns(M, vals, o = {}) {
    const W = fitW(o.w || 640), H = o.h || 220, pl = 44, pr = 8, pt = 24, pb = 30, n = vals.length;
    const max = Math.max(...vals, 1), nice = max > 400 ? 100 : max > 150 ? 50 : max > 40 ? 20 : 10, top = Math.ceil(max * 1.08 / nice) * nice;
    const iw = W - pl - pr, ih = H - pt - pb, slot = iw / n, bw = Math.min(46, slot * .62), Y = v => pt + ih - v / top * ih;
    const busiest = vals.indexOf(max);
    let g = '';
    for (let v = 0; v <= top; v += top / 4) g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${pl - 8}" y="${Y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    vals.forEach((v, i) => {
      const x = pl + slot * i + (slot - bw) / 2, h = ih * v / top, r = Math.min(4, h), y = pt + ih - h, hot = i === (o.highlight ?? n - 1), dim = o.upTo != null && i > o.upTo;
      g += `<path class="col${hot ? ' hi' : ''}${dim ? ' dim' : ''}" d="M${x},${pt + ih}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${pt + ih}Z"/>`;
      g += `<rect class="hit" x="${pl + slot * i}" y="${pt}" width="${slot}" height="${ih}" data-tip="${esc(M.monthsLong[i])}: ${fmt(v)} hours" ${o.clickable ? `data-month="${i}" tabindex="0"` : ''}/>`;
      if (n <= 8 || i % 2 === 0 || i === n - 1) g += `<text class="ax" x="${x + bw / 2}" y="${H - 9}" text-anchor="middle">${M.months[i]}</text>`;
      if ((i === n - 1 || i === busiest) && !dim && v > 0) g += `<text class="vl" x="${x + bw / 2}" y="${y - 7}" text-anchor="middle">${fmt(v)}</text>`;
    });
    g += `<line class="base" x1="${pl}" x2="${W - pr}" y1="${pt + ih}" y2="${pt + ih}"/>`;
    return `<svg class="chart cols" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || 'Hours by month')}">${g}</svg>`;
  }
  const hbars = (items, o = {}) => { const max = o.max || Math.max(...items.map(i => i.value), 1);
    return `<div class="hbars">${items.map(i => `<div class="hb"${i.id ? ` data-open="${esc(i.id)}" tabindex="0" role="button"` : ''}><span class="hb-l">${esc(i.label)}</span><span class="hb-t" data-tip="${esc(i.label)}: ${fmt(i.value)} hours"><span style="width:${(i.value / max * 100).toFixed(1)}%"></span></span><span class="hb-v">${fmt(i.value)}<small> h</small></span></div>`).join('')}</div>`; };
  const meter = (v, cap, o = {}) => { const pct = cap ? v / cap : 0; return `<div class="meter${pct > 1 ? ' over' : ''}" data-tip="${fmt(v)} of ${fmt(cap)} agreed hours (${Math.round(pct * 100)}%)">${o.time != null ? `<i class="time" style="left:${(o.time * 100).toFixed(1)}%" title="Time elapsed"></i>` : ''}<span style="width:${(Math.min(1, pct) * 100).toFixed(1)}%"></span></div>`; };
  function ring(pct, o = {}) { const r = o.r || 46, sw = o.sw || 10, c = 2 * Math.PI * r, s = r + sw;
    const time = o.time != null ? `<g transform="rotate(${o.time * 360} ${s} ${s})"><line class="ring-halo" x1="${s}" y1="${sw / 2 - 5}" x2="${s}" y2="${sw * 1.5 + 5}"/><line class="ring-time" x1="${s}" y1="${sw / 2 - 5}" x2="${s}" y2="${sw * 1.5 + 5}"/></g>` : '';
    return `<svg class="ring${pct > 1 ? ' over' : ''}" viewBox="0 0 ${2 * s} ${2 * s}" width="${o.size || 2 * s}" height="${o.size || 2 * s}" aria-hidden="true"><circle class="ring-bg" cx="${s}" cy="${s}" r="${r}" stroke-width="${sw}"/><circle class="ring-fg" cx="${s}" cy="${s}" r="${r}" stroke-width="${sw}" stroke-dasharray="${(c * Math.min(1, pct)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${s} ${s})"/>${time}</svg>`; }
  const spark = (vals, w = 110, h = 30) => { const max = Math.max(...vals, 1), st = w / Math.max(1, vals.length - 1);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${vals.map((v, i) => `${(i * st).toFixed(1)},${(h - 3 - v / max * (h - 6)).toFixed(1)}`).join(' ')}"/></svg>`; };
  function heat(M, rows, o = {}) {
    const max = Math.max(...rows.flatMap(r => r.v), 1);
    return `<div class="tbl-wrap"><table class="heat"><thead><tr><th scope="col">${esc(o.first || '')}</th>${M.months.map(m => `<th scope="col">${m}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>
      ${rows.map(r => `<tr${r.id ? ` data-open="${esc(r.id)}" tabindex="0"` : ''}><th scope="row">${esc(r.label)}</th>${r.v.map((v, m) => { const a = v / max; return `<td style="--a:${a.toFixed(2)}" class="${a > .45 ? 'dk' : ''}" data-tip="${esc(r.label)}, ${esc(M.monthsLong[m])}: ${o.approx ? 'about ' : ''}${fmt(v)} hours">${v ? fmt(v) : '·'}</td>`; }).join('')}<td class="tot">${fmt(sum(r.v))}</td></tr>`).join('')}
      </tbody></table></div>`;
  }
  window.ZC = { esc, badge, paceChip, burnup, columns, hbars, meter, ring, spark, heat, PACE, STATUS };
})();
