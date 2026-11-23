import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ProjectReport } from "../projects/model";
import { ApiError, type SecuredApiClient } from "./client";
import {
  reportDay,
  reportHours,
  reportMonth,
  reportTimestamp,
} from "./dashboard-format";

import { ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, FolderKanban, LayoutGrid, Layers3, Presentation as PresentationIcon, UsersRound } from "lucide-react";
import { ProjectReportingCard } from "./ProjectReportingCard";
import { ExecutiveOverview, WorkProgress } from "./ExecutiveOverview";
import { DeliveryTrends, StatusComposition } from "./ClientCockpitVisuals";
import { metricPercent, percentText } from "./insight-metrics";
import { chartKinds, DotChart, DotChartDialog, type ChartKind } from "./DotAnalytics";
import { closePortalOverlay, portalNavigate, usePlatformRoute, usePortalLocation } from "./portal-location";
import { PersonPhoto } from "./PersonPhoto";
import { OtherContacts } from "./OtherContacts";
import { isOtherContact } from "../projects/other-contacts";
import { WorkspaceNavigation, type WorkspaceGroup } from "./WorkspaceNavigation";
import { ReportingPeriod } from "./ReportingPeriod";
import { readReportingRange } from "./reporting-period";
import { reportingTimeMonth } from "../projects/time-history";
import { CsvExport } from "./CsvExport";
import { milestoneCsv, publishedProjectCsv, type CsvData } from "./report-csv";
import { deliveryDate, deliveryDefaults, rollup } from "../projects/delivery";
import { isBoardRole } from "../projects/directory-role";
import { clientDelivery, clientProjectFilters, forProjectFilter, type ProjectFilter } from "./client-delivery";
import { DeliveryMetrics, ParentEngagementCard } from "./ClientDeliverySummary";
import "./executive.css";
import "./intelligence.css";
import "./client-delivery.css";
const Presentation = lazy(() => import("./ExecutivePresentation"));

const searchText = (value: string) =>
  value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const projectSorts = {
  name: "Name", start: "Start date", deadline: "Expected completion", completion: "Work completion", hours: "Attributable hours",
} as const;

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
      key={JSON.stringify([props.tenant, props.preview?.mode, props.preview?.scope])}
      {...props}
    />
  );
}

function ScopedClientReport({ client, tenant, month, onDenied, preview }: ReportScope) {
  const [result, setResult] = useState<{
    client: SecuredApiClient;
    month: string;
    report?: ProjectReport;
    lastReport?: ProjectReport;
  }>();
  const [epoch, setEpoch] = useState(0);
  const location = usePortalLocation();
  const nativeClient = usePlatformRoute()?.kind === "client";
  const view = location.get("view") || "overview";
  const search = location.get("q")?.slice(0, 120) || "";
  const status = location.get("status") || "all";
  const sort = location.get("project-sort") || "name";
  const setSearch = (value: string) => portalNavigate({ q: value }, true);
  const setStatus = (value: string) => portalNavigate({ status: value === "all" ? null : value });
  const [collapsed, setCollapsed] = useState(false);
  const chart = chartKinds.find(kind => kind === location.get("chart"));
  const presenting = location.get("present") === "1";
  const overlayTrigger = useRef<HTMLElement | null>(null);
  const hadOverlay = useRef(false);
  const page = useRef<HTMLDivElement>(null);
  const previousView = useRef(view);
  const revealView = useRef(false);
  useLayoutEffect(() => {
    if (previousView.current !== view) {
      page.current?.focus({ preventScroll: true });
      if (revealView.current) window.scrollTo({ top: 0, behavior: "instant" });
      revealView.current = false;
    }
    previousView.current = view;
  }, [view]);
  useLayoutEffect(() => {
    if (hadOverlay.current && !chart && !presenting) {
      if (overlayTrigger.current?.isConnected) overlayTrigger.current.focus({ preventScroll: true });
      else page.current?.focus({ preventScroll: true });
    }
    hadOverlay.current = Boolean(chart || presenting);
  }, [chart, presenting]);
  const choose = (destination: string, selectedMonth?: string, filter?: ProjectFilter) => {
    const projectFilter = destination.startsWith("projects:");
    const next = projectFilter ? "projects" : destination;
    if (next !== view) revealView.current = true;
    portalNavigate({ view: next === "overview" ? null : next, q: null,
      status: projectFilter ? destination.slice(9) : filter && filter !== "all" ? filter : null, "project-sort": null, chart: null, present: null,
      ...(selectedMonth && { month: selectedMonth }) }, Boolean(chart || presenting));
  };
  const openOverlay = (key: "chart" | "present", value: string, trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined) => {
    overlayTrigger.current = trigger ?? null;
    portalNavigate({ [key]: value }, false, key);
  };
  const scopedResult = result?.client === client ? result : undefined;
  const current = scopedResult?.month === month ? scopedResult : undefined;
  const reportRequest = (preview ? "client-preview?" : "report?") + new URLSearchParams({
    month, ...(preview && { mode: preview.mode, ...(preview.scope && { scope: preview.scope }) }),
  });
  useEffect(() => {
    let reportDay = deliveryDate();
    const refreshAfterMidnight = () => {
      const day = deliveryDate();
      if (day === reportDay) return;
      reportDay = day;
      setEpoch(value => value + 1);
    };
    const timer = window.setInterval(refreshAfterMidnight, 60_000);
    document.addEventListener("visibilitychange", refreshAfterMidnight);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshAfterMidnight);
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    client
      .call<ProjectReport>(tenant, reportRequest, {
        signal: abort.signal,
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        if (data.month !== month || data.tenant.id !== tenant)
          throw Error("Unexpected reporting scope");
        setResult({ client, month, report: data });
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return;
        if (failure instanceof ApiError && [401, 403].includes(failure.status))
          { setResult({ client, month }); onDenied(); }
        else setResult(prior => ({ client, month, lastReport: prior?.client === client ? prior.report ?? prior.lastReport : undefined }));
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch, onDenied, reportRequest]);

  const report = current?.report;
  const periodReport = report ?? scopedResult?.report ?? scopedResult?.lastReport;
  const currentMonth = periodReport?.reportingThroughMonth ?? reportingTimeMonth();
  const monthRange = view === "history" ? readReportingRange(location, currentMonth) : undefined;
  const availableMonths = (periodReport?.portfolio?.history ?? []).map(row => row.month);
  const latestMonth = [
    ...(periodReport && periodReport.totalSeconds > 0 ? [periodReport.month] : []),
    ...(periodReport?.portfolio?.history ?? []).filter(row => row.seconds > 0).map(row => row.month),
  ].filter(candidate => candidate <= currentMonth).sort().at(-1);
  const periodToolbar = (action?: ReactNode) => <ReportingPeriod month={month} currentMonth={currentMonth} action={action}
    availableMonths={availableMonths} latestMonth={latestMonth} empty={report?.totalSeconds === 0}
    range={monthRange} pending={!report && !current}
    onMonth={selected => portalNavigate({ month: selected, "period-scope": null, "from-month": null, "through-month": null })}
    onRange={range => portalNavigate({ view: "history", "period-scope": range.preset,
      "from-month": range.preset === "custom" ? range.from ?? null : null,
      "through-month": range.preset === "custom" ? range.through ?? null : null, chart: null })} />;

  const [kind, id, itemId] = view.split(":");
  const area = kind === "area" ? report?.portfolio?.areas.find(a => a.id === id) : undefined;
  const engagementProject = kind === "group" && report?.hierarchy?.[id]?.kind === "engagement" ? report.projects.find(p => p.id === id) : undefined;
  const engagement = kind === "group" ? engagementProject ?? report?.portfolio?.engagements.find(group => group.id === id) : undefined;
  const project = ["project", "timeline", "milestone"].includes(kind) ? report?.projects.find(p => p.id === id) : undefined;
  const contact = kind === "contact" ? report?.portfolio?.directory.find(p => p.id === id) : undefined;
  const milestone = kind === "milestone" ? project?.milestones?.find(m => m.id === itemId) : undefined;
  const labels: Record<string, string> = { overview: "Leadership summary", projects: "Projects", directory: "MI Directory",
    history: "Reporting history", milestones: "Milestones", notes: "Executive notes", engagements: "Parent engagements", areas: "Departments" };
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
        {nativeClient && periodToolbar()}
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
      <div>
        {nativeClient && scopedResult && periodToolbar()}
        <p className="intel-empty intel-loading" role="status">Loading approved reporting…</p>
      </div>
    );

  const visible = [...report.projects].sort((a, b) =>
    a.name.localeCompare(b.name, "en-CA"),
  );
  const portfolio = report.portfolio;
  const hierarchy = report.hierarchy ?? {};
  const delegatedTotals = rollup(visible.map(p => ({ ...p, delivery: { ...deliveryDefaults, parentId: hierarchy[p.id]?.parentId } })));
  const children = project ? visible.filter(p => hierarchy[p.id]?.parentId === project.id) : [];
  const selectedArea = area;
  const delivery = clientDelivery(report);
  const activeDepartment = selectedArea && delivery.departmentRows.find(dept => dept.id === selectedArea.id);
  const activeEngagement = engagement && delivery.parentRows.find(group => group.id === engagement.id);
  const activeProject = project && delivery.projectRows.find(item => item.project.id === project.id);
  const scoped = activeDepartment?.projects ?? activeEngagement?.projects ?? delivery.projects;
  const matching = scoped.filter(item =>
    searchText([item.project.name, item.parent?.name, item.department?.name].filter(Boolean).join(" ")).includes(searchText(search)) &&
    (status === "unaffiliated" ? !item.parent : forProjectFilter(item, status, item.project.seconds)),
  ).sort((a, b) => {
    const byName = a.project.name.localeCompare(b.project.name, "en-CA");
    if (sort === "start" || sort === "deadline") return (a[sort] || "9999").localeCompare(b[sort] || "9999") || byName;
    if (sort === "completion") return (b.completion ?? -1) - (a.completion ?? -1) || byName;
    if (sort === "hours") return b.project.seconds - a.project.seconds || byName;
    return byName;
  });
  const projectGroups = new Map<string, { label: string; projects: typeof matching }>();
  for (const row of matching) {
    const group = activeDepartment ? "" : activeEngagement ? row.department?.id ?? "" : row.parent?.id ?? "";
    const label = activeDepartment ? "Delivery projects" : activeEngagement ? row.department?.name ?? "Direct delivery projects" : row.parent?.name ?? "Independent delivery projects";
    const bucket = projectGroups.get(group) ?? { label, projects: [] };
    bucket.projects.push(row);
    projectGroups.set(group, bucket);
  }
  const directory = (portfolio?.directory ?? []).filter(p => !isOtherContact({ url: p.profileUrl }) &&
    searchText(p.name + " " + p.role).includes(searchText(search)));
  const period = reportMonth(report.month);
  const directoryFor = (projectId: string) => (portfolio?.directory ?? []).filter(member => member.projectIds.includes(projectId));
  const isPortfolio = (!nativeClient && view === "overview") || view === "projects" || Boolean(selectedArea || engagement);
  const unavailable = !standardTitle && !selectedArea && !engagement && !contact && (!project || (kind === "milestone" && !milestone));
  const presentReport = {
    ...report,
    projects: activeDepartment ? activeDepartment.effortProjects.map(item => item.project) : activeEngagement ? delivery.projectRows.filter(item => item.project.id === activeEngagement.id ||
      item.parentIds.has(activeEngagement.id) || item.parent?.id === activeEngagement.id).map(item => item.project) :
      project ? [project] : contact ? visible.filter(p => contact.projectIds.includes(p.id)) : report.projects,
  };
  const allowExport = preview?.mode !== "draft";
  function confirmedExport(select: (report: ProjectReport) => CsvData) {
    const visibleData = JSON.stringify(select(report!));
    return async (signal: AbortSignal) => {
      const latest = await client.call<ProjectReport>(tenant, reportRequest, { signal });
      if (latest.month !== month || latest.tenant.id !== tenant) throw Error("Unexpected reporting scope.");
      const data = select(latest);
      if (JSON.stringify(data) !== visibleData) throw Error("The approved report changed. Refresh it and export again.");
      return data;
    };
  }
  const exportProjectRows = (projects: ProjectReport["projects"]) =>
    confirmedExport(latest => publishedProjectCsv(latest, projects));
  const exportMilestoneRows = (projects: ProjectReport["projects"], chosenMilestone?: string) =>
    confirmedExport(latest => {
      const ids = new Set(projects.map(p => p.id));
      return milestoneCsv(latest.projects.filter(p => ids.has(p.id)), false, chosenMilestone);
    });
  const csvPrefix = "Morris_" + report.tenant.name + "_" + report.month;
  const contextScoped = Boolean(selectedArea || engagement || project || contact);
  if (contextScoped) {
    presentReport.totalSeconds = presentReport.projects.reduce((sum, p) => sum + p.seconds, 0);
    if (portfolio) presentReport.portfolio = { ...portfolio, history: [] };
  }
  const card = (item: typeof matching[number]) => <ProjectReportingCard key={item.project.id} project={item.project} period={period}
    placement={item.placement} team={directoryFor(item.project.id)} onLink={choose} delivery={item.delivery}
    parent={item.parent && { ...item.parent, budget: hierarchy[item.parent.id] }} department={item.department}
    history={report.historyByProject?.[item.project.id]} />;
  const directoryGroups = contact ? [{ label: "Approved contact", members: [contact] }] : [
    { label: "Board", members: directory.filter(member => isBoardRole(member.role)) },
    { label: "Morris Interactive team", members: directory.filter(member => !isBoardRole(member.role)) },
  ];
  const presentationButton = !unavailable && <button type="button" className="mi-present-button" onClick={event => openOverlay("present", "1", event.currentTarget)}>
    <PresentationIcon size={17} aria-hidden="true" />{view === "overview" ? "Presentation" : "Present this view"}</button>;
  const groups: WorkspaceGroup[] = [{ label: "Client reporting", destinations: [
    { id: "leadership", label: "Leadership summary", icon: LayoutGrid, active: view === "overview", select: () => choose("overview") },
    { id: "projects", label: "Projects", icon: FolderKanban, active: view === "projects" || ["project", "group", "timeline"].includes(kind), select: () => choose("projects") },
    { id: "departments", label: "Departments", icon: Layers3, active: view === "areas", select: () => choose("areas"),
      children: (portfolio?.areas ?? []).map(area => ({ id: "client-department-" + area.id, label: area.name, icon: Layers3,
        active: selectedArea?.id === area.id, select: () => choose("area:" + area.id) })) },
    { id: "directory", label: "MI Directory", icon: UsersRound, active: view === "directory" || Boolean(contact), select: () => choose("directory") },
    { id: "presentation", label: "Presentation", icon: PresentationIcon, active: presenting, select: () => openOverlay("present", "1") },
  ] }];
  return (
    <WorkspaceNavigation groups={groups} heading="Client workspace" navigationLabel="Client workspace" mobileLabel="Workspace navigation"
      collapseLabel="sidebar" collapsed={collapsed} busy={false} onCollapse={() => setCollapsed(value => !value)}
      searchResults={delivery.projects.map(row => ({ id: "client-project-" + row.project.id, label: row.project.name,
        context: row.department?.name ?? "Published projects", select: () => choose("project:" + row.project.id) }))}>
      <div className="exec-content intel-workspace" tabIndex={-1} ref={page}>
        {(nativeClient || view !== "overview") && <div className="mi-report-top">
          {nativeClient ? periodToolbar(presentationButton) : presentationButton}
        </div>}
        {view === "overview" && <ExecutiveOverview report={report} delivery={delivery} platform={nativeClient} draft={preview?.mode === "draft"} onLink={choose}
          onChart={(type, trigger) => openOverlay("chart", type, trigger)} onPresentation={trigger => openOverlay("present", "1", trigger)} />}
        {view !== "overview" && <nav className="exec-breadcrumb" aria-label="Breadcrumb">
          <button type="button" className="exec-text-button" onClick={() => choose("overview")}><ChevronLeft size={16} /> Leadership summary</button>
          {(project || engagement) && <><ChevronRight size={14} aria-hidden="true" /><button type="button" className="exec-text-button"
            onClick={() => choose(project && kind !== "project" ? "project:" + project.id : "projects")}>{project && kind !== "project" ? project.name : "Projects"}</button></>}
          {contact && <><ChevronRight size={14} aria-hidden="true" /><button type="button" className="exec-text-button" onClick={() => choose("directory")}>MI Directory</button></>}
          {selectedArea && <><ChevronRight size={14} aria-hidden="true" /><button type="button" className="exec-text-button" onClick={() => choose("areas")}>Departments</button></>}
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{title}</span>
        </nav>}
        {view !== "overview" && <section className="intel-page-hero mi-compact-report-hero" data-area={selectedArea && searchText(selectedArea.name)}>
          <div><span className="exec-kicker">{period}</span><h2>{title}</h2>
            {selectedArea?.description && <p>{selectedArea.description}</p>}
            {activeDepartment && activeDepartment.counts.blocked > 0 && <p className="mi-department-attention"><CircleAlert size={16} aria-hidden="true" />
              {activeDepartment.counts.blocked} {activeDepartment.counts.blocked === 1 ? "active blocker" : "active blockers"}</p>}
            {contact && <p>{contact.role}</p>}
          </div>
        </section>}
        {unavailable && <p className="intel-empty" role="status">This link is unavailable for your approved report.</p>}
        {(view === "engagements" || view === "projects") && delivery.parentRows.length > 0 && <section className="mi-exec-panel" aria-label="Parent engagements">
          <div className="mi-exec-heading"><div><h3>Parent engagements</h3><p>Open an engagement or select a count to see its delivery projects.</p></div></div>
          <div className="mi-engagement-grid">{delivery.parentRows.map(group => <ParentEngagementCard key={group.id} engagement={group} period={period}
            onOpen={() => choose("group:" + group.id)} onFilter={filter => choose("group:" + group.id, undefined, filter)} />)}</div>
        </section>}
        {view === "engagements" && !delivery.parentRows.length && <p className="intel-empty">There are no approved parent engagements.</p>}
        {view === "areas" && <section className="mi-exec-panel" aria-label="Published departments">
          <div className="mi-exec-heading"><div><h3>Delivery by department</h3><p>{period} · Share of approved effort</p></div>
            {allowExport && visible.length > 0 && <CsvExport filename={csvPrefix + "_Departments"}
              label="Export approved department projects CSV" load={exportProjectRows(delivery.projects.filter(row => row.department).map(row => row.project))} onDenied={onDenied} />}
          </div>
          {delivery.departmentRows.length > 0 ? <div className="mi-department-index">{delivery.departmentRows.map(dept => {
            const share = dept.seconds > 0 ? metricPercent(dept.seconds, report.totalSeconds) : undefined;
            return <button type="button" key={dept.id} className="mi-department-link" data-attention={dept.counts.blocked > 0 || undefined} onClick={() => choose("area:" + dept.id)}>
              <span><b>{dept.name}</b><small>{dept.counts.all} {dept.counts.all === 1 ? "delivery project" : "delivery projects"}</small>
                <small>{share === undefined ? "No approved effort in this period" : percentText(share) + " of approved effort · " + reportHours(dept.seconds) + " h"}</small>
                {dept.counts.blocked > 0 && <small className="mi-engagement-risk"><CircleAlert size={14} aria-hidden="true" />{dept.counts.blocked} active {dept.counts.blocked === 1 ? "blocker" : "blockers"}</small>}</span>
              <ArrowUpRight aria-hidden="true" size={18} />
            </button>})}</div> : <p className="intel-empty">There are no approved departments.</p>}
        </section>}
        {activeDepartment && <>
          <section className="mi-exec-panel" aria-label={activeDepartment.name + " delivery metrics"}>
            {activeDepartment.counts.all ? <DeliveryMetrics counts={activeDepartment.counts} seconds={activeDepartment.seconds} period={period} active={status} onFilter={setStatus} />
              : <p className="mi-cockpit-empty">No approved delivery projects are available in {activeDepartment.name}.
                {activeDepartment.seconds > 0 && " " + reportHours(activeDepartment.seconds) + " h of approved effort were reported directly against this department in " + period + "."}
              </p>}
          </section>
          {activeDepartment.counts.all > 0 && <div className="mi-cockpit-analysis mi-department-analysis">
            <div className="mi-exec-panel"><StatusComposition counts={activeDepartment.counts} onFilter={setStatus} label="Department status composition" /></div>
            <DeliveryTrends counts={activeDepartment.counts} projects={activeDepartment.projects} onFilter={setStatus}
              onProject={id => choose("project:" + id)} />
            <WorkProgress projects={activeDepartment.projects} onProject={id => choose("project:" + id)} />
          </div>}
        </>}
        {activeEngagement && <ParentEngagementCard engagement={activeEngagement} period={period}
          onOpen={activeEngagement.project ? () => choose("project:" + activeEngagement.id) : undefined}
          onFilter={setStatus} />}
        {isPortfolio && <section className="mi-client-projects" aria-labelledby="published-projects">
          <div className="mi-exec-heading">
            <div><h2 id="published-projects">{activeDepartment || activeEngagement ? "Delivery projects" : "Published projects"}</h2>
              <p role="status">{matching.length} {matching.length === 1 ? "project" : "projects"}{status !== "all" ? " · " + (clientProjectFilters[status as ProjectFilter] ?? "Filtered") : ""}</p></div>
            {allowExport && matching.length > 0 && <CsvExport filename={csvPrefix + "_" + title + "_Projects"}
              label="Export approved projects CSV" scope={JSON.stringify([view, search, status, sort])}
              load={exportProjectRows(matching.map(item => item.project))} onDenied={onDenied} />}
          </div>
          {scoped.length > 0 && <div className="mi-project-filters">
            <label className="secure-search-label">Search published projects
              <input type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} />
            </label>
            <label>Status<select value={Object.hasOwn(clientProjectFilters, status) ? status : "all"} onChange={event => setStatus(event.target.value)}>
              {Object.entries(clientProjectFilters).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
            <label>Sort by<select value={Object.hasOwn(projectSorts, sort) ? sort : "name"} onChange={event => portalNavigate({ "project-sort": event.target.value === "name" ? null : event.target.value })}>
              {Object.entries(projectSorts).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
          </div>}
          {!scoped.length && <p className="secure-empty">No approved delivery projects are available in this view.</p>}
          {scoped.length > 0 && !matching.length && <div className="secure-empty">
            <p>No published projects match.</p>
            <button type="button" onClick={() => portalNavigate({ q: null, status: null })}>Clear filters</button>
          </div>}
          {[...projectGroups].map(([id, group]) => <section className="mi-project-group" key={id}>
            {!activeDepartment && <h3>{group.label}</h3>}
            {view === "projects" && id ? [...new Set(group.projects.map(item => item.department?.id ?? ""))].map(dept => {
              const items = group.projects.filter(item => (item.department?.id ?? "") === dept);
              return <section className="mi-department-group" key={dept}><h4>{items[0]?.department?.name ?? "Direct delivery projects"}</h4>
                <div className="secure-project-grid">{items.map(card)}</div></section>;
            }) : <div className="secure-project-grid">{group.projects.map(card)}</div>}
          </section>)}
        </section>}
      {(view === "directory" || contact) && <section className="mi-exec-panel" aria-labelledby="directory-heading">
        <div className="secure-section-heading"><h2 id="directory-heading">{contact ? "Approved contact" : "Morris Interactive Directory"}</h2>
          {view === "directory" && (portfolio?.directory.length ?? 0) > 0 && <label className="secure-search-label">Search approved contacts<input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label>}
        </div>
        {(contact ? [contact] : directory).length ? directoryGroups.filter(group => group.members.length > 0).map(group =>
          <section className="mi-directory-group" key={group.label} aria-label={group.label}>
            {!contact && <h3>{group.label}</h3>}{group.label === "Board" && <p>Board members whose profiles are approved for this portal.</p>}
            <div className="intel-directory-grid">{group.members.map(member => <article className="intel-contact" key={member.id}>
          <PersonPhoto name={member.name} photo={member.photo} alt={member.photoAlt} />
          <div><h4>{member.name}</h4>{member.role && <p>{member.role}</p>}
          {member.responsibility && <p className="exec-copy">{member.responsibility}</p>}
          {member.publicContact && <p className="exec-copy">{member.publicContact}</p>}
          {member.email && <p><a href={"mailto:" + member.email}>{member.email}</a></p>}
          {member.phone && <p>{member.phone}</p>}
          {member.profileUrl && <a href={member.profileUrl} rel="noreferrer">Morris profile</a>}
          {!contact && <button className="exec-text-button" onClick={() => choose("contact:" + member.id)}>View contact <ArrowUpRight size={15} aria-hidden="true" /></button>}
          <ul>{member.projectIds.map(id => visible.find(p => p.id === id)).filter(p => p !== undefined).map(p => <li key={p.id}><button className="exec-text-button" onClick={() => choose("project:" + p.id)}>{p.name}</button></li>)}</ul>
          </div>
        </article>)}</div></section>) : <p className="secure-empty">{search && view === "directory" ? "No approved contacts match." : "No approved contacts are available for these projects."}</p>}
        {view === "directory" && <OtherContacts />}
      </section>}
      {view === "history" && <DotChart report={report} kind="trend" expanded monthRange={monthRange} draft={preview?.mode === "draft"} onLink={choose} onOpen={trigger => openOverlay("chart", "trend", trigger)} />}
      {(selectedArea || engagement) && <DotChart report={presentReport} kind="plan" draft={preview?.mode === "draft"} onLink={choose} onOpen={trigger => openOverlay("chart", "plan", trigger)} />}
      {view === "notes" && <article className="intel-detail"><h3>Delivery narrative</h3>
        <p>{portfolio?.narrative || "No executive narrative has been published for this period."}</p>
        {portfolio?.action && <><h3>Next decision</h3><p>{portfolio.action}</p></>}</article>}
      {activeProject && project && kind === "project" && <article className="intel-detail">
        <div className="intel-detail-links">
          {activeProject.delivery?.kind === "engagement" && <button type="button" className="exec-text-button" onClick={() => choose("group:" + project.id)}>Open engagement</button>}
          <button className="exec-text-button" onClick={() => choose("timeline:" + project.id)}>Project timeline</button>
          {allowExport && <CsvExport filename={csvPrefix + "_" + project.name} label="Export project CSV"
            load={exportProjectRows([project])} onDenied={onDenied} />}
          {report.sourceUpdatedAt && <span>Source updated {reportTimestamp(report.sourceUpdatedAt)}</span>}
        </div>
        <ProjectReportingCard project={project} period={period} placement={activeProject.placement} team={directoryFor(project.id)} onLink={choose}
          delivery={activeProject.delivery} department={activeProject.department}
          parent={activeProject.parent && { ...activeProject.parent, budget: hierarchy[activeProject.parent.id] }}
          history={report.historyByProject?.[project.id]} descendantTotals={delegatedTotals.get(project.id)} detail />
        {!!children.length && <section aria-label="Child projects"><h3>Child projects</h3><ul className="delivery-client-tree">{children.map(child => <li key={child.id}><button type="button" className="exec-text-button" onClick={() => choose("project:" + child.id)}>{child.name}</button></li>)}</ul></section>}
        <DotChart report={presentReport} kind="plan" draft={preview?.mode === "draft"} onLink={choose} onOpen={trigger => openOverlay("chart", "plan", trigger)} />
      </article>}
      {(view === "milestones" || (project && kind === "timeline")) && <article className="intel-detail">
        <div className="secure-section-heading">
          <h3>{kind === "timeline" ? "Delivery timeline" : "Published milestones"}</h3>
          {allowExport && (project ? [project] : visible).some(p => p.milestones?.length) &&
            <CsvExport filename={csvPrefix + "_" + title + "_Milestones"} label="Export milestones CSV"
              load={exportMilestoneRows(project ? [project] : visible)} onDenied={onDenied} />}
        </div>
        {(() => {
          const items = (project ? [project] : visible).flatMap(p => [
            ...(p.milestones ?? []).map(m => ({ ...m, project: p, body: "", type: m.completed ? "Complete" : m.status === "blocked" ? "Blocked" : "Milestone", route: "milestone:" + p.id + ":" + m.id })),
            ...(kind === "timeline" ? (p.updates ?? []).map(u => ({ ...u, project: p, type: "Update", route: "" })) : []),
          ]).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
          return items.length ? <ol className="intel-timeline">{items.map(item => <li key={item.project.id + item.id + item.type}>
            {item.date ? <time dateTime={item.date}>{reportDay(item.date)}</time> : <span>Unscheduled</span>}<div><span>{item.type} · {item.project.name}</span>
              {item.route ? <button className="exec-text-button" onClick={() => choose(item.route)}>{item.title}</button> : <strong>{item.title}</strong>}
              {item.body && <p>{item.body}</p>}</div>
          </li>)}</ol> : <p className="intel-empty">There are no published timeline entries for this view.</p>;
        })()}
      </article>}
      {milestone && project && <article className="intel-detail"><h3>{milestone.completed ? "Completed milestone" : "Project milestone"}</h3>
        <p>{milestone.date && reportDay(milestone.date) + " · "}{project.name}</p><button className="exec-text-button" onClick={() => choose("timeline:" + project.id)}>View the project timeline</button></article>}
      </div>
      {chart && !presenting && !unavailable && <DotChartDialog report={contextScoped ? presentReport : report} kind={chart} monthRange={monthRange} draft={preview?.mode === "draft"}
        onLink={choose} onClose={() => closePortalOverlay("chart")} />}
      {presenting && !unavailable && <Suspense fallback={<p role="status">Opening presentation…</p>}>
        <Presentation report={presentReport} scope={view} scopeTitle={title} onLink={choose} onClose={() => closePortalOverlay("present")}
          draft={preview?.mode === "draft"} linked={nativeClient} />
      </Suspense>}
    </WorkspaceNavigation>
  );
}
