import { useState } from "react";
import { ArrowUpRight, CalendarClock, CircleAlert } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { reportingTimeMonth } from "../projects/time-history";
import { clientDelivery, deadlineHorizons, deadlineWindow, forProjectFilter, type DeadlineHorizon, type ProjectFilter } from "./client-delivery";
import { projectStatus, reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { metricPercent, percentText } from "./insight-metrics";
import { TrendPlot } from "./ReportingPlots";
import { monthlyEffort } from "./monthly-effort";
import { portalNavigate, usePortalLocation } from "./portal-location";
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
