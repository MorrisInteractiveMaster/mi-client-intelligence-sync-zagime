import { followingTimeMonth } from "./reporting-period";
import { useState, type CSSProperties } from "react";
import { ArrowUpRight } from "lucide-react";
import { projectCompletionHistory, type clientDelivery, type ProjectFilter } from "./client-delivery";
import { reportMonth } from "./dashboard-format";
import { TrendPlot } from "./ReportingPlots";
import { metricPercent, percentText } from "./insight-metrics";
import "./client-cockpit.css";

type Counts = ReturnType<typeof clientDelivery>["counts"];
type Tone = "active" | "upcoming" | "complete" | "neutral";

function dotPosition(index: number, count: number, span: number, start: number, radius: number) {
  const fraction = span === 360 ? index / count : index / (count - 1);
  const angle = (start + fraction * span) * Math.PI / 180;
  return { cx: 50 + radius * Math.cos(angle), cy: 50 + radius * Math.sin(angle) };
}

export function ProgressArc({ value, label, tone = "active", detail }: {
  value?: number;
  label: string;
  tone?: Tone | "risk";
  detail?: string;
}) {
  const message = value === undefined ? "Not yet measurable" : percentText(value);
  return <span className="mi-progress-arc" data-tone={tone} role="img"
    aria-label={label + ", " + message + (detail ? ", " + detail : "")}>
    <svg focusable="false" aria-hidden="true" viewBox="0 0 100 100">
      {Array.from({ length: 29 }, (_, index) => {
        const filled = value !== undefined && value > 0 && index < Math.max(1, Math.round(value * 29 / 100));
        return <circle key={index} {...dotPosition(index, 29, 270, 135, 36)} r="2.35" data-filled={filled}
          style={{ "--dot-order": index } as CSSProperties} />;
      })}
    </svg>
    <span aria-hidden="true">{value === undefined ? "—" : message}</span>
  </span>;
}

const statuses = [
  { tone: "active", label: "In progress", filter: "active" },
  { tone: "upcoming", label: "Upcoming", filter: "upcoming" },
  { tone: "complete", label: "Completed", filter: "completed" },
  { tone: "neutral", label: "Other", filter: "other" },
] as const;

export function StatusComposition({ counts, onFilter, label = "Portfolio status composition" }: {
  counts: Counts;
  onFilter: (filter: ProjectFilter) => void;
  label?: string;
}) {
  const [inspected, inspect] = useState<ProjectFilter>();
  const other = counts.all - counts.active - counts.completed - counts.upcoming;
  const statusRows = statuses.map(status => ({
    ...status,
    count: status.filter === "other" ? other : counts[status.filter],
  }));
  const active = statusRows.find(row => row.filter === inspected);
  const totalDots = 56;
  const parts = statusRows.filter(row => row.count > 0).map(row => ({
    ...row,
    dots: Math.max(1, Math.floor(row.count * totalDots / counts.all)),
  }));
  const partitionSize = parts.reduce((sum, part) => sum + part.dots, 0);
  const dots = parts.flatMap(part => Array.from({ length: part.dots }, () => part));
  return <section className="mi-status-composition" aria-label={label}>
    <div className="mi-status-wheel" aria-hidden="true">
      <svg focusable="false" viewBox="0 0 100 100">
        {Array.from({ length: partitionSize || totalDots }, (_, index) => {
          const part = dots[index];
          return <circle key={index} {...dotPosition(index, partitionSize || totalDots, 360, -90, 40)} r="1.7"
            data-tone={part?.tone} data-muted={Boolean(active && part?.filter !== active.filter)}
            style={{ "--dot-order": index } as CSSProperties} />;
        })}
      </svg>
      <div><strong>{active ? active.count : counts.all}</strong><small>{active?.label ?? "Projects"}</small></div>
    </div>
    <div className="mi-status-composition-key">
      <h3>{label}</h3>
      <div className="mi-status-legend">
        {statusRows.map(({ label: status, count, filter, tone }) => {
          const percentage = metricPercent(count, counts.all);
          return <button type="button" key={filter} data-tone={tone} data-inspected={filter === active?.filter || undefined}
            onPointerEnter={() => inspect(filter)} onPointerLeave={() => inspect(undefined)}
            onFocus={() => inspect(filter)} onBlur={() => inspect(undefined)} onClick={() => onFilter(filter)}
            aria-label={status + " status, " + count + " of " + counts.all + " approved projects" +
              (percentage === undefined ? "" : ", " + percentText(percentage))}>
            <i aria-hidden="true" /> <span>{status}</span>
            <b>{percentage === undefined ? "—" : percentText(percentage)}</b>
          </button>;
        })}
      </div>
      <p aria-live="polite">{active
        ? active.count + " of " + counts.all + " approved delivery projects"
        : counts.all ? "Current approved delivery projects" : "No approved delivery projects yet"}</p>
    </div>
  </section>;
}

export function DeliveryTrends({ counts, projects, onFilter, onProject, label = "Delivery trends" }: {
  counts: Counts;
  projects: ReturnType<typeof clientDelivery>["projects"];
  onFilter: (filter: ProjectFilter) => void;
  onProject: (id: string) => void;
  label?: string;
}) {
  const [metric, setMetric] = useState<"completed" | "active">("completed");
  const [historyUnit, setHistoryUnit] = useState<"count" | "share">("count");
  const [chosenMonth, setMonth] = useState<string>();
  const [hoveredMonth, inspect] = useState<string>();
  const datedHistory = metric === "completed" ? projectCompletionHistory(projects) : [];
  const history = completionMonths(datedHistory);
  const dated = datedHistory.reduce((total, bucket) => total + bucket.projects.length, 0);
  const undated = projects.filter(item => item.completed || item.project.status === "closed" && item.delivery?.completedOn).length - dated;
  const showingShare = historyUnit === "share" && counts.all > 0;
  const shareOfPortfolio = (count: number) => metricPercent(count, counts.all) ?? 0;
  const selected = history.find(bucket => bucket.month === chosenMonth) ?? datedHistory.at(-1);
  const shown = history.find(bucket => bucket.month === hoveredMonth) ?? selected;
  const current = counts[metric];
  const percent = metricPercent(current, counts.all);
  const name = metric === "completed" ? "Completed projects" : "In-progress projects";
  const detail = current + " of " + counts.all + " approved delivery projects";
  return <section className="mi-exec-panel mi-trend-snapshot" aria-label={label}>
    <div className="mi-exec-heading"><div><h3>{label}</h3><p>Current approved portfolio</p></div></div>
    <div className="mi-trend-switch" role="group" aria-label="Trend metric">
      <button type="button" aria-pressed={metric === "completed"} onClick={() => setMetric("completed")}>Completion trend</button>
      <button type="button" aria-pressed={metric === "active"} onClick={() => setMetric("active")}>Active projects</button>
    </div>
    <button type="button" className="mi-trend-result" onClick={() => onFilter(metric)}
      aria-label={name + ", " + detail + (percent === undefined ? ", not yet measurable" : ", " + percentText(percent))}>
      <ProgressArc value={percent} label={name} detail={detail} tone={metric === "completed" ? "complete" : "active"} />
      <span><b>{name}</b><small>{counts.all ? detail : "Not yet measurable"}</small></span>
      <ArrowUpRight aria-hidden="true" size={17} />
    </button>
    {selected && shown ? <div className="mi-client-completion-history">
      <p>Monthly counts include projects with a published completion date.</p>
      <div className="mi-insight-segments" role="group" aria-label="Completion display">
        <button type="button" aria-pressed={!showingShare} onClick={() => setHistoryUnit("count")}>Count</button>
        <button type="button" disabled={!counts.all} aria-pressed={showingShare} onClick={() => setHistoryUnit("share")}>Portfolio share</button>
      </div>
      <TrendPlot label="Dated project completions" unit={showingShare ? "percent" : "projects"} rows={history.map(bucket => ({
        id: bucket.id, month: bucket.month, label: reportMonth(bucket.month), value: showingShare ? shareOfPortfolio(bucket.projects.length) : bucket.projects.length,
      }))} active={selected.id} onSelect={setMonth} onInspect={inspect}
        spokenValue={value => showingShare ? percentText(value) + " of the current approved portfolio" : value + (value === 1 ? " completion" : " completions")} />
      <p aria-live="polite"><strong>{reportMonth(shown.month)}</strong> · {shown.projects.length} {shown.projects.length === 1 ? "project completed" : "projects completed"}{showingShare && " · " + percentText(shareOfPortfolio(shown.projects.length)) + " of the current approved portfolio"}</p>
      <details key={selected.month} open><summary>See projects completed in {reportMonth(selected.month)}</summary>{selected.projects.length === 0 && <p>No dated completions in this month.</p>}<ul>{selected.projects.map(project => <li key={project.id}>
        <button type="button" className="exec-text-button" onClick={() => onProject(project.id)}>{project.name} <ArrowUpRight size={14} aria-hidden="true" /></button>
      </li>)}</ul></details>
      <details><summary>Show completion data table</summary><table>
        <caption>Published project completions by month</caption><thead><tr><th scope="col">Month</th><th scope="col">Projects completed</th></tr></thead>
        <tbody>{history.map(bucket => <tr key={bucket.id}><th scope="row">{reportMonth(bucket.month)}</th><td>{bucket.projects.length}</td></tr>)}</tbody>
      </table></details>
    </div> : <p className="mi-trend-empty">{metric === "active" ? "Trend tracking begins from the first verified historical snapshot." :
      "No dated project completions have been published."}</p>}
    {metric === "completed" && undated > 0 && <p className="mi-trend-empty">{undated} {undated === 1 ? "completed project is" : "completed projects are"} excluded from history because a verified completion date has not been published.</p>}
  </section>;
}

function completionMonths(dated: ReturnType<typeof projectCompletionHistory>) {
  if (!dated.length) return [];
  const known = new Map(dated.map(bucket => [bucket.month, bucket]));
  const last = dated.at(-1)!.month;
  const first = dated[0].month;
  const floor = String(Math.max(1000, Number(last.slice(0, 4)) - 10)).padStart(4, "0") + last.slice(4);
  const months = [];
  for (let month = first < floor ? floor : first; month <= last; month = followingTimeMonth(month)) {
    months.push(known.get(month) ?? { id: month, month, projects: [] });
    if (month === last) break;
  }
  return months;
}
