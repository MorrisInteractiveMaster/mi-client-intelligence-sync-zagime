import { useState } from "react";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { publicProject, type ProjectReport, type StaffProjectSummary } from "../projects/model";
import type { PublishedPortfolio } from "../projects/portfolio";
import { projectMeasures } from "./client-delivery";
import { EffortToggle, type EffortUnit } from "./ClientIntelligence";
import { ProgressArc } from "./ClientCockpitVisuals";
import { BudgetUtilization } from "./ClientDeliverySummary";
import { projectStatus, reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { PersonPhoto } from "./PersonPhoto";

type Delivery = NonNullable<ProjectReport["hierarchy"]>[string];
type Props = {
  project: ProjectReport["projects"][number];
  period: string;
  placement?: PublishedPortfolio["placements"][number];
  team: PublishedPortfolio["directory"];
  onLink?: (destination: string) => void;
  detail?: boolean;
  delivery?: Delivery;
  history?: PublishedPortfolio["history"];
  parent?: { id: string; name: string; budget?: Delivery };
  department?: { id: string; name: string };
  descendantTotals?: { monthly: number; lifetime: number; descendants: number };
};

export function ProjectReportPreview({ project, period }: { project: StaffProjectSummary; period: string }) {
  const [open, setOpen] = useState(false);
  return <details className="exec-preview" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Preview approved content</summary>
    {open && <>
      <p className="secure-muted">Project card for an authorized client after publication.</p>
      <ProjectReportingCard project={publicProject({ ...project, lifetimeSeconds: project.lifetimeSeconds - (project.workOrderEffort?.lifetimeRemainingSeconds ?? 0) },
        project.workOrderEffort?.assignedSeconds ?? project.seconds)} period={period}
        placement={project.reportPreview?.placement} team={project.reportPreview?.team ?? []} />
    </>}
  </details>;
}

export function ProjectReportingCard({ project, period, placement, team, onLink, detail, delivery, history, parent, department, descendantTotals }: Props) {
  const [unit, setUnit] = useState<EffortUnit>("percentage");
  const [detailsOpen, setDetailsOpen] = useState(Boolean(detail));
  const { start, deadline, completion, active, upcoming, blocked, near, dueSoon, overdue, risk } = projectMeasures(project, delivery, placement, today());
  const isManager = (id: string) => delivery?.managerIds?.includes(id) || placement?.managerIds?.includes(id) || placement?.leadId === id;
  const teamRole = (member: PublishedPortfolio["directory"][number]) => [isManager(member.id) && "Project manager",
    placement?.facilitatorIds?.includes(member.id) && "Facilitator"].filter(Boolean).join(" · ") || member.role;
  const managers = team.filter(member => isManager(member.id));
  const arrangement = delivery?.type && { hourly: "Hourly", "fixed-fee": "Fixed fee", training: "Training & Workshops", workshop: "Training & Workshops" }[delivery.type];
  const tone = blocked || overdue ? "risk" : project.status === "completed" ? "complete" : near ? "near" : dueSoon ? "warning" : undefined;
  return <article className="secure-card secure-published-project mi-project-card" data-progress-tone={tone}>
    <header className="mi-project-card-header">
      <div><p className="secure-badge" data-status={active ? "active" : project.status}>
        {placement?.archived ? "Archived" : upcoming ? "Upcoming" : projectStatus[active ? "active" : project.status]}
      </p>
      {!detail && <h3>{project.name}</h3>}</div>
      <div className="mi-project-completion">
        <ProgressArc value={completion} label={project.name + " work completion"}
          detail="out of 100% of planned work" tone={blocked ? "risk" : project.status === "completed" ? "complete" : "active"} />
        <span aria-hidden="true">Work completion</span>
        <span className="exec-sr-only">{completion === undefined ? "Work completion not recorded" : completion + "% work completion"}</span>
      </div>
    </header>
    {(parent || department) && <div className="mi-project-lineage">
      {parent && (onLink ? <button type="button" className="exec-text-button" onClick={() => onLink("group:" + parent.id)}>{parent.name}</button> : <span>{parent.name}</span>)}
      {department && (onLink ? <button type="button" className="exec-text-button" onClick={() => onLink("area:" + department.id)}>{department.name}</button> : <span>{department.name}</span>)}
    </div>}
    {blocked ? <p className="mi-project-risk"><CircleAlert size={16} aria-hidden="true" /><span><b>Blocked</b>{risk && " · " + risk}</span></p>
      : overdue ? <p className="mi-project-risk"><CircleAlert size={16} aria-hidden="true" />Overdue · {reportDay(overdue)}</p>
        : dueSoon ? <p className="mi-project-warning">Deadline approaching</p>
          : near ? <p className="mi-project-near">Nearing completion</p> : null}
    {delivery?.blocker?.active === false && delivery.blocker.message && <p className="secure-message">Blocker resolved · {delivery.blocker.message}</p>}
    {(start || deadline) && <p className="mi-project-dates">
      {start && <span>Start {reportDay(start)}</span>}{deadline && <span>Expected completion {reportDay(deadline)}</span>}
    </p>}
    {detail && <dl className="mi-project-facts" aria-label="Approved project facts">
      <div><dt>Arrangement</dt><dd>{arrangement ?? "Not published"}</dd></div>
      <div><dt>Expected completion</dt><dd>{deadline ? reportDay(deadline) : "Not published"}</dd></div>
      <div><dt>Completion date</dt><dd>{delivery?.completedOn ? reportDay(delivery.completedOn) : "Not yet recorded"}</dd></div>
    </dl>}
    {project.description && <p className="secure-project-description">{project.description}</p>}
    {detail && Boolean(project.milestones?.length) && (() => {
      const approved = (project.milestones ?? []).filter(item => item.status !== "waived");
      if (!approved.length) return null;
      const complete = approved.filter(item => item.completed).length;
      return <div className="mi-v4-detail-milestones">
        <span><b>Milestone progress</b> · {complete} of {approved.length} approved milestones completed</span>
        <progress value={complete} max={approved.length} aria-label="Completed approved milestones" />
      </div>;
    })()}
    {!detail && !detailsOpen && Boolean(project.milestones?.length) && <ol className="mi-card-milestones" aria-label="Approved milestone highlights">
      {[...(project.milestones ?? [])].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).slice(0, 3).map(item => <li
        key={item.id} data-complete={item.completed || undefined} data-blocked={item.status === "blocked" || undefined}>
        <span>{item.title} <small>· {milestoneStatus(item)}</small></span>
      </li>)}
    </ol>}
    <dl className="secure-project-hours">
      <div><dt>{period} approved effort</dt><dd>{reportHours(descendantTotals?.monthly ?? project.seconds)} h</dd></div>
      <div><dt>Whole-project approved effort</dt><dd>{reportHours(descendantTotals?.lifetime ?? project.lifetimeSeconds)} h</dd></div>
    </dl>
    {detail && (delivery?.monthlyCap !== undefined || delivery?.lifetimeCap !== undefined) && <EffortToggle unit={unit} onChange={setUnit} />}
    {detail && delivery?.monthlyCap === undefined && delivery?.lifetimeCap === undefined && <p className="secure-muted">No published cap</p>}
    <BudgetUtilization budget={delivery} showHours={detail && unit === "hours"} title={delivery?.kind === "engagement" ? "Parent engagement hour caps" : "Delivery project hour caps"} />
    {team.length > 0 && <div className="mi-project-people">
      <div className="mi-project-faces" aria-hidden="true">{(managers.length ? managers : team).slice(0, 3).map(member =>
        <PersonPhoto key={member.id} name={member.name} photo={member.photo} alt="" />)}</div>
      <span>{managers.length ? managers.map(member => member.name).join(", ") : team.length + (team.length === 1 ? " team member" : " team members")}</span>
    </div>}
    {detail ? <div className="mi-project-detail-panel mi-project-document" aria-label="Project detail sections">
      {detailDetails()}
    </div> : <details className="mi-project-detail-panel" onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>Project details</summary>
      {detailsOpen && detailDetails()}
    </details>}
    {onLink && !detail && <button type="button" className="exec-text-button intel-open-project" onClick={() => onLink("project:" + project.id)}>
      Open project <span className="exec-sr-only">{project.name}</span><ArrowUpRight size={16} aria-hidden="true" />
    </button>}
  </article>;

  function detailDetails() {
    return <>
      {(Boolean(detail && descendantTotals) || project.plan.targetSeconds > 0) && <dl className="secure-project-hours">
        {detail && descendantTotals && <div><dt>Approved effort on this project in {period}</dt><dd>{reportHours(project.seconds)} h</dd></div>}
        {project.plan.targetSeconds > 0 && <div><dt>{project.plan.basis === "monthly" ? "Monthly" : "Lifetime"} reporting target</dt><dd>{reportHours(project.plan.targetSeconds)} h</dd></div>}
      </dl>}
      <BudgetUtilization budget={parent?.budget} showHours={detail && unit === "hours"} title="Parent engagement hour caps" />
      {Boolean(history?.length) && <div>
        <h4>Reported effort by month</h4>
        <ul className="mi-project-history">{history?.map(row => <li key={row.month}>
          <time dateTime={row.month}>{reportMonth(row.month)}</time><strong>{reportHours(row.seconds)} h</strong>
        </li>)}</ul>
      </div>}
      {team.length > 0 && <div className="exec-project-team">
        <h4>Project team</h4>
        <ul>{team.map(member => <li key={member.id}>
          <PersonPhoto name={member.name} photo={member.photo} alt={member.photoAlt} />
          <div>{onLink ? <button type="button" className="exec-text-button" onClick={() => onLink("contact:" + member.id)}>{member.name}</button> : member.name}
            {teamRole(member) && <div>{teamRole(member)}</div>}</div>
        </li>)}</ul>
      </div>}
      {Boolean(project.milestones?.length) && <div>
        <h4>Milestones</h4>
        <ul className="secure-timeline">
          {[...(project.milestones ?? [])].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).map(item => <li key={item.id}>
            {onLink ? <button type="button" className="exec-text-button" onClick={() => onLink("milestone:" + project.id + ":" + item.id)}>{item.title}</button> : <b>{item.title}</b>}
            <p>{item.date && <><time dateTime={item.date}>{reportDay(item.date)}</time>{" · "}</>}
              {milestoneStatus(item)}</p>
            {item.blocker?.message && <p className={item.blocker.resolvedOn ? undefined : "mi-project-risk"}>
              {item.blocker.resolvedOn ? "Resolved " + reportDay(item.blocker.resolvedOn) : "Blocked"} · {item.blocker.message}</p>}
          </li>)}
        </ul>
      </div>}
      {Boolean(project.updates?.length) && <div>
        <h4>Project updates</h4>
        <ul className="secure-timeline">
          {[...(project.updates ?? [])].sort((a, b) => b.date.localeCompare(a.date)).map(item => <li key={item.id}>
            <time dateTime={item.date}>{reportDay(item.date)}</time><b>{item.title}</b><p className="secure-project-description">{item.body}</p>
          </li>)}
        </ul>
      </div>}
    </>;
  }
}

function milestoneStatus(item: NonNullable<ProjectReport["projects"][number]["milestones"]>[number]) {
  return item.completed ? "Complete" : item.status === "waived" ? "Waived" : item.status === "blocked" ? "Blocked" : item.status === "in-progress" ? "In progress" : "Pending";
}
