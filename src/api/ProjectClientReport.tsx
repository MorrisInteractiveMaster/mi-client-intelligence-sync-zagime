import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectReport } from "../projects/model";
import { ApiError, type SecuredApiClient } from "./client";
import {
  reportDay,
  reportHours,
  reportMonth,
  reportTimestamp,
} from "./dashboard-format";

import { ArrowUpRight, CalendarDays, ChartNoAxesColumnIncreasing, ChevronLeft, ChevronRight, FolderKanban, LayoutGrid, PanelLeftClose, Presentation as PresentationIcon, UsersRound } from "lucide-react";
import { ProjectReportingCard } from "./ProjectReportingCard";
import { ExecutiveOverview } from "./ExecutiveOverview";
import { chartKinds, DotChart, DotChartDialog, DotField, dotScale, type ChartKind } from "./DotAnalytics";
import { closePortalOverlay, portalNavigate, usePlatformRoute, usePortalLocation } from "./portal-location";
import { PersonPhoto } from "./PersonPhoto";
import { deliveryDefaults, rollup } from "../projects/delivery";
import "./executive.css";
import "./intelligence.css";
const Presentation = lazy(() => import("./ExecutivePresentation"));

const searchText = (value: string) =>
  value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type ReportScope = {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  onDenied: () => void;
  preview?: { mode: "published" | "draft"; scope?: string };
};

export function ProjectClientReport(props: ReportScope) {
  return (
    <ScopedClientReport
      key={JSON.stringify([props.tenant, props.month, props.preview?.mode, props.preview?.scope])}
      {...props}
    />
  );
}

function ScopedClientReport({ client, tenant, month, onDenied, preview }: ReportScope) {
  const [result, setResult] = useState<{
    client: SecuredApiClient;
    report?: ProjectReport;
  }>();
  const [epoch, setEpoch] = useState(0);
  const location = usePortalLocation();
  const nativeClient = usePlatformRoute()?.kind === "client";
  const view = location.get("view") || "overview";
  const search = location.get("q")?.slice(0, 120) || "";
  const status = location.get("status") || "all";
  const setSearch = (value: string) => portalNavigate({ q: value }, true);
  const setStatus = (value: string) => portalNavigate({ status: value === "all" ? null : value });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const chart = chartKinds.find(kind => kind === location.get("chart"));
  const presenting = location.get("present") === "1";
  const overlayTrigger = useRef<HTMLElement | null>(null);
  const hadOverlay = useRef(false);
  const page = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  useLayoutEffect(() => {
    if (previousView.current !== view) page.current?.focus({ preventScroll: true });
    previousView.current = view;
  }, [view]);
  useLayoutEffect(() => {
    if (hadOverlay.current && !chart && !presenting) {
      if (overlayTrigger.current?.isConnected) overlayTrigger.current.focus({ preventScroll: true });
      else page.current?.focus({ preventScroll: true });
    }
    hadOverlay.current = Boolean(chart || presenting);
  }, [chart, presenting]);
  const choose = (destination: string, selectedMonth?: string) => {
    setMobileOpen(false);
    const projectFilter = destination.startsWith("projects:");
    const next = projectFilter ? "projects" : destination;
    portalNavigate({ view: next === "overview" ? null : next, q: null,
      status: projectFilter ? destination.slice(9) : null, chart: null, present: null,
      ...(selectedMonth && { month: selectedMonth }) }, Boolean(chart || presenting));
  };
  const openOverlay = (key: "chart" | "present", value: string) => {
    overlayTrigger.current = document.activeElement as HTMLElement | null;
    portalNavigate({ [key]: value }, false, key);
  };
  const current = result?.client === client ? result : undefined;
  useEffect(() => {
    const abort = new AbortController();
    client
      .call<ProjectReport>(tenant, (preview ? "client-preview?" + new URLSearchParams({ month, mode: preview.mode, ...(preview.scope ? { scope: preview.scope } : {}) }) : "report?month=" + month), {
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
          { if (preview) setResult({ client }); onDenied(); }
        else setResult({ client });
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch, onDenied, preview?.mode, preview?.scope]);

  const report = current?.report;
  const [kind, id, itemId] = view.split(":");
  const area = kind === "area" ? report?.portfolio?.areas.find(a => a.id === id) : undefined;
  const engagementProject = kind === "group" && report?.hierarchy?.[id]?.kind === "engagement" ? report.projects.find(p => p.id === id) : undefined;
  const engagement = kind === "group" ? engagementProject ?? report?.portfolio?.engagements.find(group => group.id === id) : undefined;
  const project = ["project", "timeline", "milestone"].includes(kind) ? report?.projects.find(p => p.id === id) : undefined;
  const contact = kind === "contact" ? report?.portfolio?.directory.find(p => p.id === id) : undefined;
  const milestone = kind === "milestone" ? project?.milestones?.find(m => m.id === itemId) : undefined;
  const labels: Record<string, string> = { overview: "Leadership summary", projects: "Projects", directory: "MI Directory",
    history: "Reporting history", milestones: "Milestones", notes: "Executive notes", engagements: "Engagements", areas: "Service Areas" };
  const standardTitle = Object.hasOwn(labels, view) ? labels[view] : undefined;
  const title = area?.name ?? engagement?.name ?? contact?.name ?? milestone?.title ?? (project && kind === "timeline" ? "Project timeline" : project?.name) ?? standardTitle ?? "Report unavailable";
  useEffect(() => {
    if (!report) return;
    const previous = document.title;
    document.title = (presenting ? "Presentation · " : "") + title + " · Client Intelligence";
    return () => { document.title = previous; };
  }, [report, title, presenting]);
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
  if (!report)
    return (
      <p className="intel-empty intel-loading" role="status">
        Loading approved reporting…
      </p>
    );

  const visible = [...report.projects].sort((a, b) =>
    a.name.localeCompare(b.name, "en-CA"),
  );
  const portfolio = report.portfolio;
  const hierarchy = report.hierarchy ?? {};
  const projectLookup = new Map(visible.map(p => [p.id, p]));
  const delegatedTotals = rollup(visible.map(p => ({ ...p, delivery: { ...deliveryDefaults, parentId: hierarchy[p.id]?.parentId } })));
  const parent = project && hierarchy[project.id]?.parentId ? projectLookup.get(hierarchy[project.id].parentId!) : undefined;
  const children = project ? visible.filter(p => hierarchy[p.id]?.parentId === project.id) : [];
  const selectedArea = area;
  const placements = new Map(portfolio?.placements.map(p => [p.id, p]));
  const isWithin = (projectId: string, root: string) => {
    let next: string | undefined = projectId;
    const visited = new Set<string>();
    while (next && !visited.has(next) && visited.size < 24) {
      if (next === root) return true;
      visited.add(next); next = hierarchy[next]?.parentId;
    }
    return false;
  };
  const parentEngagements = visible.filter(p => hierarchy[p.id]?.kind === "engagement");
  const approvedGroups = portfolio?.engagements ?? [];
  const scoped = selectedArea ? visible.filter(p => placements.get(p.id)?.areaId === selectedArea.id)
    : engagementProject ? visible.filter(p => isWithin(p.id, engagementProject.id))
      : engagement ? visible.filter(p => placements.get(p.id)?.engagementId === engagement.id) : visible;
  const displayStatus = (project: ProjectReport["projects"][number]) => placements.get(project.id)?.archived ? "archived" : project.status;
  const matching = scoped.filter(project => searchText(project.name).includes(searchText(search)) && (status === "all" || displayStatus(project) === status));
  const groupName = (id: string) => portfolio?.engagements.find(e => e.id === id)?.name ?? "Independent delivery projects";
  const groups = (view === "projects" || selectedArea) ? [...new Set(matching.map(p => placements.get(p.id)?.engagementId ?? ""))] : [""];
  const Group = view === "projects" || selectedArea ? "details" : "div";
  const directory = (portfolio?.directory ?? []).filter(p =>
    view === "directory" ? searchText(p.name + " " + p.role).includes(searchText(search)) :
      !selectedArea || p.areaId === selectedArea.id || p.projectIds.some(id => scoped.some(project => project.id === id)));
  const period = reportMonth(report.month);
  const directoryFor = (projectId: string) => (portfolio?.directory ?? []).filter(member => member.projectIds.includes(projectId));
  const isPortfolio = view === "overview" || view === "projects" || Boolean(selectedArea || engagement);
  const unavailable = !standardTitle && !selectedArea && !engagement && !contact && (!project || (kind === "milestone" && !milestone));
  const presentReport = {
    ...report,
    projects: selectedArea || engagement ? scoped : project ? [project] : contact ? visible.filter(p => contact.projectIds.includes(p.id)) : report.projects,
  };
  const contextScoped = Boolean(selectedArea || engagement || project || contact);
  if (contextScoped) {
    presentReport.totalSeconds = presentReport.projects.reduce((sum, p) => sum + p.seconds, 0);
    if (portfolio) presentReport.portfolio = { ...portfolio, history: [] };
  }
  return (
    <div className="exec-frame intel-workspace" data-collapsed={collapsed}>
      <aside className="exec-sidebar" data-mobile-open={mobileOpen} onKeyDown={event => {
        if (event.key === "Escape" && mobileOpen) { setMobileOpen(false); mobileToggle.current?.focus(); }
      }}>
        <button ref={mobileToggle} type="button" className="intel-mobile-nav" aria-expanded={mobileOpen} aria-controls="client-portal-nav"
          onClick={() => setMobileOpen(value => !value)}>{mobileOpen ? "Close workspace navigation" : "Workspace navigation"}</button>
        <div className="exec-sidebar-title"><span>Client workspace</span>
          <button className="exec-icon exec-collapse" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setCollapsed(!collapsed)}><PanelLeftClose size={18} /></button>
        </div>
        <nav aria-label="Client workspace" id="client-portal-nav">
          <button type="button" aria-label="Leadership summary" aria-current={view === "overview" ? "page" : undefined} onClick={() => choose("overview")}><LayoutGrid size={18} /><span>Leadership summary</span></button>
          {nativeClient && <>
            <button type="button" aria-current={view === "engagements" ? "page" : undefined} onClick={() => choose("engagements")}><FolderKanban size={18} aria-hidden="true" />Engagements</button>
            <button type="button" aria-current={view === "areas" ? "page" : undefined} onClick={() => choose("areas")}><span className="exec-nav-dot" aria-hidden="true" />Service Areas</button>
          </>}
          <button type="button" aria-label="Projects" aria-current={view === "projects" ? "page" : undefined} onClick={() => choose("projects")}><FolderKanban size={18} /><span>Projects</span></button>
          <button type="button" aria-label="Reporting history" aria-current={view === "history" ? "page" : undefined} onClick={() => choose("history")}><ChartNoAxesColumnIncreasing size={18} /><span>Reporting history</span></button>
          <button type="button" aria-label="Milestones" aria-current={view === "milestones" ? "page" : undefined} onClick={() => choose("milestones")}><CalendarDays size={18} /><span>Milestones</span></button>
          {portfolio?.areas.map(area => <button type="button" key={area.id} aria-label={area.name} aria-current={view === "area:" + area.id ? "page" : undefined} onClick={() => choose("area:" + area.id)}><span className="exec-nav-dot" aria-hidden="true" /><span>{area.name}</span></button>)}
          <button type="button" aria-label="MI Directory" aria-current={view === "directory" ? "page" : undefined} onClick={() => choose("directory")}><UsersRound size={18} /><span>MI Directory</span></button>
          {nativeClient && <button type="button" aria-current={presenting ? "page" : undefined} onClick={() => openOverlay("present", "1")}><PresentationIcon size={18} aria-hidden="true" />Presentation</button>}
        </nav>
      </aside>
      <div className="exec-content" tabIndex={-1} ref={page}>
        {view === "overview" && <ExecutiveOverview report={report} platform={nativeClient} onLink={choose} onChart={type => openOverlay("chart", type)}
          onPresentation={() => openOverlay("present", "1")} />}
        {view !== "overview" && <nav className="exec-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="exec-text-button" onClick={() => choose("overview")}><ChevronLeft size={16} /> Leadership summary</button>
          {project && <><ChevronRight size={14} aria-hidden="true" /><button type="button" className="exec-text-button"
            onClick={() => choose(kind === "project" ? "projects" : "project:" + project.id)}>{kind === "project" ? "Projects" : project.name}</button></>}
          {contact && <><ChevronRight size={14} aria-hidden="true" /><button type="button" className="exec-text-button" onClick={() => choose("directory")}>MI Directory</button></>}
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{title}</span>
        </nav>}
        {view !== "overview" && <section className="intel-page-hero" data-area={selectedArea && searchText(selectedArea.name)}>
          <div><span className="exec-kicker">{period}</span><h2>{title}</h2>
            {selectedArea?.description && <p>{selectedArea.description}</p>}
            {selectedArea && <p>{scoped.length ? reportHours(presentReport.totalSeconds) + " h allocated · " + scoped.length + " published projects" : "No published projects for this period"}</p>}
            {contact && <p>{contact.role}</p>}
          </div>
          {!unavailable && <button className="exec-hero-action" type="button" onClick={() => openOverlay("present", "1")}><PresentationIcon size={16} aria-hidden="true" /> Present this view</button>}
          {selectedArea && <DotField value={presentReport.totalSeconds} unit={dotScale(Math.max(report.totalSeconds, 1))} />}
        </section>}
        {view === "projects" && Object.values(hierarchy).some(item => item.parentId) && <details className="delivery-details">
          <summary>Project hierarchy</summary><ul className="delivery-client-tree">{visible.filter(p => hierarchy[p.id]?.parentId).map(p =>
            <li key={p.id}>{projectLookup.get(hierarchy[p.id].parentId!)?.name} <span aria-hidden="true">›</span> <button className="exec-text-button" type="button" onClick={() => choose("project:" + p.id)}>{p.name}</button></li>)}</ul>
        </details>}
        {(view === "engagements" || view === "areas") && <section className="platform-report-directory" aria-label={title}>
          {view === "engagements" && <>
            {parentEngagements.map(engagement => <button type="button" key={engagement.id} className="platform-report-link" onClick={() => choose("group:" + engagement.id)}>
              <b>{engagement.name}</b><span>{visible.filter(p => isWithin(p.id, engagement.id)).length} published projects and engagements</span>
              <ArrowUpRight aria-hidden="true" size={18} />
            </button>)}
            {approvedGroups.filter(group => !parentEngagements.some(project => project.id === group.id)).map(group =>
              <button type="button" key={group.id} className="platform-report-link" onClick={() => choose("group:" + group.id)}>
                <b>{group.name}</b><span>Published engagement</span><ArrowUpRight aria-hidden="true" size={18} />
              </button>)}
            {!parentEngagements.length && !approvedGroups.length && <p>No engagements have been published for this period.</p>}
          </>}
          {view === "areas" && <>
            {portfolio?.areas.map(group => <button type="button" key={group.id} className="platform-report-link" onClick={() => choose("area:" + group.id)}>
              <b>{group.name}</b><span>{visible.filter(project => placements.get(project.id)?.areaId === group.id).length} published projects</span>
              <ArrowUpRight aria-hidden="true" size={18} />
            </button>)}
            {!portfolio?.areas.length && <p>No service areas have visible projects for this period.</p>}
          </>}
        </section>}
        {unavailable && <p className="intel-empty" role="status">This link is unavailable for your approved report.</p>}
        {isPortfolio && (
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
              {group && <button className="exec-text-button" onClick={() => choose("group:" + group)}>Open reporting group</button>}
            <div className="secure-project-grid">
          {matching.filter(p => !(view === "projects" || selectedArea) || (placements.get(p.id)?.engagementId ?? "") === group).map((project) => (
            <ProjectReportingCard key={project.id} project={project} period={period}
              placement={placements.get(project.id)}
              team={directoryFor(project.id)} onLink={choose} delivery={hierarchy[project.id]} />
          ))}
            </div>
          </Group>
        ))}
      </section>)}
      {(view === "directory" || selectedArea || contact) && <section aria-labelledby="directory-heading">
        <div className="secure-section-heading"><h2 id="directory-heading">MI Directory</h2>
          {view === "directory" && (portfolio?.directory.length ?? 0) > 0 && <label className="secure-search-label">Search approved contacts<input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label>}
        </div>
        {(contact ? [contact] : directory).length ? <div className="intel-directory-grid">{(contact ? [contact] : directory).map(member => <article className="intel-contact" key={member.id}>
          <PersonPhoto name={member.name} photo={member.photo} alt={member.photoAlt} />
          <div><h3>{member.name}</h3><p>{member.role}</p>
          {member.responsibility && <p className="exec-copy">{member.responsibility}</p>}
          {member.publicContact && <p className="exec-copy">{member.publicContact}</p>}
          {member.email && <p><a href={"mailto:" + member.email}>{member.email}</a></p>}
          {member.phone && <p>{member.phone}</p>}
          {member.profileUrl && <a href={member.profileUrl} rel="noreferrer">Morris profile</a>}
          {!contact && <button className="exec-text-button" onClick={() => choose("contact:" + member.id)}>View contact <ArrowUpRight size={15} aria-hidden="true" /></button>}
          <ul>{member.projectIds.map(id => visible.find(p => p.id === id)).filter(p => p !== undefined).map(p => <li key={p.id}><button className="exec-text-button" onClick={() => choose("project:" + p.id)}>{p.name}</button></li>)}</ul>
          </div>
        </article>)}</div> : <p className="secure-empty">{search && view === "directory" ? "No approved contacts match." : "No approved contacts are available for these projects."}</p>}
      </section>}
      {view === "history" && <DotChart report={report} kind="trend" expanded onLink={choose} onOpen={() => openOverlay("chart", "trend")} />}
      {(selectedArea || engagement) && <DotChart report={presentReport} kind="plan" onLink={choose} onOpen={() => openOverlay("chart", "plan")} />}
      {view === "notes" && <article className="intel-detail"><h3>Delivery narrative</h3>
        <p>{portfolio?.narrative || "No executive narrative has been published for this period."}</p>
        {portfolio?.action && <><h3>Next decision</h3><p>{portfolio.action}</p></>}</article>}
      {project && kind === "project" && <article className="intel-detail">
        <div className="intel-detail-links">
          {parent && <button className="exec-text-button" onClick={() => choose("project:" + parent.id)}>Parent: {parent.name}</button>}
          {placements.get(project.id)?.areaId && <button className="exec-text-button" onClick={() => choose("area:" + placements.get(project.id)!.areaId)}>
            {portfolio?.areas.find(a => a.id === placements.get(project.id)?.areaId)?.name}</button>}
          {placements.get(project.id)?.engagementId && <button className="exec-text-button" onClick={() => choose("group:" + placements.get(project.id)!.engagementId)}>{groupName(placements.get(project.id)!.engagementId)}</button>}
          <button className="exec-text-button" onClick={() => choose("timeline:" + project.id)}>Project timeline</button>
          {report.sourceUpdatedAt && <span>Source updated {reportTimestamp(report.sourceUpdatedAt)}</span>}
        </div>
        <ProjectReportingCard project={project} period={period} placement={placements.get(project.id)} team={directoryFor(project.id)} onLink={choose}
          delivery={hierarchy[project.id]} descendantTotals={delegatedTotals.get(project.id)} detail />
        {!!children.length && <section aria-label="Child projects"><h3>Child projects</h3><ul className="delivery-client-tree">{children.map(child => <li key={child.id}><button type="button" className="exec-text-button" onClick={() => choose("project:" + child.id)}>{child.name}</button></li>)}</ul></section>}
        <DotChart report={presentReport} kind="plan" onLink={choose} onOpen={() => openOverlay("chart", "plan")} />
      </article>}
      {(view === "milestones" || (project && kind === "timeline")) && <article className="intel-detail">
        <h3>{kind === "timeline" ? "Delivery timeline" : "Published milestones"}</h3>
        {(() => {
          const items = (project ? [project] : visible).flatMap(p => [
            ...(p.milestones ?? []).map(m => ({ ...m, project: p, body: "", type: m.completed ? "Complete" : "Upcoming", route: "milestone:" + p.id + ":" + m.id })),
            ...(kind === "timeline" ? (p.updates ?? []).map(u => ({ ...u, project: p, type: "Update", route: "" })) : []),
          ]).sort((a, b) => a.date.localeCompare(b.date));
          return items.length ? <ol className="intel-timeline">{items.map(item => <li key={item.project.id + item.id + item.type}>
            <time dateTime={item.date}>{reportDay(item.date)}</time><div><span>{item.type} · {item.project.name}</span>
              {item.route ? <button className="exec-text-button" onClick={() => choose(item.route)}>{item.title}</button> : <strong>{item.title}</strong>}
              {item.body && <p>{item.body}</p>}</div>
          </li>)}</ol> : <p className="intel-empty">There are no published timeline entries for this view.</p>;
        })()}
      </article>}
      {milestone && project && <article className="intel-detail"><h3>{milestone.completed ? "Completed milestone" : "Upcoming milestone"}</h3>
        <p>{reportDay(milestone.date)} · {project.name}</p><button className="exec-text-button" onClick={() => choose("timeline:" + project.id)}>View the project timeline</button></article>}
      </div>
      {chart && !presenting && !unavailable && <DotChartDialog report={contextScoped ? presentReport : report} kind={chart}
        onLink={choose} onClose={() => closePortalOverlay("chart")} />}
      {presenting && !unavailable && <Suspense fallback={<p role="status">Opening presentation…</p>}>
        <Presentation report={presentReport} scope={view} scopeTitle={title} onLink={choose} onClose={() => closePortalOverlay("present")}
          draft={preview?.mode === "draft"} linked={nativeClient} />
      </Suspense>}
    </div>
  );
}
