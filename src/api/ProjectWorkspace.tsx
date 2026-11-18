import { useEffect, useRef, useState } from "react";
import { ApiError, type SecuredApiClient } from "./client";
import type {
  Project,
  ProjectPage,
  ProjectView,
  ProjectWorkspace,
} from "../projects/model";
import type { StaffSource, HistoryRow } from "./types";
import type { Allocation } from "../reporting/model";
import { hoursToSeconds } from "../projects/duration";
const h = (s: number) => String(s / 3600);
export function ProjectStaffWorkspace({
  client,
  tenant,
  workspace,
  month,
  onDenied,
}: {
  client: SecuredApiClient;
  tenant: string;
  workspace: ProjectWorkspace;
  month: string;
  onDenied: () => void;
}) {
  const [page, setPage] = useState<ProjectPage>({
    revision: workspace.revision,
    projects: [],
  });
  const [sources, setSources] = useState<StaffSource[]>();
  const [sourceCursor, setSourceCursor] = useState<string>();
  const [audits, setAudits] = useState<ProjectPage["audits"]>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [editing, setEditing] = useState<Project | "new">();
  const [selected, setSelected] = useState<StaffSource>();
  const [portions, setPortions] = useState<Allocation[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const lock = useRef(false);
  const scope = tenant + "|" + month;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const creation = useRef<string | undefined>(undefined);
  const query = (cursor?: string) =>
    `month=${month}&limit=25${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
  const failed = (e: unknown) => {
    if (e instanceof ApiError && [401, 403].includes(e.status)) onDenied();
    setError(
      e instanceof Error ? e.message : "The request could not be completed.",
    );
  };
  useEffect(() => {
    const abort = new AbortController();
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
      .call<ProjectPage>(tenant, "projects?" + query(), {
        signal: abort.signal,
      })
      .then((p) => {
        if (!abort.signal.aborted) {
          setPage(p);
          setError("");
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) failed(e);
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch]);
  async function perform(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
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
      "projects?" + query(page.nextCursor),
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
      <h2>Projects</h2>
      <p>
        Project plans and publication are managed by Morris. QuickBooks
        connections are disabled.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          creation.current = `${Date.now()}-${crypto.randomUUID()}`;
          setEditing("new");
        }}
      >
        Create project
      </button>
      <button disabled={busy} onClick={() => setEpoch((x) => x + 1)}>
        Refresh workspace
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {page.revision === 0 && <p role="status">Loading projects…</p>}
      {page.revision > 0 && !page.projects?.length && (
        <p>No projects yet. Create one without a work order.</p>
      )}
      {page.projects?.map((p) => (
        <article className="secure-card" key={p.id}>
          <h3>{p.name}</h3>
          <p>
            {p.status} · {p.progress}% progress ·{" "}
            {p.published ? "Published" : "Unpublished"}
          </p>
          <p>
            {h(p.seconds)} h in {month} · {h(p.lifetimeSeconds)} h lifetime ·{" "}
            {h(p.plan.targetSeconds)} h {p.plan.basis} plan
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const d = await client.call<{
                  revision: number;
                  project: Project;
                }>(tenant, `projects/${p.id}`);
                if (d.revision !== page.revision)
                  throw Error("Refresh the workspace before editing.");
                setEditing(d.project);
              })
            }
          >
            Edit {p.name}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await client.call(tenant, `projects/${p.id}/publication`, {
                  method: "PATCH",
                  body: {
                    expectedRevision: page.revision,
                    published: !p.published,
                  },
                });
                refresh();
              })
            }
          >
            {p.published ? "Unpublish" : "Publish"} {p.name}
          </button>
        </article>
      ))}
      {page.nextCursor && (
        <button disabled={busy} onClick={() => void perform(moreProjects)}>
          More projects
        </button>
      )}
      {editing && (
        <form
          className="secure-form"
          key={editing === "new" ? "new" : editing.id}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void perform(async () => {
              const original = editing === "new" ? undefined : editing;
              const planHours = String(f.get("hours"));
              const patch = {
                name: String(f.get("name")),
                status: String(f.get("status")),
                progress: Number(f.get("progress")),
                description: String(f.get("description")),
                internalNotes: String(f.get("notes")),
                workOrderReference: String(f.get("workOrder")),
                plan: {
                  basis: String(f.get("basis")),
                  targetSeconds:
                    original && planHours === h(original.plan.targetSeconds)
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
          <h3>{editing === "new" ? "New project" : "Edit project"}</h3>
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
              {["planned", "active", "paused", "completed"].map((s) => (
                <option key={s}>{s}</option>
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
              defaultValue={editing === "new" ? "fixed" : editing.plan.basis}
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
                editing === "new" ? "0" : h(editing.plan.targetSeconds)
              }
            />
          </label>
          <label>
            Client description
            <textarea
              name="description"
              maxLength={4000}
              defaultValue={editing === "new" ? "" : editing.description}
            />
          </label>
          <label>
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
          <p>
            A reporting reference does not connect or change a QuickBooks
            project.
          </p>
          <p>
            New projects stay unpublished until you explicitly publish them.
          </p>
          <button disabled={busy || page.revision === 0}>Save project</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setEditing(undefined)}
          >
            Cancel
          </button>
        </form>
      )}
      <h2>Recorded time</h2>
      {!sources && (
        <button
          disabled={busy || page.revision === 0}
          onClick={() => void perform(() => loadSources())}
        >
          Load authorized time
        </button>
      )}
      {sources?.length === 0 && <p>No source time is available.</p>}
      {sources?.map((s) => (
        <article className="secure-card" key={s.id}>
          <h3>
            {s.date} · {h(s.seconds)} h recorded
          </h3>
          <p>{s.description}</p>
          <p>Approval: {s.approval ?? "unknown"}</p>
          <p>
            {h(s.unallocatedSeconds)} h unallocated
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
        <section aria-label="Time allocation">
          <h3>Allocate {h(selected.seconds)} recorded hours</h3>
          {portions.map((p, i) => (
            <div key={i}>
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
                        n === i ? { ...v, seconds: Number(e.target.value) } : v,
                      ),
                    )
                  }
                />
              </label>
              <span>{h(p.seconds)} h</span>
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
            3600 seconds = 1 hour. Splits change reporting only; recorded source
            time is unchanged.
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
            disabled={busy || selected.conflict}
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
          {history?.map((r) => (
            <p key={r.revision}>
              Revision {r.revision} · {r.at} ·{" "}
              {r.portions.reduce((n, p) => n + p.seconds, 0)} allocated seconds
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
      <h2>Audit history</h2>
      {!audits && (
        <button
          disabled={busy || page.revision === 0}
          onClick={() => void perform(() => loadAudits())}
        >
          Load audit history
        </button>
      )}
      {audits?.map((a) => (
        <p key={a.id}>
          {a.at} · {a.action} · {a.actor}
        </p>
      ))}
      {auditCursor && (
        <button
          disabled={busy}
          onClick={() => void perform(() => loadAudits(auditCursor))}
        >
          More audit history
        </button>
      )}
    </section>
  );
}
