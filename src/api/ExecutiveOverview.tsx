import { ArrowUpRight, CalendarClock, CircleAlert, ClipboardCheck, FolderKanban, Presentation } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { clientDelivery, publishedMonthlyCap, type ProjectFilter } from "./client-delivery";
import { ParentEngagementCard } from "./ClientDeliverySummary";
import { DeliveryTrends, ProgressArc, StatusComposition } from "./ClientCockpitVisuals";
import { DepartmentAnalytics, EffortToggle, MonthlyEffort, UpcomingDeadlines, type EffortUnit } from "./ClientIntelligence";
import { ContextHelp } from "./ContextHelp";
import { DotChart, type ChartKind } from "./DotAnalytics";
import { metricPercent, percentText } from "./insight-metrics";
import { reportDay, reportHours, reportMonth, reportTimestamp, today } from "./dashboard-format";

type Delivery = ReturnType<typeof clientDelivery>;
type OpenView = (view: string, month?: string, filter?: ProjectFilter) => void;

export function ExecutiveOverview({ report, delivery, onPresentation, onLink, onChart, platform, draft, effortUnit, onEffortUnit }: {
  report: ProjectReport;
  delivery: Delivery;
  onPresentation: (trigger: HTMLButtonElement) => void;
  onLink: OpenView;
  onChart: (kind: ChartKind, trigger: HTMLButtonElement) => void;
  platform?: boolean;
  draft?: boolean;
  effortUnit: EffortUnit;
  onEffortUnit: (unit: EffortUnit) => void;
}) {
  const { portfolio, projects } = report;
  const { counts, parentRows, progress, risks, unaffiliated } = delivery;
  const period = reportMonth(report.month);
  const monthlyCap = publishedMonthlyCap(delivery);
  const utilization = metricPercent(monthlyCap.used, monthlyCap.cap);
  const displayDate = today();
  const milestones = projects.flatMap(p => (p.milestones ?? []).filter(m => !m.completed && m.status !== "waived" && m.date >= displayDate)
    .map(m => ({ ...m, project: p.name, projectId: p.id }))).sort((a, b) => a.date.localeCompare(b.date));
  const signals = [
    { label: "Approved projects", value: counts.all, icon: FolderKanban, filter: "all", tone: "active" },
    { label: "In progress", value: counts.active, icon: FolderKanban, filter: "active", tone: "active" },
    { label: "Upcoming", value: counts.upcoming, icon: CalendarClock, filter: "upcoming", tone: "upcoming" },
    { label: "Completed", value: counts.completed, icon: ClipboardCheck, filter: "completed", tone: "complete" },
    { label: "Blocked", value: counts.blocked, icon: CircleAlert, filter: "blocked", tone: "risk" },
    { label: "Deadlines approaching", value: delivery.projects.filter(item => item.dueSoon).length, icon: CalendarClock, filter: "due-soon", tone: "upcoming" },
  ] as const;
  const openFilter = (filter: ProjectFilter) => onLink("projects", undefined, filter);
  const narrative = portfolio?.narrative || portfolio?.action;

  return <div className="mi-client-cockpit">
    <section className="mi-cockpit-hero" aria-labelledby="executive-title">
      <div className="mi-cockpit-intro">
        <p>{report.tenant.name} <span aria-hidden="true">·</span> <time dateTime={report.month}>{period}</time></p>
        <h2 id="executive-title">Leadership summary</h2>
        <p className="mi-cockpit-hero-detail">
          {parentRows.length} {parentRows.length === 1 ? "parent project" : "parent projects"}
          {delivery.departmentRows.length > 0 && " · " + delivery.departmentRows.length + (delivery.departmentRows.length === 1 ? " approved department" : " approved departments")}
        </p>
        <div className="mi-cockpit-actions">
          <button className="mi-cockpit-primary" type="button" onClick={() => onLink("projects")}>Explore projects <ArrowUpRight size={16} aria-hidden="true" /></button>
          {!platform && <button className="mi-cockpit-secondary" type="button" onClick={event => onPresentation(event.currentTarget)}><Presentation size={16} aria-hidden="true" />At a Glance</button>}
        </div>
      </div>
      <div className="mi-cockpit-portfolio" aria-label="All-time delivery projects">
        <p>All-time approved portfolio</p>
        <StatusComposition counts={counts} onFilter={openFilter} />
      </div>
    </section>

    <section className="mi-cockpit-signals" aria-label="Delivery at a glance">
      {signals.map(({ label, value, icon: Icon, filter, tone }) => <button key={filter} type="button" data-tone={tone} onClick={() => openFilter(filter)}>
        <span className="mi-signal-glyph"><Icon size={18} aria-hidden="true" /></span>
        <span><small>{label}</small><strong>{value}</strong></span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>)}
    </section>

    <section className="mi-exec-panel mi-effort-summary" aria-label="Published portfolio summary">
      <div><span>Reported effort · {period} <ContextHelp label="How are reported hours calculated?">Approved project allocations in this period are counted once across the departments and projects you can see.</ContextHelp></span>
        <strong>{reportHours(report.totalSeconds)} h</strong>
        {report.sourceUpdatedAt && <small>Source updated <time dateTime={report.sourceUpdatedAt}>{reportTimestamp(report.sourceUpdatedAt)}</time></small>}
      </div>
      <EffortToggle unit={effortUnit} onChange={onEffortUnit} />
      {report.totalSeconds > 0 && <button type="button" className="exec-text-button" onClick={event => onChart("distribution", event.currentTarget)}>Explore reported hours<span className="exec-sr-only"> by department</span><ArrowUpRight size={16} aria-hidden="true" /></button>}
    </section>
    <section className="mi-exec-panel mi-effort-summary" aria-label="Monthly cap utilization">
      <div><span>Monthly cap utilization · {period} <ContextHelp label="How is monthly cap utilization calculated?">Approved cap-consumed seconds divided by published caps. When a parent has a cap, nested caps are omitted from this portfolio comparison.</ContextHelp></span>
        <strong>{!monthlyCap.count ? "No published cap" : effortUnit === "hours" ? reportHours(monthlyCap.used) + " of " + reportHours(monthlyCap.cap) + " h" :
          utilization === undefined ? "Not applicable" : percentText(utilization)}</strong>
        {monthlyCap.count > 0 && <small>{monthlyCap.count} {monthlyCap.count === 1 ? "published limit" : "published limits"} · Uncapped work is excluded</small>}
      </div>
      <button type="button" className="exec-text-button" onClick={event => onChart("plan", event.currentTarget)}>Review hours and caps <ArrowUpRight size={16} aria-hidden="true" /></button>
    </section>
    <div className="mi-cockpit-analysis mi-insight-grid">
      <DeliveryTrends counts={counts} projects={delivery.projects} onFilter={openFilter} onProject={id => onLink("project:" + id)} />
      <DepartmentAnalytics report={report} delivery={delivery} unit={effortUnit} onLink={onLink} />
      <UpcomingDeadlines delivery={delivery} report={report} onLink={onLink} />
        <section className="mi-exec-panel mi-cockpit-priorities" aria-labelledby="priority-heading">
          <div className="mi-exec-heading"><div><h3 id="priority-heading">Decision priorities</h3><p>Open blockers and overdue work</p></div></div>
          {risks.length ? <ul className="mi-priority-list">{risks.slice(0, 4).map(item => <li key={item.project.id}>
            <button type="button" onClick={() => onLink("project:" + item.project.id)}>
              <CircleAlert size={17} aria-hidden="true" /><span><b>{item.project.name}</b><small>{item.risk}</small></span><ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </li>)}</ul> : <p className="mi-cockpit-empty">No approved blockers or overdue work recorded.</p>}
          {milestones.length > 0 && <ul className="mi-priority-list mi-priority-calendar">{milestones.slice(0, 3).map(milestone => <li key={milestone.projectId + ":" + milestone.id}>
            <button type="button" onClick={() => onLink("milestone:" + milestone.projectId + ":" + milestone.id)}>
              <CalendarClock size={17} aria-hidden="true" /><span><b>{milestone.title}</b><small>{milestone.project} · {reportDay(milestone.date)}</small></span><ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </li>)}</ul>}
        </section>
      <WorkProgress projects={progress} onProject={id => onLink("project:" + id)} />
      <MonthlyEffort report={report} delivery={delivery} unit={effortUnit} onLink={onLink} />
    </div>

    {(parentRows.length > 0 || unaffiliated.length > 0) && <section className="mi-exec-panel mi-cockpit-engagements" aria-labelledby="parent-delivery-title">
      <div className="mi-exec-heading"><div><h3 id="parent-delivery-title">Parent engagements</h3><p>Approved delivery projects and effort grouped by parent.</p></div>
        <button type="button" className="exec-text-button" onClick={() => onLink("projects")}>View portfolio <ArrowUpRight size={16} aria-hidden="true" /></button>
      </div>
      {parentRows.length > 0 && <div className="mi-engagement-grid">{parentRows.map(engagement => <ParentEngagementCard key={engagement.id} engagement={engagement} period={period} reportSeconds={report.totalSeconds} exactEffort={effortUnit === "hours"}
        onOpen={() => onLink("group:" + engagement.id)} onFilter={filter => onLink("group:" + engagement.id, undefined, filter)} />)}</div>}
      {unaffiliated.length > 0 && <button type="button" className="exec-text-button mi-independent-projects" onClick={() => openFilter("unaffiliated")}>
        {unaffiliated.length} {unaffiliated.length === 1 ? "independent delivery project" : "independent delivery projects"} <ArrowUpRight size={15} aria-hidden="true" />
      </button>}
    </section>}

    <DotChart report={report} kind="trend" draft={draft} onLink={onLink} onOpen={trigger => onChart("trend", trigger)} />
    {narrative && <section className="mi-exec-panel" aria-label="Executive notes"><h3>Executive notes</h3>
      <p>{narrative.length > 175 ? narrative.slice(0, 175) + "…" : narrative}</p>
      <button type="button" className="exec-text-button" onClick={() => onLink("notes")}>Read executive notes</button>
    </section>}
  </div>;
}

export function WorkProgress({ projects, onProject, title = "Work completion by project" }: {
  projects: Delivery["projects"];
  onProject: (id: string) => void;
  title?: string;
}) {
  const rows = projects.filter(item => item.completion !== undefined).slice(0, 5);
  return <section className="mi-exec-panel mi-cockpit-progress" aria-label={title}>
    <div className="mi-exec-heading"><div><h3>{title}</h3><p>Based on approved milestones or a published completion assessment.</p></div></div>
    {rows.length ? <ol className="mi-progress-rows">{rows.map(item => <li key={item.project.id}>
      <button type="button" onClick={() => onProject(item.project.id)}>
        <ProgressArc value={item.completion} label="Work completion" detail="out of 100% of planned work" tone={item.blocked ? "risk" : item.completed ? "complete" : "active"} />
        <span><b>{item.project.name}</b>{(item.blocked || item.department || item.parent) && <small>{item.blocked ? "Blocked" : item.department?.name ?? item.parent?.name}</small>}</span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </li>)}</ol> : <p className="mi-cockpit-empty">No approved work-completion assessments recorded.</p>}
  </section>;
}
