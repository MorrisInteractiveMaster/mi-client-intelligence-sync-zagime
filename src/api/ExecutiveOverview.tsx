import { ArrowUpRight, CircleAlert, ClipboardCheck, FolderKanban, Presentation, Timer } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { deliveryDefaults, rollup } from "../projects/delivery";
import { previousReportingMonth } from "../projects/portfolio";
import { ContextHelp } from "./ContextHelp";
import { chartKinds, chartRows, DotChart, type ChartKind } from "./DotAnalytics";
import { reportDay, reportHours, reportMonth, reportTimestamp, today } from "./dashboard-format";
import { Sparkline } from "./ReportingPlots";

export function ExecutiveOverview({ report, onPresentation, onLink, onChart, platform, draft }: {
  report: ProjectReport;
  onPresentation: () => void;
  onLink: (view: string, month?: string) => void;
  onChart: (kind: ChartKind) => void;
  platform?: boolean;
  draft?: boolean;
}) {
  const { portfolio, projects, hierarchy = {} } = report;
  const period = reportMonth(report.month);
  const currentDate = today().slice(0, 7) === report.month ? today() : report.month + "-01";
  const milestones = projects.flatMap(p => (p.milestones ?? []).filter(m => !m.completed && m.status !== "waived" && m.date >= currentDate)
    .map(m => ({ ...m, project: p.name, projectId: p.id }))).sort((a, b) => a.date.localeCompare(b.date));
  const archived = new Set(portfolio?.placements.filter(p => p.archived).map(p => p.id));
  const active = projects.filter(p => !archived.has(p.id) && p.status === "active");
  const completed = projects.filter(p => p.status === "completed");
  const blockers = projects.filter(p => hierarchy[p.id]?.blocker?.active);
  const lastMonth = portfolio?.history.find(row => row.month === previousReportingMonth(report.month));
  const change = report.totalSeconds - (lastMonth?.seconds ?? 0);
  const comparison = !lastMonth ? "Prior month unavailable" : change === 0 ? "No change from the prior month"
    : reportHours(Math.abs(change)) + " h " + (change > 0 ? "more" : "less") + " than " + reportMonth(lastMonth.month);
  const trend = chartRows(report, "trend").filter(row => row.id <= report.month).slice(-8);
  const delegated = rollup(projects.map(p => ({ ...p, delivery: { ...deliveryDefaults, parentId: hierarchy[p.id]?.parentId } })));
  const leading = projects.filter(project => hierarchy[project.id]?.kind === "engagement")
    .map(project => ({ project, seconds: delegated.get(project.id)?.monthly ?? 0 }))
    .sort((a, b) => b.seconds - a.seconds)[0];
  const capWatch = projects.filter(project => {
    const budget = hierarchy[project.id];
    return budget?.monthlyCap !== undefined && budget.monthlyCap > 0 &&
      budget.monthlyCapUsed !== undefined && budget.monthlyCapUsed / budget.monthlyCap >= .8;
  });
  const signals = [
    { label: "In progress", value: active.length, icon: FolderKanban, action: "projects:active" },
    { label: "Completed projects", value: completed.length, icon: ClipboardCheck, action: "projects:completed" },
    { label: "Open blockers", value: blockers.length, icon: CircleAlert, action: blockers.length === 1 ? "project:" + blockers[0].id : "projects" },
    { label: "Upcoming milestones", value: milestones.length, icon: Timer, action: "milestones" },
  ];
  const narrative = portfolio?.narrative || portfolio?.action;
  return <div className="mi-leadership">
    <section className="mi-leadership-cover" aria-labelledby="executive-title">
      <div className="mi-leadership-copy">
        <time dateTime={report.month} className="exec-kicker">{period}</time>
        <h2 id="executive-title">Leadership summary</h2>
        <p className="mi-leadership-client">{report.tenant.name}</p>
        {leading && leading.seconds > 0 && <p className="mi-leadership-insight">
          <button type="button" className="mi-hero-text" onClick={() => onLink("group:" + leading.project.id)}>{leading.project.name}</button>
          {" led reported effort this period with " + reportHours(leading.seconds) + " h."}
        </p>}
        <div className="mi-leadership-actions">
          <button className="mi-hero-primary" type="button" onClick={onPresentation}><Presentation size={18} aria-hidden="true" />
            {platform ? "Open presentation" : "At a Glance"}
          </button>
          {platform && <button className="mi-hero-secondary" type="button" onClick={() => onLink("engagements")}>
            Explore engagements <ArrowUpRight size={17} aria-hidden="true" />
          </button>}
        </div>
      </div>
      <div className="mi-leadership-metric" aria-label="Published portfolio summary">
        <div>Reported effort<ContextHelp label="How are reported hours calculated?">Hours include classified work and remaining time recorded against published work orders you can see.</ContextHelp></div>
        {projects.length ? <>
          <strong>{reportHours(report.totalSeconds)} <small>h</small></strong>
          <Sparkline rows={trend.map(row => ({ ...row, value: row.seconds }))} />
          <p>{comparison}</p>
        </> : <p>No approved effort is available for this period.</p>}
      </div>
    </section>
    <section className="mi-delivery-signals" aria-label="Delivery at a glance">
      {signals.map(({ label, value, icon: Icon, action }) => <button key={label} className="mi-delivery-signal" type="button" onClick={() => onLink(action)}>
        <Icon size={18} aria-hidden="true" /><span>{label}</span><b>{value}</b><ArrowUpRight size={16} aria-hidden="true" />
      </button>)}
    </section>
    {report.sourceUpdatedAt && <p className="mi-source-freshness">Source updated <time dateTime={report.sourceUpdatedAt}>{reportTimestamp(report.sourceUpdatedAt)}</time></p>}
    <section className="mi-leadership-analysis" aria-label="Delivery analysis">
      {chartKinds.filter(kind => kind !== "plan" || chartRows(report, kind).length > 0)
        .map(kind => <DotChart key={kind} report={report} kind={kind} draft={draft} onLink={onLink} onOpen={() => onChart(kind)} />)}
    </section>
    <section className="mi-leadership-brief" aria-label="Delivery stories">
      <div><h3>Upcoming milestones</h3>
        {milestones.length ? <ul className="exec-activity">{milestones.slice(0, 4).map(m => <li key={m.projectId + ":" + m.id}>
          <time dateTime={m.date}>{reportDay(m.date)}</time><div>
            <button type="button" className="exec-text-button" onClick={() => onLink("milestone:" + m.projectId + ":" + m.id)}>{m.title}</button><span>{m.project}</span>
          </div></li>)}</ul> : <p>No upcoming milestones have been published.</p>}
        <button type="button" className="exec-text-button" onClick={() => onLink("milestones")}>View milestones</button>
      </div>
      <div><h3>Executive notes</h3>
        {narrative ? <><p>{narrative.length > 175 ? narrative.slice(0, 175) + "…" : narrative}</p>
          <button type="button" className="exec-text-button" onClick={() => onLink("notes")}>Read executive notes</button></>
          : <p>No executive notes have been published for this period.</p>}
        {capWatch.length > 0 && <p>{capWatch.length} {capWatch.length === 1 ? "project has" : "projects have"} used at least 80% of the published monthly cap.</p>}
      </div>
      {blockers.length > 0 && <div className="mi-leadership-blockers"><h3><CircleAlert size={18} aria-hidden="true" /> Delivery risks</h3>
        <ul>{blockers.slice(0, 4).map(project => <li key={project.id}>
          <button type="button" className="exec-text-button" onClick={() => onLink("project:" + project.id)}>{project.name}</button>
          {hierarchy[project.id].blocker?.message && <p>{hierarchy[project.id].blocker?.message}</p>}
        </li>)}</ul>
      </div>}
    </section>
  </div>;
}
