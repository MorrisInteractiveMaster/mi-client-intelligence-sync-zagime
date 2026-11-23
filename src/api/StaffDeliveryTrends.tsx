import { useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined } from "lucide-react";
import { calendarDate } from "../projects/delivery";
import type { StaffProjectSummary } from "../projects/model";
import { DottedTrack } from "./EffortVisuals";
import { reportMonth } from "./dashboard-format";
import { metricPercent } from "./insight-metrics";
import type { PulseStatus } from "./staff-overview-metrics";

export function StaffDeliveryTrends({ projects, active, completed, onProjects }: {
  projects?: StaffProjectSummary[];
  active: number;
  completed: number;
  onProjects: (status: PulseStatus) => void;
}) {
  const [series, setSeries] = useState<"completed" | "active">("completed");
  const months = new Map<string, StaffProjectSummary[]>();
  for (const project of projects ?? []) {
    const date = project.delivery?.completedOn;
    if (!calendarDate(date) || (project.status !== "completed" && project.status !== "closed")) continue;
    const month = date.slice(0, 7);
    const sameMonth = months.get(month) ?? [];
    sameMonth.push(project);
    months.set(month, sameMonth);
  }
  const markedComplete = series === "completed";
  const rows = [...months].sort(([first], [second]) => second.localeCompare(first));
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 6);
  const count = markedComplete ? completed : active;
  const label = markedComplete ? "Projects marked completed" : "Projects currently in progress";
  const caption = projects ? count + " of " + projects.length + " current portfolio projects" : undefined;

  return <section className="mi-cockpit-panel mi-staff-delivery-trends" aria-label="Delivery trends">
    <header className="mi-cockpit-heading">
      <div><p className="mi-cockpit-kicker"><ChartNoAxesCombined size={15} aria-hidden="true" /> Portfolio analytics</p><h3>Delivery trends</h3></div>
      <div className="mi-toggle-set" aria-label="Delivery trend measure">
        <button type="button" aria-pressed={markedComplete} onClick={() => setSeries("completed")}>Completions</button>
        <button type="button" aria-pressed={!markedComplete} onClick={() => setSeries("active")}>In progress</button>
      </div>
    </header>
    <DottedTrack label={label} tone={markedComplete ? "teal" : "blue"}
      value={projects ? metricPercent(count, projects.length) : undefined} detail={caption} />
    <button type="button" className="mi-cockpit-link" onClick={() => onProjects(series)}>
      {markedComplete ? "View completed projects" : "View projects in progress"} <ArrowUpRight size={15} aria-hidden="true" />
    </button>
    {!projects ? <p className="mi-effort-muted">Loading portfolio history…</p>
      : !markedComplete ? <p className="mi-effort-muted">Historical active-project counts have not been recorded. This chart shows the current portfolio.</p>
      : !rows.length ? <p className="mi-effort-muted">No dated project completions are available for a monthly trend.</p>
      : <div className="mi-completion-bars">
        <h4>Project completions with a recorded date</h4>
        <ul>{visible.map(([month, records]) => <li key={month}><details>
          <summary><span>{reportMonth(month)}</span><span className="mi-completion-dots" aria-hidden="true">
            {Array.from({ length: Math.min(records.length, 12) }, (_, index) => <i key={index} />)}
          </span><strong>{records.length}</strong></summary>
          <ul>{records.map(project => <li key={project.id}>{project.name}</li>)}</ul>
        </details></li>)}</ul>
        {rows.length > 6 && <button type="button" className="secure-secondary" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show recent completion months" : "Show all completion months"}
        </button>}
      </div>}
  </section>;
}
