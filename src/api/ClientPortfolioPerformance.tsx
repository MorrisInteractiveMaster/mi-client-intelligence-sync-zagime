import { ArrowUpRight } from "lucide-react";
import { Fragment } from "react";
import { projectCompletionHistory, type clientDelivery, type ProjectFilter } from "./client-delivery";
import { completionBand, completionBands, milestoneState, milestoneStates } from "./project-explorer";
import { portfolioStatuses, segmentCount } from "./ClientProjectExplorer";
import { reportMonth, today } from "./dashboard-format";
import { percentText } from "./insight-metrics";
import type { OpenClientView } from "./ClientIntelligence";

type Delivery = ReturnType<typeof clientDelivery>;

function Comparison({ label, count, total, onOpen }: { label: string; count: number; total: number; onOpen: () => void }) {
  const detail = count + " of " + total + (total ? " · " + percentText(count / total * 100) : "");
  return <button type="button" title={detail} aria-label={label + " · " + detail} onClick={onOpen} className="mi-v4-comparison">
    <span>{label}</span><span className="mi-v4-comparison-track" aria-hidden="true"><i style={{ inlineSize: (total ? count / total * 100 : 0) + "%" }} /></span>
    <b>{count}</b><ArrowUpRight size={13} aria-hidden="true" />
  </button>;
}

export function CompletionPerformance({ delivery, onLink }: { delivery: Delivery; onLink: OpenClientView }) {
  const completeMonths = projectCompletionHistory(delivery.projects);
  const displayed = completeMonths.slice(-12);
  const maximum = Math.max(1, ...displayed.map(item => item.projects.length));
  return <div className="mi-v4-analytics-grid">
    <section className="mi-exec-panel" aria-label="Project completion distribution">
      <div className="mi-exec-heading"><div><h3>Work completion</h3><p>Measured assessments across approved delivery projects</p></div></div>
      <div className="mi-v4-comparisons">{completionBands.map(([key, label]) => <Comparison key={key} label={label} total={delivery.counts.all}
        count={delivery.projects.filter(row => completionBand(row.completion) === key).length}
        onOpen={() => onLink("projects", undefined, "all", { completion: key })} />)}</div>
    </section>
    <section className="mi-exec-panel" aria-label="Completed projects by month">
      <div className="mi-exec-heading"><div><h3>Completed projects by month</h3><p>Based on published completion dates</p></div></div>
      {displayed.length ? <div className="mi-v4-month-scroll"><div className="mi-v4-columns" style={{ gridTemplateColumns: "repeat(" + displayed.length + ",minmax(52px,1fr))" }}>
        {displayed.map(item => {
          const detail = reportMonth(item.month) + " · " + item.projects.length + " · " + item.projects.map(project => project.name).join(", ");
          return <button type="button" key={item.id} aria-label={detail} title={detail}
            onClick={() => onLink("projects", undefined, "all", { completedMonth: item.month })}>
            <b>{item.projects.length}</b>
            <span aria-hidden="true" className="mi-v4-column" style={{ blockSize: Math.max(10, item.projects.length / maximum * 76) }} />
            <span>{reportMonth(item.month)}</span>
          </button>;
        })}
      </div></div> : <p className="mi-cockpit-empty">No published completion dates are available.</p>}
      {delivery.counts.completed > 0 && <button className="exec-text-button" type="button" onClick={() => onLink("projects", undefined, "completed")}>View completed projects <ArrowUpRight size={14} aria-hidden="true" /></button>}
    </section>
  </div>;
}

export function MilestonePerformance({ delivery, onLink }: { delivery: Delivery; onLink: OpenClientView }) {
  const date = today();
  const allMilestones = delivery.projects.flatMap(row => row.project.milestones ?? []).filter(item => item.status !== "waived");
  return <section className="mi-exec-panel" aria-label="Milestone performance">
    <div className="mi-exec-heading"><div><h3>Milestone performance</h3><p>Milestones approved for client reporting</p></div></div>
    {allMilestones.length ? <>
      <div className="mi-v4-comparisons">{milestoneStates.map(([key, label]) => <Comparison key={key} label={label} total={allMilestones.length}
        count={allMilestones.filter(item => milestoneState(item, date) === key).length}
        onOpen={() => onLink("projects", undefined, "all", { milestone: key })} />)}</div>
      {delivery.departmentRows.some(department => department.projects.some(row => row.project.milestones?.length)) &&
        <details className="mi-v4-breakdown"><summary>Milestones by department</summary>
          <div className="mi-v4-comparisons">{delivery.departmentRows.map(department => {
            const milestones = department.projects.flatMap(row => row.project.milestones ?? []).filter(item => item.status !== "waived");
            return milestones.length > 0 && <Comparison key={department.id} label={department.name + " completed"} total={milestones.length}
              count={milestones.filter(item => milestoneState(item, date) === "completed").length}
              onOpen={() => onLink("projects", undefined, "all", { department: department.id, milestone: "completed" })} />;
          })}</div>
        </details>}
    </> : <p className="mi-cockpit-empty">No approved milestones are available.</p>}
  </section>;
}

export function ParentPerformance({ delivery, onLink }: { delivery: Delivery; onLink: OpenClientView }) {
  const max = Math.max(1, ...delivery.parentRows.map(row => row.counts.all));
  return <section className="mi-exec-panel" aria-label="Parent engagements">
    <div className="mi-exec-heading"><div><h3>Parent engagements</h3><p>Compare delivery counts and measured completion</p></div>
      <button type="button" className="exec-text-button" onClick={() => onLink("engagements")}>View engagements <ArrowUpRight size={14} aria-hidden="true" /></button></div>
    {delivery.parentRows.length ? <div className="mi-v4-parent-list">{delivery.parentRows.map(row => {
      const assessments = row.projects.flatMap(item => item.completion === undefined ? [] : [item.completion]);
      const average = assessments.length ? percentText(assessments.reduce((sum, value) => sum + value, 0) / assessments.length) : "Not assessed";
      return <Fragment key={row.id}>
        <div className="mi-v4-stack-row">
          <button className="exec-text-button mi-v4-stack-label" type="button" onClick={() => onLink("group:" + row.id)}>{row.name}</button>
          <div className="mi-v4-stack-rail"><div className="mi-v4-stack" style={{ inlineSize: row.counts.all / max * 100 + "%" }}>
            {portfolioStatuses.map(([status, label]) => {
              const count = segmentCount(row.counts, status);
              const detail = label + " · " + count + " of " + row.counts.all + (count ? " · " + percentText(count / row.counts.all * 100) : "");
              return count > 0 && <button type="button" className="mi-v4-stack-segment" key={status} data-state={status} style={{ flexGrow: count }}
                aria-label={row.name + " · " + detail} title={detail} onClick={() => onLink("projects", undefined, status as ProjectFilter, { parent: row.id })}>{count}</button>;
            })}
          </div></div>
          <b>{row.counts.all}</b>
        </div>
        <p>{average}{assessments.length > 0 && " average across " + assessments.length + " assessed"}</p>
      </Fragment>;
    })}</div> : <p className="mi-cockpit-empty">No approved parent engagements.</p>}
    {delivery.unaffiliated.length > 0 && <button type="button" className="exec-text-button" onClick={() => onLink("projects", undefined, "unaffiliated")}>
      {delivery.unaffiliated.length} independent delivery projects <ArrowUpRight size={14} aria-hidden="true" /></button>}
  </section>;
}
