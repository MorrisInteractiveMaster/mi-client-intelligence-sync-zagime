/* V02 shared model: turns a data set into the answers leadership needs. No AI: plain arithmetic on the synced hours. */
(function () {
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const sum = a => a.reduce((x, y) => x + y, 0);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const day = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const fmt = n => Math.round(n).toLocaleString('en-CA');
  const dLong = s => { const [y, m, d] = s.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
  const dShort = s => { const [, m, d] = s.split('-').map(Number); return `${MON[m - 1].slice(0, 3)} ${d}`; };
  const dMon = s => { const [y, m] = s.split('-').map(Number); return `${MON[m - 1].slice(0, 3)} ${y}`; };

  function model(d) {
    const P = d.projects, work = P.filter(p => p.wo), kids = p => p.wo ? P.filter(c => c.parent === p.wo) : [];
    const n = d.months.length, asOf = day(d.asOf);
    // month-end date for each reporting month (capped at the as-of date)
    const ym = d.monthsLong.map(s => { const [mn, y] = s.split(' '); return [+y, MON.indexOf(mn)]; });
    const monthEnd = ym.map(([y, m]) => Math.min(asOf, Date.UTC(y, m + 1, 0)));
    const monthStart = ym.map(([y, m]) => Date.UTC(y, m, 1));
    const monthly = d.months.map((_, i) => sum(work.map(p => p.months[i])));
    const total = sum(monthly);

    function item(p) {
      const ks = kids(p);
      const months = p.months.map((v, i) => v + sum(ks.map(k => k.months[i])));
      const people = p.people.map((v, i) => v + sum(ks.map(k => k.people[i])));
      const hours = sum(months), s = day(p.start), e = day(p.end);
      let run = 0; const cum = months.map(v => (run += v));
      const timePct = p.status === 'Upcoming' ? 0 : clamp((asOf - s) / (e - s));
      const usePct = p.cap ? hours / p.cap : 0;
      // recent pace: average of the last three reporting months the project was active
      const active = months.map((v, i) => [v, i]).filter(([, i]) => monthEnd[i] >= s && monthStart[i] <= e);
      const recentArr = active.slice(-3).map(([v]) => v), recent = recentArr.length ? sum(recentArr) / recentArr.length : 0;
      const monthsLeft = Math.max(0, (e - asOf) / (30.44 * 864e5));
      const projected = p.status === 'Completed' || p.status === 'Upcoming' ? hours : hours + recent * monthsLeft;
      let pace, paceNote;
      if (p.status === 'Upcoming') { pace = 'Not started'; paceNote = `Starts ${dLong(p.start)}`; }
      else if (p.status === 'Completed') { pace = 'Complete'; paceNote = `${fmt(hours)} of ${fmt(p.cap)} agreed hours used`; }
      else if (hours > p.cap) { pace = 'Over'; paceNote = `${fmt(hours - p.cap)} hours past the agreed ${fmt(p.cap)}`; }
      else if (projected > p.cap * 1.05) { pace = 'Running hot'; paceNote = `At the recent pace it would reach about ${fmt(projected)} of ${fmt(p.cap)} hours by ${dShort(p.end)}`; }
      else if (projected < p.cap * .75) { pace = 'Room to spare'; paceNote = `At the recent pace it would finish near ${fmt(projected)} of ${fmt(p.cap)} hours`; }
      else { pace = 'On pace'; paceNote = `Tracking toward about ${fmt(projected)} of ${fmt(p.cap)} hours by ${dShort(p.end)}`; }
      return { ...p, months, people, hours, cum, timePct, usePct, recent, projected, pace, paceNote, kids: ks.map(item), s, e,
        daysLeft: Math.round((e - asOf) / 864e5), isUmbrella: !p.parent && !!p.wo && ks.length > 0 };
    }
    const items = P.map(item), byId = Object.fromEntries(items.map(x => [x.id, x]));
    const agreements = items.filter(x => x.wo && !x.parent).sort((a, b) => (a.status === 'Completed') - (b.status === 'Completed') || b.hours - a.hours);
    const active = agreements.filter(a => a.status !== 'Completed');
    const capActive = sum(active.map(a => a.cap)), usedActive = sum(active.map(a => a.hours));
    const decisions = items.filter(x => x.wo && (x.status === 'Attention' || x.status === 'Delayed')).sort((a, b) => (b.status === 'Delayed') - (a.status === 'Delayed') || a.e - b.e);
    const hot = items.filter(x => x.wo && (x.pace === 'Over' || x.pace === 'Running hot') && x.status !== 'Completed');
    const upcoming = items.filter(x => x.status === 'Upcoming').sort((a, b) => a.s - b.s);
    const dueSoon = items.filter(x => x.wo && x.status !== 'Completed' && x.daysLeft >= 0 && x.daysLeft <= 60).sort((a, b) => a.e - b.e);
    const counts = ['On track', 'Attention', 'Delayed', 'Completed'].map(s => ({ s, n: work.filter(p => p.status === s).length }));
    const services = Object.entries(work.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + sum(p.months), m), {})).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
    const people = d.people.map((pp, i) => ({ ...pp, hours: sum(work.map(p => p.people[i])), monthly: monthly.map((_, m) => sum(work.map(p => { const t = sum(p.people); return t ? p.months[m] * p.people[i] / t : 0; }))) }))
      .filter(p => p.hours > 0).sort((a, b) => b.hours - a.hours);
    const last = monthly[n - 1], prev = n > 1 ? monthly[n - 2] : null;
    const lastName = d.monthsLong[n - 1].split(' ')[0], prevName = n > 1 ? d.monthsLong[n - 2].split(' ')[0] : '';
    const change = prev == null ? 0 : last - prev;
    const ml = d.monthsLong, y0 = ml[0].split(' ')[1], y1 = ml[n - 1].split(' ')[1];
    const period = n === 1 ? ml[0] : y0 === y1 ? `${ml[0].split(' ')[0]} to ${ml[n - 1]}` : `${ml[0]} to ${ml[n - 1]}`;
    const usedPct = capActive ? usedActive / capActive : 0;
    // One-sentence answer, written from the numbers.
    const workN = work.length, doneN = work.filter(p => p.status === 'Completed').length;
    const live = work.filter(p => p.status !== 'Completed'), delayed = live.filter(p => p.status === 'Delayed').length, attn = live.filter(p => p.status === 'Attention').length;
    const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const hotTxt = hot.length ? pl(hot.length, 'project using hours faster than planned', 'projects using hours faster than planned') : '';
    const lateTxt = delayed ? pl(delayed, 'project delayed', 'projects delayed') : '';
    const join = (...xs) => { xs = xs.filter(Boolean); return xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs.join(''); };
    const paceWord = !active.length ? 'complete'
      : doneN / workN >= .6 ? `winding down, with ${doneN} of ${workN} projects finished`
      : live.length && (delayed + attn) / live.length >= .4 ? `under pressure, with ${join(lateTxt, attn ? pl(attn, 'needing attention', 'needing attention') : '', hotTxt)}`
      : delayed || hot.length ? `mostly on track, with ${join(lateTxt, hotTxt)}`
      : decisions.length ? 'on track, with a decision waiting' : 'on track';
    const headline = `${fmt(total)} hours delivered, ${period}. The partnership is ${paceWord}.`;
    return { d, client: d.client, partner: d.partner, asOf: d.asOf, asOfT: asOf, asOfLong: dLong(d.asOf), synced: d.syncedAt, months: d.months, monthsLong: ml, ym, monthEnd, monthStart, n,
      monthly, total, last, prev, change, lastName, prevName, period, items, byId, agreements, active, capActive, usedActive, usedPct, decisions, hot, upcoming, dueSoon, counts, services, people, headline,
      label: d.label || 'Current demo' };
  }
  window.ZM = { model, sum, clamp, day, iso, fmt, dLong, dShort, dMon, MON };
})();
