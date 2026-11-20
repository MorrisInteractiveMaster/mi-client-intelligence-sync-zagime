import { useEffect, useRef, useState } from "react";
import { ApiError, type SecuredApiClient } from "./client";
import type {
  Project,
  ProjectPage,
  ProjectMilestone,
  ProjectUpdate,
  StaffProjectSummary,
  ProjectWorkspace,
} from "../projects/model";
import type { StaffSource, HistoryRow } from "./types";
import type { Allocation } from "../reporting/model";
import { hoursToSeconds } from "../projects/duration";
import { Activity, Clock3, FolderKanban, Layers3, Plug } from "lucide-react";
import { PortfolioAdmin } from "./PortfolioAdmin";
import { ProjectReportPreview } from "./ProjectReportingCard";
import { ContextHelp } from "./ContextHelp";
import "./executive.css";
import { TimeConnectionPanel } from "./TimeConnectionPanel";
import { ProjectTimelineFields } from "./ProjectTimelineFields";
import {
  projectStatus,
  reportDay,
  reportHours,
  reportMonth,
  reportTimestamp,
} from "./dashboard-format";

const sections = {
  projects: "Projects",
  portfolio: "Portfolio management",
  hours: "Hours & allocations",
  activity: "Audit history",
  integrations: "Integrations",
};
type Area = keyof typeof sections;
const sectionIcons = { projects: FolderKanban, portfolio: Layers3, hours: Clock3, activity: Activity, integrations: Plug };
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
  useEffect(() => { onUnsavedChange?.(editorDirty || portfolioDirty); return () => onUnsavedChange?.(false); }, [editorDirty, portfolioDirty, onUnsavedChange]);
  const [page, setPage] = useState<ProjectPage>({
    revision: workspace.revision,
    projects: [],
  });
  const [sources, setSources] = useState<StaffSource[]>();
  const [sourceCursor, setSourceCursor] = useState<string>();
  const [audits, setAudits] = useState<ProjectPage["audits"]>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [editing, setEditing] = useState<Project | "new">();
  const [updates, setUpdates] = useState<ProjectUpdate[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [area, setArea] = useState<Area>("projects");
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const allocationHeading = useRef<HTMLHeadingElement>(null);
  const [selected, setSelected] = useState<StaffSource>();
  const [portions, setPortions] = useState<Allocation[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>();
  const [historyCursor, setHistoryCursor] = useState<string>();
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
    if ((editorDirty || portfolioDirty) && !window.confirm("Discard the unsaved changes?")) return;
    if (editorDirty) { setEditing(undefined); setEditorDirty(false); }
    if (next !== "projects" && next !== "hours") {
      setSearch("");
      setDraftSearch("");
    }
    setArea(next);
  };
  useEffect(() => {
    areaHeading.current?.focus();
  }, [area]);
  useEffect(() => {
    if (editing) editorHeading.current?.focus();
    setEditorDirty(false);
  }, [editing]);
  useEffect(() => {
    if (selected) allocationHeading.current?.focus();
  }, [selected]);
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
    if (e instanceof ApiError && [401, 403].includes(e.status)) onDenied();
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
    setSources(undefined);
    setAudits(undefined);
    setSelected(undefined);
    setEditing(undefined);
    setHistory(undefined);
    setSourceCursor(undefined);
    setAuditCursor(undefined);
    setHistoryCursor(undefined);
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
  async function moreProjects() {
    const p = await client.call<ProjectPage>(
      tenant,
      "projects?" + projectQuery(page.nextCursor),
    );
    consistent(p);
    setPage((old) => ({ ...p, projects: [...old.projects!, ...p.projects!] }));
  }
  async function loadSources(cursor?: string) {
    const p = await client.call<ProjectPage>(
      tenant,
      "sources?" + query(cursor),
    );
    consistent(p);
    setSources((old) => (cursor ? [...old!, ...p.sources!] : p.sources));
    setSourceCursor(p.nextCursor);
  }
  async function loadAudits(cursor?: string) {
    const p = await client.call<ProjectPage>(tenant, "audits?" + query(cursor));
    consistent(p);
    setAudits((old) => (cursor ? [...old!, ...p.audits!] : p.audits));
    setAuditCursor(p.nextCursor);
  }
  async function loadHistory(s: StaffSource, cursor?: string) {
    const p = await client.call<ProjectPage>(
      tenant,
      `sources/${s.id}/history?` + query(cursor),
    );
    consistent(p);
    setHistory((old) => (cursor ? [...old!, ...p.history!] : p.history));
    setHistoryCursor(p.nextCursor);
  }
  return (
    <section className="secure-staff" aria-label="Project administration">
      <div className="secure-hero secure-staff-hero">
        <div>
          <p className="secure-eyebrow">
            Morris administration · {reportMonth(month)}
          </p>
          <h2>{workspace.tenant.name}</h2>
        </div>
      </div>
      <div className="exec-frame exec-staff-frame">
      <aside className="exec-sidebar">
      <nav aria-label="Morris workspace sections">
        {Object.entries(sections).map(([key, label]) => (
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
                creation.current = `${Date.now()}-${crypto.randomUUID()}`;
                setUpdates([]);
                setMilestones([]);
                setEditing("new");
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
        {editing && (
          <form
            className="secure-form secure-project-editor"
            key={editing === "new" ? "new" : editing.id}
            onChange={() => setEditorDirty(true)}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void perform(async () => {
                const original = editing === "new" ? undefined : editing;
                const planHours = String(f.get("hours"));
                const patch = {
                  name: String(f.get("name")),
                  updates,
                  milestones,
                  status: String(f.get("status")),
                  progress: Number(f.get("progress")),
                  description: String(f.get("description")),
                  internalNotes: String(f.get("notes")),
                  workOrderReference: String(f.get("workOrder")),
                  plan: {
                    basis: String(f.get("basis")),
                    targetSeconds:
                      original &&
                      planHours === String(original.plan.targetSeconds / 3600)
                        ? original.plan.targetSeconds
                        : hoursToSeconds(planHours),
                  },
                };
                await client.call(
                  tenant,
                  original ? `projects/${original.id}` : "projects",
                  {
                    method: original ? "PATCH" : "POST",
                    ...(original ? {} : { key: creation.current }),
                    body: original
                      ? { expectedRevision: page.revision, patch }
                      : patch,
                  },
                );
                creation.current = undefined;
                refresh();
              });
            }}
          >
            <h3 ref={editorHeading} tabIndex={-1}>
              {editing === "new" ? "New project" : "Edit project"}
            </h3>
            <fieldset className="secure-editor-grid" disabled={busy}>
              <label>
                Project name
                <input
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={editing === "new" ? "" : editing.name}
                />
              </label>
              <label>
                Status
                <select
                  name="status"
                  defaultValue={editing === "new" ? "planned" : editing.status}
                >
                  {Object.entries(projectStatus).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Progress (%)
                <input
                  name="progress"
                  type="number"
                  min={0}
                  max={100}
                  required
                  defaultValue={editing === "new" ? 0 : editing.progress}
                />
              </label>
              <label>
                Plan basis
                <select
                  name="basis"
                  defaultValue={
                    editing === "new" ? "fixed" : editing.plan.basis
                  }
                >
                  <option value="fixed">Lifetime target</option>
                  <option value="monthly">Monthly target</option>
                </select>
              </label>
              <label>
                Planned hours
                <input
                  name="hours"
                  inputMode="decimal"
                  required
                  defaultValue={
                    editing === "new"
                      ? "0"
                      : String(editing.plan.targetSeconds / 3600)
                  }
                />
              </label>
              <label className="secure-field-wide">
                Client description
                <textarea
                  name="description"
                  maxLength={4000}
                  defaultValue={editing === "new" ? "" : editing.description}
                />
              </label>
              <label className="secure-field-wide">
                Internal notes
                <textarea
                  name="notes"
                  maxLength={4000}
                  defaultValue={editing === "new" ? "" : editing.internalNotes}
                />
              </label>
              <label>
                Work-order reference (optional)
                <input
                  name="workOrder"
                  maxLength={120}
                  defaultValue={
                    editing === "new" ? "" : (editing.workOrderReference ?? "")
                  }
                />
              </label>
            </fieldset>
            <ProjectTimelineFields
              {...{ updates, milestones, setUpdates, setMilestones }}
              disabled={busy}
            />
            <p>
              {editing !== "new" && editing.published
                ? "Saving updates the published project and its client-visible content."
                : "This project stays private until you publish it."}
            </p>
            <div className="secure-actions">
              <button type="submit" disabled={busy || page.revision === 0}>
                Save project
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { if (!editorDirty || window.confirm("Discard the unsaved project changes?")) setEditing(undefined); }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="secure-project-grid">
          {page.projects?.map((p) => (
            <article className="secure-card" key={p.id}>
              <div className="secure-card-flags">
                <p className="secure-badge" data-status={p.status}>
                  {projectStatus[p.status]}
                </p>
                <p
                  className="secure-badge"
                  data-status={p.published ? "published" : "private"}
                >
                  {p.published ? "Published" : "Unpublished"}
                </p>
              </div>
              <h3>{p.name}</h3>
              {p.workOrderReference && (
                <p className="secure-project-reference">
                  {p.workOrderReference}
                </p>
              )}
              <div className="secure-progress">
                <span>{p.progress}% progress</span>
                <progress
                  aria-label={p.name + " progress"}
                  max={100}
                  value={p.progress}
                />
              </div>
              <dl className="secure-project-hours">
                <div>
                  <dt>Allocated in {month}</dt>
                  <dd>{reportHours(p.seconds)} h</dd>
                </div>
                <div>
                  <dt>Lifetime allocated</dt>
                  <dd>{reportHours(p.lifetimeSeconds)} h</dd>
                </div>
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
                  onClick={() =>
                    void perform(async () => {
                      const d = await client.call<{
                        revision: number;
                        project: Project;
                      }>(tenant, `projects/${p.id}`);
                      if (
                        d.revision !== page.revision ||
                        latestScope.current !== scope
                      )
                        throw Error("Refresh the workspace before editing.");
                      setUpdates(d.project.updates ?? []);
                      setMilestones(d.project.milestones ?? []);
                      setEditing(d.project);
                    })
                  }
                >
                  Edit
                </button>
                <button type="button" className="secure-secondary" disabled={busy} aria-label={"Organize " + p.name}
                  onClick={() => { setOrganizing(p); changeArea("portfolio"); }}>Organize</button>
                <button
                  className="secure-secondary"
                  disabled={busy}
                  aria-label={`${p.published ? "Unpublish" : "Publish"} ${p.name}`}
                  onClick={() =>
                    void perform(async () => {
                      await client.call(
                        tenant,
                        `projects/${p.id}/publication`,
                        {
                          method: "PATCH",
                          body: {
                            expectedRevision: page.revision,
                            published: !p.published,
                          },
                        },
                      );
                      refresh();
                    })
                  }
                >
                  {p.published ? "Unpublish" : "Publish"}
                </button>
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
      <section hidden={area !== "hours"} aria-labelledby="project-time-hours">
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
            projects={page.projects ?? []}
            busy={busy}
            run={perform}
            onChanged={() => setEpoch((x) => x + 1)}
            onDenied={onDenied}
            manage={false}
          />
        )}
        <h3>Recorded time across projects</h3>
        <p>
          Splits change reporting hours. The original source entry stays intact.
        </p>
        {search && (
          <button
            className="secure-secondary"
            disabled={busy}
            onClick={() => {
              setSearch("");
              setDraftSearch("");
            }}
          >
            Show all project choices
          </button>
        )}
        {page.nextCursor && (
          <button disabled={busy} onClick={() => void perform(moreProjects)}>
            More project choices
          </button>
        )}
        {!sources && (
          <button
            disabled={busy || page.revision === 0}
            onClick={() => void perform(() => loadSources())}
          >
            Load authorized time
          </button>
        )}
        {sources?.length === 0 && (
          <p className="secure-empty">
            No source time is available for {reportMonth(month)}.
          </p>
        )}
        {sources?.map((s) => (
          <article className="secure-card" key={s.id}>
            <h3>
              {reportDay(s.date)} · {reportHours(s.seconds)} h recorded
            </h3>
            <p>{s.description}</p>
            <p>Approval: {s.approval ?? "unknown"}</p>
            {s.modifiedAt && (
              <p>
                Source updated {reportTimestamp(s.modifiedAt)}
                {s.deleted ? " · Deleted in QuickBooks Time" : ""}
              </p>
            )}
            {s.needsReview && !s.deleted && (
              <p role="status">
                Source changed. Review the prior split before saving a new
                allocation.
              </p>
            )}
            <p>
              {!s.deleted && (
                <>
                  {reportHours(s.seconds - s.unallocatedSeconds)} h allocated
                  ·{" "}
                </>
              )}
              {reportHours(s.unallocatedSeconds)} h unallocated
              {s.conflict
                ? " · Source conflict: review required before changing allocations."
                : ""}
            </p>
            <button
              disabled={busy || s.conflict}
              onClick={() => {
                setSelected(s);
                setPortions(s.portions);
                setHistory(undefined);
                setHistoryCursor(undefined);
              }}
            >
              Allocate recorded hours
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  setSelected(s);
                  setPortions(s.portions);
                  await loadHistory(s);
                })
              }
            >
              Allocation history
            </button>
          </article>
        ))}
        {sourceCursor && (
          <button
            disabled={busy}
            onClick={() => void perform(() => loadSources(sourceCursor))}
          >
            More recorded time
          </button>
        )}
        {selected && (
          <section
            className="secure-card secure-allocation"
            aria-label="Time allocation"
          >
            <h3 ref={allocationHeading} tabIndex={-1}>
              Allocate {reportHours(selected.seconds)} recorded hours
            </h3>
            {portions.map((p, i) => (
              <div className="secure-split" key={i}>
                <label>
                  Delivery project
                  <select
                    aria-label="Delivery project"
                    value={p.projectId}
                    onChange={(e) =>
                      setPortions((old) =>
                        old.map((v, n) =>
                          n === i ? { ...v, projectId: e.target.value } : v,
                        ),
                      )
                    }
                  >
                    <option value="">Choose project</option>
                    {!page.projects?.some((v) => v.id === p.projectId) &&
                      p.projectId && (
                        <option value={p.projectId}>
                          Existing project {p.projectId}
                        </option>
                      )}
                    {page.projects?.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Allocated seconds
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={p.seconds}
                    onChange={(e) =>
                      setPortions((old) =>
                        old.map((v, n) =>
                          n === i
                            ? { ...v, seconds: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <span>{reportHours(p.seconds)} h</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    setPortions((old) => old.filter((_, n) => n !== i))
                  }
                >
                  Remove split
                </button>
              </div>
            ))}
            <p>
              {reportHours(
                portions.reduce((sum, portion) => sum + portion.seconds, 0),
              )}{" "}
              h in this split · {reportHours(selected.seconds)} h recorded.
              Enter split durations in seconds (1 h = 3,600 seconds).
            </p>
            <button
              disabled={busy || portions.length >= 10 || selected.conflict}
              onClick={() =>
                setPortions((old) => [
                  ...old,
                  { projectId: "", seconds: 0, description: "" },
                ])
              }
            >
              Add split
            </button>
            <button
              disabled={
                busy ||
                selected.conflict ||
                portions.some(
                  (p) =>
                    !p.projectId ||
                    !Number.isSafeInteger(p.seconds) ||
                    p.seconds <= 0,
                ) ||
                new Set(portions.map((p) => p.projectId)).size !==
                  portions.length ||
                portions.reduce((sum, p) => sum + p.seconds, 0) >
                  selected.seconds
              }
              onClick={() =>
                void perform(async () => {
                  await client.call(tenant, `allocations/${selected.id}`, {
                    method: "PATCH",
                    body: { expectedRevision: page.revision, portions },
                  });
                  refresh();
                })
              }
            >
              Save allocation
            </button>
            <button
              className="secure-secondary"
              disabled={busy}
              onClick={() => setSelected(undefined)}
            >
              Close allocation
            </button>
            {history?.length === 0 && <p>No allocation revisions yet.</p>}
            {history?.map((r) => (
              <p key={r.revision}>
                Revision {r.revision} · {reportTimestamp(r.at)} ·{" "}
                {reportHours(r.portions.reduce((n, p) => n + p.seconds, 0))} h
                allocated
              </p>
            ))}
            {historyCursor && (
              <button
                disabled={busy}
                onClick={() =>
                  void perform(() => loadHistory(selected, historyCursor))
                }
              >
                More allocation history
              </button>
            )}
          </section>
        )}
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
              projects={page.projects ?? []}
              busy={busy}
              run={perform}
              onChanged={() => setEpoch((value) => value + 1)}
              onDenied={onDenied}
            />
          </article>
        </section>
      )}
      </div>
      </div>
    </section>
  );
}
