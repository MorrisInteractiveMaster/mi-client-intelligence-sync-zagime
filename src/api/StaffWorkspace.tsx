import { useEffect, useRef, useState } from "react";
import { ApiError, SecuredApiClient } from "./client";
import type {
  HistoryRow,
  StaffPage,
  StaffProject,
  StaffSource,
  Workspace,
} from "./types";
import type { Allocation } from "../reporting/model";
import { hours } from "../reporting/model";
import "./secure.css";
type Props = {
  client: SecuredApiClient;
  tenant: string;
  workspace: Workspace;
  month: string;
  onDenied: () => void;
};
export function StaffWorkspace({
  client,
  tenant,
  workspace,
  month,
  onDenied,
}: Props) {
  const [tab, setTab] = useState<"projects" | "sources">("projects");
  const [projects, setProjects] = useState<StaffProject[]>([]);
  const [sources, setSources] = useState<StaffSource[]>([]);
  const [projectCursor, setProjectCursor] = useState<string>();
  const [sourceCursor, setSourceCursor] = useState<string>();
  const [revision, setRevision] = useState(workspace.revision);
  const [pageReady, setPageReady] = useState(false);
  const revisionRef = useRef(workspace.revision);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [epoch, setEpoch] = useState(0);
  const [loadedSources, setLoadedSources] = useState(false);
  const [create, setCreate] = useState(false);
  const [editing, setEditing] = useState<StaffProject>();
  const [selected, setSelected] = useState<StaffSource>();
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string>();
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    return () => {
      current.current = false;
    };
  }, []);
  const query = (cursor?: string) =>
    `month=${month}&limit=20${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`;
  const failed = (e: unknown) => {
    if (!current.current) return;
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      onDenied();
      return;
    }
    setError(e instanceof Error ? e.message : "The request was not completed.");
  };
  useEffect(() => {
    const abort = new AbortController();
    let active = true;
    setPageReady(false);
    setProjects([]);
    setSources([]);
    setSelected(undefined);
    setEditing(undefined);
    setHistory([]);
    setLoadedSources(false);
    setProjectCursor(undefined);
    setSourceCursor(undefined);
    setBusy(true);
    client
      .call<StaffPage>(tenant, "projects?" + query(), { signal: abort.signal })
      .then((p) => {
        if (active) {
          setProjects(p.projects!);
          setProjectCursor(p.nextCursor);
          setRevision(p.revision);
          revisionRef.current = p.revision;
          setPageReady(true);
          setError("");
        }
      })
      .catch((e) => {
        if (active) failed(e);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [client, tenant, month, epoch]);
  useEffect(() => {
    if (tab !== "sources" || loadedSources || !pageReady) return;
    const abort = new AbortController();
    let active = true;
    client
      .call<StaffPage>(tenant, "sources?" + query(), { signal: abort.signal })
      .then((p) => {
        if (active) {
          if (p.revision !== revisionRef.current)
            throw Error(
              "The workspace changed. Refresh before allocating time.",
            );
          setSources(p.sources!);
          setSourceCursor(p.nextCursor);
          setLoadedSources(true);
        }
      })
      .catch((e) => {
        if (active) failed(e);
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [tab, loadedSources, client, tenant, month, epoch, pageReady]);
  async function action(
    work: () => Promise<unknown>,
    message: string,
    refresh = true,
  ) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
      if (!current.current) return;
      setNotice(message);
      if (refresh) setEpoch((x) => x + 1);
    } catch (e) {
      failed(e);
      throw e;
    } finally {
      lock.current = false;
      if (current.current) setBusy(false);
    }
  }
  async function more(resource: "projects" | "sources", cursor: string) {
    await action(
      async () => {
        const p = await client.call<StaffPage>(
          tenant,
          resource + "?" + query(cursor),
        );
        if (p.revision !== revision)
          throw Error(
            "The workspace changed between pages. Refresh to load a consistent view.",
          );
        if (resource === "projects") {
          setProjects((v) => [...v, ...p.projects!]);
          setProjectCursor(p.nextCursor);
        } else {
          setSources((v) => [...v, ...p.sources!]);
          setSourceCursor(p.nextCursor);
        }
      },
      "Page loaded.",
      false,
    ).catch(() => {});
  }
  async function loadHistory(s: StaffSource, cursor?: string) {
    await action(
      async () => {
        const p = await client.call<StaffPage>(
          tenant,
          `sources/${s.id}/history?` + query(cursor),
        );
        if (p.revision !== revision)
          throw Error(
            "The workspace changed. Refresh before reviewing history.",
          );
        setHistory((v) => (cursor ? [...v, ...p.history!] : p.history!));
        setHistoryCursor(p.nextCursor);
      },
      "Allocation history loaded.",
      false,
    ).catch(() => {});
  }
  return (
    <div className="secure-staff">
      <div className="secure-toolbar">
        <div>
          <h2>Morris workspace</h2>
          <p>
            {workspace.role === "administrator" ? "Administrator" : "Editor"} ·
            Revision {revision}
          </p>
        </div>
        <button
          disabled={busy}
          onClick={() => {
            setError("");
            setEpoch((x) => x + 1);
          }}
        >
          Refresh workspace
        </button>
      </div>
      <nav aria-label="Staff workspace">
        <button
          aria-pressed={tab === "projects"}
          onClick={() => setTab("projects")}
        >
          Projects
        </button>
        <button
          aria-pressed={tab === "sources"}
          onClick={() => setTab("sources")}
        >
          Time allocation
        </button>
      </nav>
      {error && <p role="alert">{error} No automatic write retry was made.</p>}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Updating workspace…</p>}
      {tab === "projects" ? (
        <>
          <div className="secure-toolbar">
            <p>Assigned agreements → departments → delivery projects</p>
            {workspace.canCreate && (
              <button
                disabled={busy}
                onClick={() => {
                  setCreate(true);
                  setEditing(undefined);
                }}
              >
                New project
              </button>
            )}
          </div>
          {(create || editing) && (
            <ProjectForm
              key={editing?.id ?? "new"}
              project={editing}
              workspace={workspace}
              busy={busy}
              cancel={() => {
                setCreate(false);
                setEditing(undefined);
              }}
              save={async (input, key) => {
                await action(
                  () =>
                    editing
                      ? client.call(tenant, `projects/${editing.id}`, {
                          method: "PATCH",
                          body: { expectedRevision: revision, patch: input },
                        })
                      : client.call(tenant, "projects", {
                          method: "POST",
                          body: input,
                          key,
                        }),
                  editing ? "Project saved." : "Project created privately.",
                );
                setCreate(false);
                setEditing(undefined);
              }}
            />
          )}
          <div className="secure-cards">
            {projects.map((p) => (
              <article className="secure-card" key={p.id}>
                <small>
                  {
                    workspace.agreements.find((a) => a.id === p.agreementId)
                      ?.name
                  }{" "}
                  /{" "}
                  {
                    workspace.departments.find((d) => d.id === p.departmentId)
                      ?.name
                  }
                </small>
                <h3>{p.name}</h3>
                <span className="secure-badge">
                  {p.published ? "Published" : "Private"}
                </span>
                <p>
                  {hours(p.seconds)} h in {month} · {hours(p.lifetimeSeconds)} h
                  lifetime
                </p>
                <p>
                  {p.plan.minutes / 60} h{" "}
                  {p.plan.basis === "fixed" ? "lifetime plan" : "monthly plan"}{" "}
                  · {p.progress}% progress
                </p>
                {p.workOrderReference && (
                  <p>Work order: {p.workOrderReference}</p>
                )}
                <div className="secure-toolbar">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setEditing(p);
                      setCreate(false);
                    }}
                  >
                    Edit project
                  </button>
                  {workspace.role === "administrator" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          () =>
                            client.call(
                              tenant,
                              `projects/${p.id}/publication`,
                              {
                                method: "PATCH",
                                body: {
                                  expectedRevision: revision,
                                  published: !p.published,
                                },
                              },
                            ),
                          p.published
                            ? "Project unpublished."
                            : "Project published.",
                        ).catch(() => {})
                      }
                    >
                      {p.published ? "Unpublish" : "Publish"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
          {!projects.length && !busy && (
            <p>No assigned projects on this page.</p>
          )}
          {projectCursor && (
            <button
              disabled={busy}
              onClick={() => void more("projects", projectCursor)}
            >
              Load more projects
            </button>
          )}
        </>
      ) : (
        <>
          <p>
            Recorded time stays unchanged. Reporting splits update only the
            dashboard allocation history. Editors see entries only when every
            applied target is authorized.
          </p>
          <div className="secure-cards">
            {sources.map((s) => (
              <article className="secure-card" key={s.id}>
                <h3>
                  {s.date} · {hours(s.seconds)} h recorded
                </h3>
                <p>{s.description}</p>
                <p>
                  {hours(s.unallocatedSeconds)} h unallocated
                  {s.conflict ? " · Conflict — review before allocating" : ""}
                </p>
                <p>Source work order: {s.sourceWorkOrderId || "Unassigned"}</p>
                <button
                  disabled={busy}
                  onClick={() => {
                    setSelected(s);
                    setHistory([]);
                    setHistoryCursor(undefined);
                  }}
                >
                  Review split
                </button>
              </article>
            ))}
          </div>
          {!sources.length && loadedSources && (
            <p>No authorized time on this page.</p>
          )}
          {sourceCursor && (
            <button
              disabled={busy}
              onClick={() => void more("sources", sourceCursor)}
            >
              Load more time
            </button>
          )}
          {selected && (
            <section className="secure-card">
              <h3>Reporting split · {selected.date}</h3>
              <AllocationForm
                key={selected.id + "-" + selected.allocationRevision}
                source={selected}
                projects={projects}
                busy={busy}
                save={async (portions) => {
                  await action(
                    () =>
                      client.call(tenant, `allocations/${selected.id}`, {
                        method: "PATCH",
                        body: { expectedRevision: revision, portions },
                      }),
                    "Reporting split saved. Source time unchanged.",
                  );
                }}
              />
              <button
                disabled={busy}
                onClick={() => void loadHistory(selected)}
              >
                View allocation history
              </button>
              <ol>
                {history.map((h) => (
                  <li key={h.revision}>
                    Revision {h.revision} · {h.at}
                    <ul>
                      {h.portions.map((p) => (
                        <li key={p.projectId}>
                          {projects.find((x) => x.id === p.projectId)?.name ??
                            p.projectId}
                          : {hours(p.seconds)} h · {p.description}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              {historyCursor && (
                <button
                  disabled={busy}
                  onClick={() => void loadHistory(selected, historyCursor)}
                >
                  Load earlier revisions
                </button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
function ProjectForm({
  project,
  workspace,
  busy,
  cancel,
  save,
}: {
  project?: StaffProject;
  workspace: Workspace;
  busy: boolean;
  cancel: () => void;
  save: (input: unknown, key?: string) => Promise<void>;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [agreement, setAgreement] = useState(
    project?.agreementId ?? workspace.agreements[0]?.id ?? "",
  );
  const [department, setDepartment] = useState(
    project?.departmentId ??
      workspace.departments.find((d) => d.agreementId === agreement)?.id ??
      "",
  );
  const [plan, setPlan] = useState(String((project?.plan.minutes ?? 0) / 60));
  const [basis, setBasis] = useState(project?.plan.basis ?? "fixed");
  const [progress, setProgress] = useState(String(project?.progress ?? 0));
  const [wo, setWo] = useState(project?.workOrderReference ?? "");
  const [pending, setPending] = useState<{ input: unknown; key: string }>();
  const [message, setMessage] = useState("");
  return (
    <form
      className="secure-card secure-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage("");
        const input = project
          ? {
              name: name.trim(),
              plan: { basis, minutes: Math.round(Number(plan) * 60) },
              progress: Number(progress),
              workOrderReference: wo.trim(),
            }
          : {
              name: name.trim(),
              agreementId: agreement,
              departmentId: department,
              plan: { basis, minutes: Math.round(Number(plan) * 60) },
            };
        const attempt = pending ?? {
          input,
          key: `${Date.now()}-${crypto.randomUUID()}`,
        };
        if (!project) setPending(attempt);
        try {
          await save(attempt.input, project ? undefined : attempt.key);
        } catch (e) {
          setMessage(
            e instanceof ApiError && e.status < 500 && e.status !== 429
              ? "Save was rejected. Check the workspace before retrying."
              : "Outcome is uncertain. Retry the identical request with the same key.",
          );
          if (e instanceof ApiError && e.status === 400) setPending(undefined);
        }
      }}
    >
      <h3>{project ? "Edit project" : "New private project"}</h3>
      <fieldset disabled={busy || !!pending}>
        <label>
          Project name
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!project && (
          <>
            <label>
              Agreement
              <select
                value={agreement}
                onChange={(e) => {
                  setAgreement(e.target.value);
                  setDepartment(
                    workspace.departments.find(
                      (d) => d.agreementId === e.target.value,
                    )?.id ?? "",
                  );
                }}
              >
                {workspace.agreements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Department
              <select
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                {workspace.departments
                  .filter((d) => d.agreementId === agreement)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>A work order is optional and can be attached after creation.</p>
          </>
        )}
        <label>
          Planned hours
          <input
            type="number"
            min="0"
            max="1000000"
            step="0.05"
            required
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </label>
        <label>
          Plan basis
          <select
            value={basis}
            onChange={(e) => setBasis(e.target.value as "fixed" | "monthly")}
          >
            <option value="fixed">Lifetime</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        {project && (
          <>
            <label>
              Progress (%)
              <input
                type="number"
                min="0"
                max="100"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              />
            </label>
            <label>
              Optional work-order reference
              <input
                maxLength={120}
                value={wo}
                onChange={(e) => setWo(e.target.value)}
              />
            </label>
            <p>
              This reporting reference does not link or change QuickBooks
              records.
            </p>
          </>
        )}
      </fieldset>
      <div className="secure-toolbar">
        <button disabled={busy || !name.trim() || !department} type="submit">
          {pending ? "Retry same creation" : "Save project"}
        </button>
        <button type="button" disabled={busy || !!pending} onClick={cancel}>
          Cancel
        </button>
      </div>
      {pending && (
        <p>
          The creation key is held in memory until resolved. Keep this form open
          while retrying; after reloading, inspect projects before creating
          again.
        </p>
      )}
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
function AllocationForm({
  source,
  projects,
  busy,
  save,
}: {
  source: StaffSource;
  projects: StaffProject[];
  busy: boolean;
  save: (portions: Allocation[]) => Promise<void>;
}) {
  const [rows, setRows] = useState(
    source.portions.map((p) => ({ ...p, hours: String(p.seconds / 3600) })),
  );
  const [message, setMessage] = useState("");
  const seconds = rows.reduce(
    (n, p) => n + Math.round(Number(p.hours) * 3600),
    0,
  );
  return (
    <form
      className="secure-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setMessage("");
        try {
          await save(
            rows.map((p) => ({
              projectId: p.projectId,
              seconds: Math.round(Number(p.hours) * 3600),
              description: p.description,
            })),
          );
        } catch {
          setMessage(
            "Split was not confirmed. Refresh to reconcile before retrying.",
          );
        }
      }}
    >
      <p>
        {hours(source.seconds)} h recorded ·{" "}
        {hours(Math.max(0, source.seconds - seconds))} h remaining
        {seconds > source.seconds ? " — allocated hours exceed source" : ""}
      </p>
      {rows.map((p, i) => (
        <fieldset className="secure-split" key={i} disabled={busy}>
          <label>
            Project
            <select
              required
              value={p.projectId}
              onChange={(e) =>
                setRows((v) =>
                  v.map((x, j) =>
                    j === i ? { ...x, projectId: e.target.value } : x,
                  ),
                )
              }
            >
              {!projects.some((x) => x.id === p.projectId) && (
                <option value={p.projectId}>
                  {p.projectId || "Choose project"}
                </option>
              )}
              {projects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hours
            <input
              required
              type="number"
              min="0"
              step="0.001"
              value={p.hours}
              onChange={(e) =>
                setRows((v) =>
                  v.map((x, j) =>
                    j === i ? { ...x, hours: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <label>
            Reporting description
            <input
              maxLength={1000}
              value={p.description}
              onChange={(e) =>
                setRows((v) =>
                  v.map((x, j) =>
                    j === i ? { ...x, description: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <button
            type="button"
            onClick={() => setRows((v) => v.filter((_, j) => i !== j))}
          >
            Remove split
          </button>
        </fieldset>
      ))}
      <div className="secure-toolbar">
        <button
          disabled={busy || rows.length >= 10}
          type="button"
          onClick={() =>
            setRows((v) => [
              ...v,
              {
                projectId:
                  projects.find((p) => !v.some((x) => x.projectId === p.id))
                    ?.id ?? "",
                seconds: 0,
                hours: "0",
                description: "",
              },
            ])
          }
        >
          Add split
        </button>
        <button
          disabled={
            busy || seconds > source.seconds || rows.some((p) => !p.projectId)
          }
          type="submit"
        >
          Save reporting split
        </button>
      </div>
      {message && <p role="alert">{message}</p>}
    </form>
  );
}
