import type { StaffProjectSummary } from "../projects/model";
import { capRollup, measureDelivery, rollup } from "../projects/delivery";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { portalNavigate, usePortalLocation } from "./portal-location";
import { CsvExport } from "./CsvExport";
import { csvHours } from "./report-csv";

export function EngagementOverview({ projects, month, onOpen }: { projects: StaffProjectSummary[]; month?: string; onOpen: (id: string) => void }) {
  const location = usePortalLocation();
  const parent = projects.find(p => p.id === location.get("engagement"));
  const service = projects.find(p => p.id === location.get("service-area") && p.delivery?.parentId === parent?.id);
  const effort = rollup(projects);
  const consumption = capRollup(projects);
  const direct = projects.filter(p => p.delivery?.parentId === parent?.id && parent);
  const services = direct.filter(p => p.delivery?.kind === "service-area");
  const delivery = service ? projects.filter(p => p.delivery?.parentId === service.id) : direct.filter(p => p.delivery?.kind !== "service-area");
  const roots = projects.filter(p => !p.delivery?.parentId &&
    (p.delivery?.kind === "engagement" || p.workOrderEffort || projects.some(child => child.delivery?.parentId === p.id)));
  if (!parent) return <section aria-label="Parent engagements">
    <div className="secure-section-heading"><h3>Parent engagements</h3>
      <CsvExport filename={["Morris_Parent_Engagements", month].filter(Boolean).join("_")} label="Export engagements CSV"
        data={{ headers: ["Engagement", "Work-order recorded hours", "Monthly reported hours", "Lifetime reported hours"],
          rows: roots.map(p => [p.name, csvHours(p.workOrderEffort?.recordedSeconds), csvHours(effort.get(p.id)?.monthly),
            csvHours(effort.get(p.id)?.lifetime)]) }} />
    </div>
    {!roots.length && <p>No parent engagements or standalone work orders yet.</p>}
    <div className="secure-project-grid">{roots.map(p => <article className="secure-card" key={p.id}>
      <h4>{p.name}</h4><p>{reportHours(effort.get(p.id)?.monthly ?? 0)} h reported this month</p>
      <button type="button" onClick={() => portalNavigate({ engagement: p.id, "service-area": null })}>Open {p.name}</button>
    </article>)}</div>
  </section>;
  const branch = service ?? parent;
  const cap = consumption.get(branch.id)!;
  const now = today();
  const health = measureDelivery({ ...branch, milestones: branch.deliveryMilestones }, cap, now);
  const serviceIds = new Set(services.map(p => p.id));
  const branchProjects = service ? delivery : projects.filter(p => p.delivery?.kind !== "service-area" &&
    (p.delivery?.parentId === parent.id || serviceIds.has(p.delivery?.parentId ?? "")));
  const deadlines = branchProjects.flatMap(p => p.delivery?.deadline && p.delivery.deadline >= now &&
    !["completed", "closed", "cancelled"].includes(p.status) ? [{ id: p.id, date: p.delivery.deadline, name: p.name }] : [])
    .sort((a, b) => a.date.localeCompare(b.date));
  const blockers = [branch, ...branchProjects].filter(p => p.delivery?.blocker?.active);
  return <section aria-label="Engagement overview">
    <nav className="secure-actions" aria-label="Engagement location">
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({ engagement: null, "service-area": null })}>All engagements</button>
      {service && <button type="button" className="secure-secondary" onClick={() => portalNavigate({ "service-area": null })}>Back to {parent.name}</button>}
    </nav>
    <div className="secure-section-heading"><h3>{service?.name ?? parent.name}</h3>
      <CsvExport filename={["Morris", branch.name, month].filter(Boolean).join("_")}
        label={service ? "Export service area CSV" : "Export engagement CSV"}
        data={{ headers: ["Project", "Row type", "Reported hours", "Monthly cap hours", "Monthly cap used hours",
          "Lifetime cap hours", "Lifetime cap used hours", "Delivery status", "Deadline"],
          rows: [[branch.name, "Branch total", csvHours(effort.get(branch.id)?.monthly), csvHours(branch.delivery?.monthlyCap),
            csvHours(cap.monthly), csvHours(branch.delivery?.lifetimeCap), csvHours(cap.lifetime),
            projectStatus[branch.status], branch.delivery?.deadline],
            ...branchProjects.map(p => [p.name, "Project", csvHours(p.seconds), csvHours(p.delivery?.monthlyCap),
              csvHours(consumption.get(p.id)?.monthly), csvHours(p.delivery?.lifetimeCap), csvHours(consumption.get(p.id)?.lifetime),
              projectStatus[p.status], p.delivery?.deadline])] }} />
    </div>
    <dl className="secure-metrics">
      <div><dt>Work-order recorded</dt><dd>{reportHours(parent.workOrderEffort?.recordedSeconds ?? 0)} h</dd></div>
      <div><dt>Reported effort for branch</dt><dd>{reportHours(effort.get(branch.id)?.monthly ?? 0)} h</dd></div>
      <div><dt>Monthly hours charged to cap</dt><dd>{reportHours(cap.monthly)} h</dd></div>
      <div><dt>Monthly hours remaining</dt><dd>{health.monthlyRemaining === undefined ? "No cap" : reportHours(health.monthlyRemaining) + " h"}</dd></div>
      <div><dt>Lifetime hours remaining</dt><dd>{health.lifetimeRemaining === undefined ? "No cap" : reportHours(health.lifetimeRemaining) + " h"}</dd></div>
    </dl>
    <dl className="secure-metrics">
      {!service && <div><dt>Service areas</dt><dd>{services.length}</dd></div>}
      <div><dt>Delivery projects</dt><dd>{branchProjects.length}</dd></div>
      <div><dt>In progress</dt><dd>{branchProjects.filter(p => p.status === "active").length}</dd></div>
      <div><dt>Completed</dt><dd>{branchProjects.filter(p => p.status === "completed").length}</dd></div>
      <div><dt>Delivery health</dt><dd>{blockers.length && ["Not configured", "On track"].includes(health.health) ? "Attention needed" : health.health}</dd></div>
      <div><dt>Next delivery deadline</dt><dd>{deadlines[0] ? reportDay(deadlines[0].date) : "None scheduled"}</dd></div>
    </dl>
    {!!blockers.length && <section aria-label="Current blockers"><h4>Current blockers</h4>
      <ul>{blockers.map(p => <li key={p.id}>Blocked · {p.name}</li>)}</ul>
    </section>}
    {!service && !!services.length && <><h4>Service areas</h4><div className="secure-project-grid">{services.map(p => <article className="secure-card" key={p.id}>
      <h4>{p.name}</h4><p>{projects.filter(child => child.delivery?.parentId === p.id).length} delivery projects</p>
      <button type="button" onClick={() => portalNavigate({ "service-area": p.id })}>Open {p.name}</button>
    </article>)}</div></>}
    <h4>{service ? "Delivery projects" : "Direct delivery projects"}</h4>
    {!delivery.length && <p>No direct delivery projects in this branch.</p>}
    <div className="secure-project-grid">{delivery.map(p => <article className="secure-card" key={p.id}>
      <h4>{p.name}</h4><p>{projectStatus[p.status]} · {p.published ? "Published" : "Private"}</p>
      <p>{reportHours(p.seconds)} h reported{p.delivery?.deadline && " · Due " + reportDay(p.delivery.deadline)}</p>
      {p.delivery?.blocker?.active && <p className="secure-message secure-error">Blocked</p>}
      <button type="button" onClick={() => onOpen(p.id)}>Open {p.name}</button>
    </article>)}</div>
  </section>;
}
