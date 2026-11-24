import { useState } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { clientDelivery, deadlineHorizons, deadlineWindow, forProjectFilter, type DeadlineHorizon, type ProjectFilter } from "./client-delivery";
import { projectStatus, reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { metricPercent, percentText } from "./insight-metrics";
import { TrendPlot } from "./ReportingPlots";
import "./client-intelligence.css";

type Delivery = ReturnType<typeof clientDelivery>;
export type EffortUnit = "percentage" | "hours";
export type OpenClientView = (view: string, month?: string, filter?: ProjectFilter) => void;

export function EffortToggle({ unit, onChange }: { unit: EffortUnit; onChange: (unit: EffortUnit) => void }) {
  return <div className="mi-insight-segments" role="group" aria-label="Effort display">
    <button type="button" aria-pressed={unit === "percentage"} onClick={() => onChange("percentage")}>Percentage</button>
    <button type="button" aria-pressed={unit === "hours"} onClick={() => onChange("hours")}>Hours</button>
  </div>;
}

export function DepartmentAnalytics({ report, delivery, unit, onLink }: {
  report: ProjectReport; delivery: Delivery; unit: EffortUnit; onLink: OpenClientView;
}) {
  const [mode, setMode] = useState<"effort" | "projects">("effort");
  const [status, setStatus] = useState<"all" | "active" | "completed" | "upcoming">("all");
  const effort = mode === "effort";
  const eligible = (item: Delivery["projectRows"][number]) => forProjectFilter(item, status, item.project.seconds);
  const measure = (projects: Delivery["projectRows"]) => projects.filter(eligible).reduce((total, item) => total + (effort ? item.project.seconds : 1), 0);
  const unassigned = (effort ? delivery.projectRows : delivery.projects).filter(item => !item.department);
  const departments = [
    ...delivery.departmentRows.map(item => ({ id: item.id, name: item.name, target: "area:" + item.id,
      value: measure(effort ? item.effortProjects : item.projects) })),
    { id: "unassigned", name: "No department", target: "projects", value: measure(unassigned) },
  ].filter(item => item.value > 0).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, "en-CA"));
  const total = departments.reduce((sum, item) => sum + item.value, 0);
  const amount = (value: number) => effort ? reportHours(value) + " h" : String(value);
  return <section className="mi-exec-panel mi-department-composition" aria-labelledby="department-effort-title">
    <div className="mi-exec-heading"><div><h3 id="department-effort-title">Department distribution</h3>
      <p>{effort ? reportMonth(report.month) + " · Approved allocation share" : "Approved delivery projects by department"}</p></div>
      <button type="button" className="exec-text-button" onClick={() => onLink("areas")}>Browse departments <ArrowUpRight size={16} aria-hidden="true" /></button>
    </div>
    <div className="mi-insight-controls">
      <div className="mi-insight-segments" role="group" aria-label="Department metric">
        <button type="button" aria-pressed={effort} onClick={() => setMode("effort")}>Effort allocation</button>
        <button type="button" aria-pressed={!effort} onClick={() => setMode("projects")}>Project count</button>
      </div>
      <label>Project status<select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
        <option value="all">All</option><option value="active">In progress</option><option value="completed">Completed</option><option value="upcoming">Upcoming</option>
      </select></label>
    </div>
    {total > 0 ? <ol className="mi-composition-rows">{departments.map(item => {
      const share = metricPercent(item.value, total)!;
      const detail = amount(item.value) + " of " + amount(total) + (effort ? " approved allocated effort in the selected scope" : " approved delivery projects in the selected scope");
      return <li key={item.id}><button type="button" aria-label={item.name + ", " + percentText(share) + ", " + detail}
        onClick={() => onLink(item.target, undefined, item.id === "unassigned" ? status === "all" ? "unassigned" : `unassigned-${status}` : status)}>
        <span>{item.name}<small>{detail}</small></span>
        <span className="mi-insight-bar" aria-hidden="true"><i style={{ inlineSize: share + "%" }} /></span>
        <b>{effort && unit === "percentage" ? percentText(share) : amount(item.value)}</b>
      </button></li>;
    })}</ol> : <p className="mi-cockpit-empty">{effort ? "No approved effort yet for this period." : "No approved delivery projects match this status."}</p>}
  </section>;
}

export function UpcomingDeadlines({ delivery, report, onLink }: { delivery: Delivery; report: ProjectReport; onLink: OpenClientView }) {
  const [showAll, setShowAll] = useState(false);
  const [horizon, setHorizon] = useState<DeadlineHorizon>(3);
  const { rows, unscheduled, through, completed } = deadlineWindow(delivery.projects, today(), horizon);
  return <section className="mi-exec-panel mi-deadline-panel" aria-labelledby="upcoming-deadlines">
    <div className="mi-exec-heading"><div><h3 id="upcoming-deadlines"><CalendarClock size={19} aria-hidden="true" /> Upcoming deadlines</h3>
      <p>Approved dates through {reportDay(through)} · Regina time</p></div></div>
    <div className="mi-insight-segments" role="group" aria-label="Deadline horizon">
      {deadlineHorizons.map(value => <button key={value} type="button" aria-pressed={horizon === value}
        onClick={() => { setShowAll(false); setHorizon(value); }}>{value} months</button>)}
    </div>
    <div aria-live="polite">
      {rows.length ? <ul className="mi-priority-list">{rows.slice(0, showAll ? rows.length : 5).map(item => {
        const managers = report.portfolio?.directory.filter(person => person.projectIds.includes(item.project.id) &&
          (item.delivery?.managerIds?.includes(person.id) || item.placement?.managerIds?.includes(person.id) || person.id === item.placement?.leadId)) ?? [];
        const urgency = item.days < 0 ? Math.abs(item.days) + " days overdue" :
          item.days === 0 ? "Due today" : item.days + (item.days === 1 ? " day remaining" : " days remaining");
        return <li key={item.project.id}><button type="button" data-alert={item.days < 0 || item.blocked || undefined}
          onClick={() => onLink("project:" + item.project.id)}>
          {item.days < 0 || item.blocked ? <CircleAlert size={17} aria-hidden="true" /> : <CalendarClock size={17} aria-hidden="true" />}
          <span><b>{item.project.name}</b>
            <small>{[item.parent?.name, item.department?.name, ...managers.map(person => person.name)].filter(Boolean).join(" · ")}</small>
            <small>{reportDay(item.due)} · {urgency} · {item.upcoming ? "Upcoming" : projectStatus[item.active ? "active" : item.project.status]}{item.blocked ? " · Blocked" : ""}</small></span>
          <ArrowUpRight size={15} aria-hidden="true" />
        </button></li>;
      })}</ul> : <p className="mi-cockpit-empty">No approved deadlines in this window.</p>}
      {rows.length > 5 && <button type="button" className="exec-text-button" aria-expanded={showAll}
        onClick={() => setShowAll(value => !value)}>{showAll ? "Show fewer deadlines" : "Show all " + rows.length + " deadlines"}</button>}
      {unscheduled > 0 && <p className="mi-cockpit-empty">{unscheduled} {unscheduled === 1 ? "project has" : "projects have"} no published deadline.</p>}
    </div>
    {completed.length > 0 && <details><summary>Delivery against published deadlines</summary>
      <ul>{completed.map(item => <li key={item.id}><button className="exec-text-button" type="button" onClick={() => onLink("project:" + item.id)}>
        {item.name} · {item.late ? "Completed after target" : "Completed on time"} <ArrowUpRight size={15} aria-hidden="true" />
      </button></li>)}</ul>
    </details>}
  </section>;
}

export function MonthlyEffort({ report, delivery, unit, onLink }: { report: ProjectReport; delivery: Delivery; unit: EffortUnit; onLink: OpenClientView }) {
  const [areaId, setArea] = useState("");
  const [projectId, setProject] = useState("");
  const [hovered, setHovered] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const portfolioHistory = report.portfolio?.history ?? [];
  const members = areaId ? delivery.departmentRows.find(item => item.id === areaId)?.effortProjects ?? [] : delivery.projectRows;
  const scope = members.filter(item => !projectId || item.project.id === projectId);
  const filtered = Boolean(areaId || projectId);
  const byMonth = new Map<string, number>();
  if (filtered) {
    for (const member of scope) {
      for (const entry of report.historyByProject?.[member.project.id] ?? [])
        byMonth.set(entry.month, (byMonth.get(entry.month) ?? 0) + entry.seconds);
    }
    byMonth.set(report.month, scope.reduce((sum, item) => sum + item.project.seconds, 0));
  }
  const history = new Map(portfolioHistory.map(item => [item.month, item.seconds]));
  history.set(report.month, report.totalSeconds);
  const rows = [...history].sort(([a], [b]) => a.localeCompare(b)).map(([month, total]) => {
    const seconds = filtered ? byMonth.get(month) ?? 0 : total;
    return { id: month, month, label: reportMonth(month), seconds, total, share: metricPercent(seconds, total) };
  });
  const comparable = unit === "percentage" ? rows.filter(row => row.share !== undefined) : rows;
  const visible = comparable.slice(-24);
  const active = visible.find(row => row.id === selected) ?? visible.find(row => row.id === report.month) ?? visible.at(-1);
  const inspected = visible.find(row => row.id === hovered) ?? active;
  const cap = projectId ? scope[0]?.delivery : undefined;
  const utilized = cap?.monthlyCap !== undefined && cap.monthlyCapUsed !== undefined
    ? metricPercent(cap.monthlyCapUsed, cap.monthlyCap) : undefined;
  const value = (row: typeof rows[number]) => unit === "hours" ? reportHours(row.seconds) + " h" :
    row.share === undefined ? "Not applicable" : percentText(row.share);
  return <section className="mi-exec-panel mi-monthly-effort" aria-label="Monthly approved effort">
    <div className="mi-exec-heading"><div><h3>Monthly approved effort</h3>
      <p>{unit === "percentage" ? "Share of all approved portfolio effort in each month" : "Approved allocated hours in each month"}</p></div></div>
    <div className="mi-insight-controls">
      <label>Effort department<select value={areaId} onChange={event => { setArea(event.target.value); setProject(""); }}>
        <option value="">All departments</option>{delivery.departmentRows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Effort project<select value={projectId} onChange={event => setProject(event.target.value)}>
        <option value="">All projects in scope</option>{members.map(item => <option key={item.project.id} value={item.project.id}>{item.project.name}</option>)}
      </select></label>
    </div>
    {inspected && active ? <>
      <TrendPlot label="Monthly approved allocation" unit={unit === "hours" ? "hours" : "percent"} rows={visible.map(row => ({
        id: row.id, month: row.month, label: row.label, value: unit === "hours" ? row.seconds : row.share!,
      }))} active={active.id} onSelect={setSelected} onInspect={setHovered} />
      <p aria-live="polite"><b>{inspected.label} · {value(inspected)}</b> · {reportHours(inspected.seconds)} of {reportHours(inspected.total)} approved h</p>
      <button type="button" className="exec-text-button" onClick={() => onLink(projectId ? "project:" + projectId : areaId ? "area:" + areaId : "projects", active.month)}>
        Open {active.label} detail <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </> : <p>No approved effort is available to compare in this scope.</p>}
    {projectId && <p><strong>{reportMonth(report.month)} cap utilization</strong> {cap?.monthlyCap === undefined ? "No published cap" :
      utilized === undefined ? "Not applicable" : percentText(utilized)}{cap?.monthlyCap !== undefined && cap.monthlyCapUsed !== undefined &&
      " · " + reportHours(cap.monthlyCapUsed) + " of " + reportHours(cap.monthlyCap) + " h against the published cap"}</p>}
    <details><summary>Show approved monthly effort table</summary>
      <table><caption>Approved effort by month for the selected scope</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Hours</th><th scope="col">Portfolio hours</th><th scope="col">Share</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{reportHours(row.seconds)}</td><td>{reportHours(row.total)}</td>
          <td>{row.share === undefined ? "Not applicable" : percentText(row.share)}</td></tr>)}</tbody>
      </table>
    </details>
  </section>;
}
