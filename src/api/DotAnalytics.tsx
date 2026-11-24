import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Maximize2, X } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { metricPercent, percentText } from "./insight-metrics";
import { reportHours, reportMonth } from "./dashboard-format";
import { BarPlot, TrendPlot } from "./ReportingPlots";
import { axisMaximum, chartRows, comparableYears, type ChartKind, type MonthRange, type Row } from "./reporting-chart-data";
export { chartKinds, chartRows, type ChartKind } from "./reporting-chart-data";
import { CsvExport } from "./CsvExport";
import { csvHours } from "./report-csv";

export const chartTitles = {
  distribution: "Delivery by department",
  trend: "Monthly delivery history",
  plan: "Reported effort against plans",
};
const descriptions = {
  distribution: "Share of approved effort by department for the selected month.",
  trend: "Monthly hours for the work you can see. Select a month for its exact hours and detailed report.",
  plan: "Reported hours and published monthly targets for the same projects.",
};

function YearComparison({ month, rows, onLink }: { month: string; rows: Row[]; onLink: Props["onLink"] }) {
  const comparable = comparableYears(month, rows);
  const year = Number(month.slice(0, 4));
  const scale = axisMaximum(Math.max(0, ...comparable.flatMap(({ prior, current }) => [prior?.seconds ?? 0, current?.seconds ?? 0])));
  return <details className="intel-chart-table mi-chart-table"><summary>Compare with previous year</summary>
    <p>Compare the same months through {reportMonth(month)}. A dash means the approved report has no entry for that month.</p>
    <table><caption>Approved reported hours by year</caption>
      <thead><tr><th scope="col">Month</th><th scope="col">{year - 1}</th><th scope="col">{year}</th></tr></thead>
      <tbody>{comparable.map(({ month: label, prior, current }) => <tr key={label}>
        <th scope="row">{label}</th>{[prior, current].map((row, index) => <td key={index}>{row
          ? <button type="button" className="exec-text-button mi-year-cell" onClick={() => onLink("projects", row.month)}
              aria-label={row.label + ", " + reportHours(row.seconds) + " hours"}>
            <span>{reportHours(row.seconds)} h</span><span className="mi-bar-track" aria-hidden="true"><i style={{ inlineSize: row.seconds / scale * 100 + "%" }} /></span>
          </button> : "—"}</td>)}
      </tr>)}</tbody>
    </table>
  </details>;
}

type Props = {
  report: ProjectReport; kind: ChartKind;
  onOpen?: (trigger: HTMLButtonElement) => void;
  onLink: (destination: string, month?: string) => void;
  expanded?: boolean;
  draft?: boolean;
  monthRange?: MonthRange;
};
export function DotChart({ report, kind, onLink, onOpen, expanded, monthRange, draft }: Props) {
  const [selection, setSelection] = useState<string>();
  const [hovered, setHovered] = useState<string>();
  const distribution = kind === "distribution";
  const series = chartRows(report, kind, monthRange);
  const rows = (distribution && report.totalSeconds <= 0 || kind === "trend" && !series.some(row => row.seconds > 0)) ? [] : series;
  const byId = new Map(rows.map(row => [row.id, row]));
  const share = (seconds: number) => metricPercent(seconds, report.totalSeconds);
  const trend = kind === "trend";
  const selected = rows.find(row => row.id === selection) ??
    (trend ? rows.find(row => row.month === report.month) ?? rows.at(-1) : rows[0]);
  const inspected = rows.find(row => row.id === hovered) ?? selected;
  const selectedProjects = report.projects.filter(project => selected?.projectIds.includes(project.id));
  const Plot = trend ? TrendPlot : BarPlot;
  const caption = chartTitles[kind] + " in hours";
  return <section className="intel-chart mi-report-chart" data-kind={kind} aria-label={chartTitles[kind]}>
    <header className="intel-chart-head">
      <div><h3>{chartTitles[kind]}</h3><p>{descriptions[kind]}</p></div>
      {onOpen && <button className="intel-icon" type="button" aria-label={"Expand " + chartTitles[kind].toLowerCase()} onClick={event => onOpen(event.currentTarget)}><Maximize2 size={17} aria-hidden="true" /></button>}
    </header>
    {selected && inspected ? <>
      <Plot label={chartTitles[kind]} unit={distribution ? "percent" : "hours"}
        rows={rows.map(row => ({ ...row, value: distribution ? share(row.seconds) ?? 0 : row.seconds }))}
        active={selected.id} spokenValue={(_, row) => reportHours(byId.get(row.id)!.seconds) + " hours"}
        onSelect={setSelection} onInspect={setHovered} />
      <div className="intel-chart-insight mi-chart-detail">
        <div aria-live="polite"><strong>{inspected.label}</strong><span>{distribution
          ? percentText(share(inspected.seconds) ?? 0) + " · " + reportHours(inspected.seconds) + " of " + reportHours(report.totalSeconds) + " approved hours"
          : reportHours(inspected.seconds) + " h"}</span></div>
        {selected.destination && <button className="exec-text-button" type="button" onClick={() => onLink(selected.destination!, selected.month)}>
          {trend ? "View " + selected.label : "View " + selected.label + " department"} <ArrowUpRight size={15} aria-hidden="true" />
        </button>}
      </div>
      {expanded && selectedProjects.length > 0 && <div className="intel-related"><h4>{kind === "plan" ? "Projects with monthly plans" : "Contributing projects · " + selected.label}</h4>
        <ul>{selectedProjects.map(project => <li key={project.id}><button className="exec-text-button" type="button" onClick={() => onLink("project:" + project.id)}>
          {project.name} <span>{reportHours(kind === "plan" && selected.id === "target" ? project.plan.targetSeconds : project.seconds)} h</span>
        </button></li>)}</ul></div>}
      {trend && expanded && <YearComparison month={report.month} rows={rows} onLink={onLink} />}
      <div className="mi-chart-actions">
        <details className="intel-chart-table mi-chart-table"><summary>Show data table</summary><table>
          <caption>{caption}</caption><thead><tr><th scope="col">{trend ? "Month" : "Group"}</th><th scope="col">Hours</th>{distribution && <th scope="col">Share of approved effort</th>}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{reportHours(row.seconds)}</td>
            {distribution && <td>{percentText(share(row.seconds) ?? 0)}</td>}</tr>)}</tbody>
        </table></details>
        {!draft && <CsvExport filename={"Morris_" + report.tenant.name + "_" + kind + "_" + report.month} label="Export chart CSV"
          data={{ headers: [trend ? "Month" : "Group", "Reported hours"],
            rows: rows.map(row => [row.month ?? row.label, csvHours(row.seconds)]) }} />}
      </div>
    </> : <p className="mi-chart-empty">{kind === "plan" ? "No monthly plans have been published for this scope."
      : trend ? "No approved monthly totals are available in this range." : "No approved effort yet for this period."}</p>}
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
