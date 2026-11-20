import { useState } from "react";
import type { ProjectReport } from "../projects/model";
import { chartRows } from "./DotAnalytics";
import { deliveryDefaults, rollup } from "../projects/delivery";
import { PersonPhoto } from "./PersonPhoto";
import { reportDay, reportHours, reportMonth, today } from "./dashboard-format";

type DataRow = { id: string; label: string; value: number; destination?: string; month?: string };
type Narrative = { label: string; detail?: string; destination?: string };
type Person = NonNullable<ProjectReport["portfolio"]>["directory"][number];
type Chapter = {
  title: string;
  text?: string;
  link: string;
  timeline?: boolean;
  measure?: string;
  unit?: "hours" | "percent";
  data?: DataRow[];
  notes?: Narrative[];
  people?: Person[];
};
type OpenReport = (view: string, month?: string) => void;

export function publishedChapters(report: ProjectReport): Chapter[] {
  const { projects, hierarchy = {}, portfolio } = report;
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
        { label: projects.filter(p => p.status === "active").length + " active projects", destination: "projects:active" },
        { label: projects.filter(p => p.status === "completed").length + " completed projects", destination: "projects:completed" },
      ] },
    { title: "Engagement Portfolio", link: "engagements", unit: "hours", measure: "Approved reported hours by parent or standalone work order",
      data: portfolioProjects.map(p => ({ id: p.id, label: p.name, value: branchEffort.get(p.id)?.monthly ?? 0,
        destination: (hierarchy[p.id]?.kind === "engagement" ? "group:" : "project:") + p.id })) },
    { title: "Historical Hours and Effort", link: "history", timeline: true, unit: "hours", measure: "Approved reported hours by month",
      data: chartRows(report, "trend").map(row => ({ ...row, value: row.seconds })) },
    { title: "Hours by Service Area", link: navigation.area, unit: "hours", measure: "Approved allocated hours by service area",
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
      ].sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, detail: (row.date < asOf ? "Past due · " : "") + reportDay(row.date) + " · " + row.detail })) },
    { title: "Morris Team", link: "directory", people: (portfolio?.directory ?? []).filter(p => p.projectIds.some(id => projects.some(project => project.id === id))) },
    { title: "Next Steps and Approved Updates", link: "notes", notes: [
      ...(portfolio?.narrative ? [{ label: "Executive notes", detail: portfolio.narrative }] : []),
      ...(portfolio?.action ? [{ label: "Next steps", detail: portfolio.action }] : []),
      ...projects.flatMap(p => (p.updates ?? []).map(update => ({ label: update.title, detail: update.body, destination: "timeline:" + p.id }))),
    ] },
  ];
}

function reading(chapter: Chapter, value: number) {
  return chapter.unit === "percent" ? value + "%" : reportHours(value) + " h";
}

export function PresentationContent({ chapter, onLink }: { chapter: Chapter; onLink?: OpenReport }) {
  const rows = chapter.data ?? [];
  const [selectedId, setSelectedId] = useState<string>();
  const chosen = rows.find(row => row.id === selectedId) ?? (chapter.timeline ? rows.at(-1) : rows[0]);
  const maximum = Math.max(1, ...rows.map(row => row.value));
  const coordinate = (row: DataRow, index: number) => [12 + index / Math.max(1, rows.length - 1) * 296, 83 - row.value / maximum * 68].join(",");
  const table = (tableRows: DataRow[]) => <table>
    <caption>{chapter.measure}</caption>
    <thead><tr><th scope="col">Name</th><th scope="col">{chapter.unit === "percent" ? "Percent" : "Hours"}</th></tr></thead>
    <tbody>{tableRows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{reading(chapter, row.value)}</td></tr>)}</tbody>
  </table>;
  if (rows.length && !onLink) return table(rows);
  if (rows.length) return <div className="platform-scene-data">
    {chapter.timeline && <svg viewBox="0 0 320 100" role="img" aria-label={chapter.measure}>
      <defs><linearGradient id="presentation-trend-fill" x2="0%" y2="100%"><stop stopColor="#f5db77" stopOpacity=".33"/><stop offset="100%" stopColor="#f5db77" stopOpacity="0"/></linearGradient></defs>
      <path d="M12 83H308M12 49H308M12 15H308" stroke="#7c9ab24a" fill="none"/>
      <polygon points={"12,83 " + rows.map(coordinate).join(" ") + " " + coordinate(rows.at(-1)!, rows.length - 1).split(",")[0] + ",83"} fill="url(#presentation-trend-fill)"/>
      <polyline points={rows.map(coordinate).join(" ")} fill="none" stroke="#f5db77" strokeWidth="2.4" strokeLinejoin="round" />
      {rows.map((row, index) => { const [x, y] = coordinate(row, index).split(","); return <circle cx={x} cy={y} key={row.id} r={chosen?.id === row.id ? 4 : 2.5} fill="#f5db77" />; })}
    </svg>}
    <div className={"platform-scene-series" + (chapter.timeline ? " platform-scene-time" : "")} aria-label={chapter.measure}>
      {(chapter.timeline ? rows.slice(-12) : rows.slice(0, 8)).map(row => <button key={row.id} type="button" aria-pressed={chosen?.id === row.id} onClick={() => setSelectedId(row.id)} title={row.label + " · " + reading(chapter, row.value)}>
        <span>{row.label}</span>{!chapter.timeline && <span className="platform-scene-bar" style={{ width: Math.max(.2, row.value / maximum * 100) + "%" }} aria-hidden="true" />}
        <b>{reading(chapter, row.value)}</b>
      </button>)}
    </div>
    {chosen?.destination && <button className="intel-report-link" type="button" onClick={() => onLink?.(chosen.destination!, chosen.month)}>Open {chosen.label}</button>}
    <details><summary>Show data table</summary>{table(rows)}</details>
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
