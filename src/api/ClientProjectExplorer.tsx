import { ArrowLeft, ArrowRight, ArrowUpRight, CircleAlert, LayoutGrid, List, Search } from "lucide-react";
import { clientProjectFilters, type clientDelivery } from "./client-delivery";
import { projectStatus, reportDay, reportHours, reportMonth, today } from "./dashboard-format";
import { completionBands, explorerPageSizes, explorerResults, explorerScopeFields, explorerSorts, explorerStatus, milestoneStates } from "./project-explorer";
import { portalNavigate } from "./portal-location";
import { percentText } from "./insight-metrics";
import type { ReactNode } from "react";
import "./project-explorer.css";

type Delivery = ReturnType<typeof clientDelivery>;
type Row = Delivery["projects"][number];

export const portfolioStatuses = [
  ["active", "In progress"], ["completed", "Completed"], ["upcoming", "Upcoming"], ["other", "Other"],
] as const;
export const segmentCount = (counts: Delivery["counts"], status: typeof portfolioStatuses[number][0]) =>
  status === "other" ? counts.all - counts.active - counts.completed - counts.upcoming : counts[status];

function DepartmentChooser({ delivery, value, onChange }: { delivery: Delivery; value: string; onChange: (id: string) => void }) {
  const departments = [{ id: "", name: "All projects", counts: delivery.counts },
    ...[...delivery.departmentRows].sort((a, b) => a.order - b.order)];
  return <div className="mi-explorer-departments" role="group" aria-label="Explore projects by department">
    {departments.map(({ id, name, counts }) => {
      const tip = [counts.all + " approved projects", ...portfolioStatuses.map(([status, label]) => segmentCount(counts, status) + " " + label.toLowerCase())].join(" · ");
      return <button className="mi-explorer-department" key={id} type="button" aria-pressed={value === id}
        aria-label={name + " · " + tip} title={tip} onClick={() => onChange(id)}>
        <b className="mi-explorer-department-name">{name}</b>
        <span className="mi-explorer-count" aria-hidden="true">{counts.all}</span>
        <small className="mi-explorer-department-counts">{counts.active} active · {counts.completed} completed</small>
        <span className="mi-explorer-track" aria-hidden="true">{portfolioStatuses.map(([status]) =>
          <i key={status} data-state={status} style={{ flexGrow: segmentCount(counts, status) }} />)}</span>
      </button>;
    })}
  </div>;
}

function ExplorerProject({ row, managers, open }: { row: Row; managers: string; open: () => void }) {
  const { project } = row;
  return <article className="mi-explorer-project" aria-label={project.name}>
    <div className="mi-explorer-identity">
      <h3>{project.name}</h3>
      <p>{[row.parent?.name, row.department?.name].filter(Boolean).join(" · ") || "Independent delivery project"}</p>
      {row.risk && <p className="mi-explorer-risk"><CircleAlert aria-hidden="true" size={15} /> {row.blocked ? "Blocker active" : "Overdue"}</p>}
    </div>
    <div className="mi-explorer-state">
      <span className="mi-explorer-badge" data-state={explorerStatus(row)}>{row.active ? "In progress" : row.upcoming ? "Upcoming" : projectStatus[project.status]}</span>
      <span>{row.completion === undefined ? "Not assessed" : percentText(row.completion) + " assessed"}</span>
    </div>
    <div className="mi-explorer-owner"><span>{managers || "No published manager"}</span>
      {row.deadline && <time dateTime={row.deadline}>{reportDay(row.deadline)}</time>}</div>
    <div className="mi-explorer-action">
      {project.seconds > 0 && <span>{reportHours(project.seconds)} h approved</span>}
      <button id={"client-open-" + project.id} type="button" className="exec-text-button" aria-label={"Open project " + project.name} onClick={open}>Open project <ArrowUpRight size={16} aria-hidden="true" /></button>
    </div>
  </article>;
}

export function ClientProjectExplorer({ delivery, params, onOpen, managersFor, exportAction, rows = delivery.projects, scoped }: {
  delivery: Delivery; params: URLSearchParams; rows?: Row[]; scoped?: boolean;
  onOpen: (id: string) => void; managersFor: (row: Row) => string; exportAction?: (rows: Row[]) => ReactNode;
}) {
  const [department, parent, band, completedMonth, milestone] = explorerScopeFields.map(field => params.get(field) ?? "");
  const status = params.get("status") ?? "all";
  const sort = params.get("project-sort") ?? "name";
  const view = params.get("explorer-view") === "cards" ? "cards" : "list";
  const results = explorerResults(rows, params, today());
  const filter = (field: string, value: string, replace = false) =>
    portalNavigate({ [field]: value || null, "explorer-page": null }, replace);
  const count = results.matches.length;
  const page = (number: number) => portalNavigate({ "explorer-page": number === 1 ? null : String(number) });
  return <section className="mi-explorer" aria-label="Project Explorer">
    {!scoped && <DepartmentChooser delivery={delivery} value={department} onChange={value => filter("explorer-department", value)} />}
    <div className="mi-explorer-toolbar">
      <label className="mi-explorer-search"><span><Search size={16} aria-hidden="true" /> Search published projects</span>
        <input type="search" maxLength={120} value={params.get("q") ?? ""} placeholder="Project, department or parent"
          onChange={event => filter("q", event.currentTarget.value, true)} /></label>
      {!scoped && <label>Department<select aria-label="Department" value={department} onChange={event => filter("explorer-department", event.target.value)}>
        <option value="">All departments</option>{delivery.departmentRows.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
      </select></label>}
      <label>Parent project<select value={parent} onChange={event => filter("explorer-parent", event.target.value)}>
        <option value="">All engagements</option>{delivery.parentRows.map(row => <option value={row.id} key={row.id}>{row.name}</option>)}
      </select></label>
      <label>Status<select value={status} onChange={event => filter("status", event.target.value === "all" ? "" : event.target.value)}>
        {Object.entries(clientProjectFilters).filter(([key]) => !key.startsWith("unassigned-") || key === status)
          .map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>Deadline<select value={params.get("explorer-deadline") ?? ""} onChange={event => filter("explorer-deadline", event.target.value)}>
        <option value="">Any date</option><option value="soon">Approaching</option><option value="overdue">Overdue</option><option value="unscheduled">No published date</option>
      </select></label>
      <label>Sort by<select value={Object.hasOwn(explorerSorts, sort) ? sort : "name"} onChange={event => filter("project-sort", event.target.value)}>
        {Object.entries(explorerSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Sort direction<select value={params.get("project-direction") ?? (sort === "completion" || sort === "hours" ? "desc" : "asc")}
        onChange={event => filter("project-direction", event.target.value)}>
        <option value="asc">Ascending</option><option value="desc">Descending</option>
      </select></label>
    </div>
    {(band || completedMonth || milestone) && <div className="mi-explorer-drilldowns">
      {band && <button type="button" className="secure-secondary" onClick={() => filter("explorer-completion", "")}>Work completion · {completionBands.find(([key]) => key === band)?.[1]} ×</button>}
      {/^\d{4}-(0[1-9]|1[0-2])$/.test(completedMonth) && <button type="button" className="secure-secondary" onClick={() => filter("explorer-completed-month", "")}>Completed · {reportMonth(completedMonth)} ×</button>}
      {milestone && <button type="button" className="secure-secondary" onClick={() => filter("explorer-milestone", "")}>Milestones · {milestoneStates.find(([key]) => key === milestone)?.[1]} ×</button>}
    </div>}
    <div className="mi-explorer-meta">
      <p role="status">{count ? "Showing " + (results.offset + 1) + "–" + Math.min(results.offset + results.size, count) + " of " + count + (count === 1 ? " project" : " projects") : "0 projects"}</p>
      <div className="mi-explorer-actions">
        {count > 0 && exportAction?.(results.matches)}
        <div className="mi-insight-segments" role="group" aria-label="Project view">
          <button type="button" aria-pressed={view === "list"} onClick={() => portalNavigate({ "explorer-view": null }, true)}><List size={16} aria-hidden="true" /> List</button>
          <button type="button" aria-pressed={view === "cards"} onClick={() => portalNavigate({ "explorer-view": "cards" }, true)}><LayoutGrid size={16} aria-hidden="true" /> Cards</button>
        </div>
      </div>
    </div>
    {count ? <div className="mi-explorer-results" data-view={view} aria-label="Matching projects">
      {results.visible.map(row => <ExplorerProject key={row.project.id} row={row} managers={managersFor(row)} open={() => onOpen(row.project.id)} />)}
    </div> : <div className="mi-explorer-empty"><p>No published projects match.</p>
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({
        ...Object.fromEntries(explorerScopeFields.map(field => [field, null])),
        q: null, status: null, "explorer-deadline": null, "explorer-page": null,
      })}>Clear filters</button></div>}
    <nav className="mi-explorer-pagination" aria-label="Project pages">
      <label>Projects per page<select aria-label="Projects per page" value={results.size} onChange={event => filter("explorer-size", event.target.value)}>
        {explorerPageSizes.map(size => <option key={size} value={size}>{size}</option>)}
      </select></label>
      <div><button type="button" className="secure-secondary" disabled={results.page === 1} onClick={() => page(results.page - 1)}><ArrowLeft size={16} aria-hidden="true" /> Previous</button>
      <span>Page {results.page} of {results.pages}</span>
      <button type="button" className="secure-secondary" disabled={results.page === results.pages} onClick={() => page(results.page + 1)}>Next <ArrowRight size={16} aria-hidden="true" /></button></div>
    </nav>
  </section>;
}
