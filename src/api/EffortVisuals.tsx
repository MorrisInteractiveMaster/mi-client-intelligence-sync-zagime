import { useId, useState, type CSSProperties } from "react";
import { ArrowUpRight, Clock3 } from "lucide-react";
import { reportHours } from "./dashboard-format";
import { metricPercent, percentText } from "./insight-metrics";
import type { SourceHours, SourceHoursGroup } from "./types";
import "./effort-visuals.css";

type Tone = "blue" | "teal" | "gold" | "coral";

export function DottedTrack({ value, label, detail, displayValue, tone = "blue" }: {
  value?: number;
  label: string;
  detail?: string;
  displayValue?: string;
  tone?: Tone;
}) {
  const description = useId();
  const measured = value !== undefined;
  const wording = measured ? percentText(value) : "Not yet measurable";
  const style = { "--mi-dot-width": Math.min(value ?? 0, 100) + "%" } as CSSProperties;
  return <span className="mi-dot-meter" data-tone={measured && value > 100 ? "coral" : tone}
    role={measured ? "meter" : undefined} aria-label={label}
    aria-valuenow={value} aria-valuemin={measured ? 0 : undefined}
    aria-valuemax={measured ? Math.max(value, 100) : undefined}
    aria-valuetext={measured ? displayValue ?? wording : undefined} aria-describedby={detail ? description : undefined}
    data-measured={measured} tabIndex={detail ? 0 : undefined}>
    <span className="mi-dot-meter-legend"><span>{label}</span><strong>{displayValue ?? wording}</strong></span>
    {measured && <span className="mi-dot-meter-track" style={style} aria-hidden="true"><span /></span>}
    {detail && <span id={description} className="mi-dot-meter-detail">{detail}</span>}
  </span>;
}

export function AllocationCoverage({ hours, loading = false }: { hours?: SourceHours; loading?: boolean }) {
  const coverage = hours && metricPercent(hours.allocatedSeconds, hours.recordedSeconds);
  const exact = hours && reportHours(hours.allocatedSeconds) + " h allocated / " + reportHours(hours.recordedSeconds) + " h recorded";
  return <section className="mi-effort-panel mi-allocation-coverage" aria-label="Time allocation coverage">
    <div className="mi-effort-title"><Clock3 size={18} aria-hidden="true" /><h3>Time allocation coverage</h3></div>
    <p className="mi-coverage-value">
      <strong>{coverage === undefined ? (loading ? "Loading" : "Not yet measurable") : percentText(coverage)}</strong>
      {coverage !== undefined && <span> allocated</span>}
    </p>
    {coverage !== undefined && <DottedTrack value={coverage} label="Share of recorded time" detail={exact} tone="teal" />}
    {hours && <dl className="mi-ledger-detail">
      <div><dt>Recorded</dt><dd>{reportHours(hours.recordedSeconds)} h</dd></div>
      <div><dt>Allocated</dt><dd>{reportHours(hours.allocatedSeconds)} h</dd></div>
      <div><dt>Remaining</dt><dd>{reportHours(hours.unallocatedSeconds)} h</dd></div>
    </dl>}
    {hours?.recordedSeconds === 0 && <p className="mi-effort-muted">No recorded hours in this scope.</p>}
  </section>;
}

export function SourceMix({ groups, denominator, label, onSelect, busy = false, fallbackId }: {
  groups: SourceHoursGroup[];
  denominator: number;
  label: string;
  onSelect?: (id: string) => void;
  fallbackId?: string;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const roles = groups.filter(group => group.recordedSeconds !== 0);
  if (denominator <= 0 || !roles.length) return <p className="mi-effort-muted">No recorded hours to compare in this scope.</p>;
  return <><ul className="mi-effort-mix" aria-label={label}>{(expanded ? roles : roles.slice(0, 5)).map(group => {
    const id = group.id ?? fallbackId;
    const share = metricPercent(group.recordedSeconds, denominator);
    const exact = reportHours(group.recordedSeconds) + " h of " + reportHours(denominator) + " h recorded";
    return <li key={group.id ?? "unavailable"}>
      <DottedTrack value={share} detail={exact} label={group.label} tone="blue" />
      {id && onSelect && <button type="button" className="mi-mix-drilldown" aria-label={group.label}
        title={exact} disabled={busy} onClick={() => onSelect(id)}>
        <ArrowUpRight aria-hidden="true" size={18} />
      </button>}
    </li>;
  })}</ul>
  {roles.length > 5 && <button type="button" className="secure-secondary mi-mix-more" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
    {expanded ? "Show fewer entries" : "Show all " + roles.length + " entries"}
  </button>}</>;
}
