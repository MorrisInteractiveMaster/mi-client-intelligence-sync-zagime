import { ChevronRight, Layers3 } from "lucide-react";
import { useState } from "react";
import { deliveryDate, measureDelivery } from "../projects/delivery";
import type { StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import { projectStatus, reportHours } from "./dashboard-format";
import { DottedTrack } from "./EffortVisuals";
import { metricPercent } from "./insight-metrics";

export function DepartmentWorkspace({ portfolio, projects, selected, onDepartment, onProject, onSettings }: {
  portfolio?: Portfolio;
  projects: StaffProjectSummary[];
  selected: string | null;
  onDepartment: (id: string | null) => void;
  onProject: (id: string) => void;
  onSettings: () => void;
}) {
  const [filter, setFilter] = useState<{ department: string; status: string }>();
  if (!portfolio) return <p role="status">Loading departments…</p>;
  const areas = [...portfolio.areas].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const placements = new Map(portfolio.placements.map(item => [item.id, item]));
  const department = areas.find(item => item.id === selected);
  const matches = (id: string) => projects.filter(project =>
    !placements.get(project.id)?.archived && project.delivery?.kind !== "engagement" && project.delivery?.kind !== "service-area" &&
    (project.delivery?.areaId || placements.get(project.id)?.areaId) === id);
  const departmentProjects = department ? matches(department.id) : [];
  const currentStatus = filter?.department === selected ? filter?.status : undefined;
  const displayed = departmentProjects.filter(project => !currentStatus || project.status === currentStatus);
  const allocated = departmentProjects.reduce((total, project) => total + (project.workOrderEffort?.assignedSeconds ?? project.seconds), 0);
  const reported = projects.filter(project => (project.delivery?.areaId ?? placements.get(project.id)?.areaId) === department?.id)
    .reduce((total, project) => total + project.seconds, 0);
  const today = deliveryDate();
  const statusCounts = new Map<StaffProjectSummary["status"], number>();
  for (const project of departmentProjects) statusCounts.set(project.status, (statusCounts.get(project.status) ?? 0) + 1);

  return <section className="mi-staff-departments" aria-label={department?.name ?? "Configured departments"}>
    <div className="delivery-section-heading">
      {selected ? <button type="button" className="secure-secondary" onClick={() => onDepartment(null)}>All departments</button>
        : <p>{areas.length} configured {areas.length === 1 ? "department" : "departments"}</p>}
      <button type="button" className="secure-secondary" onClick={onSettings}>Manage departments</button>
    </div>
    {selected ? department ? <>
      {department.description && <p>{department.description}</p>}
      <div className="mi-department-snapshot mi-exec-panel">
        <div><h3>Delivery snapshot</h3><p>{departmentProjects.length} delivery projects · {reportHours(allocated)} h allocated this month</p>
          <div className="secure-actions">{[...statusCounts].map(([status, count]) => <button type="button" className="secure-secondary" key={status}
            aria-pressed={status === currentStatus} onClick={() => setFilter(status === currentStatus ? undefined : { department: department.id, status })}>
            {projectStatus[status]} · {count}</button>)}</div>
          <p className="mi-effort-muted">Trend tracking begins from the first verified snapshot.</p></div>
        {department.monthlyCap !== undefined && <DottedTrack value={metricPercent(reported, department.monthlyCap)} label="Monthly department cap used"
          detail={reportHours(reported) + " h reported / " + reportHours(department.monthlyCap) + " h monthly cap"} />}
      </div>
      <div className="mi-department-grid">{displayed.map(project => {
        const completion = measureDelivery(project, { monthly: project.seconds, lifetime: project.lifetimeSeconds }, today).completion;
        return <article className="mi-department-project" key={project.id}>
          <button className="mi-department-card" type="button" onClick={() => onProject(project.id)}>
            <div><strong>{project.name}</strong><span>{projectStatus[project.status]} · {reportHours(project.workOrderEffort?.assignedSeconds ?? project.seconds)} h allocated</span></div><ChevronRight aria-hidden="true" />
          </button>
          {completion !== undefined && <DottedTrack value={completion} label="Project work completion" />}
        </article>;
      })}</div>
      {!departmentProjects.length && <p className="secure-empty">There are no delivery projects in this department.</p>}
    </> : <p className="secure-empty">This department is unavailable.</p> :
      <div className="mi-department-grid">{areas.map(area => {
        const count = matches(area.id).length;
        return <button className="mi-department-card" type="button" key={area.id} onClick={() => onDepartment(area.id)}>
          <Layers3 aria-hidden="true" /><div><strong>{area.name}</strong><span>{count} {count === 1 ? "project" : "projects"} · {area.visible ? "Client-visible" : "Private"}</span></div><ChevronRight aria-hidden="true" />
        </button>;
      })}</div>}
    {!selected && !areas.length && <p className="secure-empty">Create a department to organize delivery projects by service area.</p>}
  </section>;
}
