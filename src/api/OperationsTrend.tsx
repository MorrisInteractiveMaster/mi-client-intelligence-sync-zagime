import { ArrowUpRight, BarChart3, Timer } from "lucide-react";
import type { SourceSummary } from "./types";
import { reportHours, reportMonth } from "./dashboard-format";

export function OperationsTrend({ summary, loading, onMonth }: { summary?: SourceSummary; loading: boolean; onMonth: (month: string) => void }) {
  const rows = summary?.hours.byPeriod.slice(-12) ?? [];
  const scale = Math.max(1, ...rows.map(row => row.recordedSeconds));
  return <section className="mi-operations-trend" aria-label="Recorded hours by month">
    <header><div className="mi-chart-icon"><BarChart3 aria-hidden="true" size={20} /></div>
      <div><h3>Recorded hours by month</h3><p>QuickBooks Time · up to 12 imported months</p></div></header>
    {!rows.length && <p className="mi-chart-empty">{loading ? "Loading recorded hours…" : "No recorded hours are available in this view."}</p>}
    {!!rows.length && <><ol>{rows.map(row => <li key={row.id}>
      <button type="button" aria-label={reportMonth(row.label) + ", " + reportHours(row.recordedSeconds) + " hours"}
        onClick={() => onMonth(row.label)}>
        <span>{reportHours(row.recordedSeconds)} h</span><i aria-hidden="true" style={{ height: 100 * row.recordedSeconds / scale + "%" }} />
        <small>{reportMonth(row.label).split(" ")[0].slice(0, 3)}</small>
      </button>
    </li>)}</ol>
      <details><summary><Timer aria-hidden="true" size={15} /> Monthly totals</summary><table><thead><tr><th scope="col">Month</th><th scope="col">Recorded hours</th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{reportMonth(row.label)}</th><td>{reportHours(row.recordedSeconds)}</td></tr>)}</tbody></table></details>
      <p><ArrowUpRight aria-hidden="true" size={15} /> Select a month to open its time entries.</p></>}
  </section>;
}
