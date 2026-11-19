import { useState } from "react";
import { publicProject, type ProjectReport, type StaffProjectSummary } from "../projects/model";
import type { PublishedPortfolio } from "../projects/portfolio";
import { projectStatus, reportDay, reportHours } from "./dashboard-format";

type Props = {
  project: ProjectReport["projects"][number];
  period: string;
  placement?: PublishedPortfolio["placements"][number];
  team: PublishedPortfolio["directory"];
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

export function ProjectReportingCard({ project, period, placement, team }: Props) {
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
      {project.description && (
        <p className="secure-project-description">
          {project.description}
        </p>
      )}
      <div className="secure-progress">
        <span>{project.progress}% progress</span>
        <progress
          aria-label={project.name + " progress"}
          max={100}
          value={project.progress}
        />
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
      </dl>
      {team.length > 0 && <div className="exec-project-team">
        <h4>Project team</h4>
        <ul>{team.map(member => <li key={member.id}>{member.name}{placement?.leadId === member.id ? " · Lead" : ""}</li>)}</ul>
      </div>}
      {Boolean(
        project.milestones?.length || project.updates?.length,
      ) && (
        <details>
          <summary>Updates and milestones</summary>
          {!!project.milestones?.length && (
            <div>
              <h4>Milestones</h4>
              <ul className="secure-timeline">
                {[...project.milestones]
                  .sort((a, b) => a.date.localeCompare(b.date))
                  .map((item) => (
                    <li key={item.id}>
                      <b>{item.title}</b>
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
    </article>
  );
}
