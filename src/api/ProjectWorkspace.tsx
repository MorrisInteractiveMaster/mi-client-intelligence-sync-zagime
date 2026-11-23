import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ApiError, type SecuredApiClient } from "./client";
import type {
  Project,
  ProjectPage,
  ProjectDraftMetadata,
  StaffProjectDetail,
  StaffProjectSummary,
  ProjectWorkspace,
} from "../projects/model";
import { publicProject } from "../projects/model";
import { Activity, Building2, CalendarDays, ChartNoAxesCombined, Clock3, ClipboardList, Eye, FolderKanban, Layers3, LayoutGrid, Monitor, Plug, Presentation, ShieldCheck, UsersRound } from "lucide-react";
import { PortfolioAdmin } from "./PortfolioAdmin";
import { ProjectReportPreview } from "./ProjectReportingCard";
import { ContextHelp } from "./ContextHelp";
import "./executive.css";
import "./intelligence.css";
import "./delivery-operations.css";
import { DeliveryDirectory, DeliveryHealth, DeliveryMilestones, DeliveryPreview, projectCatalog } from "./DeliveryOperations";
import { TimeAllocation } from "./TimeAllocation";
import type { Portfolio } from "../projects/portfolio";
import type { TimeStatus } from "../projects/time";
import { capRollup, measureDelivery } from "../projects/delivery";
import { closePortalOverlay, periodHref, portalNavigate, usePlatformRoute, usePortalLocation } from "./portal-location";
import { clientBase, staffPath } from "./platform-routes";
import { PlatformLink } from "./PlatformHome";
import { PublicationReview } from "./PublicationReview";
import { EngagementOverview } from "./EngagementOverview";
import { CsvExport } from "./CsvExport";
import { allAuthorizedRows, authorizedPages, overviewCsv, staffProjectCsv } from "./report-csv";
import type { SourceSummary } from "./types";
import { precedingTimeMonth, reportingTimeMonth } from "../projects/time-history";
import { TimeConnectionPanel } from "./TimeConnectionPanel";
import { QuickBooksTimeMapping } from "./QuickBooksTimeMapping";
import { ProjectCreation } from "./ProjectCreation";
import { ProjectManagement } from "./ProjectManagement";
import { OperationsTrend } from "./OperationsTrend";
import { ReportingPeriod } from "./ReportingPeriod";
import { WorkspaceNavigation, type WorkspaceGroup } from "./WorkspaceNavigation";
import { navigatePlatform } from "./portal-location";
import {
  projectStatus,
  reportDay,
  reportHours,
  reportMonth,
  reportTimestamp,
  today,
} from "./dashboard-format";

const sections = {
  overview: "Overview",
  clients: "Clients",
  projects: "Projects",
  management: "Project Management",
  hours: "Time Allocation",
  mapping: "QuickBooks Time Mapping",
  directory: "Team Directory",
  milestones: "Milestones",
  health: "Budgets & Delivery Health",
  preview: "Client Preview",
  integrations: "Integrations",
  portfolio: "Portfolio management",
  activity: "Audit & Settings",
};
type Area = keyof typeof sections;
const sectionIcons = { overview: LayoutGrid, projects: FolderKanban, management: ClipboardList, portfolio: Layers3, hours: Clock3, mapping: Layers3, activity: Activity, integrations: Plug,
  clients: Building2, directory: UsersRound, milestones: CalendarDays, health: ChartNoAxesCombined, preview: Monitor };
const StaffPresentation = lazy(() => import("./ExecutivePresentation"));
export function ProjectStaffWorkspace({
  client,
  tenant,
  workspace,
  month,
  onDenied,
  onUnsavedChange,
}: {
  client: SecuredApiClient;
  tenant: string;
  workspace: ProjectWorkspace;
  month: string;
  onDenied: () => void;
  onUnsavedChange?: (dirty: boolean) => void;
}) {
  const [organizing, setOrganizing] = useState<StaffProjectSummary>();
  const [editorDirty, setEditorDirty] = useState(false);
  const [portfolioDirty, setPortfolioDirty] = useState(false);
  const [timeDirty, setTimeDirty] = useState(false);
  const [managementDirty, setManagementDirty] = useState(false);
  const [staffCollapsed, setStaffCollapsed] = useState(() => {
    try { return localStorage.getItem("morris-workspace-navigation") === "collapsed"; } catch { return false; }
  });
  function toggleStaffNavigation() {
    const next = !staffCollapsed;
    setStaffCollapsed(next);
    try { localStorage.setItem("morris-workspace-navigation", next ? "collapsed" : "expanded"); } catch { /* optional preference */ }
  }
  useEffect(() => { onUnsavedChange?.(editorDirty || portfolioDirty || timeDirty || managementDirty); return () => onUnsavedChange?.(false); }, [editorDirty, portfolioDirty, timeDirty, managementDirty, onUnsavedChange]);
  const [page, setPage] = useState<ProjectPage>({
    revision: workspace.revision,
    projects: [],
  });
  const [catalog, setCatalog] = useState<StaffProjectSummary[]>();
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [timeStatus, setTimeStatus] = useState<TimeStatus>();
  const [overviewTime, setOverviewTime] = useState<SourceSummary>();
  const [overviewTimeError, setOverviewTimeError] = useState(false);
  const [overviewTrend, setOverviewTrend] = useState<SourceSummary>();
  const [trendLoading, setTrendLoading] = useState(false);
  const [publicationReview, setPublicationReview] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [audits, setAudits] = useState<ProjectPage["audits"]>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [editing, setEditing] = useState<Project | "new">();
  const [editingDraft, setEditingDraft] = useState<ProjectDraftMetadata>();
  const location = usePortalLocation();
  const overviewPeriod = location.get("period") || "month";
  const rangeStart = location.get("overview-start") || "";
  const rangeEnd = location.get("overview-end") || "";
  const platform = usePlatformRoute();
  const nativeWorkspace = platform?.kind === "staff";
  const managed = location.get("managed");
  const staffRoute = location.get("staff");
  const area: Area = staffRoute === "time" ? "integrations" : staffRoute && Object.hasOwn(sections, staffRoute) ? staffRoute as Area : "projects";
  const editorRoute = location.get("editor");
  const tableView = location.get("staff-layout") === "table";
  const treeView = location.get("staff-layout") === "tree";
  const statusFilter = location.get("project-filter") || "all";
  const matchesStatus = (p: StaffProjectSummary) => statusFilter === "all" ||
    (statusFilter === "closed" ? p.status === "closed" || p.status === "cancelled" : p.status === statusFilter);
  const allProjects = catalog ?? page.projects ?? [];
  const parentFilter = location.get("project-parent");
  const projectParents = allProjects.filter(p => p.delivery?.kind === "engagement" && !p.delivery.parentId);
  const ancestry = new Map(allProjects.map(project => [project.id, project.delivery?.parentId]));
  function matchesParent(project: StaffProjectSummary) {
    if (!parentFilter) return true;
    const seen = new Set<string>();
    let id: string | undefined = project.id;
    while (id && !seen.has(id)) {
      if (id === parentFilter) return true;
      seen.add(id);
      id = ancestry.get(id);
    }
    return false;
  }
  const overviewTotals = area === "overview" && catalog ? capRollup(catalog) : undefined;
  const deliveryOverview = overviewTotals && catalog ? catalog.map(p => ({
    project: p, health: measureDelivery({ ...p, milestones: p.deliveryMilestones }, overviewTotals.get(p.id)!, today()),
  })) : [];
  const upcoming = deliveryOverview.filter(row => row.health.upcoming && row.health.upcoming >= today()).sort((a,b) =>
    a.health.upcoming!.localeCompare(b.health.upcoming!)).slice(0, 5);
  const trainings = catalog?.flatMap(p => (p.delivery?.training?.dates ?? []).filter(date => date >= today()).map(date => ({ p, date })))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5) ?? [];
  const preview = allProjects.find(p => p.id === location.get("staff-preview"));
  const previewButton = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (nativeWorkspace || (!editorDirty && !portfolioDirty)) return;
    const previous = window.location.href;
    const guard = () => {
      if (window.location.href !== previous && !window.confirm("Discard the unsaved changes?"))
        window.history.replaceState(window.history.state, "", previous);
    };
    window.addEventListener("popstate", guard, true);
    return () => window.removeEventListener("popstate", guard, true);
  }, [editorDirty, portfolioDirty, location.toString(), nativeWorkspace]);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [search, setSearch] = useState("");
  const visibleProjects = (parentFilter && !search && catalog ? catalog : page.projects ?? [])
    .filter(project => matchesStatus(project) && matchesParent(project));
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<StaffProjectSummary>();
  const lock = useRef(false);
  const scope = tenant + "|" + month + "|" + search;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const creation = useRef<string | undefined>(undefined);
  const hasUnsaved = editorDirty || portfolioDirty || timeDirty || managementDirty;
  const permit = () => !hasUnsaved || window.confirm("Discard the unsaved changes?");
  const changeArea = (next: Area) => {
    if (area === next && !(next === "management" && managed)) return;
    if (!permit()) return;
    if (editorDirty) { setEditing(undefined); setEditorDirty(false); }
    setNotice("");
    if (next !== "projects" && next !== "hours") {
      setSearch("");
      setDraftSearch("");
    }
    portalNavigate({ staff: next, editor: null, managed: null, subsection: next === "portfolio" && organizing ? "placements" : null,
      view: null, chart: null, present: null, q: null, status: null, previewMode: null, previewProject: null });
  };
  useEffect(() => {
    if (area !== "overview") return;
    const abort = new AbortController();
    setOverviewTime(undefined);
    setOverviewTimeError(false);
    const current = reportingTimeMonth();
    const anchor = overviewPeriod === "current" || overviewPeriod === "year" ? current :
      overviewPeriod === "previous" ? precedingTimeMonth(current) :
      overviewPeriod === "previous-year" ? String(Number(current.slice(0, 4)) - 1) + "-01" : month;
    const period = overviewPeriod === "all" || overviewPeriod === "range" ? overviewPeriod :
      ["year", "previous-year"].includes(overviewPeriod) ? "year" : "month";
    const query = new URLSearchParams({ month: anchor, limit: "1", period,
      ...(period === "range" ? { start: rangeStart, end: rangeEnd } : {}) });
    if (period === "range" && (!rangeStart || !rangeEnd || rangeStart > rangeEnd)) return;
    client.call<ProjectPage>(tenant, "sources?" + query, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setOverviewTime(result.sourceSummary); })
      .catch(() => { if (!abort.signal.aborted) setOverviewTimeError(true); });
    return () => abort.abort();
  }, [area, client, tenant, month, overviewPeriod, rangeStart, rangeEnd, epoch]);
  useEffect(() => {
    if (area !== "overview" || !nativeWorkspace) return;
    const abort = new AbortController();
    setOverviewTrend(undefined);
    setTrendLoading(true);
    client.call<ProjectPage>(tenant, "sources?month=" + month + "&limit=1&period=all&group=month", { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setOverviewTrend(result.sourceSummary); })
      .catch(() => { if (!abort.signal.aborted) setOverviewTrend(undefined); })
      .finally(() => { if (!abort.signal.aborted) setTrendLoading(false); });
    return () => abort.abort();
  }, [area, client, tenant, month, epoch, nativeWorkspace]);
  useEffect(() => {
    const original = document.title;
    document.title = (editorRoute && area === "projects" ? "Project editor" : staffRoute === "time" ? "QuickBooks Time status" : sections[area]) + " · Morris Interactive";
    return () => { document.title = original; };
  }, [area, editorRoute, staffRoute]);
  useEffect(() => {
    if (!preview && previewButton.current?.isConnected) previewButton.current.focus({ preventScroll: true });
  }, [preview]);
  useEffect(() => {
    areaHeading.current?.focus();
  }, [area]);
  useEffect(() => {
    setEditorDirty(false);
  }, [editing]);
  useEffect(() => {
    if (!editorDirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [editorDirty]);
  const query = (cursor?: string) =>
    `month=${month}&limit=25${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
  const projectQuery = (cursor?: string) =>
    query(cursor) + (search ? "&search=" + encodeURIComponent(search) : "");
  const failed = (e: unknown) => {
    if (e instanceof ApiError && [401, 403].includes(e.status) && e.code !== "publication_approval_required") onDenied();
    setError(
      e instanceof ApiError && e.status === 413
        ? "The project is too large to save. Shorten the description, notes, or updates."
        : e instanceof Error
          ? e.message
          : "The request could not be completed.",
    );
  };
  useEffect(() => {
    const abort = new AbortController();
    setListError(false);
    setPage({ revision: 0, projects: [] });
    setAudits(undefined);
    setEditing(undefined);
    setEditingDraft(undefined);
    setAuditCursor(undefined);
    client
      .call<ProjectPage>(tenant, "projects?" + projectQuery(), {
        signal: abort.signal,
      })
      .then((p) => {
        if (!abort.signal.aborted) {
          setPage(p);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) {
          setListError(true);
          failed(e);
        }
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch, search]);
  useEffect(() => {
    const abort = new AbortController();
    setCatalogError("");
    projectCatalog(client, tenant, month, abort.signal).then(value => {
      if (!abort.signal.aborted) setCatalog(value);
    }).catch(e => { if (!abort.signal.aborted) { setCatalog(undefined); setCatalogError(e.message); } });
    client.call<{ portfolio: Portfolio }>(tenant, "portfolio", { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) setPortfolio(value.portfolio);
    }).catch(e => { if (!abort.signal.aborted) setCatalogError(e.message); });
    client.call<TimeStatus>(tenant, "time?month=" + month, { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) setTimeStatus(value);
    }).catch(() => { if (!abort.signal.aborted) setTimeStatus(undefined); });
    return () => abort.abort();
  }, [client, tenant, month, epoch]);
  useEffect(() => {
    if (area !== "projects" || !editorRoute) { setEditing(undefined); return; }
    if (!page.revision) return;
    if (editorRoute === "new") {
      creation.current ??= `${Date.now()}-${crypto.randomUUID()}`;
      setEditingDraft(undefined); setEditing("new");
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(editorRoute)) { setError("This editor link is unavailable."); return; }
    const abort = new AbortController();
    client.call<StaffProjectDetail>(tenant, "projects/" + editorRoute, { signal: abort.signal })
      .then(detail => {
        if (abort.signal.aborted || latestScope.current !== scope) return;
        if (detail.revision !== page.revision) throw Error("Refresh the workspace before editing.");
        setEditingDraft(detail.draft);
        setEditing(detail.project);
      }).catch(error => { if (!abort.signal.aborted) failed(error); });
    return () => abort.abort();
  }, [client, tenant, scope, page.revision, area, editorRoute]);
  async function perform(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      failed(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const consistent = (p: ProjectPage) => {
    if (latestScope.current !== scope)
      throw Error("The reporting month changed. Refresh before continuing.");
    if (p.revision !== page.revision)
      throw Error("The workspace changed. Refresh before continuing.");
  };
  const refresh = () => {
    setEpoch((x) => x + 1);
    setNotice("Saved to the protected workspace.");
  };
  const openDeliveryProject = (id: string) => portalNavigate({ staff: "projects", editor: id });
  function previewChanges(projectId: string) {
    portalNavigate({ staff: "preview", editor: null, previewProject: projectId, previewMode: "draft",
      view: "project:" + projectId, chart: null, present: null, q: null, status: null });
  }
  function changePublication(project: StaffProjectSummary) {
    if (!window.confirm(project.published ? "Remove this project from client reporting?" : "Publish approved project information to authorized clients?")) return;
    void perform(async () => {
      await client.call(tenant, "projects/" + project.id + "/publication", {
        method: "PATCH",
        body: { expectedRevision: page.revision, published: !project.published },
      });
      refresh();
    });
  }
  function resolveDraft(projectId: string, action: "publish" | "discard") {
    const confirmation = action === "publish"
      ? "Publish the saved changes to authorized clients?"
      : "Discard the saved draft? Clients will continue seeing the last approved version.";
    if (!window.confirm(confirmation)) return;
    void perform(async () => {
      await client.call(tenant, "projects/" + projectId + "/draft", {
        method: "PATCH", body: { expectedRevision: page.revision, action },
      });
      setEpoch(value => value + 1);
      setNotice(action === "publish" ? "Project changes published." : "Draft discarded. The approved version is unchanged.");
    });
  }
  async function moreProjects() {
    const p = await client.call<ProjectPage>(
      tenant,
      "projects?" + projectQuery(page.nextCursor),
    );
    consistent(p);
    setPage((old) => ({ ...p, projects: [...old.projects!, ...p.projects!] }));
  }
  async function loadAudits(cursor?: string) {
    const p = await client.call<ProjectPage>(tenant, "audits?" + query(cursor));
    consistent(p);
    setAudits((old) => (cursor ? [...old!, ...p.audits!] : p.audits));
    setAuditCursor(p.nextCursor);
  }
  const nativeArea = (id: Area) => ({
    id, label: sections[id], icon: sectionIcons[id], active: area === id,
    select: () => changeArea(id),
  });
  const crossLink = (id: string, label: string, icon: typeof LayoutGrid, href: string) => ({
    id, label, icon, external: true, select: () => { if (permit()) navigatePlatform(href); },
  });
  const groups: WorkspaceGroup[] = [
    { label: "Workspace", destinations: [
      nativeArea("overview"), nativeArea("clients"),
      { id: "create-project", label: "Create Project", icon: FolderKanban, active: editorRoute === "new",
        select: () => { if (editorRoute !== "new" && permit()) openDeliveryProject("new"); } },
      nativeArea("management"), nativeArea("directory"),
    ] },
    { label: "Time & Reporting", destinations: (["hours", "mapping"] as const).map(nativeArea) },
    { label: "Delivery", destinations: (["milestones", "health", "portfolio", "activity"] as const).map(nativeArea) },
    { label: "Client experience", destinations: [
      crossLink("published-view", "Published client report", Building2, periodHref(clientBase, month)),
      crossLink("presentation", "Presentation", Presentation, periodHref(clientBase + "/present", month)),
      crossLink("draft-preview", "Draft Preview", Eye, periodHref(clientBase, month, { previewMode: "draft" })),
    ] },
    ...(workspace.platformAdmin ? [{ label: "Administration", destinations: [
      crossLink("control", "Control Panel", ShieldCheck, periodHref("/control", month)),
      crossLink("employee", "Employee Mapping", UsersRound, periodHref("/control/employee-mapping", month)),
      crossLink("time-health", "Integration Health", Plug, periodHref("/control/time", month)),
    ] }] : []),
  ];
  const pageTitle = staffRoute === "time" ? "QuickBooks Time status" : area === "projects" && editorRoute === "new" ? "Create Project" : area === "projects" && editing ? "Project setup" : sections[area];
  const content = <>
    {nativeWorkspace && <header className="mi-page-heading"><p className="mi-kicker">{workspace.tenant.name} · {reportMonth(month)}</p>
      <h2>{pageTitle}</h2></header>}
    {nativeWorkspace && area !== "hours" && <ReportingPeriod month={month} availableMonths={overviewTrend?.hours.byPeriod.map(row => row.label)}
      latestMonth={overviewTrend?.hours.byPeriod.at(-1)?.label}
      onMonth={value => { if (permit()) portalNavigate({ month: value, period: null }); }}
      onRange={area === "overview" ? range => { if (!permit()) return;
        const through = range.through;
        const end = through && new Date(Date.UTC(Number(through.slice(0, 4)), Number(through.slice(5)), 0)).toISOString().slice(0, 10);
        portalNavigate({ period: range.preset === "last-year" ? "previous-year" : range.preset === "custom" ? "range" : range.preset,
          "overview-start": range.preset === "custom" && range.from ? range.from + "-01" : null,
          "overview-end": range.preset === "custom" ? end ?? null : null });
      } : undefined} />}

      {area !== "overview" && <nav className="exec-breadcrumb" aria-label="Breadcrumb">
        <button className="exec-text-button" type="button" onClick={() => changeArea("overview")}>Morris Overview</button>
        <span aria-current="page">{sections[area]}</span>
      </nav>}
      {area === "overview" && <section aria-label="Morris operating overview">
        <div className="delivery-section-heading"><h3>Delivery performance</h3>
          {!nativeWorkspace && <label>Time period<select value={overviewPeriod} onChange={event => portalNavigate({ period: event.target.value })}>
            <option value="month">{reportMonth(month)}</option><option value="current">This Month</option><option value="previous">Previous Month</option>
            <option value="year">This Year</option><option value="previous-year">Last Year</option>
            <option value="all">All History</option><option value="range">Custom Date Range</option>
          </select></label>}
          {!nativeWorkspace && overviewPeriod === "range" && <form className="secure-actions" onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            portalNavigate({ "overview-start": String(data.get("start")), "overview-end": String(data.get("end")) });
          }}><label>From<input type="date" name="start" defaultValue={rangeStart} required /></label>
            <label>Through<input type="date" name="end" defaultValue={rangeEnd} required /></label>
            <button type="submit">Apply dates</button></form>}</div>
        <div className="intel-pulse" aria-label="Project status">
          {(["active", "planned", "completed"] as const).map(status => <button className="intel-pulse-item" key={status}
            type="button" onClick={() => changeArea("projects")}><span>{projectStatus[status]}</span><b>{catalog?.filter(p => p.status === status).length ?? "—"}</b></button>)}
        </div>
        <dl className={"secure-metrics" + (nativeWorkspace ? " mi-operation-metrics" : "")}>
          {!nativeWorkspace && <div><dt>Client workspace</dt><dd>{workspace.tenant.name}</dd></div>}
          <div><dt>Registered work orders</dt><dd>{timeStatus?.mappings.length ?? "Unavailable"}</dd></div>
          <div data-featured="true"><dt>Hours recorded</dt><dd>{overviewTime?.hours ? reportHours(overviewTime.hours.recordedSeconds) + " h" : overviewTimeError ? "Unavailable" : "Loading"}</dd></div>
          <div><dt>Work-order attributed</dt><dd>{overviewTime?.hours ? reportHours(overviewTime.hours.attributedSeconds ?? 0) + " h" : overviewTimeError ? "Unavailable" : "Loading"}</dd></div>
          <div><dt>Remaining at parent level</dt><dd>{overviewTime?.hours ? reportHours(overviewTime.hours.remainingAtParentSeconds ?? 0) + " h" : overviewTimeError ? "Unavailable" : "Loading"}</dd></div>
          <div><dt>Classified hours</dt><dd>{overviewTime?.hours ? reportHours(overviewTime.hours.classifiedSeconds ?? 0) + " h" : overviewTimeError ? "Unavailable" : "Loading"}</dd></div>
          {overviewTime?.hours && overviewTime.hours.recordedSeconds > (overviewTime.hours.attributedSeconds ?? 0) &&
            <div><dt>Hours without a verified work-order association</dt><dd>{reportHours(overviewTime.hours.recordedSeconds - (overviewTime.hours.attributedSeconds ?? 0))} h</dd></div>}
          <div><dt>Work orders with activity</dt><dd>{overviewTime?.hours.byWorkOrder.filter(order => order.id !== null && order.recordedSeconds > 0).length ?? "—"}</dd></div>
          <div><dt>Allocations awaiting review</dt><dd>{overviewTime?.counts.review ?? "—"}</dd></div>
          <div><dt>Last successful Time sync</dt><dd>{timeStatus?.lastDailySuccess ? reportTimestamp(timeStatus.lastDailySuccess) : "Unavailable"}</dd></div>
          <div><dt>Blocked milestones</dt><dd>{catalog?.flatMap(p => p.deliveryMilestones ?? []).filter(m => m.status === "blocked").length ?? "—"}</dd></div>
          <div><dt>Over cap</dt><dd>{overviewTotals ? deliveryOverview.filter(row => (row.health.monthlyRemaining ?? 0) < 0 || (row.health.lifetimeRemaining ?? 0) < 0).length : "—"}</dd></div>
        </dl>
        <div className="secure-actions">
          <button type="button" onClick={() => openDeliveryProject("new")}>Create Project</button>
          {overviewTime && <CsvExport filename={["Morris", workspace.tenant.name, "Overview", overviewTime.period.start ?? "All_History", overviewTime.period.end].filter(Boolean).join("_")}
            label="Export overview CSV" data={overviewCsv(overviewTime)} />}
          <button type="button" className="secure-secondary" onClick={() => changeArea("hours")}>Allocate Hours</button>
          <button type="button" className="secure-secondary" onClick={() => changeArea("directory")}>Assign Team</button>
          {nativeWorkspace ? <>
            <PlatformLink className="platform-primary-action" href={periodHref(clientBase, month)}>View {workspace.tenant.name} Dashboard</PlatformLink>
            <PlatformLink href={periodHref(clientBase, month, { previewMode: "draft" })}>Preview Draft Changes</PlatformLink>
            <PlatformLink href={periodHref(staffPath("hours"), month, { period: "all" })}>Browse All History</PlatformLink>
          </> : <button type="button" className="secure-secondary" onClick={() => changeArea("preview")}>Preview as {workspace.tenant.name}</button>}
        </div>
        {nativeWorkspace && <OperationsTrend summary={overviewTrend} loading={trendLoading}
          onMonth={value => { if (permit()) navigatePlatform(periodHref(staffPath("hours"), value)); }} />}
        {overviewTime?.hours && <div className="intel-editorial platform-overview-figures">
          <section><h3>Recorded hours by consultant</h3><ul>{overviewTime.hours.byConsultant.slice(0, 7).map(item => <li key={item.id ?? "unknown"}>
            {item.id && nativeWorkspace ? <PlatformLink href={periodHref(staffPath("hours"), month, { period: overviewPeriod, consultant: item.id })}>{item.label}</PlatformLink> : item.label}
            <span>{reportHours(item.recordedSeconds)} h</span>
          </li>)}</ul>{!overviewTime.hours.byConsultant.length && <p>No consultant hours in this period.</p>}</section>
          <section><h3>Hours by work order</h3><ul>{overviewTime.hours.byWorkOrder.slice(0, 7).map(item => <li key={item.id ?? "unknown"}>
            {item.id && nativeWorkspace ? <PlatformLink href={periodHref(staffPath("hours"), month, { period: overviewPeriod, workOrder: item.id })}>{item.label}</PlatformLink> : item.label}
            <span>{reportHours(item.recordedSeconds)} h recorded · {reportHours(item.allocatedSeconds)} h allocated</span>
          </li>)}</ul>{!overviewTime.hours.byWorkOrder.length && <p>No work-order hours in this period.</p>}</section>
        </div>}
        <div className="intel-editorial">
          <section><h3>Upcoming deadlines</h3>{upcoming.length ? <ul>{upcoming.map(({ project, health }) => <li key={project.id}><button type="button" className="exec-text-button" onClick={() => openDeliveryProject(project.id)}>{project.name}</button> · {reportDay(health.upcoming!)}</li>)}</ul> : <p className="secure-muted">No deadlines are recorded for upcoming work.</p>}</section>
          <section><h3>Upcoming training</h3>{trainings.length ? <ul>{trainings.map(({ p, date }) => <li key={p.id + date}><button type="button" className="exec-text-button" onClick={() => openDeliveryProject(p.id)}>{p.name}</button> · {reportDay(date)}</li>)}</ul> : <p className="secure-muted">No upcoming sessions are recorded.</p>}</section>
        </div>
        {!nativeWorkspace && <><h3>Workspace</h3>
        <div className="intel-staff-overview">{Object.entries(sections).filter(([key]) => key !== "overview" && (!nativeWorkspace || key !== "integrations")).map(([key,label]) =>
          <button type="button" key={key} onClick={() => changeArea(key as Area)}>{label}</button>)}</div></>}
      </section>}
      {catalogError && <p role="alert" className="secure-message secure-error">{catalogError} <button type="button" className="secure-secondary" onClick={() => setEpoch(value => value + 1)}>Reload workspace lists</button></p>}
      {area === "clients" && <section aria-label="Clients">
        <h3>{workspace.tenant.name}</h3><p>This workspace shows the client assigned to your Morris account.</p>
        <div className="secure-actions"><button type="button" onClick={() => changeArea("projects")}>Open client projects</button>
          <button type="button" className="secure-secondary" onClick={() => changeArea("preview")}>Preview as {workspace.tenant.name}</button></div>
      </section>}
      {area === "management" && nativeWorkspace && <p>
        <PlatformLink href={periodHref(staffPath("projects"), month)} beforeNavigate={permit}>Browse all projects</PlatformLink>
      </p>}
      {area === "management" && <ProjectManagement client={client} tenant={tenant} selected={managed}
        projects={allProjects} areas={portfolio?.areas} canPublish={workspace.canPublish === true} onDirty={setManagementDirty} onDenied={onDenied}
        onSelect={id => { if (permit()) portalNavigate({ staff: "management", managed: id ?? null }); }}
        onSetup={id => { if (permit()) portalNavigate({ staff: "projects", managed: null, editor: id }); }}
        onSaved={() => setEpoch(value => value + 1)} />}
      {area === "directory" && <DeliveryDirectory client={client} tenant={tenant} portfolio={portfolio} revision={page.revision} onSaved={() => setEpoch(value => value + 1)} onDenied={onDenied} />}
      {area === "health" && <DeliveryHealth month={month} projects={allProjects} portfolio={portfolio} healthOnly onOpen={openDeliveryProject} />}
      {area === "milestones" && <DeliveryMilestones month={month} client={client} tenant={tenant} projects={allProjects} onSaved={refresh} onOpen={openDeliveryProject} />}
      {area === "preview" && <DeliveryPreview client={client} tenant={tenant} month={month} />}
      {error && (
        <p className="secure-message secure-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="secure-message" role="status">
          {notice}
        </p>
      )}
      {busy && (
        <p className="secure-muted" role="status">
          Working…
        </p>
      )}
      {area === "projects" && editorRoute && (editing ? <>
        {!portfolio && catalogError && <div className="secure-actions">
          <p role="alert">Project setup could not load the departments and team directory.</p>
          <button type="button" className="secure-secondary" onClick={() => setEpoch(value => value + 1)}>Retry project setup</button>
        </div>}
        <ProjectCreation key={editing === "new" ? "new" : editing.id + ":" + (editingDraft?.revision ?? 0)}
          project={editing === "new" ? undefined : editing} projects={allProjects} portfolio={portfolio}
          busy={busy || !page.revision || !portfolio} canPublish={workspace.canPublish === true}
          onDirty={() => setEditorDirty(true)} onCancel={() => {
            if (editorDirty && !window.confirm("Discard the unsaved project changes?")) return;
            setEditorDirty(false);
            creation.current = undefined;
            portalNavigate({ ...(nativeWorkspace && { staff: "management", managed: editing === "new" ? null : editing.id }), editor: null });
          }} onSave={(project, publish) => void perform(async () => {
            if (editing === "new") {
              const result = await client.call<{ id: string }>(tenant, "projects", {
                method: "POST", key: creation.current, body: { project, publish },
              });
              creation.current = undefined;
              setEditorDirty(false);
              portalNavigate(nativeWorkspace ? { staff: "management", managed: result.id, editor: null } : { editor: null }, true);
              setEpoch(value => value + 1);
              setNotice(publish ? "Project created and published." : "Project saved as a private draft.");
              return;
            }
            const result = await client.call<{ draft?: ProjectDraftMetadata; changed: boolean }>(tenant, "projects/" + editing.id, {
              method: "PATCH", body: { expectedRevision: page.revision, patch: project },
            });
            setEditorDirty(false);
            setEpoch(value => value + 1);
            if (editing.published) {
              setNotice(result.draft ? "Draft saved. Clients still see the last approved version." : "No project changes to save.");
            } else {
              portalNavigate(nativeWorkspace ? { staff: "management", managed: editing.id, editor: null } : { editor: null }, true);
              setNotice(result.changed ? "Project changes saved." : "No project changes to save.");
            }
          })} />
        {editing !== "new" && <div className="secure-actions creation-related" aria-label="Project actions">
          <button type="button" className="secure-secondary" disabled={busy}
            onClick={() => { if (permit()) portalNavigate({ staff: "management", managed: editing.id, editor: null }); }}>Manage delivery progress</button>
          {editing.published && editingDraft && <>
            <button type="button" className="secure-secondary" disabled={busy || editorDirty}
              onClick={() => previewChanges(editing.id)}>Preview Changes</button>
            {workspace.canPublish && <button type="button" disabled={busy || editorDirty}
              onClick={() => resolveDraft(editing.id, "publish")}>Publish Changes</button>}
            <button type="button" className="secure-secondary" disabled={busy || editorDirty}
              onClick={() => resolveDraft(editing.id, "discard")}>Discard Draft</button>
          </>}
        </div>}
      </> : !error && <p role="status">Loading project editor&hellip;</p>)}
      <section hidden={area !== "projects" || Boolean(editorRoute)} aria-labelledby="staff-projects">
        {nativeWorkspace && <div className="project-list-controls">
          <label>Project status<select value={statusFilter} onChange={event => portalNavigate({ "project-filter": event.target.value === "all" ? null : event.target.value })}>
            <option value="all">All projects</option><option value="active">Active projects</option><option value="completed">Completed</option>
            <option value="paused">On hold</option><option value="closed">Closed or cancelled</option></select></label>
          <label>Parent Project<select value={parentFilter ?? ""} disabled={!catalog} onChange={event => portalNavigate({ "project-parent": event.target.value || null })}>
            <option value="">All parent projects</option>
            {projectParents.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select></label>
          <button type="button" className="secure-secondary" disabled={busy || !catalog || workspace.canPublish === false} onClick={() => setPublicationReview(true)}>Review &amp; Publish</button>
          <button type="button" className="secure-secondary" aria-pressed={location.has("engagements")}
            onClick={() => portalNavigate({ engagements: location.has("engagements") ? null : "1", engagement: null, "service-area": null })}>By Parent Project</button>
        </div>}
        {area === "projects" && location.has("engagements") && <EngagementOverview month={month} projects={allProjects} areas={portfolio?.areas}
          onOpen={id => portalNavigate({ staff: "projects", editor: id, engagements: null, engagement: null, "service-area": null })} />}
        {area === "projects" && publicationReview && <PublicationReview projects={allProjects} client={client} tenant={tenant}
          revision={page.revision} onClose={() => setPublicationReview(false)} onSaved={refresh} />}
        <div className="secure-section-heading">
          <div>
            <h2
              tabIndex={-1}
              ref={area === "projects" ? areaHeading : undefined}
              id="staff-projects"
            >
              Projects
            </h2>
            <p>Manage progress, plans and what the client can see.</p>
          </div>
          <div className="secure-actions">
            <button
              disabled={busy || page.revision === 0}
              onClick={() => {
                if (!editorDirty || window.confirm("Discard the unsaved project changes?"))
                  portalNavigate({ staff: "projects", editor: "new" });
              }}
            >
              Create project
            </button>
            <button
              className="secure-secondary"
              disabled={busy}
              onClick={() => {
                setError("");
                setNotice("");
                setEpoch((x) => x + 1);
              }}
            >
              Refresh workspace
            </button>
          </div>
        </div>
        <form
          className="secure-form secure-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(draftSearch.trim());
            setSelectedProject(undefined);
          }}
        >
          <label>
            Search projects
            <input
              name="projectSearch"
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              type="search"
              maxLength={120}
              placeholder="Name, work-order reference or project ID"
            />
          </label>
          <button type="submit" disabled={busy}>
            Search
          </button>
          {search && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraftSearch("");
                setSearch("");
                setSelectedProject(undefined);
              }}
            >
              Clear search
            </button>
          )}
        </form>
        {!location.has("engagements") && <CsvExport filename={["Morris", workspace.tenant.name, "Projects", month, statusFilter === "all" ? "" : statusFilter].filter(Boolean).join("_")}
          scope={JSON.stringify([search, parentFilter, statusFilter, page.revision])} label="Export projects CSV" disabled={busy || !page.revision} onDenied={onDenied}
          load={async signal => {
            const query = new URLSearchParams({ month, ...(search ? { search } : {}) });
            const rows = await allAuthorizedRows("projects", query, signal, authorizedPages(client, tenant));
            return staffProjectCsv(month, rows.filter(project => matchesStatus(project) && matchesParent(project)));
          }} />}
        {page.revision === 0 && !listError && (
          <p className="secure-empty" role="status">
            Loading projects…
          </p>
        )}
        {page.revision > 0 && !visibleProjects.length && (
          <p className="secure-empty">
            {search
              ? page.nextCursor
                ? "No matches on this page. Continue searching to check more projects."
                : "No matching projects."
              : parentFilter || statusFilter !== "all" ? "No projects match these filters."
                : "No projects yet. Create one without a work order."}
          </p>
        )}
        <div className="intel-workspace-toolbar" aria-label="Project layout">
          <button type="button" aria-pressed={!tableView && !treeView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": null })}>Project list</button>
          <button type="button" aria-pressed={treeView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": "tree" })}>Hierarchy</button>
          <button type="button" aria-pressed={tableView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": "table" })}>Table</button>
        </div>
        {tableView && <div className="intel-table-scroll" tabIndex={0} role="region" aria-label="Projects table">
          <table><thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Visibility</th><th scope="col">Reported effort</th><th scope="col">Work order</th><th scope="col">Publication</th></tr></thead>
          <tbody>{visibleProjects.map(p => <tr key={p.id}><th scope="row"><button type="button" className="exec-text-button" disabled={busy}
            onClick={() => { if (!editorDirty || window.confirm("Discard the unsaved project changes?")) portalNavigate({ staff: "projects", editor: p.id }); }}>{p.name}</button></th>
            <td>{projectStatus[p.status]}</td><td>{p.published ? (p.draft ? "Published · Draft changes" : "Published") : "Unpublished"}</td><td>{reportHours(p.seconds)} h</td><td>{p.workOrderReference || "—"}</td>
            <td><div className="secure-actions">
              {p.published && nativeWorkspace && <PlatformLink href={periodHref(clientBase + "/projects/" + p.id, month)}>View Published</PlatformLink>}
              {p.draft ? <button type="button" className="secure-secondary" disabled={busy || editorDirty}
                onClick={() => openDeliveryProject(p.id)}>Review changes</button> :
                <button type="button" className="secure-secondary" disabled={busy} onClick={() => changePublication(p)}
                  aria-label={`${p.published ? "Unpublish" : "Publish"} ${p.name}`}>{p.published ? "Unpublish" : "Publish"}</button>}
            </div></td>
          </tr>)}</tbody></table>
        </div>}
        {treeView && <DeliveryHealth month={month} projects={allProjects} portfolio={portfolio} onOpen={openDeliveryProject} />}
        <div hidden={tableView || treeView} className="secure-project-grid delivery-project-index">
          {visibleProjects.map((p) => (
            <article className="secure-card" key={p.id}>
              <div className="secure-card-flags">
                <p className="secure-badge" data-status={p.status}>
                  {projectStatus[p.status]}
                </p>
                <p
                  className="secure-badge"
                  data-status={p.published ? "published" : "private"}
                >
                  {p.published ? (p.draft ? "Published · Draft changes" : "Published") : "Unpublished"}
                </p>
              </div>
              <h3>{p.name}</h3>
              {p.workOrderReference && (
                <p className="secure-project-reference">
                  {p.workOrderReference}
                </p>
              )}
              {p.delivery?.blocker?.active && <p className="secure-message secure-error">Blocked · {p.delivery.blocker.message || "Review project details"}</p>}
              <dl className="secure-project-hours">
                <div>
                  <dt>{p.workOrderEffort ? "Reported effort" : "Assigned"} · {month}</dt>
                  <dd>{reportHours(p.seconds)} h</dd>
                </div>
                <div>
                  <dt>Total reported effort</dt>
                  <dd>{reportHours(p.lifetimeSeconds)} h</dd>
                </div>
                {p.workOrderEffort && <div><dt>Work-order recorded</dt><dd>{reportHours(p.workOrderEffort.recordedSeconds)} h</dd></div>}
                <div>
                  <dt>
                    {p.plan.basis === "monthly" ? "Monthly" : "Lifetime"} target
                  </dt>
                  <dd>{reportHours(p.plan.targetSeconds)} h</dd>
                </div>
              </dl>
              <div className="secure-actions">
                <a
                  href="#project-time-hours"
                  aria-label={`View hours for ${p.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setSelectedProject(p);
                    changeArea("hours");
                  }}
                >
                  View hours
                </a>
                <button
                  disabled={busy}
                  aria-label={`Edit ${p.name}`}
                  onClick={() => { if (!editorDirty || window.confirm("Discard the unsaved project changes?")) portalNavigate({ staff: "projects", editor: p.id }); }}
                >
                  Edit
                </button>
                <button type="button" className="secure-secondary" disabled={busy} aria-label={"Organize " + p.name}
                  onClick={() => { setOrganizing(p); changeArea("portfolio"); }}>Organize</button>
                <button type="button" className="secure-secondary" disabled={busy} onClick={event => {
                  previewButton.current = event.currentTarget;
                  portalNavigate({ "staff-preview": p.id }, false, "staff-preview");
                }}>Presentation preview</button>
                <button
                  className="secure-secondary"
                  disabled={busy || Boolean(p.draft)}
                  aria-label={`${p.published ? "Unpublish" : "Publish"} ${p.name}`}
                  onClick={() => changePublication(p)}
                >
                  {p.published ? "Unpublish" : "Publish"}
                </button>
                {p.published && nativeWorkspace && <PlatformLink href={periodHref(clientBase + "/projects/" + p.id, month)}>View Published</PlatformLink>}
              </div>
              <ProjectReportPreview project={p} period={reportMonth(month)} />
            </article>
          ))}
        </div>
        {page.nextCursor && (!parentFilter || search || !catalog) && (
          <button disabled={busy} onClick={() => void perform(moreProjects)}>
            {search ? "Continue searching" : "More projects"}
          </button>
        )}
      </section>
      {area === "portfolio" && <PortfolioAdmin key={organizing?.id ?? "portfolio"} client={client} tenant={tenant} month={month}
        initialProject={organizing} onDenied={onDenied} onSaved={() => setEpoch(x => x + 1)} onDirty={setPortfolioDirty} />}
      <section hidden={area !== "hours"} className="time-allocation-panel" aria-labelledby="project-time-hours">
        <h2
          id="project-time-hours"
          ref={area === "hours" ? areaHeading : undefined}
          tabIndex={-1}
        >
          Project hours{selectedProject ? " · " + selectedProject.name : ""} <ContextHelp label="Recorded versus allocated hours">Recorded hours come from the time source. Reporting allocations assign all or part of a record to delivery projects without editing the original time.</ContextHelp>
        </h2>
        {selectedProject && (
          <button
            onClick={() => {
              setSelectedProject(undefined);
              setSearch("");
              setDraftSearch("");
            }}
          >
            Show hours for all projects
          </button>
        )}
        {selectedProject &&
          page.projects
            ?.filter((project) => project.id === selectedProject.id)
            .map((project) => (
              <dl
                className="secure-metrics"
                aria-label="Morris allocated reporting hours"
                key={project.id}
              >
                <div>
                  <dt>Allocated to project · {reportMonth(month)}</dt>
                  <dd>{reportHours(project.seconds)} h</dd>
                </div>
                <div>
                  <dt>Allocated to project · lifetime</dt>
                  <dd>{reportHours(project.lifetimeSeconds)} h</dd>
                </div>
              </dl>
            ))}
        {area === "hours" && <TimeAllocation client={client} tenant={tenant} month={month} projects={allProjects}
          portfolio={portfolio} onDenied={onDenied} onSaved={() => setEpoch(value => value + 1)}
          initialConsultant={location.get("consultant") ?? undefined} initialHistory={location.get("period") === "all"}
          initialWorkOrder={location.get("workOrder") ?? undefined} onUnsavedChange={setTimeDirty}
          sourceLink={nativeWorkspace ? { id: location.get("source") ?? undefined,
            href: id => periodHref(staffPath("hours", id), month), backHref: periodHref(staffPath("hours"), month) } : undefined} />}
      </section>
      {area === "mapping" && <QuickBooksTimeMapping client={client} tenant={tenant} month={month}
        projects={allProjects} portfolio={portfolio} onDenied={onDenied} onSaved={refresh} />}
      <section hidden={area !== "activity"} aria-labelledby="staff-audits">
        <h2
          id="staff-audits"
          ref={area === "activity" ? areaHeading : undefined}
          tabIndex={-1}
        >
          Audit history
        </h2>
        <p>
          Project, publication, and allocation changes across the workspace.
        </p>
        {!audits && (
          <button
            disabled={busy || page.revision === 0}
            onClick={() => void perform(() => loadAudits())}
          >
            Load audit history
          </button>
        )}
        {audits?.length === 0 && (
          <p className="secure-empty">No activity has been recorded.</p>
        )}
        {audits && (
          <ol className="secure-timeline secure-audits">
            {audits.map((a) => (
              <li key={a.id}>
                <b>{a.action}</b>
                <time dateTime={a.at}>{reportTimestamp(a.at)}</time>
                <p>
                  Record {a.entityId} · Revision {a.revision}
                </p>
                <p>Actor {a.actor}</p>
              </li>
            ))}
          </ol>
        )}
        {auditCursor && (
          <button
            disabled={busy}
            onClick={() => void perform(() => loadAudits(auditCursor))}
          >
            More audit history
          </button>
        )}
      </section>
      {area === "integrations" && (
        <section aria-labelledby="staff-integrations">
          <h2 id="staff-integrations" ref={areaHeading} tabIndex={-1}>
            Integrations
          </h2>
          <article className="secure-card">
            <h3>QuickBooks Online Accounting</h3>
            <p>Disconnected</p>
          </article>
          <article className="secure-card">
            <h3>QuickBooks Time</h3>
            {staffRoute !== "time" && <button className="exec-text-button" type="button" onClick={() => portalNavigate({ staff: "time" })}>Open QuickBooks Time status</button>}
            {page.nextCursor && (
              <button
                disabled={busy}
                onClick={() => void perform(moreProjects)}
              >
                More project choices
              </button>
            )}
            <TimeConnectionPanel
              client={client}
              tenant={tenant}
              month={month}
              refreshVersion={epoch}
            projects={allProjects}
              busy={busy}
              run={perform}
              onChanged={() => setEpoch((value) => value + 1)}
              onDenied={onDenied}
            />
          </article>
        </section>
      )}
      {preview && <Suspense fallback={<p role="status">Opening presentation preview…</p>}>
        <StaffPresentation scope="project-preview" scopeTitle={preview.name} onClose={() => closePortalOverlay("staff-preview")}
          report={{ month, tenant: workspace.tenant, projects: [publicProject(preview, preview.seconds)], totalSeconds: preview.seconds }} />
      </Suspense>}
      {location.has("staff-preview") && page.revision > 0 && !preview && <p role="status">This presentation preview is unavailable on the current project page.</p>}
    </>;
  return <section className="secure-staff intel-staff" aria-label="Project administration">
    {nativeWorkspace ? <WorkspaceNavigation groups={groups} collapsed={staffCollapsed} onCollapse={toggleStaffNavigation} busy={busy}
      searchResults={allProjects.map(project => ({ id: "project-" + project.id, label: project.name, context: "Project management",
        select: () => { if (permit()) portalNavigate({ staff: "management", managed: project.id, editor: null }); } }))}>
      {content}
    </WorkspaceNavigation> : <>
      <div className="secure-hero secure-staff-hero"><div><p className="secure-eyebrow">Morris administration · {reportMonth(month)}</p>
        <h2>{pageTitle}</h2><p>{workspace.tenant.name}</p></div></div>
      <div className="exec-frame exec-staff-frame">
      <aside className="exec-sidebar">
      <nav aria-label="Morris workspace sections">
        {Object.entries(sections).filter(([key]) => !nativeWorkspace || key !== "integrations").map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={area === key}
            disabled={busy}
            onClick={() => {
              setSelectedProject(undefined);
              setOrganizing(undefined);
              if (key === "hours") {
                setSearch("");
                setDraftSearch("");
              }
              changeArea(key as Area);
            }}
          >
            {(() => { const Icon = sectionIcons[key as Area]; return <Icon size={18} aria-hidden="true" />; })()}
            <span>{label}</span>
          </button>
        ))}
      </nav>
      </aside>
      <div className="exec-content">{content}</div></div>
    </>}
  </section>;
}
