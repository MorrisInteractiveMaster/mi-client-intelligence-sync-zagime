import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ApiError, type SecuredApiClient } from "./client";
import type {
  Project,
  ProjectPage,
  ProjectDraftMetadata,
  StaffProjectDetail,
  ProjectMilestone,
  ProjectUpdate,
  StaffProjectSummary,
  ProjectWorkspace,
} from "../projects/model";
import { publicProject } from "../projects/model";
import { Activity, Building2, CalendarDays, ChartNoAxesCombined, Clock3, FolderKanban, Layers3, LayoutGrid, Monitor, Plug, UsersRound } from "lucide-react";
import { PortfolioAdmin } from "./PortfolioAdmin";
import { ProjectReportPreview } from "./ProjectReportingCard";
import { ContextHelp } from "./ContextHelp";
import "./executive.css";
import "./intelligence.css";
import "./delivery-operations.css";
import { DeliveryDirectory, DeliveryFields, DeliveryHealth, DeliveryMilestones, DeliveryPreview, projectCatalog, readDeliveryForm } from "./DeliveryOperations";
import { TimeAllocation } from "./TimeAllocation";
import type { Portfolio } from "../projects/portfolio";
import type { TimeStatus } from "../projects/time";
import { capRollup, measureDelivery } from "../projects/delivery";
import { closePortalOverlay, periodHref, portalNavigate, usePlatformRoute, usePortalLocation } from "./portal-location";
import { clientBase, staffPath } from "./platform-routes";
import { PlatformLink } from "./PlatformHome";
import { PublicationReview } from "./PublicationReview";
import { EngagementOverview } from "./EngagementOverview";
import type { SourceSummary } from "./types";
import { precedingTimeMonth, reportingTimeMonth } from "../projects/time-history";
import { TimeConnectionPanel } from "./TimeConnectionPanel";
import { ProjectTimelineFields } from "./ProjectTimelineFields";
import { ProjectCreation } from "./ProjectCreation";
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
  hours: "Time Allocation",
  directory: "Team Directory",
  milestones: "Milestones",
  health: "Budgets & Delivery Health",
  preview: "Client Preview",
  integrations: "Integrations",
  portfolio: "Portfolio management",
  activity: "Audit & Settings",
};
type Area = keyof typeof sections;
const sectionIcons = { overview: LayoutGrid, projects: FolderKanban, portfolio: Layers3, hours: Clock3, activity: Activity, integrations: Plug,
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
  useEffect(() => { onUnsavedChange?.(editorDirty || portfolioDirty || timeDirty); return () => onUnsavedChange?.(false); }, [editorDirty, portfolioDirty, timeDirty, onUnsavedChange]);
  const [page, setPage] = useState<ProjectPage>({
    revision: workspace.revision,
    projects: [],
  });
  const [catalog, setCatalog] = useState<StaffProjectSummary[]>();
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [timeStatus, setTimeStatus] = useState<TimeStatus>();
  const [overviewTime, setOverviewTime] = useState<SourceSummary>();
  const [overviewTimeError, setOverviewTimeError] = useState(false);
  const [publicationReview, setPublicationReview] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [audits, setAudits] = useState<ProjectPage["audits"]>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [editing, setEditing] = useState<Project | "new">();
  const [editingDraft, setEditingDraft] = useState<ProjectDraftMetadata>();
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const location = usePortalLocation();
  const overviewPeriod = location.get("period") || "month";
  const rangeStart = location.get("overview-start") || "";
  const rangeEnd = location.get("overview-end") || "";
  const platform = usePlatformRoute();
  const nativeWorkspace = platform?.kind === "staff";
  const staffRoute = location.get("staff");
  const area: Area = staffRoute === "time" ? "integrations" : staffRoute && Object.hasOwn(sections, staffRoute) ? staffRoute as Area : "projects";
  const editorRoute = location.get("editor");
  const tableView = location.get("staff-layout") === "table";
  const treeView = location.get("staff-layout") === "tree";
  const statusFilter = location.get("project-filter") || "all";
  const matchesStatus = (p: StaffProjectSummary) => statusFilter === "all" ||
    (statusFilter === "closed" ? p.status === "closed" || p.status === "cancelled" : p.status === statusFilter);
  const allProjects = catalog ?? page.projects ?? [];
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
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");
  const [listError, setListError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [search, setSearch] = useState("");
  const [draftSearch, setDraftSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState<StaffProjectSummary>();
  const lock = useRef(false);
  const scope = tenant + "|" + month + "|" + search;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const creation = useRef<string | undefined>(undefined);
  const changeArea = (next: Area) => {
    if (area === next) return;
    if ((editorDirty || portfolioDirty || timeDirty) && !window.confirm("Discard the unsaved changes?")) return;
    if (editorDirty) { setEditing(undefined); setEditorDirty(false); }
    setNotice("");
    if (next !== "projects" && next !== "hours") {
      setSearch("");
      setDraftSearch("");
    }
    portalNavigate({ staff: next, editor: null, subsection: next === "portfolio" && organizing ? "placements" : null,
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
    if (editing) editorHeading.current?.focus();
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
      setUpdates([]); setMilestones([]); setEditingDraft(undefined); setEditing("new");
      return;
    }
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(editorRoute)) { setError("This editor link is unavailable."); return; }
    const abort = new AbortController();
    client.call<StaffProjectDetail>(tenant, "projects/" + editorRoute, { signal: abort.signal })
      .then(detail => {
        if (abort.signal.aborted || latestScope.current !== scope) return;
        if (detail.revision !== page.revision) throw Error("Refresh the workspace before editing.");
        setUpdates(detail.project.updates ?? []);
        setMilestones(detail.project.milestones ?? []);
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
  function changeLifecycle(project: Project, status: Project["status"], label: string) {
    const visibility = project.published ? " This saves a draft for publication review." : "";
    if (!window.confirm(label + " for " + project.name + "?" + visibility)) return;
    const { name, progress, description, internalNotes, plan, workOrderReference, updates, milestones, delivery } = project;
    void perform(async () => {
      await client.call(tenant, "projects/" + project.id, {
        method: "PATCH", body: { expectedRevision: page.revision, patch: {
          name, status, progress, description, internalNotes, plan, workOrderReference, updates, milestones, delivery,
        } },
      });
      setEpoch(value => value + 1);
      setNotice(project.published ? "Status saved to the draft." : "Project status saved.");
    });
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
  return (
    <section className="secure-staff intel-staff" aria-label="Project administration">
      <div className="secure-hero secure-staff-hero">
        <div>
          <p className="secure-eyebrow">
            Morris administration · {reportMonth(month)}
          </p>
          <h2>{staffRoute === "time" ? "QuickBooks Time status" : area === "projects" && editing ? "Project workspace" : sections[area]}</h2>
          <p>{workspace.tenant.name}</p>
        </div>
      </div>
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
      <div className="exec-content">
      {area !== "overview" && <nav className="exec-breadcrumb" aria-label="Breadcrumb">
        <button className="exec-text-button" type="button" onClick={() => changeArea("overview")}>Morris Overview</button>
        <span aria-current="page">{sections[area]}</span>
      </nav>}
      {area === "overview" && <section aria-label="Morris operating overview">
        <div className="delivery-section-heading"><h3>Delivery performance</h3>
          <label>Time period<select value={overviewPeriod} onChange={event => portalNavigate({ period: event.target.value })}>
            <option value="month">{reportMonth(month)}</option><option value="current">This Month</option><option value="previous">Previous Month</option>
            <option value="year">This Year</option><option value="previous-year">Last Year</option>
            <option value="all">All History</option><option value="range">Custom Date Range</option>
          </select></label>
          {overviewPeriod === "range" && <form className="secure-actions" onSubmit={event => {
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
        <dl className="secure-metrics">
          <div><dt>Client workspace</dt><dd>{workspace.tenant.name}</dd></div>
          <div><dt>Registered work orders</dt><dd>{timeStatus?.mappings.length ?? "Unavailable"}</dd></div>
          <div><dt>Hours recorded</dt><dd>{overviewTime?.hours ? reportHours(overviewTime.hours.recordedSeconds) + " h" : overviewTimeError ? "Unavailable" : "Loading"}</dd></div>
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
          <button type="button" className="secure-secondary" onClick={() => changeArea("hours")}>Allocate Hours</button>
          <button type="button" className="secure-secondary" onClick={() => changeArea("directory")}>Assign Team</button>
          {nativeWorkspace ? <>
            <PlatformLink className="platform-primary-action" href={periodHref(clientBase, month)}>View Zagimē Dashboard</PlatformLink>
            <PlatformLink href={periodHref(clientBase, month, { previewMode: "draft" })}>Preview Draft Changes</PlatformLink>
            <PlatformLink href={periodHref(staffPath("hours"), month, { period: "all" })}>Browse All History</PlatformLink>
          </> : <button type="button" className="secure-secondary" onClick={() => changeArea("preview")}>Preview as {workspace.tenant.name}</button>}
        </div>
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
        <h3>Workspace</h3>
        <div className="intel-staff-overview">{Object.entries(sections).filter(([key]) => key !== "overview" && (!nativeWorkspace || key !== "integrations")).map(([key,label]) =>
          <button type="button" key={key} onClick={() => changeArea(key as Area)}>{label}</button>)}</div>
      </section>}
      {catalogError && <p role="alert" className="secure-message secure-error">{catalogError} <button type="button" className="secure-secondary" onClick={() => setEpoch(value => value + 1)}>Reload workspace lists</button></p>}
      {area === "clients" && <section aria-label="Clients">
        <h3>{workspace.tenant.name}</h3><p>This workspace shows the client assigned to your Morris account.</p>
        <div className="secure-actions"><button type="button" onClick={() => changeArea("projects")}>Open client projects</button>
          <button type="button" className="secure-secondary" onClick={() => changeArea("preview")}>Preview as {workspace.tenant.name}</button></div>
      </section>}
      {area === "directory" && <DeliveryDirectory client={client} tenant={tenant} portfolio={portfolio} revision={page.revision} onSaved={() => setEpoch(value => value + 1)} onDenied={onDenied} />}
      {area === "health" && <DeliveryHealth projects={allProjects} portfolio={portfolio} healthOnly onOpen={openDeliveryProject} />}
      {area === "milestones" && <DeliveryMilestones client={client} tenant={tenant} projects={allProjects} onSaved={refresh} onOpen={openDeliveryProject} />}
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
      <section hidden={area !== "projects"} aria-labelledby="staff-projects">
        {nativeWorkspace && <div className="secure-actions">
          <label>Project status<select value={statusFilter} onChange={event => portalNavigate({ "project-filter": event.target.value === "all" ? null : event.target.value })}>
            <option value="all">All projects</option><option value="active">Active projects</option><option value="completed">Completed</option>
            <option value="paused">On hold</option><option value="closed">Closed or cancelled</option></select></label>
          <button type="button" className="secure-secondary" disabled={busy || !catalog} onClick={() => setPublicationReview(true)}>Review and Publish Existing Projects</button>
          <button type="button" className="secure-secondary" aria-pressed={location.has("engagements")}
            onClick={() => portalNavigate({ engagements: location.has("engagements") ? null : "1", engagement: null, "service-area": null })}>By Parent Engagement</button>
        </div>}
        {area === "projects" && location.has("engagements") && <EngagementOverview projects={allProjects} onOpen={id => portalNavigate({ staff: "projects", editor: id, engagements: null, engagement: null, "service-area": null })} />}
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
        {page.revision === 0 && !listError && (
          <p className="secure-empty" role="status">
            Loading projects…
          </p>
        )}
        {page.revision > 0 && !page.projects?.length && (
          <p className="secure-empty">
            {search
              ? page.nextCursor
                ? "No matches on this page. Continue searching to check more projects."
                : "No matching projects."
              : "No projects yet. Create one without a work order."}
          </p>
        )}
        {editing === "new" && <ProjectCreation projects={allProjects} portfolio={portfolio} busy={busy || !page.revision}
          onDirty={() => setEditorDirty(true)} onCancel={() => {
            if (editorDirty && !window.confirm("Discard the unsaved project changes?")) return;
            creation.current = undefined;
            portalNavigate({ editor: null });
          }} onSave={(project, openDetails) => void perform(async () => {
            const result = await client.call<{ id: string }>(tenant, "projects", { method: "POST", key: creation.current, body: project });
            creation.current = undefined;
            setEditorDirty(false);
            portalNavigate({ editor: openDetails ? result.id : null }, true);
            setEpoch(value => value + 1);
            setNotice("Project saved as a private draft.");
          })} />}
        {editing && editing !== "new" && (
          <form
            className="secure-form secure-project-editor"
            key={editing.id + ":" + editing.status}
            onChange={() => setEditorDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(async () => {
                const original = editing;
                const patch = {
                  name: String(f.get("name")),
                  updates,
                  milestones,
                  status: String(f.get("status")),
                  progress: original.progress,
                  description: String(f.get("description")),
                  internalNotes: String(f.get("notes")),
                  workOrderReference: String(f.get("workOrder")),
                  delivery: readDeliveryForm(f, original, portfolio?.placements.find(p => p.id === original?.id)),
                  plan: original.plan,
                };
                const result = await client.call<{ draft?: ProjectDraftMetadata; changed: boolean }>(
                  tenant,
                  `projects/${original.id}`,
                  {
                    method: "PATCH",
                    body: { expectedRevision: page.revision, patch },
                  },
                );
                setEditorDirty(false);
                if (original.published) {
                  setEpoch(value => value + 1);
                  setNotice(result.draft ? "Draft saved. Clients still see the last approved version." : "No project changes to save.");
                } else {
                  portalNavigate({ editor: null }, true);
                  refresh();
                }
              });
            }}
          >
            <h3 ref={editorHeading} tabIndex={-1}>
              Edit project
            </h3>
            <details className="delivery-details">
              <summary>Project lifecycle</summary>
              <p>{editing.published ? "Status changes need publication before clients will see them." : "The project remains private."}</p>
              <div className="secure-actions">
                {["completed", "closed", "cancelled"].includes(editing.status)
                  ? <button type="button" className="secure-secondary" disabled={busy || editorDirty} onClick={() => changeLifecycle(editing, "active", "Reopen project")}>Reopen project</button>
                  : <button type="button" className="secure-secondary" disabled={busy || editorDirty} onClick={() => changeLifecycle(editing, "completed", "Mark completed")}>Mark completed</button>}
                {editing.status !== "closed" && <button type="button" className="secure-secondary" disabled={busy || editorDirty} onClick={() => changeLifecycle(editing, "closed", "Close project")}>Close project</button>}
                {editing.status !== "cancelled" && <button type="button" className="secure-secondary" disabled={busy || editorDirty} onClick={() => changeLifecycle(editing, "cancelled", "Cancel project")}>Cancel project</button>}
              </div>
            </details>
            <fieldset className="secure-editor-grid" disabled={busy}>
              <label>
                Project name
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={editing.name}
                />
              </label>
              <label>
                Status
                <select
                  name="status"
                  defaultValue={editing.status}
                >
                  {Object.entries(projectStatus).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <input name="progress" type="hidden" value={editing.delivery?.manualCompletion ?? ""} />
              <label className="secure-field-wide">
                Client description
                <textarea
                  name="description"
                  maxLength={4000}
                  defaultValue={editing.description}
                />
              </label>
              <label className="secure-field-wide">
                Internal notes
                <textarea
                  name="notes"
                  maxLength={4000}
                  defaultValue={editing.internalNotes}
                />
              </label>
              <label>
                Work-order reference (optional)
                <input
                  name="workOrder"
                  maxLength={120}
                  defaultValue={
                    editing.workOrderReference ?? ""
                  }
                />
              </label>
            </fieldset>
            <DeliveryFields project={editing} projects={allProjects} portfolio={portfolio} mappings={timeStatus?.mappings} />
            <ProjectTimelineFields
              {...{ updates, milestones, setUpdates, setMilestones }}
              disabled={busy}
              people={portfolio?.directory}
            />
            <p>
              {editing.published
                ? "Save a draft and preview it before publishing. Clients see the last approved version until you publish changes."
                : "This project stays private until you publish it."}
            </p>
            <div className="secure-actions">
              <button type="submit" disabled={busy || page.revision === 0}>
                {editing.published ? "Save Draft" : "Save project"}
              </button>
              {editing.published && editingDraft && <>
                <button className="secure-secondary" type="button" disabled={busy || editorDirty || !page.revision}
                  onClick={() => previewChanges(editing.id)}>Preview Changes</button>
                <button type="button" disabled={busy || editorDirty || !page.revision}
                  onClick={() => resolveDraft(editing.id, "publish")}>Publish Changes</button>
                <button className="secure-secondary" type="button" disabled={busy || editorDirty || !page.revision}
                  onClick={() => resolveDraft(editing.id, "discard")}>Discard Draft</button>
              </>}
              <button
                type="button"
                disabled={busy}
                onClick={() => { if (!editorDirty || window.confirm("Discard the unsaved project changes?")) portalNavigate({ editor: null }); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="intel-workspace-toolbar" aria-label="Project layout">
          <button type="button" aria-pressed={!tableView && !treeView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": null })}>Project list</button>
          <button type="button" aria-pressed={treeView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": "tree" })}>Hierarchy</button>
          <button type="button" aria-pressed={tableView} className="secure-secondary" onClick={() => portalNavigate({ "staff-layout": "table" })}>Table</button>
        </div>
        {tableView && <div className="intel-table-scroll" tabIndex={0} role="region" aria-label="Projects table">
          <table><thead><tr><th scope="col">Project</th><th scope="col">Status</th><th scope="col">Visibility</th><th scope="col">Reported effort</th><th scope="col">Work order</th><th scope="col">Publication</th></tr></thead>
          <tbody>{page.projects?.filter(matchesStatus).map(p => <tr key={p.id}><th scope="row"><button type="button" className="exec-text-button" disabled={busy}
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
        {treeView && <DeliveryHealth projects={allProjects} portfolio={portfolio} onOpen={openDeliveryProject} />}
        <div hidden={tableView || treeView} className="secure-project-grid delivery-project-index">
          {page.projects?.filter(matchesStatus).map((p) => (
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
        {page.nextCursor && (
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
        {area === "hours" && (
          <TimeConnectionPanel
            client={client}
            tenant={tenant}
            month={month}
            projectId={selectedProject?.id}
            refreshVersion={epoch}
            projects={allProjects}
            busy={busy}
            run={perform}
            onChanged={() => setEpoch((x) => x + 1)}
            onDenied={onDenied}
            manage={false}
          />
        )}
        {area === "hours" && <TimeAllocation client={client} tenant={tenant} month={month} projects={allProjects}
          portfolio={portfolio} onDenied={onDenied} onSaved={() => setEpoch(value => value + 1)}
          initialConsultant={location.get("consultant") ?? undefined} initialHistory={location.get("period") === "all"}
          initialWorkOrder={location.get("workOrder") ?? undefined} onUnsavedChange={setTimeDirty}
          sourceLink={nativeWorkspace ? { id: location.get("source") ?? undefined,
            href: id => periodHref(staffPath("hours", id), month), backHref: periodHref(staffPath("hours"), month) } : undefined} />}
      </section>
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
      </div>
      </div>
    </section>
  );
}
