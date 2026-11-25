import { ArrowDownRight, ArrowUpRight, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { precedingTimeMonth } from "../projects/time-history";
import type { SourceSummary } from "./types";
import { reportHours, reportMonth } from "./dashboard-format";
import { SortedTable } from "./SortHeader";
import "./staff-overview.css";

export function OperationsTrend({ summary, loading, onMonth }: {
  summary?: SourceSummary;
  loading: boolean;
  onMonth: (month: string) => void;
}) {
  const [series, setSeries] = useState<"recordedSeconds" | "allocatedSeconds">("recordedSeconds");
  const [page, setPage] = useState(0);
  const [engaged, setEngaged] = useState<string>();
  const months = [...(summary?.hours.byPeriod ?? [])].sort((a, b) => a.label.localeCompare(b.label));
  const start = Math.max(0, months.length - (page + 1) * 6);
  const end = Math.max(start, months.length - page * 6);
  const rows = months.slice(start, end);
  const min = Math.min(0, ...rows.map(row => row[series]));
  const max = Math.max(0, ...rows.map(row => row[series]));
  const height = Math.max(1, max - min);
  const plotY = (seconds: number) => 110 - (seconds - min) / height * 85;
  const label = series === "recordedSeconds" ? "Recorded hours" : "Allocated hours";
  const last = rows.at(-1);
  const prior = rows.at(-2);
  const selected = rows.find(row => row.label === engaged) ?? last;
  const delta = last && prior && prior.label === precedingTimeMonth(last.label) ? last[series] - prior[series] : undefined;
  const dots = rows.map((row, i) => ({
    x: (i + .5) / rows.length * 600,
    y: plotY(row[series]),
  }));
  const path = dots.map(({ x, y }, i) =>
    (i && rows[i - 1].label === precedingTimeMonth(rows[i].label) ? "L " : "M ") + x + " " + y
  ).join(" ");

  return <section className="mi-cockpit-panel mi-staff-trend" aria-label={label + " by month"}>
    <header className="mi-cockpit-heading">
      <div><p className="mi-cockpit-kicker"><CalendarRange size={15} aria-hidden="true" /> Source history</p>
      <h3>{label} by month</h3></div>
      <div className="mi-toggle-set" aria-label="Hours measure">
        <button type="button" aria-pressed={series === "recordedSeconds"} onClick={() => setSeries("recordedSeconds")}>Recorded</button>
        <button type="button" aria-pressed={series === "allocatedSeconds"} onClick={() => setSeries("allocatedSeconds")}>Allocated</button>
      </div>
    </header>
    {!rows.length ? <p className="mi-effort-muted" role={loading ? "status" : undefined}>
      {loading ? "Loading recorded hours…" : "No imported months are available in this scope."}
    </p> : <>
      <div className="mi-trend-readout" aria-live="polite">
        <div><b>{reportHours(selected![series])} h</b> <span>{reportMonth(selected!.label)}</span></div>
        {delta !== undefined && selected === last && <small className="mi-trend-delta">
          {delta < 0 ? <ArrowDownRight size={15} aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}
          {delta === 0 ? "No change" : (delta > 0 ? "+" : "−") + reportHours(Math.abs(delta)) + " h"} vs. prior month
        </small>}
      </div>
      <div className="mi-trend-plot">
        <svg viewBox="0 0 600 126" preserveAspectRatio="none" aria-hidden="true" className="mi-trend-lines">
          {[25, 53, 82, 110].map(y => <line key={y} x1={0} x2={600} y1={y} y2={y} />)}
          {min < 0 && <line className="mi-trend-zero" x1={0} x2={600} y1={plotY(0)} y2={plotY(0)} />}
          <path key={series} d={path} />
        </svg>
        <ol style={{ gridTemplateColumns: "repeat(" + rows.length + ", minmax(0, 1fr))" }}>
          {rows.map(row => <li key={row.label}><button type="button" aria-label={reportMonth(row.label) + ", " + reportHours(row[series]) + " " + label.toLowerCase()}
            title={reportMonth(row.label) + " · " + reportHours(row[series]) + " h"} data-highlighted={selected === row}
            onFocus={() => setEngaged(row.label)} onPointerEnter={() => setEngaged(row.label)}
            onClick={() => onMonth(row.label)}>
            <span className="mi-trend-point" style={{ top: "calc((100% - 24px) * " + plotY(row[series]) / 126 + ")" }} aria-hidden="true" />
            <span className="mi-trend-month">{reportMonth(row.label).split(" ")[0].slice(0, 3)}</span>
          </button></li>)}
        </ol>
      </div>
      <div className="mi-staff-trend-foot">
        <details><summary>Exact monthly totals</summary><SortedTable rows={rows} caption="Recorded and allocated hours"
          columns={{ label: "Month", recordedSeconds: "Recorded", allocatedSeconds: "Allocated" }} initial={{ key: "label", direction: "asc" }}
          identity={row => row.label} value={(row, key) => row[key]} cells={row => <><th scope="row">{reportMonth(row.label)}</th>
            <td>{reportHours(row.recordedSeconds)} h</td><td>{reportHours(row.allocatedSeconds)} h</td></>} /></details>
        {months.length > 6 && <div className="mi-trend-pagination">
          <button type="button" aria-label="Earlier months" disabled={!start} onClick={() => setPage(value => value + 1)}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Later months" disabled={!page} onClick={() => setPage(value => value - 1)}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>}
      </div>
    </>}
  </section>;
}
