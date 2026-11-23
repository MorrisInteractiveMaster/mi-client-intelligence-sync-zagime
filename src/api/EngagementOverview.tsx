import type { StaffProjectSummary } from "../projects/model";
import type { ServiceArea } from "../projects/portfolio";
import { capRollup, measureDelivery, rollup } from "../projects/delivery";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { portalNavigate, usePortalLocation } from "./portal-location";
import { CsvExport } from "./CsvExport";
import { csvHours } from "./report-csv";

export function EngagementOverview({ projects, areas = [], month, onOpen }: {
  projects: StaffProjectSummary[]; areas?: ServiceArea[]; month?: string; onOpen: (id: string) => void;
}) {
  const location = usePortalLocation();
  const parent = projects.find(p => p.id === location.get("engagement"));
  const effort = rollup(projects);
  const consumption = capRollup(projects);
  const direct = projects.filter(p => p.delivery?.parentId === parent?.id && parent);
  const legacyDepartments = direct.filter(p => p.delivery?.kind === "service-area");
  const departmentGroups = new Map<string, { id: string; name: string; legacy?: StaffProjectSummary; projects: StaffProjectSummary[] }>();
  for (const node of legacyDepartments) {
    const area = areas.find(item => item.id === node.delivery?.areaId);
    const key = area?.id && !departmentGroups.has(area.id) ? area.id : node.id;
    departmentGroups.set(key, { id: node.id, name: node.name, legacy: node,
      projects: projects.filter(project => project.delivery?.parentId === node.id) });
  }
  const directDelivery = direct.filter(p => p.delivery?.kind !== "service-area");
  for (const project of directDelivery) {
    const area = areas.find(item => item.id === project.delivery?.areaId);
    if (!area) continue;
    const group = departmentGroups.get(area.id) ?? { id: "department:" + area.id, name: area.name, projects: [] };
    group.projects.push(project);
    departmentGroups.set(area.id, group);
  }
  const departments = [...departmentGroups.values()];
  const service = departments.find(group => group.id === location.get("service-area"));
  const delivery = service?.projects ?? directDelivery.filter(p => !areas.some(area => area.id === p.delivery?.areaId));
  const roots = projects.filter(p => !p.delivery?.parentId &&
    (p.delivery?.kind === "engagement" || p.workOrderEffort || projects.some(child => child.delivery?.parentId === p.id)));
  if (!parent) return <section aria-label="Parent projects">
    <div className="secure-section-heading"><h3>Parent projects</h3>
      <CsvExport filename={["Morris_Parent_Projects", month].filter(Boolean).join("_")} label="Export parent projects CSV"
        data={{ headers: ["Parent Project", "Work-order recorded hours", "Monthly reported hours", "Lifetime reported hours"],
          rows: roots.map(p => [p.name, csvHours(p.workOrderEffort?.recordedSeconds), csvHours(effort.get(p.id)?.monthly),
            csvHours(effort.get(p.id)?.lifetime)]) }} />
    </div>
    {!roots.length && <p>No parent projects or standalone work orders yet.</p>}
    <div className="secure-project-grid">{roots.map(p => <article className="secure-card" key={p.id}>
      <h4>{p.name}</h4><p>{reportHours(effort.get(p.id)?.monthly ?? 0)} h reported this month</p>
      <button type="button" onClick={() => portalNavigate({ engagement: p.id, "service-area": null })}>Open {p.name}</button>
    </article>)}</div>
  </section>;
  const branch = service ? service.legacy : parent;
  const cap = branch ? consumption.get(branch.id)! : { monthly: 0, lifetime: 0 };
  const now = today();
  const health = measureDelivery({ status: branch?.status ?? "planned", progress: branch?.progress ?? 0, delivery: branch?.delivery, milestones: branch?.deliveryMilestones }, cap, now);
  const serviceIds = new Set(legacyDepartments.map(p => p.id));
  const branchProjects = service ? delivery : projects.filter(p => p.delivery?.kind !== "service-area" &&
    (p.delivery?.parentId === parent.id || serviceIds.has(p.delivery?.parentId ?? "")));
  const title = service?.name ?? parent.name;
  const monthlyEffort = service ? (branch ? effort.get(branch.id)?.monthly ?? 0 : 0) +
    delivery.filter(p => !branch || p.delivery?.parentId !== branch.id).reduce((sum, p) => sum + (effort.get(p.id)?.monthly ?? 0), 0)
    : effort.get(parent.id)?.monthly ?? 0;
  const deadlines = branchProjects.flatMap(p => p.delivery?.deadline && p.delivery.deadline >= now &&
    !["completed", "closed", "cancelled"].includes(p.status) ? [{ id: p.id, date: p.delivery.deadline, name: p.name }] : [])
    .sort((a, b) => a.date.localeCompare(b.date));
  const blockers = [...(branch ? [branch] : []), ...branchProjects].filter(p => p.delivery?.blocker?.active);
  return <section aria-label={service ? "Department overview" : "Parent Project overview"}>
    <nav className="secure-actions" aria-label="Project hierarchy">
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({ engagement: null, "service-area": null })}>All parent projects</button>
      {service && <button type="button" className="secure-secondary" onClick={() => portalNavigate({ "service-area": null })}>Back to {parent.name}</button>}
    </nav>
    <div className="secure-section-heading"><h3>{title}</h3>
      <CsvExport filename={["Morris", title, month].filter(Boolean).join("_")}
        label={service ? "Export department CSV" : "Export parent project CSV"}
        data={{ headers: ["Project", "Row type", "Reported hours", "Monthly cap hours", "Monthly cap used hours",
          "Lifetime cap hours", "Lifetime cap used hours", "Delivery status", "Deadline"],
          rows: [[title, "Branch total", csvHours(monthlyEffort), csvHours(branch?.delivery?.monthlyCap),
            csvHours(cap.monthly), csvHours(branch?.delivery?.lifetimeCap), csvHours(cap.lifetime),
            branch ? projectStatus[branch.status] : undefined, branch?.delivery?.deadline],
            ...branchProjects.map(p => [p.name, "Project", csvHours(p.seconds), csvHours(p.delivery?.monthlyCap),
              csvHours(consumption.get(p.id)?.monthly), csvHours(p.delivery?.lifetimeCap), csvHours(consumption.get(p.id)?.lifetime),
              projectStatus[p.status], p.delivery?.deadline])] }} />
    </div>
    <dl className="secure-metrics">
      {!service && <div><dt>Work-order recorded</dt><dd>{reportHours(parent.workOrderEffort?.recordedSeconds ?? 0)} h</dd></div>}
      <div><dt>Reported effort for branch</dt><dd>{reportHours(monthlyEffort)} h</dd></div>
      {branch?.delivery?.monthlyCap !== undefined && <div><dt>Monthly hours charged to cap</dt><dd>{reportHours(cap.monthly)} h</dd></div>}
      <div><dt>Monthly hours remaining</dt><dd>{health.monthlyRemaining === undefined ? "No cap" : reportHours(health.monthlyRemaining) + " h"}</dd></div>
      <div><dt>Lifetime hours remaining</dt><dd>{health.lifetimeRemaining === undefined ? "No cap" : reportHours(health.lifetimeRemaining) + " h"}</dd></div>
    </dl>
    <dl className="secure-metrics">
      {!service && <div><dt>Departments</dt><dd>{departments.length}</dd></div>}
      <div><dt>Delivery projects</dt><dd>{branchProjects.length}</dd></div>
      <div><dt>In progress</dt><dd>{branchProjects.filter(p => p.status === "active").length}</dd></div>
      <div><dt>Completed</dt><dd>{branchProjects.filter(p => p.status === "completed").length}</dd></div>
      <div><dt>Delivery health</dt><dd>{blockers.length && ["Not configured", "On track"].includes(health.health) ? "Attention needed" : health.health}</dd></div>
      <div><dt>Next delivery deadline</dt><dd>{deadlines[0] ? reportDay(deadlines[0].date) : "None scheduled"}</dd></div>
    </dl>
    {!!blockers.length && <section aria-label="Current blockers"><h4>Current blockers</h4>
      <ul>{blockers.map(p => <li key={p.id}>Blocked · {p.name}</li>)}</ul>
    </section>}
    {!service && !!departments.length && <><h4>Departments</h4><div className="secure-project-grid">{departments.map(group => <article className="secure-card" key={group.id}>
      <h4>{group.name}</h4><p>{group.projects.length} delivery projects</p>
      <button type="button" onClick={() => portalNavigate({ "service-area": group.id })}>Open {group.name}</button>
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
