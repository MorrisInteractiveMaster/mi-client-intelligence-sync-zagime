import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ProjectReport } from "../projects/model";
import { ApiError, type SecuredApiClient } from "./client";
import {
  reportHours,
  reportMonth,
} from "./dashboard-format";

import { BookOpen, ChevronLeft, ChevronRight, FolderKanban, LayoutGrid, PanelLeftClose, UsersRound } from "lucide-react";
import { ProjectReportingCard } from "./ProjectReportingCard";
import { ExecutiveOverview } from "./ExecutiveOverview";
import "./executive.css";
const Presentation = lazy(() => import("./ExecutivePresentation"));

const searchText = (value: string) =>
  value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type ReportScope = {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  onDenied: () => void;
};

export function ProjectClientReport(props: ReportScope) {
  return (
    <ScopedClientReport
      key={JSON.stringify([props.tenant, props.month])}
      {...props}
    />
  );
}

function ScopedClientReport({ client, tenant, month, onDenied }: ReportScope) {
  const [result, setResult] = useState<{
    client: SecuredApiClient;
    report?: ProjectReport;
  }>();
  const [epoch, setEpoch] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const presentationTrigger = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const choose = (next: string) => {
    setSearch("");
    setStatus("all");
    setView(next);
    requestAnimationFrame(() => page.current?.focus({ preventScroll: true }));
  };
  const current = result?.client === client ? result : undefined;
  useEffect(() => {
    const abort = new AbortController();
    client
      .call<ProjectReport>(tenant, "report?month=" + month, {
        signal: abort.signal,
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        if (data.month !== month || data.tenant.id !== tenant)
          throw Error("Unexpected reporting scope");
        setResult({ client, report: data });
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return;
        if (failure instanceof ApiError && [401, 403].includes(failure.status))
          onDenied();
        else setResult({ client });
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch, onDenied]);

  if (current && !current.report)
    return (
      <section className="secure-empty">
        <h2>Reporting is temporarily unavailable</h2>
        <p role="alert">
          The published report could not be loaded. Try again in a moment.
        </p>
        <button
          onClick={() => {
            setResult(undefined);
            setEpoch((value) => value + 1);
          }}
        >
          Retry report
        </button>
      </section>
    );
  const report = current?.report;
  if (!report)
    return (
      <p className="secure-empty" role="status">
        Loading approved reporting…
      </p>
    );

  const visible = [...report.projects].sort((a, b) =>
    a.name.localeCompare(b.name, "en-CA"),
  );
  const portfolio = report.portfolio;
  const selectedArea = portfolio?.areas.find(a => "area:" + a.id === view);
  const placements = new Map(portfolio?.placements.map(p => [p.id, p]));
  const scoped = selectedArea ? visible.filter(p => placements.get(p.id)?.areaId === selectedArea.id) : visible;
  const displayStatus = (project: ProjectReport["projects"][number]) => placements.get(project.id)?.archived ? "archived" : project.status;
  const matching = scoped.filter(project => searchText(project.name).includes(searchText(search)) && (status === "all" || displayStatus(project) === status));
  const groupName = (id: string) => portfolio?.engagements.find(e => e.id === id)?.name ?? "Independent delivery projects";
  const groups = (view === "projects" || selectedArea) ? [...new Set(matching.map(p => placements.get(p.id)?.engagementId ?? ""))] : [""];
  const Group = view === "projects" || selectedArea ? "details" : "div";
  const directory = (portfolio?.directory ?? []).filter(p =>
    view === "directory" ? searchText(p.name + " " + p.role).includes(searchText(search)) :
      !selectedArea || p.areaId === selectedArea.id || p.projectIds.some(id => scoped.some(project => project.id === id)));
  const period = reportMonth(report.month);
  return (
    <div className="exec-frame" data-collapsed={collapsed}>
      <aside className="exec-sidebar">
        <div className="exec-sidebar-title"><span>Client workspace</span>
          <button className="exec-icon exec-collapse" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}><PanelLeftClose size={18} /></button>
        </div>
        <nav aria-label="Client workspace">
          <button type="button" aria-label="Leadership summary" aria-current={view === "overview" ? "page" : undefined} onClick={() => choose("overview")}><LayoutGrid size={18} /><span>Leadership summary</span></button>
          <button type="button" aria-label="Projects" aria-current={view === "projects" ? "page" : undefined} onClick={() => choose("projects")}><FolderKanban size={18} /><span>Projects</span></button>
          {portfolio?.areas.map(area => <button type="button" key={area.id} aria-label={area.name} aria-current={view === "area:" + area.id ? "page" : undefined} onClick={() => choose("area:" + area.id)}><span className="exec-nav-dot" aria-hidden="true" /><span>{area.name}</span></button>)}
          <button type="button" aria-label="MI Directory" aria-current={view === "directory" ? "page" : undefined} onClick={() => choose("directory")}><UsersRound size={18} /><span>MI Directory</span></button>
        </nav>
      </aside>
      <div className="exec-content" tabIndex={-1} ref={page}>
        {view === "overview" && <ExecutiveOverview report={report} onArea={id => choose("area:" + id)}
          onPresentation={() => { presentationTrigger.current = document.activeElement as HTMLButtonElement; setPresenting(true); }} />}
        {view !== "overview" && <div className="exec-breadcrumb">
          <button type="button" className="exec-text-button" onClick={() => choose("overview")}><ChevronLeft size={16} /> Leadership summary</button>
          <ChevronRight size={14} aria-hidden="true" />
          <span>{selectedArea?.name ?? (view === "directory" ? "MI Directory" : "Projects")}</span>
        </div>}
        {selectedArea && <section className="exec-panel exec-area-head"><BookOpen size={21} aria-hidden="true" />
          <h2>{selectedArea.name}</h2>
          {selectedArea.description && <p>{selectedArea.description}</p>}
          <strong>{reportHours(scoped.reduce((total, p) => total + p.seconds, 0))} h allocated in {period}</strong>
        </section>}
        {view !== "directory" && (
      <section aria-labelledby="published-projects">
        <div className="secure-section-heading">
          <div>
            <h2 id="published-projects">Published projects</h2>
            <p>
              Hours reflect published reporting allocations for the selected
              month.
            </p>
          </div>
          {scoped.length > 0 && (
            <label className="secure-search-label">
              Search published projects
              <input
                type="search"
                maxLength={120}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
          {(view === "projects" || selectedArea) && <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="all">All statuses</option><option value="active">Active</option><option value="planned">Upcoming</option><option value="paused">Paused</option><option value="completed">Completed</option><option value="archived">Archived</option>
          </select></label>}
        </div>
        {!scoped.length && (
          <p className="secure-empty">
            No approved projects are available for this period.
          </p>
        )}
        {scoped.length > 0 && !matching.length && (
          <div className="secure-empty">
            <p role="status">No published projects match.</p>
            <button onClick={() => { setSearch(""); setStatus("all"); }}>Clear search</button>
          </div>
        )}
        {groups.map(group => (
          <Group className="exec-project-group" key={group} open={Group === "details" ? true : undefined}>
            {(view === "projects" || selectedArea) && <summary>{groupName(group)}</summary>}
            <div className="secure-project-grid">
          {matching.filter(p => !(view === "projects" || selectedArea) || (placements.get(p.id)?.engagementId ?? "") === group).map((project) => (
            <ProjectReportingCard key={project.id} project={project} period={period}
              placement={placements.get(project.id)}
              team={(portfolio?.directory ?? []).filter(member => member.projectIds.includes(project.id))} />
          ))}
            </div>
          </Group>
        ))}
      </section>)}
      {(view === "directory" || selectedArea) && <section aria-labelledby="directory-heading">
        <div className="secure-section-heading"><h2 id="directory-heading">MI Directory</h2>
          {view === "directory" && (portfolio?.directory.length ?? 0) > 0 && <label className="secure-search-label">Search approved contacts<input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label>}
        </div>
        {directory.length ? <div className="exec-directory-grid">{directory.map(contact => <article className="exec-panel" key={contact.id}>
          <h3>{contact.name}</h3><p>{contact.role}</p>
          {contact.responsibility && <p className="exec-copy">{contact.responsibility}</p>}
          {contact.publicContact && <p className="exec-copy">{contact.publicContact}</p>}
          <ul>{contact.projectIds.map(id => visible.find(project => project.id === id)).filter(Boolean).map(project => <li key={project!.id}>{project!.name}</li>)}</ul>
        </article>)}</div> : <p className="secure-empty">{search && view === "directory" ? "No approved contacts match." : "No approved contacts are available for these projects."}</p>}
      </section>}
      </div>
      {presenting && <Suspense fallback={<p role="status">Opening presentation…</p>}>
        <Presentation report={report} onClose={() => { setPresenting(false); requestAnimationFrame(() => presentationTrigger.current?.focus()); }} />
      </Suspense>}
    </div>
  );
}
