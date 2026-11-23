import { ArrowUpRight, CalendarClock, CircleAlert, ClipboardCheck, FolderKanban, Layers3, Presentation } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { clientDelivery, type ProjectFilter } from "./client-delivery";
import { ParentEngagementCard } from "./ClientDeliverySummary";
import { ContextHelp } from "./ContextHelp";
import { DotChart, type ChartKind } from "./DotAnalytics";
import { axisMaximum } from "./reporting-chart-data";
import { reportDay, reportHours, reportMonth, reportTimestamp, today } from "./dashboard-format";

export function ExecutiveOverview({ report, delivery, onPresentation, onLink, onChart, platform, draft }: {
  report: ProjectReport;
  delivery: ReturnType<typeof clientDelivery>;
  onPresentation: () => void;
  onLink: (view: string, month?: string, filter?: ProjectFilter) => void;
  onChart: (kind: ChartKind) => void;
  platform?: boolean;
  draft?: boolean;
}) {
  const { portfolio, projects } = report;
  const { counts, parentRows, departmentRows, progress, risks } = delivery;
  const period = reportMonth(report.month);
  const leading = departmentRows.find(row => row.seconds > 0);
  const maximum = axisMaximum(departmentRows[0]?.seconds ?? 0);
  const displayDate = today();
  const milestones = projects.flatMap(p => (p.milestones ?? []).filter(m => !m.completed && m.status !== "waived" && m.date >= displayDate)
    .map(m => ({ ...m, project: p.name, projectId: p.id }))).sort((a, b) => a.date.localeCompare(b.date));
  const signals = [
    { label: "In progress", value: counts.active, icon: FolderKanban, action: "projects:active" },
    { label: "Completed", value: counts.completed, icon: ClipboardCheck, action: "projects:completed" },
    { label: "Upcoming", value: counts.upcoming, icon: CalendarClock, action: "projects:upcoming" },
    { label: "Parent engagements", value: parentRows.length, icon: Layers3, action: "projects" },
  ];
  const near = progress.filter(item => item.near).slice(0, 5);
  const narrative = portfolio?.narrative || portfolio?.action;

  return <div className="mi-leadership">
    <section className="mi-leadership-cover mi-project-first" aria-labelledby="executive-title">
      <div className="mi-leadership-copy">
        <time dateTime={report.month} className="exec-kicker">{period}</time>
        <h2 id="executive-title">Leadership summary</h2>
        <p className="mi-leadership-client">{report.tenant.name}</p>
        <div className="mi-leadership-actions">
          <button className="mi-hero-primary" type="button" onClick={() => onLink("projects")}>Explore projects <ArrowUpRight size={17} aria-hidden="true" /></button>
          {!platform && <button className="mi-hero-secondary" type="button" onClick={onPresentation}><Presentation size={18} aria-hidden="true" />At a Glance</button>}
        </div>
      </div>
      <div className="mi-leadership-metric" aria-label="All-time delivery projects">
        <div>All-time approved portfolio</div>
        <strong>{counts.all}</strong>
        <p>{counts.all === 1 ? "Delivery project" : "Delivery projects"}</p>
        {leading && <p className="mi-leading-department">
          <button type="button" className="mi-hero-text" onClick={() => onLink("area:" + leading.id)}>{leading.name}</button>
          {" led " + period + " by attributable hours · " + reportHours(leading.seconds) + " h"}
        </p>}
      </div>
    </section>
    <section className="mi-delivery-signals" aria-label="Delivery at a glance">
      {signals.map(({ label, value, icon: Icon, action }) => <button key={label} className="mi-delivery-signal" type="button" onClick={() => onLink(action)}>
        <Icon size={18} aria-hidden="true" /><span>{label}</span><b>{value}</b><ArrowUpRight size={16} aria-hidden="true" />
      </button>)}
    </section>

    {parentRows.length > 0 && <section className="mi-exec-panel" aria-labelledby="parent-delivery-title">
      <div className="mi-exec-heading"><div><h3 id="parent-delivery-title">Parent engagements</h3><p>Delivery projects and approved effort by engagement.</p></div>
        <button type="button" className="exec-text-button" onClick={() => onLink("projects")}>View portfolio <ArrowUpRight size={16} aria-hidden="true" /></button>
      </div>
      <div className="mi-engagement-grid">{parentRows.map(engagement => <ParentEngagementCard key={engagement.id} engagement={engagement} period={period}
        onOpen={() => onLink("group:" + engagement.id)} onFilter={filter => onLink("group:" + engagement.id, undefined, filter)} />)}</div>
    </section>}

    <section className="mi-exec-panel mi-department-brief" aria-labelledby="department-effort-title">
      <div className="mi-exec-heading"><div><h3 id="department-effort-title">Department effort</h3>
        <p>{period} · Hours attributed to approved delivery projects</p></div>
        {departmentRows.length > 0 && <button type="button" className="exec-text-button" onClick={() => onLink("areas")}>Browse departments <ArrowUpRight size={16} aria-hidden="true" /></button>}
      </div>
      {departmentRows.length ? <div className="mi-department-chart">
        <div className="mi-department-axis" aria-hidden="true"><span>Department</span>
          <div>{[0, .25, .5, .75, 1].map(step => <span key={step}>{reportHours(step * maximum)}</span>)}</div><span>Hours</span></div>
        <ol className="mi-exec-rows">{departmentRows.map((row, _index, rows) => {
          const rank = rows.findIndex(item => item.seconds === row.seconds) + 1;
          return <li key={row.id}><button type="button" className="mi-department-row" onClick={() => onLink("area:" + row.id)}
            aria-label={row.name + ", " + reportHours(row.seconds) + " hours, " + row.counts.all + " delivery projects" + (row.seconds > 0 ? ", rank " + rank : "")}>
            <span><b>{row.name}</b><small>{row.seconds > 0 ? rank + " · " : ""}{row.counts.all} {row.counts.all === 1 ? "project" : "projects"}</small></span>
            <span className="mi-scale-track" aria-hidden="true"><i style={{ width: 100 * row.seconds / maximum + "%" }} /></span>
            <strong>{reportHours(row.seconds)} h</strong>
          </button></li>;
        })}</ol>
      </div> : <p className="intel-empty">No departments are available in this approved report.</p>}
      <div className="mi-secondary-effort" aria-label="Published portfolio summary">
        <span>Reported effort · {period} <ContextHelp label="How are reported hours calculated?">Reported effort includes classifications and any remaining time recorded against published work orders you can see. Department hours include approved project classifications only.</ContextHelp></span>
        <strong>{reportHours(report.totalSeconds)} h</strong>
        {report.sourceUpdatedAt && <span>Source updated <time dateTime={report.sourceUpdatedAt}>{reportTimestamp(report.sourceUpdatedAt)}</time></span>}
        {projects.length > 0 && <button type="button" className="exec-text-button" onClick={() => onChart("distribution")}>Explore reported hours<span className="exec-sr-only"> by department</span></button>}
      </div>
    </section>

    <section className="mi-leadership-queues" aria-label="Delivery priorities">
      <article className="mi-exec-panel mi-priority-panel" data-priority="near">
        <h3>Nearing completion</h3>
        <p>At least 70% complete, with work still remaining.</p>
        {near.length ? <ol className="mi-exec-rows">{near.map(item => <li key={item.project.id}>
          <button type="button" className="mi-priority-row" onClick={() => onLink("project:" + item.project.id)}>
            <span><b>{item.project.name}</b>{item.blocked && <small data-risk="true">Blocked</small>}</span>
            <strong>{item.completion}%</strong>
          </button>
        </li>)}</ol> : <p className="intel-empty">No approved delivery projects are in this range.</p>}
      </article>
      <article className="mi-exec-panel mi-priority-panel" data-priority="risk">
        <h3>Blocked or overdue</h3>
        <p>Open blockers first, then the earliest overdue work.</p>
        {risks.length ? <ol className="mi-exec-rows">{risks.slice(0, 5).map(item => <li key={item.project.id}>
          <button type="button" className="mi-priority-row" onClick={() => onLink("project:" + item.project.id)}>
            <span><b>{item.project.name}</b><small> {item.risk}</small></span>
            <strong><CircleAlert size={14} aria-hidden="true" /> {item.blocked ? "Blocked" : "Overdue"}</strong>
          </button>
        </li>)}</ol> : <p className="intel-empty">No approved blockers or overdue dates are recorded.</p>}
      </article>
    </section>

    <section className="mi-exec-panel" aria-labelledby="progress-comparison-title">
      <div className="mi-exec-heading"><div><h3 id="progress-comparison-title">Work completion by project</h3><p>Approved milestones or a recorded completion assessment.</p></div>
        {counts.all > 0 && <button type="button" className="exec-text-button" onClick={() => onLink("projects")}>All delivery projects <ArrowUpRight size={16} aria-hidden="true" /></button>}
      </div>
      {progress.length ? <ol className="mi-exec-rows mi-progress-comparison">{progress.map(item => <li key={item.project.id}>
        <button type="button" className="mi-department-row" onClick={() => onLink("project:" + item.project.id)}
          aria-label={item.project.name + ", " + item.completion + "% work completion" + (item.blocked ? ", blocked" : "")}
          data-progress-tone={item.blocked ? "risk" : item.completed ? "complete" : item.near ? "near" : undefined}>
          <span><b>{item.project.name}</b><small>{item.blocked ? "Blocked" : item.department?.name ?? item.parent?.name}</small></span>
          <span className="mi-scale-track" aria-hidden="true"><i style={{ width: item.completion + "%" }} /></span><strong>{item.completion}%</strong>
        </button>
      </li>)}</ol> : <p className="intel-empty">No approved work-completion assessments have been recorded.</p>}
    </section>
    <DotChart report={report} kind="trend" draft={draft} onLink={onLink} onOpen={() => onChart("trend")} />
    {(milestones.length > 0 || narrative) && <section className="mi-leadership-brief" aria-label="Delivery stories">
      {milestones.length > 0 && <div><h3>Upcoming milestones</h3>
        <ul className="exec-activity">{milestones.slice(0, 4).map(m => <li key={m.projectId + ":" + m.id}>
          <time dateTime={m.date}>{reportDay(m.date)}</time><div>
            <button type="button" className="exec-text-button" onClick={() => onLink("milestone:" + m.projectId + ":" + m.id)}>{m.title}</button><span>{m.project}</span>
          </div>
        </li>)}</ul>
      </div>}
      {narrative && <div><h3>Executive notes</h3><p>{narrative.length > 175 ? narrative.slice(0, 175) + "…" : narrative}</p>
        <button type="button" className="exec-text-button" onClick={() => onLink("notes")}>Read executive notes</button></div>}
    </section>}
  </div>;
}
