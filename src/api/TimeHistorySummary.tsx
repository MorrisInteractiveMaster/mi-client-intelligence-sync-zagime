import { useState } from "react";
import { AllocationCoverage, SourceMix } from "./EffortVisuals";
import { reportHours, reportMonth } from "./dashboard-format";
import { CsvExport } from "./CsvExport";
import { hoursBreakdown } from "./report-csv";
import type { SourceHoursGroup, SourceSummary } from "./types";
import type { TimeGrouping } from "../projects/time-history";

type Props = {
  summary: SourceSummary;
  grouping: TimeGrouping;
  filenamePrefix?: string;
  busy: boolean;
  onConsultant: (id: string) => void;
  onWorkOrder: (id: string) => void;
};

export function TimeHistorySummary({ summary, grouping, busy, onConsultant, onWorkOrder, filenamePrefix = "Morris" }: Props) {
  const { hours } = summary;
  const [dimension, setDimension] = useState<"workOrder" | "consultant" | "morris">("workOrder");
  const current = dimension === "morris" && !hours.byMorrisProfile?.length ? "workOrder" : dimension;
  const groups = current === "consultant" ? hours.byConsultant : current === "morris" ? hours.byMorrisProfile ?? [] : hours.byWorkOrder;
  const tabs: { id: typeof dimension; label: string }[] = [
    { id: "workOrder", label: "Work orders" }, { id: "consultant", label: "Consultants" },
  ];
  if (hours.byMorrisProfile?.length) tabs.push({ id: "morris", label: "Morris profiles" });
  return <section className="time-history-summary" aria-label="Time summaries">
    <div className="time-analytics-grid">
      <AllocationCoverage hours={hours} />
      <section className="time-mix-panel" aria-label="Recorded time distribution">
        <header className="mi-cockpit-heading"><h3>Recorded time distribution</h3>
          <div className="mi-toggle-set" aria-label="Group recorded time">
            {tabs.map(({ id, label }) => <button key={id} type="button" aria-pressed={current === id}
              onClick={() => setDimension(id)}>{label}</button>)}
          </div>
        </header>
        <SourceMix key={current} groups={groups} denominator={hours.recordedSeconds} label="Share of time in filter scope" busy={busy}
          fallbackId={current === "consultant" ? "unavailable" : undefined}
          onSelect={current === "consultant" ? onConsultant : current === "workOrder" ? onWorkOrder : undefined} />
      </section>
    </div>
    <details className="delivery-details time-breakdowns">
      <summary>Exact breakdowns and CSV exports</summary>
    <details className="delivery-details">
      <summary>Hours by consultant</summary>
      <HoursTable label="Hours by consultant" filename={filenamePrefix + "_byConsultant"} rows={hours.byConsultant}
        onSelect={onConsultant} unavailableFilter="unavailable" busy={busy} />
    </details>
    {!!hours.byMorrisProfile?.length && <details className="delivery-details">
      <summary>Hours by linked Morris profile</summary>
      <HoursTable label="Hours by linked Morris profile" filename={filenamePrefix + "_byMorrisProfile"} rows={hours.byMorrisProfile} busy={busy} />
    </details>}
    <details className="delivery-details">
      <summary>Hours by work order</summary>
      <HoursTable label="Hours by work order" filename={filenamePrefix + "_byWorkOrder"} rows={hours.byWorkOrder}
        onSelect={onWorkOrder} busy={busy} />
    </details>
    <details className="delivery-details">
      <summary>Hours by {grouping}</summary>
      <HoursTable label={"Hours by " + grouping} filename={filenamePrefix + "_" + grouping} exportedRows={hours.byPeriod} rows={grouping === "month"
        ? hours.byPeriod.map(row => ({ ...row, label: reportMonth(row.label) }))
        : hours.byPeriod} busy={busy} />
    </details>
    </details>
  </section>;
}

function HoursTable({ label, rows, exportedRows, filename, onSelect, unavailableFilter, busy }: {
  label: string;
  rows: SourceHoursGroup[];
  exportedRows?: SourceHoursGroup[];
  filename: string;
  onSelect?: (id: string) => void;
  unavailableFilter?: string;
  busy: boolean;
}) {
  if (!rows.length) return <p>No recorded hours match this scope.</p>;
  return <><CsvExport filename={filename} label={"Export " + label.toLowerCase() + " CSV"} disabled={busy}
    data={hoursBreakdown(label, exportedRows ?? rows)} />
    <div className="intel-table-scroll time-summary-table" tabIndex={0} aria-label={label}>
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
  </div></>;
}
