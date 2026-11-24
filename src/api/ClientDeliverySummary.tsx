import { ArrowUpRight, CircleAlert } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { clientProjectFilters, type clientDelivery, type ProjectFilter } from "./client-delivery";
import { ProgressArc } from "./ClientCockpitVisuals";
import { DottedTrack } from "./EffortVisuals";
import { metricPercent } from "./insight-metrics";
import { reportHours } from "./dashboard-format";

type DeliveryPortfolio = ReturnType<typeof clientDelivery>;
type Budget = NonNullable<ProjectReport["hierarchy"]>[string];

export function BudgetUtilization({ budget, title = "Hour caps", showHours = false }: { budget?: Budget; title?: string; showHours?: boolean }) {
  const caps = [
    { label: "Monthly hours used", cap: budget?.monthlyCap, used: budget?.monthlyCapUsed },
    { label: "Whole-project hours used", cap: budget?.lifetimeCap, used: budget?.lifetimeCapUsed },
  ].filter((entry): entry is typeof entry & { cap: number } => entry.cap !== undefined);
  if (!caps.length) return null;
  return <section className="mi-budget" aria-label={title}>
    <h4>{title}</h4>
    {caps.map(({ label, cap, used }) => {
      const percentage = used === undefined ? undefined : metricPercent(used, cap);
      const exact = used === undefined ? reportHours(cap) + " h limit" : reportHours(used) + " of " + reportHours(cap) + " hours";
      return <div className="mi-budget-cap" key={label}>
        {showHours && <p className="mi-budget-exact">{exact}</p>}
        {cap === 0 && <p className="mi-budget-exact">Zero-hour cap · percentage does not apply.</p>}
        <DottedTrack value={percentage} label={label} tone={percentage !== undefined && percentage >= 90 ? "gold" : "blue"} detail={exact} />
        {used !== undefined && used > cap && <small className="mi-budget-warning">Over cap by {reportHours(used - cap)} h</small>}
        {percentage !== undefined && percentage >= 90 && percentage <= 100 && <small>{percentage === 100 ? "Cap reached" : "Approaching cap"}</small>}
      </div>;
    })}
  </section>;
}

export function DeliveryMetrics({ counts, seconds, period, onFilter, active, more }: {
  counts: DeliveryPortfolio["counts"]; seconds: number; period: string;
  onFilter: (filter: ProjectFilter) => void; active?: string; more?: boolean;
}) {
  const metrics: { filter: ProjectFilter; label: string; value: string | number }[] = [
    { filter: "all", label: "Delivery projects", value: counts.all },
    { filter: "active", label: "In progress", value: counts.active },
    { filter: "completed", label: "Completed", value: counts.completed },
    { filter: "upcoming", label: "Upcoming", value: counts.upcoming },
    { filter: "hours", label: period + " hours", value: reportHours(seconds) + " h" },
    ...(more ? [{ filter: "near" as const, label: clientProjectFilters.near, value: counts.near }] : []),
    { filter: "blocked", label: "Active blockers", value: counts.blocked },
  ];
  return <div className="mi-metric-strip">{metrics.map(({filter,label,value}) =>
    <button key={filter} type="button" aria-pressed={active === undefined ? undefined : filter === active}
      data-attention={filter === "blocked" && counts.blocked > 0 || undefined} onClick={() => onFilter(filter)}>
      <b>{value}</b><span>{label}</span>
    </button>)}</div>;
}

export function ParentEngagementCard({ engagement, period, reportSeconds, exactEffort, onOpen, onFilter }: {
  engagement: DeliveryPortfolio["parentRows"][number]; period: string; reportSeconds?: number; exactEffort?: boolean; onOpen?: () => void; onFilter: (filter: ProjectFilter) => void;
}) {
  const share = reportSeconds === undefined ? undefined : metricPercent(engagement.seconds, reportSeconds);
  const blockers = engagement.counts.blocked;
  const overdue = engagement.projects.filter(item => item.overdue).length;
  return <article className="mi-engagement-card" data-attention={blockers > 0 || undefined}>
    <div className="mi-engagement-heading">
      <div><small>Parent engagement</small><h3>{engagement.name}</h3></div>
      {onOpen && <button type="button" className="exec-text-button" onClick={onOpen}>Open <span className="exec-sr-only">{engagement.name}</span><ArrowUpRight size={16} aria-hidden="true" /></button>}
    </div>
    <button type="button" className="mi-engagement-completion mi-trend-result" onClick={() => onFilter("completed")}>
      <ProgressArc value={metricPercent(engagement.counts.completed, engagement.counts.all)} label="Completed delivery projects" tone="complete"
        detail={engagement.counts.completed + " of " + engagement.counts.all + " approved delivery projects"} />
      <span><b>{engagement.counts.completed} of {engagement.counts.all} delivery projects completed</b>
        <small>{engagement.counts.active} in progress · {engagement.counts.upcoming} upcoming</small></span>
      <ArrowUpRight size={15} aria-hidden="true" />
    </button>
    {share === undefined || exactEffort
      ? <p className="mi-engagement-effort">{period} approved effort <strong>{reportHours(engagement.seconds)} h</strong></p>
      : <DottedTrack value={share} label="Share of approved portfolio effort"
        detail={period + " · " + reportHours(engagement.seconds) + " of " + reportHours(reportSeconds!) + " approved hours"} />}
    {(blockers > 0 || overdue > 0) && <p className="mi-engagement-risk"><CircleAlert size={15} aria-hidden="true" />
      {blockers > 0 ? blockers + (blockers === 1 ? " project blocked" : " projects blocked") : overdue + (overdue === 1 ? " project overdue" : " projects overdue")}</p>}
    <BudgetUtilization budget={engagement.delivery} title="Parent engagement hour caps" />
  </article>;
}
