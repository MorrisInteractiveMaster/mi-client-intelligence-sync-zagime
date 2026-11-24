import { useState } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { reportingTimeMonth } from "../projects/time-history";
import { clientDelivery, deadlineHorizons, deadlineWindow, forProjectFilter, type DeadlineHorizon, type ProjectFilter } from "./client-delivery";
import { projectStatus, reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { metricPercent, percentText } from "./insight-metrics";
import { portfolioStatuses } from "./ClientProjectExplorer";
import type { ExplorerScope } from "./project-explorer";
import { TrendPlot } from "./ReportingPlots";
import { monthlyEffort } from "./monthly-effort";
import { portalNavigate, usePortalLocation } from "./portal-location";
import "./client-intelligence.css";

type Delivery = ReturnType<typeof clientDelivery>;
export type EffortUnit = "percentage" | "hours";
export type OpenClientView = (view: string, month?: string, filter?: ProjectFilter, scope?: ExplorerScope) => void;

export function EffortToggle({ unit, onChange }: { unit: EffortUnit; onChange: (unit: EffortUnit) => void }) {
  return <div className="mi-insight-segments" role="group" aria-label="Effort display">
    <button type="button" aria-pressed={unit === "percentage"} onClick={() => onChange("percentage")}>Percentage</button>
    <button type="button" aria-pressed={unit === "hours"} onClick={() => onChange("hours")}>Hours</button>
  </div>;
}

export function DepartmentAnalytics({ report, delivery, unit, onLink, onUnit, showDirectoryLink = true }: {
  report: ProjectReport; delivery: Delivery; unit: EffortUnit; onLink: OpenClientView; onUnit?: (unit: EffortUnit) => void; showDirectoryLink?: boolean;
}) {
  const [mode, setMode] = useState<"effort" | "projects">("projects");
  const [status, setStatus] = useState<"all" | "active" | "completed" | "upcoming">("all");
  const [inspected, inspect] = useState("");
  const effort = mode === "effort";
  const scoped = effort ? delivery.projectRows : delivery.projects;
  const measure = (projects: Delivery["projectRows"], filter: ProjectFilter) => projects.filter(item =>
    forProjectFilter(item, filter, item.project.seconds)).reduce((total, item) => total + (effort ? item.project.seconds : 1), 0);
  const departments = [
    ...[...delivery.departmentRows].sort((a, b) => a.order - b.order).map(row => ({
      id: row.id, name: row.name, projects: effort ? row.effortProjects : row.projects,
    })),
    { id: "", name: "No department", projects: scoped.filter(item => !item.department) },
  ].filter(department => department.id || department.projects.length);
  const totals = departments.map(row => measure(row.projects, status));
  const total = totals.reduce((sum, value) => sum + value, 0);
  const max = Math.max(1, ...totals);
  const amount = (value: number) => effort ? reportHours(value) + " h" : String(value);
  const open = (id: string, filter: "all" | typeof portfolioStatuses[number][0]) => {
    if (id) onLink("projects", undefined, filter, { department: id });
    else onLink("projects", undefined, filter === "all" ? "unassigned" : ("unassigned-" + filter) as ProjectFilter);
  };
  return <section className="mi-exec-panel mi-department-composition mi-v4-department-chart" aria-labelledby="department-effort-title">
    <div className="mi-exec-heading"><div><h3 id="department-effort-title">Department distribution</h3>
      <p>{effort ? reportMonth(report.month) + " · Approved allocated effort" : "Approved delivery projects by department"}</p></div>
      {showDirectoryLink && <button type="button" className="exec-text-button" onClick={() => onLink("areas")}>Browse departments <ArrowUpRight size={16} aria-hidden="true" /></button>}
    </div>
    <div className="mi-insight-controls">
      <div className="mi-insight-segments" role="group" aria-label="Department metric">
        <button type="button" aria-pressed={!effort} onClick={() => { setMode("projects"); inspect(""); }}>Project count</button>
        <button type="button" aria-pressed={effort} onClick={() => { setMode("effort"); inspect(""); }}>Approved effort</button>
      </div>
      <label>Project status<select value={status} onChange={event => { setStatus(event.target.value as typeof status); inspect(""); }}>
        <option value="all">All</option><option value="active">In progress</option><option value="completed">Completed</option><option value="upcoming">Upcoming</option>
      </select></label>
      {effort && onUnit && <div className="mi-insight-segments" role="group" aria-label="Department effort display">
        <button type="button" aria-pressed={unit === "percentage"} onClick={() => onUnit("percentage")}>Percentage</button>
        <button type="button" aria-pressed={unit === "hours"} onClick={() => onUnit("hours")}>Exact hours</button>
      </div>}
    </div>
    {status === "all" && <ul className="mi-v4-legend" aria-label="Delivery statuses">{portfolioStatuses.map(([key, label]) =>
      <li key={key}><i data-state={key} aria-hidden="true" />{label}</li>)}</ul>}
    <ul className="mi-v4-stack-list">{departments.map((item, index) => {
      const value = totals[index];
      const share = metricPercent(value, total);
      const detail = item.name + " · " + amount(value) + " of " + amount(total) +
        (effort ? " approved allocated effort" : " approved delivery projects") + (share === undefined ? "" : " · " + percentText(share));
      return <li key={item.id} className="mi-v4-stack-row">
        <button className="exec-text-button mi-v4-stack-label" type="button" aria-label={detail} title={detail}
          onClick={() => open(item.id, status)} onFocus={() => inspect(detail)} onPointerEnter={() => inspect(detail)}>{item.name}</button>
        <div className="mi-v4-stack-rail"><div className="mi-v4-stack" style={{ inlineSize: value / max * 100 + "%" }}>
          {portfolioStatuses.filter(([key]) => status === "all" || status === key).map(([key, label]) => {
            const segment = measure(item.projects, key);
            if (!segment) return null;
            const labelDetail = item.name + " · " + label + " · " + amount(segment) + " of " + amount(value) + " · " + percentText(segment / value * 100);
            return <button type="button" key={key} data-state={key} style={{ flexGrow: segment }} aria-label={labelDetail}
              title={labelDetail} onPointerEnter={() => inspect(labelDetail)} onFocus={() => inspect(labelDetail)}
              onClick={() => open(item.id, key)}><span>{amount(segment)}</span></button>;
          })}
        </div></div>
        <b>{effort && unit === "percentage" ? share === undefined ? "—" : percentText(share) : amount(value)}</b>
      </li>;
    })}</ul>
    <p role="status" className="mi-v4-chart-detail">{inspected || (total ? amount(total) + (effort ? " of approved effort" : " approved delivery projects") :
      effort ? "No approved effort yet for this period." : "No approved delivery projects match this status.")}</p>
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
  const location = usePortalLocation();
  const [hovered, setHovered] = useState<string>();
  const requestedDepartment = location.get("effort-department");
  const department = delivery.departmentRows.find(item => item.id === requestedDepartment);
  const members = department?.effortProjects ?? delivery.projectRows;
  const project = members.find(item => item.project.id === location.get("effort-project"));
  const filtered = Boolean(department || project);
  const series = monthlyEffort(report, filtered ? project ? [project.project.id] : members.map(item => item.project.id) : undefined);
  const getValue = (row: typeof series.rows[number]) => unit === "hours" ? row.seconds : row.share;
  const points = series.rows.flatMap(row => {
    const value = getValue(row);
    return value === undefined ? [] : [{ id: row.month, month: row.month, label: reportMonth(row.month), value }];
  });
  const active = points.find(row => row.id === location.get("effort-point")) ??
    points.find(row => row.id === report.month) ?? points.at(-1);
  const inspected = series.rows.find(row => row.month === (hovered ?? active?.id));
  const cap = project?.delivery;
  const historical = report.month !== (report.reportingThroughMonth ?? reportingTimeMonth());
  const utilized = !historical && cap?.monthlyCap !== undefined && cap.monthlyCapUsed !== undefined
    ? metricPercent(cap.monthlyCapUsed, cap.monthlyCap) : undefined;
  const exact = (seconds: number | undefined) =>
    seconds === undefined ? "Not reported" : reportHours(seconds) + " h (" + seconds.toLocaleString("en-CA") + " seconds)";
  const share = (value: number | undefined) => value === undefined ? "Not applicable" : percentText(value);
  const denominatorLabel = filtered ? "Monthly portfolio effort" : "Selected-period effort";
  const detail = (row: typeof series.rows[number]) =>
    "Approved effort: " + exact(row.seconds) + ". " + denominatorLabel + ": " + exact(row.denominator) + ". " +
    series.label + ": " + share(row.share) + ".";

  return <section className="mi-exec-panel mi-monthly-effort" aria-label="Monthly approved effort">
    <div className="mi-exec-heading"><div><h3>Monthly approved effort</h3>
      <p>{unit === "percentage" ? series.label : "Approved allocated hours in each month"}</p>
      <p>{series.from === series.through ? reportMonth(series.from) : reportMonth(series.from) + " to " + reportMonth(series.through)}</p>
    </div></div>
    <div className="mi-insight-controls">
      <label>Effort department<select value={department?.id ?? ""} onChange={event => {
        setHovered(undefined);
        portalNavigate({ "effort-department": event.target.value || null, "effort-project": null, "effort-point": null }, true);
      }}>
        <option value="">All departments</option>{delivery.departmentRows.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <label>Effort project<select value={project?.project.id ?? ""} onChange={event => {
        setHovered(undefined);
        portalNavigate({ "effort-project": event.target.value || null, "effort-point": null }, true);
      }}>
        <option value="">All projects in scope</option>{members.map(item => <option key={item.project.id} value={item.project.id}>{item.project.name}</option>)}
      </select></label>
    </div>
    {active && inspected ? <>
      <TrendPlot label={unit === "percentage" ? series.label : "Monthly approved allocation in hours"}
        unit={unit === "hours" ? "hours" : "percent"} rows={points} active={active.id}
        onSelect={month => portalNavigate({ "effort-point": month }, true)} onInspect={setHovered}
        spokenValue={(_value, point) => detail(series.rows.find(row => row.month === point.id)!)} />
      <p className="mi-effort-inspection" role={hovered ? "tooltip" : "status"}>
        <b>{reportMonth(inspected.month)}</b> · {detail(inspected)}
      </p>
      <button type="button" className="exec-text-button" onClick={() => onLink(project ? "project:" + project.project.id : department ? "area:" + department.id : "projects", active.month)}>
        Open {active.label} detail <ArrowUpRight size={16} aria-hidden="true" />
      </button>
    </> : <p>No approved effort is available to compare in this scope.</p>}
    {points.length < series.rows.length && <p className="secure-muted">Months without a reported value for this measure are listed in the table and omitted from the plot.</p>}
    {project && <section className="mi-effort-cap" aria-label="Selected reporting month cap utilization">
      <p><strong>{reportMonth(report.month)} cap utilization</strong> {historical ? "Historical cap versions unavailable" :
        cap?.monthlyCap === undefined ? "No published cap" : utilized === undefined ? "Not applicable" : percentText(utilized)}
        {!historical && cap?.monthlyCap !== undefined && cap.monthlyCapUsed !== undefined &&
          " · " + reportHours(cap.monthlyCapUsed) + " of " + reportHours(cap.monthlyCap) + " h against the published cap"}</p>
    </section>}
    <details><summary>Show approved monthly effort table</summary>
      <table><caption>{series.label}</caption>
        <thead><tr><th scope="col">Month</th><th scope="col">Approved effort</th><th scope="col">{denominatorLabel}</th><th scope="col">Share</th></tr></thead>
        <tbody>{series.rows.map(row => <tr key={row.month}><th scope="row">{reportMonth(row.month)}</th>
          <td>{exact(row.seconds)}</td><td>{exact(row.denominator)}</td><td>{share(row.share)}</td></tr>)}</tbody>
      </table>
    </details>
  </section>;
}
