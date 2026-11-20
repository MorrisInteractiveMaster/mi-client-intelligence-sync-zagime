import { reportHours, reportMonth } from "./dashboard-format";
import type { SourceHoursGroup, SourceSummary } from "./types";
import type { TimeGrouping } from "../projects/time-history";

type Props = {
  summary: SourceSummary;
  grouping: TimeGrouping;
  busy: boolean;
  onConsultant: (id: string) => void;
  onWorkOrder: (id: string) => void;
};

export function TimeHistorySummary({ summary, grouping, busy, onConsultant, onWorkOrder }: Props) {
  const { hours } = summary;
  return <section className="time-history-summary" aria-label="Time summaries">
    <div className="time-ledger-totals">
      <div><span>Recorded</span><b>{reportHours(hours.recordedSeconds)} h</b></div>
      <div><span>Allocated</span><b>{reportHours(hours.allocatedSeconds)} h</b></div>
      <div><span>Unallocated</span><b>{reportHours(hours.unallocatedSeconds)} h</b></div>
    </div>
    <details className="delivery-details">
      <summary>Hours by consultant</summary>
      <HoursTable label="Hours by consultant" rows={hours.byConsultant}
        onSelect={onConsultant} unavailableFilter="unavailable" busy={busy} />
    </details>
    <details className="delivery-details">
      <summary>Hours by work order</summary>
      <HoursTable label="Hours by work order" rows={hours.byWorkOrder}
        onSelect={onWorkOrder} busy={busy} />
    </details>
    <details className="delivery-details">
      <summary>Hours by {grouping}</summary>
      <HoursTable label={"Hours by " + grouping} rows={grouping === "month"
        ? hours.byPeriod.map(row => ({ ...row, label: reportMonth(row.label) }))
        : hours.byPeriod} busy={busy} />
    </details>
  </section>;
}

function HoursTable({ label, rows, onSelect, unavailableFilter, busy }: {
  label: string;
  rows: SourceHoursGroup[];
  onSelect?: (id: string) => void;
  unavailableFilter?: string;
  busy: boolean;
}) {
  if (!rows.length) return <p>No recorded hours match this scope.</p>;
  return <div className="intel-table-scroll time-summary-table" tabIndex={0} aria-label={label}>
    <table>
      <thead><tr><th scope="col">{label}</th><th scope="col">Recorded</th><th scope="col">Allocated</th><th scope="col">Unallocated</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id ?? "unavailable"}>
        <th scope="row">
          <div className="time-profile">
            {row.wordpressProfile?.photo && <img src={row.wordpressProfile.photo} alt={row.wordpressProfile.alt || ""} loading="lazy" width="32" height="32" />}
            <span>{onSelect && (row.id !== null || unavailableFilter) ? <button type="button" className="exec-text-button" disabled={busy} onClick={() => onSelect(row.id ?? unavailableFilter!)}>
              {row.label}</button> : row.label}
            {row.wordpressProfile?.title && <small>{row.wordpressProfile.title}</small>}</span>
          </div>
        </th>
        <td>{reportHours(row.recordedSeconds)} h</td><td>{reportHours(row.allocatedSeconds)} h</td>
        <td>{reportHours(row.unallocatedSeconds)} h</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
