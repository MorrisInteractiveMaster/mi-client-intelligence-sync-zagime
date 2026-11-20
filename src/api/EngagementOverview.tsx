import type { StaffProjectSummary } from "../projects/model";
import { capRollup, measureDelivery, rollup } from "../projects/delivery";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { portalNavigate, usePortalLocation } from "./portal-location";

export function EngagementOverview({ projects, onOpen }: { projects: StaffProjectSummary[]; onOpen: (id: string) => void }) {
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
    <h3>Parent engagements</h3>
    {!roots.length && <p>No parent engagements or standalone work orders yet.</p>}
    <div className="secure-project-grid">{roots.map(p => <article className="secure-card" key={p.id}>
      <h4>{p.name}</h4><p>{reportHours(effort.get(p.id)?.monthly ?? 0)} h reported this month</p>
      <button type="button" onClick={() => portalNavigate({ engagement: p.id, "service-area": null })}>Open {p.name}</button>
    </article>)}</div>
  </section>;
  const cap = consumption.get(parent.id)!;
  const health = measureDelivery({ ...parent, milestones: parent.deliveryMilestones }, cap, today());
  return <section aria-label="Engagement overview">
    <nav className="secure-actions" aria-label="Engagement location">
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({ engagement: null, "service-area": null })}>All engagements</button>
      {service && <button type="button" className="secure-secondary" onClick={() => portalNavigate({ "service-area": null })}>Back to {parent.name}</button>}
    </nav>
    <h3>{service?.name ?? parent.name}</h3>
    <dl className="secure-metrics">
      <div><dt>Work-order recorded</dt><dd>{reportHours(parent.workOrderEffort?.recordedSeconds ?? 0)} h</dd></div>
      <div><dt>Reported effort for branch</dt><dd>{reportHours(effort.get((service ?? parent).id)?.monthly ?? 0)} h</dd></div>
      <div><dt>Monthly hours charged to cap</dt><dd>{reportHours(cap.monthly)} h</dd></div>
      <div><dt>Monthly hours remaining</dt><dd>{health.monthlyRemaining === undefined ? "No cap" : reportHours(health.monthlyRemaining) + " h"}</dd></div>
      <div><dt>Lifetime hours remaining</dt><dd>{health.lifetimeRemaining === undefined ? "No cap" : reportHours(health.lifetimeRemaining) + " h"}</dd></div>
    </dl>
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
