import { ArrowUpRight, Presentation } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { ContextHelp } from "./ContextHelp";
import { chartKinds, DotChart, DotField, dotScale, type ChartKind } from "./DotAnalytics";
import { reportDay, reportHours, reportMonth, reportTimestamp } from "./dashboard-format";

export function ExecutiveOverview({ report, onPresentation, onLink, onChart }: {
  report: ProjectReport;
  onPresentation: () => void;
  onLink: (view: string, month?: string) => void;
  onChart: (kind: ChartKind) => void;
}) {
  const { portfolio, projects } = report;
  const period = reportMonth(report.month);
  const milestones = projects.flatMap(p => (p.milestones ?? []).filter(m => !m.completed && m.date >= report.month + "-01")
    .map(m => ({ ...m, project: p.name, projectId: p.id })))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const archived = new Set(portfolio?.placements.filter(p => p.archived).map(p => p.id));
  const active = projects.filter(p => !archived.has(p.id));
  const lastMonth = portfolio?.history.at(-1);
  const change = lastMonth && report.totalSeconds - lastMonth.seconds;
  const ceiling = Math.max(1, report.totalSeconds, lastMonth?.seconds ?? 0);
  return <>
    <section className="intel-hero" aria-labelledby="executive-title">
      <div className="intel-hero-copy">
        <span className="exec-kicker">{period}</span>
        <h2 id="executive-title">Leadership<br />summary</h2>
        <p>{report.tenant.name}</p>
        <button className="exec-hero-action" type="button" onClick={onPresentation}><Presentation size={18} aria-hidden="true" /> At a Glance</button>
      </div>
      <div className="intel-hero-delivery" aria-label="Published portfolio summary">
        <div className="intel-hero-label">Allocated hours · {period}<ContextHelp label="How are allocated hours calculated?">Only reporting allocations approved for the projects you can see contribute to this figure.</ContextHelp></div>
        <strong>{reportHours(report.totalSeconds)} h</strong>
        <DotField value={report.totalSeconds} unit={dotScale(ceiling, 80)} capacity={80} />
        <p>{change === undefined ? "Prior month unavailable" : change === 0 ? "No change from the prior month" : reportHours(Math.abs(change)) + " h " + (change > 0 ? "more" : "less") + " than the prior month"}</p>
      </div>
    </section>
    <section className="intel-pulse" aria-label="Delivery at a glance">
      {([["Active projects", active.filter(p => p.status === "active").length, "active"], ["Completed projects", projects.filter(p => p.status === "completed").length, "completed"], ["Upcoming work", active.filter(p => p.status === "planned").length, "planned"]] as const)
        .map(([label, value, status]) => <button key={label} className="intel-pulse-item" type="button" onClick={() => onLink("projects:" + status)}>
          <span>{label}</span><b>{value}</b><ArrowUpRight size={16} aria-hidden="true" />
        </button>)}
      {report.sourceUpdatedAt && <p className="intel-freshness">Source updated <time dateTime={report.sourceUpdatedAt}>{reportTimestamp(report.sourceUpdatedAt)}</time></p>}
    </section>
    <section className="intel-analysis" aria-label="Delivery analysis">
      {chartKinds.map(kind => <DotChart key={kind} report={report} kind={kind} onLink={onLink} onOpen={() => onChart(kind)} />)}
    </section>
    <section className="intel-editorial" aria-label="Delivery stories">
      <div><h3>Upcoming milestones</h3>
        {milestones.length ? <ul className="exec-activity">{milestones.map(m => <li key={m.projectId + ":" + m.id}>
          <time dateTime={m.date}>{reportDay(m.date)}</time><div>
            <button className="exec-text-button" onClick={() => onLink("milestone:" + m.projectId + ":" + m.id)}>{m.title}</button><span>{m.project}</span>
          </div></li>)}</ul> : <p>No upcoming milestones have been published.</p>}
        <button type="button" className="exec-text-button" onClick={() => onLink("milestones")}>View milestones</button>
      </div>
      <div><h3>Executive notes</h3>
        {portfolio?.narrative || portfolio?.action ? <><p>{(portfolio.narrative || portfolio.action).slice(0, 175)}{(portfolio.narrative || portfolio.action).length > 175 && "…"}</p>
          {portfolio.action && <p><b>Next decision</b> · {portfolio.action}</p>}
          <button type="button" className="exec-text-button" onClick={() => onLink("notes")}>Read executive notes</button></>
          : <p>No executive notes have been published for this period.</p>}
      </div>
    </section>
  </>;
}
