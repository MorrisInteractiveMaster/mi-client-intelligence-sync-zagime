import { ArrowDownRight, ArrowUpRight, CalendarDays, LayoutGrid, Presentation } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { areaHours } from "../projects/portfolio";
import { ContextHelp } from "./ContextHelp";
import { reportDay, reportHours, reportMonth, reportTimestamp } from "./dashboard-format";

export function ExecutiveOverview({ report, onPresentation, onArea }: {
  report: ProjectReport; onPresentation: () => void; onArea: (id: string) => void;
}) {
  const { portfolio, projects } = report;
  const period = reportMonth(report.month);
  const areas = areaHours(projects, portfolio).sort((a, b) => b.seconds - a.seconds);
  const maxArea = Math.max(1, ...areas.map(a => a.seconds));
  const previous = portfolio?.history.at(-1)?.seconds;
  const change = previous === undefined ? null : report.totalSeconds - previous;
  const history = [...(portfolio?.history ?? []), { month: report.month, seconds: report.totalSeconds }];
  const maximum = Math.max(1, ...history.map(row => row.seconds));
  const milestones = projects.flatMap(p => (p.milestones ?? []).filter(m => !m.completed && m.date >= report.month + "-01").map(m => ({ ...m, project: p.name, projectId: p.id })))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  const monthly = projects.filter(x => x.plan.basis === "monthly" && x.plan.targetSeconds > 0);
  const planned = monthly.reduce((sum, x) => sum + x.plan.targetSeconds, 0);
  const againstPlan = monthly.reduce((sum, x) => sum + x.seconds, 0);
  const archived = new Set(portfolio?.placements.filter(p => p.archived).map(p => p.id));
  const active = projects.filter(p => !archived.has(p.id));
  const paused = active.filter(p => p.status === "paused");
  return <>
    <section className="exec-hero" aria-labelledby="executive-title">
      <div className="exec-hero-copy">
        <span className="exec-kicker">{period}</span>
        <h2 id="executive-title">Leadership summary</h2>
        <p>{report.tenant.name}</p>
        {report.sourceUpdatedAt && <p className="exec-source-freshness">Source updated <time dateTime={report.sourceUpdatedAt}>{reportTimestamp(report.sourceUpdatedAt)}</time></p>}
        <button className="exec-hero-action" type="button" onClick={onPresentation}><Presentation size={18} aria-hidden="true" /> At a Glance</button>
      </div>
      <div className="exec-hero-art" aria-hidden="true">
        {Array.from({ length: 96 }, (_, i) => <i key={i} data-lit={(i * 13 + Math.floor(i / 12) * 3) % 23 < 9} />)}
      </div>
    </section>
    <dl className="secure-metrics exec-metrics" aria-label="Published portfolio summary">
      <div className="exec-metric-primary">
        <dt>Allocated hours · {period}<ContextHelp label="How are allocated hours calculated?">These are reporting allocations approved for the projects you can see. Unassigned source time is excluded.</ContextHelp></dt>
        <dd>{reportHours(report.totalSeconds)} h</dd>
      </div>
      <div><dt>Active projects</dt><dd>{active.filter(p => p.status === "active").length}</dd></div>
      <div><dt>Completed projects</dt><dd>{projects.filter(p => p.status === "completed").length}</dd></div>
      <div><dt>Upcoming work</dt><dd>{active.filter(p => p.status === "planned").length}</dd></div>
    </dl>
    <div className="exec-overview-grid">
      <section className="exec-panel">
        <span className="exec-panel-icon"><LayoutGrid size={17} aria-hidden="true" /></span>
        <h3>Hours by service area</h3>
        {areas.length ? <ul className="exec-chart" aria-label="Allocated hours by service area">
          {areas.map(a => <li key={a.id}>
            <div>{a.id ? <button type="button" className="exec-text-button" onClick={() => onArea(a.id)}>{a.name}</button> : <span>{a.name}</span>} <b>{reportHours(a.seconds)} h</b></div>
            <div className="exec-bar" aria-hidden="true"><i style={{ width: (a.seconds / maxArea * 100) + "%" }} /></div>
          </li>)}
        </ul> : <p className="secure-muted">No published delivery hours for this period.</p>}
      </section>
      <section className="exec-panel">
        <h3>Monthly delivery</h3>
        {projects.length > 0 ? <>
          <ul className="exec-chart exec-chart--trend" aria-label="Monthly delivery history">
            {history.map(row => <li key={row.month}>
              <div><span>{reportMonth(row.month)}</span><b>{reportHours(row.seconds)} h</b></div>
              <div className="exec-bar" aria-hidden="true"><i style={{ width: (row.seconds / maximum * 100) + "%" }} /></div>
            </li>)}
          </ul>
          {change !== null && <p className="exec-comparison">{change < 0 ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />} {change === 0 ? "No change from the prior period" : reportHours(Math.abs(change)) + " h " + (change > 0 ? "more" : "less") + " than the prior period"}</p>}
        </> : <p className="secure-muted">No published delivery history is available.</p>}
        {planned > 0 && <p className="exec-planned"><b>{reportHours(againstPlan)} h</b> of {reportHours(planned)} h planned across projects with monthly targets.</p>}
      </section>
      <section className="exec-panel">
        <span className="exec-panel-icon"><CalendarDays size={17} aria-hidden="true" /></span>
        <h3>Upcoming milestones</h3>
        {milestones.length ? <ul className="exec-activity">
          {milestones.map(m => <li key={m.projectId + ":" + m.id}><time dateTime={m.date}>{reportDay(m.date)}</time><div><b>{m.title}</b><span>{m.project}</span></div></li>)}
        </ul> : <p className="secure-muted">No upcoming milestones have been published.</p>}
      </section>
      <section className="exec-panel exec-brief">
        <h3>Executive notes</h3>
        {portfolio?.narrative || portfolio?.action ? <>
          {portfolio.narrative && <p className="exec-copy">{portfolio.narrative}</p>}
          {portfolio.action && <p className="exec-copy"><b>Next decision</b><br />{portfolio.action}</p>}
        </> : <p className="secure-muted">No executive notes have been published for this period.</p>}
        {paused.length > 0 && <p><b>Paused projects</b><br />{paused.map(p => p.name).join(", ")}</p>}
      </section>
    </div>
  </>;
}
