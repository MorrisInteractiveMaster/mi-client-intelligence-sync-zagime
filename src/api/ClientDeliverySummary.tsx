import { ArrowUpRight, CircleAlert } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { clientProjectFilters, type clientDelivery, type ProjectFilter } from "./client-delivery";
import { reportHours } from "./dashboard-format";

type DeliveryPortfolio = ReturnType<typeof clientDelivery>;
type Budget = NonNullable<ProjectReport["hierarchy"]>[string];

export function BudgetUtilization({ budget, title = "Hour caps" }: { budget?: Budget; title?: string }) {
  const caps = [
    { label: "Monthly cap", cap: budget?.monthlyCap, used: budget?.monthlyCapUsed },
    { label: "Whole-project cap", cap: budget?.lifetimeCap, used: budget?.lifetimeCapUsed },
  ].filter(({cap}) => cap !== undefined && cap > 0);
  if (!caps.length) return null;
  return <section className="mi-budget" aria-label={title}>
    <h4>{title}</h4>
    {caps.map(({ label, cap, used }) => {
      const ratio = used !== undefined ? used / cap! : undefined;
      const state = ratio === undefined ? undefined : ratio > 1 ? "over" : ratio >= .9 ? "near" : "normal";
      return <div className="mi-budget-cap" data-cap={state} key={label}>
        <div><b>{label}</b><span>{used === undefined ? reportHours(cap!) + " h" : reportHours(used) + " / " + reportHours(cap!) + " h"}</span></div>
        {used !== undefined && <meter aria-label={title + ", " + label}
          aria-valuetext={reportHours(used) + " of " + reportHours(cap!) + " hours used"} min={0} max={cap!} value={Math.min(used, cap!)} />}
        {state === "over" && <small>Over cap by {reportHours(used! - cap!)} h</small>}
        {state === "near" && <small>{ratio === 1 ? "Cap reached" : "Approaching cap"}</small>}
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

export function ParentEngagementCard({ engagement, period, onOpen, onFilter }: {
  engagement: DeliveryPortfolio["parentRows"][number]; period: string; onOpen?: () => void; onFilter: (filter: ProjectFilter) => void;
}) {
  const blockers = engagement.counts.blocked;
  const overdue = engagement.projects.filter(item => item.overdue).length;
  return <article className="mi-engagement-card" data-attention={blockers > 0 || undefined}>
    <div className="mi-engagement-heading">
      <div><small>Parent engagement</small><h3>{engagement.name}</h3></div>
      {onOpen && <button type="button" className="exec-text-button" onClick={onOpen}>Open <span className="exec-sr-only">{engagement.name}</span><ArrowUpRight size={16} aria-hidden="true" /></button>}
    </div>
    <DeliveryMetrics counts={engagement.counts} seconds={engagement.seconds} period={period} onFilter={onFilter} />
    {(blockers > 0 || overdue > 0) && <p className="mi-engagement-risk"><CircleAlert size={15} aria-hidden="true" />
      {blockers > 0 ? blockers + (blockers === 1 ? " project blocked" : " projects blocked") : overdue + (overdue === 1 ? " project overdue" : " projects overdue")}</p>}
    <BudgetUtilization budget={engagement.delivery} title="Parent engagement hour caps" />
  </article>;
}
