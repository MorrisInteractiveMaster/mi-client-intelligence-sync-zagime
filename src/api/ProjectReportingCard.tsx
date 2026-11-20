import { useState } from "react";
import { publicProject, type ProjectReport, type StaffProjectSummary } from "../projects/model";
import type { PublishedPortfolio } from "../projects/portfolio";
import { projectStatus, reportDay, reportHours } from "./dashboard-format";
import { PersonPhoto } from "./PersonPhoto";

type Props = {
  project: ProjectReport["projects"][number];
  period: string;
  placement?: PublishedPortfolio["placements"][number];
  team: PublishedPortfolio["directory"];
  onLink?: (destination: string) => void;
  detail?: boolean;
  delivery?: NonNullable<ProjectReport["hierarchy"]>[string];
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

export function ProjectReportingCard({ project, period, placement, team, onLink, detail, delivery, descendantTotals }: Props) {
  const completion = delivery?.completion ?? (!delivery && project.progress > 0 ? project.progress : undefined);
  return (
    <article
      className="secure-card secure-published-project"
    >
      <p className="secure-badge" data-status={project.status}>
        {placement?.archived ? "Archived" : projectStatus[project.status]}
      </p>
      <h3>{project.name}</h3>
      {placement?.start && <p className="secure-muted">Start {reportDay(placement.start)}</p>}
      {placement?.target && <p className="secure-muted">Target {reportDay(placement.target)}</p>}
      {delivery?.start && <p className="secure-muted">Start {reportDay(delivery.start)}</p>}
      {delivery?.deadline && <p className="secure-muted">Deadline {reportDay(delivery.deadline)}</p>}
      {project.description && (
        <p className="secure-project-description">
          {project.description}
        </p>
      )}
      <div className="secure-progress">
        <span>{completion === undefined ? "Delivery completion not configured" : completion + "% progress"}</span>
        {completion !== undefined && <progress
          aria-label={project.name + " progress"}
          max={100}
          value={completion}
        />}
      </div>
      <dl className="secure-project-hours">
        <div>
          <dt>{period} allocated</dt>
          <dd>{reportHours(project.seconds)} h</dd>
        </div>
        <div>
          <dt>Lifetime allocated</dt>
          <dd>{reportHours(project.lifetimeSeconds)} h</dd>
        </div>
        {project.plan.targetSeconds > 0 && (
          <div>
            <dt>
              {project.plan.basis === "monthly"
                ? "Monthly"
                : "Lifetime"}{" "}
              target
            </dt>
            <dd>{reportHours(project.plan.targetSeconds)} h</dd>
          </div>
        )}
        {delivery?.monthlyCap !== undefined && <div><dt>Monthly cap</dt><dd>{reportHours(delivery.monthlyCap)} h</dd></div>}
        {delivery?.lifetimeCap !== undefined && <div><dt>Lifetime cap</dt><dd>{reportHours(delivery.lifetimeCap)} h</dd></div>}
        {descendantTotals && descendantTotals.descendants > 0 && <div><dt>Allocated including approved descendants</dt><dd>{reportHours(descendantTotals.monthly)} h monthly · {reportHours(descendantTotals.lifetime)} h lifetime</dd></div>}
      </dl>
      {team.length > 0 && <div className="exec-project-team">
        <h4>Project team</h4>
        <ul>{team.map(member => <li key={member.id}>
          <PersonPhoto name={member.name} photo={member.photo} alt={member.photoAlt} />
          {onLink ? <button className="exec-text-button" onClick={() => onLink("contact:" + member.id)}>{member.name}</button> : member.name}
          {placement?.managerIds?.includes(member.id) || placement?.leadId === member.id ? " · Project manager" : ""}</li>)}</ul>
      </div>}
      {Boolean(
        project.milestones?.length || project.updates?.length,
      ) && (
        <details open={detail || undefined}>
          <summary>Updates and milestones</summary>
          {!!project.milestones?.length && (
            <div>
              <h4>Milestones</h4>
              <ul className="secure-timeline">
                {[...project.milestones]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((item) => (
                    <li key={item.id}>
                      {onLink ? <button className="exec-text-button" onClick={() => onLink("milestone:" + project.id + ":" + item.id)}>{item.title}</button> : <b>{item.title}</b>}
                      <p>
                        <time dateTime={item.date}>
                          {reportDay(item.date)}
                        </time>{" "}
                        · {item.completed ? "Complete" : "Upcoming"}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {!!project.updates?.length && (
            <div>
              <h4>Project updates</h4>
              <ul className="secure-timeline">
                {[...project.updates]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((item) => (
                    <li key={item.id}>
                      <time dateTime={item.date}>
                        {reportDay(item.date)}
                      </time>
                      <b>{item.title}</b>
                      <p className="secure-project-description">
                        {item.body}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </details>
      )}
      {onLink && !detail && <button type="button" className="exec-text-button intel-open-project" onClick={() => onLink("project:" + project.id)}>
        Open project
      </button>}
    </article>
  );
}
