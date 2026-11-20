import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Maximize2, X } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { areaHours } from "../projects/portfolio";
import { reportHours, reportMonth } from "./dashboard-format";

export type ChartKind = "distribution" | "trend" | "plan";
export const chartKinds: ChartKind[] = ["distribution", "trend", "plan"];
type Row = { id: string; label: string; seconds: number; projectIds: string[]; destination?: string; month?: string };
export const chartTitles = {
  distribution: "Delivery by service area",
  trend: "Monthly delivery history",
  plan: "Allocated against monthly plans",
};
const descriptions = {
  distribution: "Approved reporting allocations for the selected month. Choose an area to trace the hours to published projects.",
  trend: "Monthly reported effort for projects you can currently access, including remaining work-order time.",
  plan: "Compares allocated hours with staff-entered monthly targets on the same set of published projects.",
};

export function chartRows(report: ProjectReport, kind: ChartKind): Row[] {
  const projects = report.projects;
  if (!projects.length) return [];
  if (kind === "trend") return [...(report.portfolio?.history ?? []), { month: report.month, seconds: report.totalSeconds }]
    .map(row => ({ id: row.month, label: reportMonth(row.month), seconds: row.seconds, projectIds: [],
      month: row.month, destination: "projects" }));
  if (kind === "plan") {
    const planned = projects.filter(project => project.plan.basis === "monthly" && project.plan.targetSeconds > 0);
    if (!planned.length) return [];
    const projectIds = planned.map(project => project.id);
    return [
      { id: "allocated", label: "Allocated", seconds: planned.reduce((n, p) => n + p.seconds, 0), projectIds },
      { id: "target", label: "Monthly target", seconds: planned.reduce((n, p) => n + p.plan.targetSeconds, 0), projectIds },
    ];
  }
  const placements = new Map(report.portfolio?.placements.map(item => [item.id, item.areaId]));
  return areaHours(projects.map(project => ({ ...project, seconds: project.workOrderEffort?.assignedSeconds ?? project.seconds })), report.portfolio).sort((a, b) => b.seconds - a.seconds).map(area => ({
    id: area.id || "unassigned", label: area.name, seconds: area.seconds,
    projectIds: projects.filter(p => (placements.get(p.id) || "") === area.id && p.seconds > 0).map(p => p.id),
    ...(area.id && { destination: "area:" + area.id }),
  }));
}

export function comparableYears(month: string, rows: Row[]) {
  const year = Number(month.slice(0, 4));
  const latestMonth = Number(month.slice(5, 7));
  const byMonth = new Map(rows.map(row => [row.month, row]));
  return Array.from({ length: latestMonth }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return { month: reportMonth(year + "-" + suffix).split(" ")[0],
      prior: byMonth.get((year - 1) + "-" + suffix), current: byMonth.get(year + "-" + suffix) };
  });
}

function YearComparison({ month, rows, onLink }: { month: string; rows: Row[]; onLink: Props["onLink"] }) {
  const comparable = comparableYears(month, rows);
  const year = Number(month.slice(0, 4));
  const unit = dotScale(Math.max(0, ...comparable.flatMap(({ prior, current }) => [prior?.seconds ?? 0, current?.seconds ?? 0])));
  return <details className="intel-chart-table"><summary>Compare with previous year</summary>
    <p>Compare the same months through {reportMonth(month)}. A dash means the approved report has no entry for that month.</p>
    <table><caption>Approved reported hours by year</caption>
      <thead><tr><th scope="col">Month</th><th scope="col">{year - 1}</th><th scope="col">{year}</th></tr></thead>
      <tbody>{comparable.map(({ month: label, prior, current }) => <tr key={label}>
        <th scope="row">{label}</th>{[prior, current].map((row, index) => <td key={index}>{row
          ? <button className="exec-text-button" onClick={() => onLink("projects", row.month)} aria-label={row.label + ", " + reportHours(row.seconds) + " hours"}>
            <DotField value={row.seconds} unit={unit} /><span>{reportHours(row.seconds)} h</span>
          </button> : "—"}</td>)}
      </tr>)}</tbody>
    </table>
  </details>;
}

export function dotScale(maximum: number, capacity = 48) {
  return Math.max(1, Math.ceil(maximum / capacity));
}

export function DotField({ value, unit, vertical = false, capacity = 48 }: {
  value: number; unit: number; vertical?: boolean; capacity?: number;
}) {
  const width = vertical ? 58 : 198;
  const height = vertical ? 146 : Math.ceil(capacity / 16) * 12;
  return <svg className="intel-dot-field" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
    {Array.from({ length: capacity }, (_, i) => {
      const filled = Math.max(0, Math.min(1, value / unit - i));
      return <circle key={i} className="intel-dot-point" data-filled={filled > 0}
        cx={vertical ? 7 + i % 4 * 14 : 6 + i % 16 * 12}
        cy={vertical ? 136 - Math.floor(i / 4) * 11.5 : 6 + Math.floor(i / 16) * 12}
        r={filled > 0 ? 3.2 + filled * 1.2 : 2.8}
        style={{ opacity: filled > 0 ? .5 + filled / 2 : .2, animationDelay: Math.min(i * 6, 210) + "ms" }} />;
    })}
  </svg>;
}

type Props = {
  report: ProjectReport; kind: ChartKind;
  onOpen?: () => void;
  onLink: (destination: string, month?: string) => void;
  expanded?: boolean;
};
export function DotChart({ report, kind, onLink, onOpen, expanded }: Props) {
  const [selection, setSelection] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const rows = chartRows(report, kind);
  const unit = dotScale(Math.max(0, ...rows.map(row => row.seconds)));
  const selected = rows.find(row => row.id === selection) ?? rows.at(kind === "trend" ? -1 : 0);
  const inspected = rows.find(row => row.id === hovered) ?? selected;
  const selectedProjects = selected?.projectIds
    ? report.projects.filter(project => selected.projectIds.includes(project.id)) : [];
  const trend = kind === "trend";
  return <section className="intel-chart" data-kind={kind}>
    <header className="intel-chart-head">
      <div><h3>{chartTitles[kind]}</h3><p>{descriptions[kind]}</p></div>
      {onOpen && <button className="intel-icon" aria-label={"Expand " + chartTitles[kind].toLowerCase()} onClick={onOpen}><Maximize2 size={17} aria-hidden="true" /></button>}
    </header>
    {rows.length ? <>
      <div className={trend ? "intel-dot-series intel-dot-series--trend" : "intel-dot-series"} aria-label={chartTitles[kind]}>
        {rows.map(row => <button key={row.id} type="button" aria-pressed={row.id === selected?.id}
          aria-label={row.label + ", " + reportHours(row.seconds) + " hours"}
          onClick={() => setSelection(row.id)} onPointerEnter={() => setHovered(row.id)} onPointerLeave={() => setHovered(undefined)}
          onFocus={() => setHovered(row.id)} onBlur={() => setHovered(undefined)}>
          <DotField value={row.seconds} unit={unit} vertical={trend} />
          <span>{trend ? row.label.split(" ")[0].slice(0, 3) : row.label}</span>
          {!trend && <b>{reportHours(row.seconds)} h</b>}
        </button>)}
      </div>
      <div className="intel-chart-insight">
        <div aria-live="polite"><strong>{inspected?.label}</strong><span>{reportHours(inspected?.seconds ?? 0)} h</span></div>
        {selected?.destination && <button className="exec-text-button" onClick={() => onLink(selected.destination!, selected.month)}>
          {trend ? "View selected month" : "View service area"} <ArrowUpRight size={15} aria-hidden="true" />
        </button>}
      </div>
      <p className="intel-legend">One full dot ≈ {unit < 36 ? unit + " s" : reportHours(unit) + " h"}. Select a group for exact hours.</p>
      {expanded && selectedProjects.length > 0 && <div className="intel-related"><h4>{kind === "plan" ? "Projects with monthly plans" : "Contributing projects"}</h4>
        <ul>{selectedProjects.map(project => <li key={project.id}><button className="exec-text-button" onClick={() => onLink("project:" + project.id)}>
          {project.name} <span>{reportHours(project.seconds)} h</span>
        </button></li>)}</ul></div>}
      {trend && expanded && <YearComparison month={report.month} rows={rows} onLink={onLink} />}
      <details className="intel-chart-table"><summary>Show data table</summary><table>
        <caption>{chartTitles[kind]} in hours</caption><thead><tr><th scope="col">{trend ? "Month" : "Group"}</th><th scope="col">Hours</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{reportHours(row.seconds)}</td></tr>)}</tbody>
      </table></details>
    </> : <p className="intel-empty">{kind === "plan" ? "There are no published monthly plans for this scope." : "No published projects are available for this period."}</p>}
  </section>;
}

export function DotChartDialog({ onClose, ...props }: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    close.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (document.fullscreenElement && element.contains(document.fullscreenElement))
        void document.exitFullscreen().catch(() => {});
      element.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return <dialog className="intel-analytics-dialog" ref={dialog} aria-label={chartTitles[props.kind] + " analysis"}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="intel-dialog-pane" ref={pane}>
      <div className="intel-dialog-tools"><span>Reporting analysis · {reportMonth(props.report.month)}</span>
        {document.fullscreenEnabled && <button className="intel-icon" type="button" aria-label="Toggle chart fullscreen"
          onClick={() => { void (document.fullscreenElement ? document.exitFullscreen() : pane.current?.requestFullscreen())?.catch(() => {}); }}><Maximize2 size={18} aria-hidden="true" /></button>}
        <button ref={close} className="intel-icon" aria-label="Close chart" type="button" onClick={onClose}><X size={20} aria-hidden="true" /></button></div>
      <DotChart {...props} expanded />
    </div>
  </dialog>;
}
