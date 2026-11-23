import { useState } from "react";
import { ArrowUpRight, CircleAlert } from "lucide-react";
import { publicProject, type ProjectReport, type StaffProjectSummary } from "../projects/model";
import type { PublishedPortfolio } from "../projects/portfolio";
import { projectMeasures } from "./client-delivery";
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
      <ProjectReportingCard project={publicProject(project, project.seconds)} period={period}
        placement={project.reportPreview?.placement} team={project.reportPreview?.team ?? []} />
    </>}
  </details>;
}

export function ProjectReportingCard({ project, period, placement, team, onLink, detail, delivery, history, parent, department, descendantTotals }: Props) {
  const { start, deadline, completion, upcoming, blocked, near, dueSoon, overdue, risk } = projectMeasures(project, delivery, placement, today());
  const isManager = (id: string) => placement?.managerIds?.includes(id) || placement?.leadId === id;
  const managers = team.filter(member => isManager(member.id));
  const hours = project.workOrderEffort;
  const tone = blocked || overdue ? "risk" : project.status === "completed" ? "complete" : near ? "near" : dueSoon ? "warning" : undefined;
  return <article className="secure-card secure-published-project mi-project-card" data-progress-tone={tone}>
    <p className="secure-badge" data-status={project.status}>
      {placement?.archived ? "Archived" : upcoming ? "Upcoming" : projectStatus[project.status]}
    </p>
    <h3>{project.name}</h3>
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
    {project.description && <p className="secure-project-description">{project.description}</p>}
    <div className="secure-progress">
      <span>{completion === undefined ? "Work completion not recorded" : completion + "% work completion"}</span>
      {completion !== undefined && <progress aria-label={project.name + " work completion"} max={100} value={completion} />}
    </div>
    <dl className="secure-project-hours">
      <div><dt>{period} hours</dt><dd>{reportHours(descendantTotals?.monthly ?? project.seconds)} h</dd></div>
      <div><dt>Whole-project effort</dt><dd>{reportHours(descendantTotals?.lifetime ?? project.lifetimeSeconds)} h</dd></div>
    </dl>
    <BudgetUtilization budget={delivery} title={delivery?.kind === "engagement" ? "Parent engagement hour caps" : "Delivery project hour caps"} />
    {team.length > 0 && <div className="mi-project-people">
      <div className="mi-project-faces" aria-hidden="true">{(managers.length ? managers : team).slice(0, 3).map(member =>
        <PersonPhoto key={member.id} name={member.name} photo={member.photo} alt="" />)}</div>
      <span>{managers.length ? managers.map(member => member.name).join(", ") : team.length + (team.length === 1 ? " team member" : " team members")}</span>
    </div>}
    <details className="mi-project-detail-panel" open={detail || undefined}>
      <summary>Project details</summary>
      <dl className="secure-project-hours">
        {hours && <>
          <div><dt>Work-order source recorded</dt><dd>{reportHours(hours.recordedSeconds)} h</dd></div>
          <div><dt>Remaining at work order</dt><dd>{reportHours(hours.remainingSeconds)} h</dd></div>
        </>}
        <div><dt>Classified to this project in {period}</dt><dd>{reportHours(hours?.assignedSeconds ?? project.seconds)} h</dd></div>
        {project.plan.targetSeconds > 0 && <div><dt>{project.plan.basis === "monthly" ? "Monthly" : "Lifetime"} reporting target</dt><dd>{reportHours(project.plan.targetSeconds)} h</dd></div>}
      </dl>
      <BudgetUtilization budget={parent?.budget} title="Parent engagement hour caps" />
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
            {(isManager(member.id) || member.role) && <div>{isManager(member.id) ? "Project manager" : member.role}</div>}</div>
        </li>)}</ul>
      </div>}
      {Boolean(project.milestones?.length) && <div>
        <h4>Milestones</h4>
        <ul className="secure-timeline">
          {[...(project.milestones ?? [])].sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999")).map(item => <li key={item.id}>
            {onLink ? <button type="button" className="exec-text-button" onClick={() => onLink("milestone:" + project.id + ":" + item.id)}>{item.title}</button> : <b>{item.title}</b>}
            <p>{item.date && <><time dateTime={item.date}>{reportDay(item.date)}</time>{" · "}</>}
              {item.completed ? "Complete" : item.status === "waived" ? "Waived" : item.status === "blocked" ? "Blocked" : item.status === "in-progress" ? "In progress" : "Pending"}</p>
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
    </details>
    {onLink && !detail && <button type="button" className="exec-text-button intel-open-project" onClick={() => onLink("project:" + project.id)}>
      Open project <span className="exec-sr-only">{project.name}</span><ArrowUpRight size={16} aria-hidden="true" />
    </button>}
  </article>;
}
