import { ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { useState } from "react";
import type { ProjectReport } from "../projects/model";
import { chartRows } from "./DotAnalytics";
import { BarPlot, TrendPlot, plotValue, type PlotRow, type PlotUnit } from "./ReportingPlots";
import { CsvExport } from "./CsvExport";
import { csvHours } from "./report-csv";
import { deliveryDefaults, rollup } from "../projects/delivery";
import { PersonPhoto } from "./PersonPhoto";
import { reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { clientDelivery } from "./client-delivery";

type DataRow = PlotRow & { destination?: string };
type Narrative = { label: string; detail?: string; destination?: string };
type Person = NonNullable<ProjectReport["portfolio"]>["directory"][number];
type Chapter = {
  title: string;
  text?: string;
  link: string;
  timeline?: boolean;
  measure?: string;
  unit?: PlotUnit;
  data?: DataRow[];
  notes?: Narrative[];
  people?: Person[];
};
type OpenReport = (view: string, month?: string) => void;

export function publishedChapters(report: ProjectReport): Chapter[] {
  const { projects, hierarchy = {}, portfolio } = report;
  const { counts } = clientDelivery(report);
  const positive = projects.filter(p => p.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const portfolioProjects = projects.filter(p => hierarchy[p.id]?.kind === "engagement" || !hierarchy[p.id]?.parentId);
  const milestones = projects.flatMap(p => (p.milestones ?? []).map(item => ({ ...item, p })));
  const asOf = today().slice(0, 7) === report.month ? today() : report.month + "-01";
  const capacity = projects.flatMap(project => {
    const row = hierarchy[project.id];
    if (!row) return [];
    return (["monthly", "lifetime"] as const).flatMap(basis => {
      const cap = row[basis === "monthly" ? "monthlyCap" : "lifetimeCap"];
      const used = row[basis === "monthly" ? "monthlyCapUsed" : "lifetimeCapUsed"];
      if (cap === undefined || !cap) return [];
      const amount = used ?? (basis === "monthly" ? project.seconds : project.lifetimeSeconds);
      return [{ id: project.id + "-" + basis, label: project.name + " · " + basis,
        value: Math.round(amount / cap * 1000) / 10, destination: "project:" + project.id }];
    });
  });
  const navigation = { area: "areas", project: "projects" };
  const branchEffort = rollup(projects.map(p => ({ ...p, delivery: { ...deliveryDefaults, parentId: hierarchy[p.id]?.parentId } })));
  return [
    { title: report.presentationTitle || "Executive Summary", text: report.tenant.name, link: "overview",
      notes: [
        { label: reportHours(report.totalSeconds) + " h reported", detail: reportMonth(report.month) },
        { label: counts.active + " active projects", destination: "projects:active" },
        { label: counts.completed + " completed projects", destination: "projects:completed" },
      ] },
    { title: "Engagement Portfolio", link: "engagements", unit: "hours", measure: "Approved reported hours by parent or standalone work order",
      data: portfolioProjects.map(p => ({ id: p.id, label: p.name, value: branchEffort.get(p.id)?.monthly ?? 0,
        destination: (hierarchy[p.id]?.kind === "engagement" ? "group:" : "project:") + p.id })) },
    { title: "Historical Hours and Effort", link: "history", timeline: true, unit: "hours", measure: "Approved reported hours by month",
      data: chartRows(report, "trend").map(row => ({ ...row, value: row.seconds })) },
    { title: "Hours by Service Area", link: navigation.area, unit: "hours", measure: "Approved reported hours by service area",
      data: chartRows(report, "distribution").map(row => ({ ...row, value: row.seconds })) },
    { title: "Hours by Delivery Project", link: navigation.project, unit: "hours", measure: "Approved reported hours by project",
      data: positive.map(p => ({ id: p.id, label: p.name, value: p.seconds, destination: "project:" + p.id })) },
    { title: "Budget Utilization", link: "projects", unit: "percent", measure: "Effort used against published caps", data: capacity },
    { title: "Milestone Completion", link: "milestones", measure: "Completed published milestones", unit: "percent",
      data: projects.flatMap(p => {
        const rows = (p.milestones ?? []).filter(m => m.status !== "waived");
        if (!rows.length) return [];
        const weights = (list: typeof rows) => list.reduce((sum, m) => sum + (m.weight ?? 1), 0);
        return [{ id: p.id, label: p.name, value: Math.round(weights(rows.filter(m => m.completed)) / weights(rows) * 100), destination: "timeline:" + p.id }];
      }) },
    { title: "Upcoming Deadlines and Risks", link: "milestones",
      notes: [
        ...milestones.filter(m => !m.completed && m.status !== "waived" && m.date).map(m => ({
          label: m.title, date: m.date, detail: m.p.name, destination: "milestone:" + m.p.id + ":" + m.id,
        })),
        ...projects.filter(p => p.status !== "completed" && hierarchy[p.id]?.deadline).map(p => ({
          label: p.name, date: hierarchy[p.id].deadline!, detail: "Project deadline", destination: "project:" + p.id,
        })),
      ].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, detail: (row.date < asOf ? "Past due · " : "") + reportDay(row.date) + " · " + row.detail }))
      .concat(projects.filter(p => hierarchy[p.id]?.blocker?.active).map(p => ({
        label: p.name, date: "", detail: "Blocked · " + (hierarchy[p.id].blocker?.message || "Published delivery blocker"), destination: "project:" + p.id,
      }))) },
    { title: "Morris Team", link: "directory", people: (portfolio?.directory ?? []).filter(p => p.projectIds.some(id => projects.some(project => project.id === id))) },
    { title: "Next Steps and Approved Updates", link: "notes", notes: [
      ...(portfolio?.narrative ? [{ label: "Executive notes", detail: portfolio.narrative }] : []),
      ...(portfolio?.action ? [{ label: "Next steps", detail: portfolio.action }] : []),
      ...projects.flatMap(p => (p.updates ?? []).map(update => ({ label: update.title, detail: update.body, destination: "timeline:" + p.id }))),
    ] },
  ];
}

export function PresentationContent({ chapter, onLink, month, draft }: { chapter: Chapter; onLink?: OpenReport; month?: string; draft?: boolean }) {
  const rows = chapter.data ?? [];
  const unit = chapter.unit ?? "hours";
  const [selectedId, setSelectedId] = useState<string>();
  const [hoveredId, setHoveredId] = useState<string>();
  const chosen = rows.find(row => row.id === selectedId) ?? (chapter.timeline ? rows.find(row => row.month === month) ?? rows.at(-1) : rows[0]);
  const inspected = rows.find(row => row.id === hoveredId) ?? chosen;
  const Plot = chapter.timeline ? TrendPlot : BarPlot;
  const table = <table className="mi-presentation-table">
    <caption>{chapter.measure}</caption>
    <thead><tr><th scope="col">{chapter.timeline ? "Month" : "Name"}</th><th scope="col">{unit === "percent" ? "Percent" : "Hours"}</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{plotValue(row.value, unit)}</td></tr>)}</tbody>
  </table>;
  if (rows.length && !onLink) return table;
  if (chosen && inspected) return <div className={"mi-presentation-data" + (chapter.timeline ? " mi-presentation-trend" : "")}>
    <Plot label={chapter.measure ?? chapter.title} unit={unit} rows={rows} active={chosen.id} onSelect={setSelectedId} onInspect={setHoveredId} />
    <div className="mi-presentation-detail">
      <p aria-live="polite"><strong>{inspected.label}</strong><span>{plotValue(inspected.value, unit)}</span></p>
      {chosen.destination && <button className="mi-presentation-link" type="button" onClick={() => onLink?.(chosen.destination!, chosen.month)}>Open {chosen.label}</button>}
    </div>
    <div className="mi-chart-actions">
      <details><summary>Show data table</summary>{table}</details>
      {!draft && month && <CsvExport filename={"Morris_" + ZAGIME_CLIENT_DISPLAY_NAME + "_" + chapter.title.replace(/[^a-zA-Z0-9]+/g, "_") + "_" + month}
        label="Export chart CSV" data={{ headers: [chapter.timeline ? "Month" : "Name", unit === "percent" ? "Percent" : "Reported hours"],
          rows: rows.map(row => [row.month ?? row.label, unit === "percent" ? row.value : csvHours(row.value)]) }} />}
    </div>
  </div>;
  if (chapter.people?.length) return <ul className="platform-scene-team">{chapter.people.map(person => <li key={person.id}>
    {!!onLink && <PersonPhoto name={person.name} photo={person.photo} alt={person.photoAlt} />}
    <div>{onLink ? <button className="intel-report-link" type="button" onClick={() => onLink("contact:" + person.id)}>{person.name}</button> : <b>{person.name}</b>}
      <p>{person.role}</p></div>
  </li>)}</ul>;
  if (chapter.notes?.length) return <ul className="platform-scene-notes">{chapter.notes.map((note, index) => <li key={note.label + index}>
    {onLink && note.destination ? <button className="intel-report-link" type="button" onClick={() => onLink(note.destination!)}>{note.label}</button> : <b>{note.label}</b>}
    {note.detail && <p>{note.detail}</p>}
  </li>)}</ul>;
  return <p>No published information is available in this chapter for the selected view.</p>;
}
