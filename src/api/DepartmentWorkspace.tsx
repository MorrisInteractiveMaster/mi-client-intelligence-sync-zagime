import { ChevronRight, Layers3 } from "lucide-react";
import { useState } from "react";
import { deliveryDate, measureDelivery } from "../projects/delivery";
import type { StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import { projectStatus, reportHours } from "./dashboard-format";
import { DottedTrack } from "./EffortVisuals";
import { metricPercent } from "./insight-metrics";
import { SortControls, useSortedRows } from "./SortHeader";

export function DepartmentWorkspace({ portfolio, projects, selected, onDepartment, onProject }: {
  portfolio?: Portfolio;
  projects: StaffProjectSummary[];
  selected: string | null;
  onDepartment: (id: string | null) => void;
  onProject: (id: string) => void;
}) {
  const [filter, setFilter] = useState<{ department: string; status: string }>();
  const placements = new Map(portfolio?.placements.map(item => [item.id, item]));
  const matches = (id: string) => projects.filter(project =>
    !placements.get(project.id)?.archived && project.delivery?.kind !== "engagement" && project.delivery?.kind !== "service-area" &&
    (project.delivery?.areaId || placements.get(project.id)?.areaId) === id);
  const areaSort = useSortedRows<Portfolio["areas"][number], "order" | "name" | "projects" | "visibility">(portfolio?.areas ?? [],
    { key: "order", direction: "asc" }, (row, field) => ({ order: row.order, name: row.name, projects: matches(row.id).length,
      visibility: row.visible ? "Client-visible" : "Private" })[field], row => row.id);
  const areas = areaSort.rows;
  const department = areas.find(item => item.id === selected);
  const departmentProjects = department ? matches(department.id) : [];
  const currentStatus = filter?.department === selected ? filter?.status : undefined;
  const displayed = departmentProjects.filter(project => !currentStatus || project.status === currentStatus);
  const allocated = departmentProjects.reduce((total, project) => total + (project.workOrderEffort?.assignedSeconds ?? project.seconds), 0);
  const pending = departmentProjects.reduce((sum, project) => sum + (project.pendingMappedEffort?.monthly ?? 0), 0);
  const reported = projects.filter(project => (project.delivery?.areaId ?? placements.get(project.id)?.areaId) === department?.id)
    .reduce((total, project) => total + project.seconds, 0);
  const today = deliveryDate();
  const sorted = useSortedRows<StaffProjectSummary, "name" | "status" | "hours" | "completion">(displayed, { key: "name", direction: "asc" },
    (row, field) => ({ name: row.name, status: projectStatus[row.status], hours: row.workOrderEffort?.assignedSeconds ?? row.seconds,
      completion: measureDelivery(row, { monthly: row.seconds, lifetime: row.lifetimeSeconds }, today).completion })[field], row => row.id);
  if (!portfolio) return <p role="status">Loading departments…</p>;
  const statusCounts = new Map<StaffProjectSummary["status"], number>();
  for (const project of departmentProjects) statusCounts.set(project.status, (statusCounts.get(project.status) ?? 0) + 1);

  return <section className="mi-staff-departments" aria-label={department?.name ?? "Configured departments"}>
    <div className="delivery-section-heading">
      {selected ? <button type="button" className="secure-secondary" onClick={() => onDepartment(null)}>All departments</button>
        : <p>{areas.length} configured {areas.length === 1 ? "department" : "departments"}</p>}
    </div>
    {selected ? department ? <>
      {department.description && <p>{department.description}</p>}
      <div className="mi-department-snapshot mi-exec-panel">
        <div><h2>Delivery snapshot</h2>
          <dl className="mi-department-metrics"><div><dt>Delivery projects</dt><dd>{departmentProjects.length}</dd></div>
            <div><dt>Allocated this month</dt><dd>{reportHours(allocated)} h</dd></div>
            {pending > 0 && <div><dt>Awaiting approval</dt><dd>{reportHours(pending)} h</dd></div>}</dl>
          <div className="secure-actions">{[...statusCounts].map(([status, count]) => <button type="button" className="secure-secondary" key={status}
            aria-pressed={status === currentStatus} onClick={() => setFilter(status === currentStatus ? undefined : { department: department.id, status })}>
            {projectStatus[status]} · {count}</button>)}</div>
        </div>
        {department.monthlyCap !== undefined && <DottedTrack value={metricPercent(reported, department.monthlyCap)} label="Monthly department cap used"
          detail={reportHours(reported) + " h reported / " + reportHours(department.monthlyCap) + " h monthly cap"} />}
      </div>
      <SortControls fields={{ name: "Project name", status: "Delivery status", hours: "Allocated hours", completion: "Completion" }}
        sort={sorted.sort} onSort={sorted.setSort} label="Sort department projects" />
      <div className="mi-department-grid">{sorted.rows.map(project => {
        const completion = measureDelivery(project, { monthly: project.seconds, lifetime: project.lifetimeSeconds }, today).completion;
        return <article className="mi-department-project" key={project.id}>
          <button className="mi-department-card" type="button" onClick={() => onProject(project.id)}>
            <div><strong>{project.name}</strong><span><b className="mi-department-status">{projectStatus[project.status]}</b> {reportHours(project.workOrderEffort?.assignedSeconds ?? project.seconds)} h allocated</span>
              {Boolean(project.pendingMappedEffort?.monthly) && <span>{reportHours(project.pendingMappedEffort!.monthly)} h awaiting approval</span>}</div><ChevronRight aria-hidden="true" />
          </button>
          {completion !== undefined && <DottedTrack value={completion} label="Project work completion" />}
        </article>;
      })}</div>
      {!departmentProjects.length && <p className="secure-empty">There are no delivery projects in this department.</p>}
    </> : <p className="secure-empty">This department is unavailable.</p> :
      <><SortControls fields={{ order: "Configured order", name: "Name", projects: "Project count", visibility: "Visibility" }}
        sort={areaSort.sort} onSort={areaSort.setSort} label="Sort departments" />
      <div className="mi-department-grid">{areas.map(area => {
        const count = matches(area.id).length;
        return <button className="mi-department-card" type="button" key={area.id} onClick={() => onDepartment(area.id)}>
          <Layers3 aria-hidden="true" /><div><strong>{area.name}</strong><span>{count} {count === 1 ? "project" : "projects"} · {area.visible ? "Client-visible" : "Private"}</span></div><ChevronRight aria-hidden="true" />
        </button>;
      })}</div></>}
    {!selected && !areas.length && <p className="secure-empty">Create a department to organize delivery projects by service area.</p>}
  </section>;
}
