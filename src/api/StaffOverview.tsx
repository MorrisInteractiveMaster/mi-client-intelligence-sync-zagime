import { useState, type ReactNode } from "react";
import { ArrowUpRight, CircleAlert, FolderKanban, Gauge, ListFilter } from "lucide-react";
import type { StaffProjectSummary } from "../projects/model";
import type { TimeStatus } from "../projects/time";
import { AllocationCoverage, SourceMix } from "./EffortVisuals";
import { metricPercent, percentText } from "./insight-metrics";
import { StaffDeliveryTrends } from "./StaffDeliveryTrends";
import { OperationsTrend } from "./OperationsTrend";
import { reportDay, reportHours, reportMonth, reportTimestamp, today } from "./dashboard-format";
import { staffPulseStatus, type PulseStatus } from "./staff-overview-metrics";
import type { SourceSummary } from "./types";
import "./staff-overview.css";

const pulseRows: { status: PulseStatus; label: string }[] = [
  { status: "active", label: "In progress" },
  { status: "upcoming", label: "Upcoming" },
  { status: "completed", label: "Completed" },
  { status: "blocked", label: "Blocked" },
  { status: "other", label: "Other statuses" },
];

type EventLink = { project: StaffProjectSummary; date: string };
export function StaffOverview({
  projects, time, timeError, trend, trendLoading, timeStatus, overCap, upcoming, training, toolbar, onMonth, onProject,
  onProjects, onTime, onReviewTime, onHealth, onMix,
}: {
  projects?: StaffProjectSummary[];
  time?: SourceSummary;
  timeError: boolean;
  trend?: SourceSummary;
  trendLoading: boolean;
  timeStatus?: TimeStatus;
  overCap?: number;
  upcoming: EventLink[];
  training: EventLink[];
  toolbar: ReactNode;
  onMonth: (month: string) => void;
  onProject: (id: string) => void;
  onProjects: (status: PulseStatus) => void;
  onTime: () => void;
  onReviewTime: () => void;
  onHealth: () => void;
  onMix: (kind: "workOrder" | "consultant", id: string) => void;
}) {
  const [dimension, setDimension] = useState<"workOrder" | "consultant">("workOrder");
  const scoped = projects?.filter(project => project.delivery?.kind !== "service-area");
  const total = scoped?.length ?? 0;
  const day = today();
  const statuses = scoped?.map(project => staffPulseStatus(project, day)) ?? [];
  const rows = pulseRows.map(row => ({ ...row, count: statuses.filter(status => status === row.status).length }));
  const dots = total > 0 ? Array.from({ length: 36 }, (_, index) => {
    let share = (index + .5) / 36 * total;
    return rows.find(row => (share -= row.count) <= 0)?.status;
  }) : [];
  const period = time?.period.kind === "all" ? "All history" : time?.period.kind === "month" && time.period.start
    ? reportMonth(time.period.start.slice(0, 7))
    : time?.period.start && time.period.end ? reportDay(time.period.start) + "–" + reportDay(time.period.end) : undefined;
  const source = time?.hours;
  const review = time?.counts.review;
  const blocked = rows.find(row => row.status === "blocked")?.count ?? 0;

  return <section className="mi-staff-cockpit" aria-label="Morris operating overview">
    {toolbar && <div className="mi-cockpit-toolbar">{toolbar}</div>}
    <div className="mi-cockpit-grid">
      <section className="mi-cockpit-panel mi-staff-pulse" aria-label="Delivery pulse">
        <p className="mi-cockpit-kicker"><FolderKanban size={15} aria-hidden="true" /> Current portfolio</p>
        <div className="mi-pulse-title"><h3>Delivery pulse</h3><strong>{scoped ? total : "—"} <small>projects</small></strong></div>
        {dots.length > 0 && <div className="mi-pulse-constellation" aria-hidden="true">
          {dots.map((status, index) => <i key={index} data-status={status} />)}
        </div>}
        {scoped?.length === 0 && <p className="mi-effort-muted">Create a project to begin tracking delivery.</p>}
        <div className="mi-pulse-choices" aria-label="Filter projects by status">
          {rows.map(({ status, label, count }) => {
            const share = metricPercent(count, total);
            const exact = scoped ? label + ": " + count + " of " + total + " projects" + (share !== undefined ? " (" + percentText(share) + ")" : "") : label;
            return <button type="button" key={status} data-status={status} title={exact} aria-label={exact} onClick={() => onProjects(status)}>
              <span><i aria-hidden="true" />{label}</span><b>{scoped ? count : "—"}</b>
            </button>;
          })}
        </div>
      </section>
      <div className="mi-cockpit-panel mi-staff-coverage">
        <AllocationCoverage hours={source} loading={!time && !timeError} />
        {Boolean(source?.automaticallyClassifiedSeconds) && <p className="mi-effort-muted">
          {reportHours(source?.automaticallyClassifiedSeconds ?? 0)} h automatically classified for staff review.
          {" "}{reportHours(Math.max(0, (source?.unallocatedSeconds ?? 0) - (source?.automaticallyClassifiedSeconds ?? 0)))} h remain unclassified.
        </p>}
        {timeError && <p className="mi-effort-muted">The selected Time scope could not be loaded.</p>}
        {period && <p className="mi-effort-muted">{period}</p>}
        <button type="button" className="mi-cockpit-link" onClick={onTime}>Open Time Allocation <ArrowUpRight size={16} aria-hidden="true" /></button>
      </div>
      <section className="mi-cockpit-panel mi-staff-priorities" aria-label="Action priorities">
        <p className="mi-cockpit-kicker"><CircleAlert size={15} aria-hidden="true" /> Review queue</p>
        <h3>Action priorities</h3>
        <div className="mi-priority-actions">
          <button type="button" onClick={onReviewTime}><b>{review ?? "—"}</b><span>Allocations awaiting review</span><ArrowUpRight size={16} aria-hidden="true" /></button>
          <button type="button" onClick={() => onProjects("blocked")}><b>{scoped ? blocked : "—"}</b><span>Projects with blockers</span><ArrowUpRight size={16} aria-hidden="true" /></button>
          <button type="button" onClick={onHealth}><b>{overCap ?? "—"}</b><span>Projects over cap</span><ArrowUpRight size={16} aria-hidden="true" /></button>
        </div>
      </section>
      <OperationsTrend summary={trend} loading={trendLoading} onMonth={onMonth} />
      <section className="mi-cockpit-panel mi-staff-mix" aria-label="Recorded time mix">
        <header className="mi-cockpit-heading">
          <div><p className="mi-cockpit-kicker"><ListFilter size={15} aria-hidden="true" /> {period ?? "Selected scope"}</p>
          <h3>Recorded time mix</h3></div>
          <div className="mi-toggle-set" aria-label="Group recorded time">
            <button type="button" aria-pressed={dimension === "workOrder"} onClick={() => setDimension("workOrder")}>Work orders</button>
            <button type="button" aria-pressed={dimension === "consultant"} onClick={() => setDimension("consultant")}>Consultants</button>
          </div>
        </header>
        {source ? <SourceMix key={dimension} groups={dimension === "workOrder" ? source.byWorkOrder : source.byConsultant}
          denominator={source.recordedSeconds} label="Percentage of recorded time"
          fallbackId={dimension === "consultant" ? "unavailable" : undefined} onSelect={id => onMix(dimension, id)} />
          : <p className="mi-effort-muted">{timeError ? "Recorded time unavailable." : "Loading recorded time…"}</p>}
      </section>
      <StaffDeliveryTrends projects={scoped} active={rows.find(row => row.status === "active")?.count ?? 0}
        completed={rows.find(row => row.status === "completed")?.count ?? 0} onProjects={onProjects} />
      <section className="mi-cockpit-panel mi-staff-schedule" aria-label="Upcoming delivery">
        <p className="mi-cockpit-kicker">Schedule</p><h3>Upcoming delivery</h3>
        <ScheduleItems title="Upcoming deadlines" items={upcoming} empty="No upcoming deadlines are recorded." onProject={onProject} />
        <ScheduleItems title="Upcoming training" items={training} empty="No upcoming sessions are recorded." onProject={onProject} />
      </section>
      <section className="mi-cockpit-panel mi-staff-reconciliation" aria-label="Work order reconciliation">
        <p className="mi-cockpit-kicker"><Gauge size={15} aria-hidden="true" /> {period ?? "Selected scope"}</p><h3>Work-order reconciliation</h3>
        <p className="mi-effort-muted">Time recorded against a verified work order can remain at parent level until staff assign it to a delivery project.</p>
        {source && <dl className="mi-ledger-detail mi-reconciliation-values">
          <div><dt>Work-order attributed</dt><dd>{reportHours(source.attributedSeconds ?? 0)} h</dd></div>
          <div><dt>Remaining at parent level</dt><dd>{reportHours(source.remainingAtParentSeconds ?? 0)} h</dd></div>
          <div><dt>Classified hours</dt><dd>{reportHours(source.classifiedSeconds ?? 0)} h</dd></div>
          {source.recordedSeconds > (source.attributedSeconds ?? 0) && <div>
            <dt>Hours without a verified work-order association</dt><dd>{reportHours(source.recordedSeconds - (source.attributedSeconds ?? 0))} h</dd>
          </div>}
        </dl>}
        {timeStatus?.lastDailySuccess && <p className="mi-effort-muted mi-reconcile-sync">Last successful Time sync {reportTimestamp(timeStatus.lastDailySuccess)}</p>}
      </section>
    </div>
  </section>;
}

function ScheduleItems({ title, items, empty, onProject }: { title: string; items: EventLink[]; empty: string; onProject: (id: string) => void }) {
  return <div className="mi-staff-events"><h4>{title}</h4>
    {items.length ? <ul>{items.map(({ project, date }) => <li key={project.id + date}>
      <button type="button" className="mi-cockpit-link" onClick={() => onProject(project.id)}>
        <span>{project.name}</span><time dateTime={date}>{reportDay(date)}</time>
      </button>
    </li>)}</ul> : <p className="mi-effort-muted">{empty}</p>}
  </div>;
}
