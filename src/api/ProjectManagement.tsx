import { ClipboardList, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Project, StaffProjectDetail, StaffProjectSummary } from "../projects/model";
import { deliveryDefaults, measureDelivery } from "../projects/delivery";
import type { DirectoryEntry } from "../projects/portfolio";
import { ApiError, type SecuredApiClient } from "./client";
import { ProjectTimelineFields } from "./ProjectTimelineFields";
import { projectStatus, reportDay, today } from "./dashboard-format";

function projectLocation(project: StaffProjectSummary, index: ReadonlyMap<string, StaffProjectSummary>) {
  const ancestors: string[] = [];
  const seen = new Set([project.id]);
  let parent = project.delivery?.parentId;
  while (parent && !seen.has(parent) && ancestors.length < 2) {
    const record = index.get(parent);
    if (!record) break;
    seen.add(parent);
    ancestors.unshift(record.name);
    parent = record.delivery?.parentId;
  }
  return ancestors;
}

export function ProjectManagement({ client, tenant, selected, projects, directory, onSelect, onSetup, onDirty, onDenied, onSaved }: {
  client: SecuredApiClient;
  tenant: string;
  selected?: string | null;
  projects: StaffProjectSummary[];
  directory?: DirectoryEntry[];
  onSelect: (project?: string) => void;
  onSetup: (id: string) => void;
  onDirty: (dirty: boolean) => void;
  onDenied: () => void;
  onSaved: () => void;
}) {
  const [search, setSearch] = useState("");
  const index = new Map(projects.map(project => [project.id, project]));
  const filtered = projects.map(project => ({ project, ancestors: projectLocation(project, index) }))
    .filter(({ project, ancestors }) => [...ancestors, project.name].join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => [...a.ancestors, a.project.name].join().localeCompare([...b.ancestors, b.project.name].join()));
  const title = selected ? index.get(selected)?.name : undefined;
  const path = selected && index.has(selected) ? projectLocation(index.get(selected)!, index) : [];
  return <section className="mi-project-management" aria-label="Project management">
    <div className="mi-management-picker">
      <label>Find a project<input type="search" value={search} onChange={event => setSearch(event.target.value)}
        placeholder="Engagement, service area or project" /></label>
      <label>Selected project<select value={selected ?? ""} onChange={event => onSelect(event.target.value || undefined)}>
        <option value="">Choose a project</option>
        {selected && !filtered.some(item => item.project.id === selected) && <option value={selected}>{title ?? "Selected project"}</option>}
        {filtered.map(({ project, ancestors }) => <option key={project.id} value={project.id}>{[...ancestors, project.name].join(" / ")}</option>)}
      </select></label>
    </div>
    {selected ? <ProgressEditor key={selected} id={selected} path={path} client={client} tenant={tenant} people={directory}
      onSetup={onSetup} onDirty={onDirty} onDenied={onDenied} onSaved={onSaved} /> :
      <div className="mi-management-empty"><ClipboardList aria-hidden="true" size={30} /><h3>Choose a project to manage delivery</h3>
        <p>Review milestones, update blockers and save progress in one place.</p></div>}
  </section>;
}

function ProgressEditor({ id, path, client, tenant, people, onSetup, onDirty, onDenied, onSaved }: {
  id: string; path: string[]; client: SecuredApiClient; tenant: string; people?: DirectoryEntry[];
  onSetup: (id: string) => void; onDirty: (dirty: boolean) => void; onDenied: () => void; onSaved: () => void;
}) {
  const [detail, setDetail] = useState<StaffProjectDetail>();
  const [updates, setUpdates] = useState<NonNullable<Project["updates"]>>([]);
  const [milestones, setMilestones] = useState<NonNullable<Project["milestones"]>>([]);
  const [status, setStatus] = useState<Project["status"]>("planned");
  const [blocker, setBlocker] = useState({ active: false, message: "", internal: "" });
  const [manual, setManual] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const attempted = useRef<AbortController | undefined>(undefined);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  function hydrate(value: StaffProjectDetail) {
    const p = value.project;
    setDetail(value); setMilestones(p.milestones ?? []); setUpdates(p.updates ?? []); setStatus(p.status);
    setBlocker(p.delivery?.blocker ?? { active: false, message: "", internal: "" });
    setManual(p.delivery?.manualCompletion === undefined ? "" : String(p.delivery.manualCompletion));
  }
  useEffect(() => {
    const abort = new AbortController();
    client.call<StaffProjectDetail>(tenant, "projects/" + id, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) hydrate(result); })
      .catch(reason => {
        if (abort.signal.aborted) return;
        if (reason instanceof ApiError && reason.status === 401) denied.current();
        else setError(reason instanceof Error ? reason.message : "Could not open this project.");
      });
    return () => { abort.abort(); attempted.current?.abort(); };
  }, [client, tenant, id]);

  const updatedBlocker = blocker.active || blocker.message.trim() || blocker.internal.trim() ? blocker : undefined;
  const project = detail?.project;
  const currentDelivery = project?.delivery;
  const hasDeliveryEdits = currentDelivery || updatedBlocker || manual !== "";
  const delivery = hasDeliveryEdits ? { ...(currentDelivery ?? deliveryDefaults), blocker: updatedBlocker,
    manualCompletion: manual === "" ? undefined : Number(manual) } : undefined;
  const dirty = Boolean(project && (status !== project.status || JSON.stringify(project.milestones ?? []) !== JSON.stringify(milestones) ||
    JSON.stringify(project.updates ?? []) !== JSON.stringify(updates) ||
    JSON.stringify(currentDelivery?.blocker) !== JSON.stringify(updatedBlocker) ||
    currentDelivery?.manualCompletion !== delivery?.manualCompletion));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  async function save(nextStatus = status) {
    if (!detail || !project || locked.current) return;
    if (manual !== "" && (!Number.isInteger(Number(manual)) || Number(manual) < 0 || Number(manual) > 100)) {
      setError("Enter a whole percentage from 0 to 100.");
      return;
    }
    if (blocker.active && !blocker.message.trim()) {
      setError("Add a client-facing message for this blocker.");
      return;
    }
    locked.current = true;
    setBusy(true); setError(""); setNotice("");
    const request = new AbortController();
    attempted.current = request;
    try {
      const { name, description, internalNotes, plan, workOrderReference, progress } = project;
      const route = "projects/" + id;
      const result = await client.call<{ revision: number }>(tenant, route, { method: "PATCH", signal: request.signal,
        body: { expectedRevision: detail.revision, patch: { name, description, internalNotes, plan, workOrderReference,
          progress, status: nextStatus, updates, milestones, delivery } } });
      if (request.signal.aborted) return;
      hydrate({ ...detail, revision: result.revision, project: { ...project, status: nextStatus, updates, milestones, delivery } });
      setNotice(project.published ? "Progress saved to the draft. Publish changes in project setup when approved." : "Progress saved.");
      onSaved();
    } catch (reason) {
      if (request.signal.aborted) return;
      if (reason instanceof ApiError && reason.status === 401) onDenied();
      else setError(reason instanceof ApiError && reason.status === 409
        ? "This project changed while you were editing. Your inputs are still here. Reopen the project to load the current version."
        : reason instanceof Error ? reason.message : "Could not save this project.");
    } finally {
      locked.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  if (!project) return <p role={error ? "alert" : "status"}>{error || "Opening project progress…"}</p>;
  const completion = measureDelivery({ progress: project.progress, status, milestones, delivery },
    { monthly: 0, lifetime: 0 }, today()).completion;
  const ended = ["closed", "completed", "cancelled"].includes(status);
  return <form className="mi-progress-editor secure-form" aria-label="Delivery progress" onSubmit={event => { event.preventDefault(); void save(); }}>
    <header>
      {!!path.length && <p className="mi-kicker">{path.join(" / ")}</p>}
      <h3>{project.name}</h3>
      <div className="secure-actions"><p className="secure-badge" data-status={status}>{projectStatus[status]}</p>
        <button type="button" className="secure-secondary" onClick={() => onSetup(id)}>Open project setup</button></div>
    </header>
    <div className="mi-progress-summary">
      <b>{completion === undefined ? "No progress recorded" : completion + "% complete"}</b>
      {completion !== undefined && <progress max={100} value={completion} aria-label="Delivery completion" />}
      <span>{milestones.filter(milestone => milestone.completed).length} of {milestones.length} milestones complete</span>
      {currentDelivery?.deadline && <span>Target {reportDay(currentDelivery.deadline)}</span>}
    </div>
    <fieldset className="mi-progress-fields" disabled={busy}>
      <label>Delivery status<select value={status} onChange={event => setStatus(event.target.value as Project["status"])}>
        {Object.entries(projectStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {!milestones.some(milestone => milestone.status !== "waived") && <label>Manual progress (%)<input type="number" min={0} max={100} value={manual}
        onChange={event => setManual(event.target.value)} /></label>}
      <label className="mi-blocker-toggle"><input type="checkbox" checked={blocker.active}
        onChange={event => setBlocker({ ...blocker, active: event.target.checked })} /> <ShieldAlert size={17} aria-hidden="true" /> Active blocker</label>
      {(blocker.active || blocker.message || blocker.internal) && <>
        <label>Client-facing blocker message<textarea maxLength={500} value={blocker.message} onChange={event => setBlocker({ ...blocker, message: event.target.value })} /></label>
        <label>Private blocker note<textarea maxLength={2000} value={blocker.internal} onChange={event => setBlocker({ ...blocker, internal: event.target.value })} /></label>
      </>}
    </fieldset>
    <ProjectTimelineFields updates={updates} milestones={milestones} setUpdates={setUpdates} setMilestones={setMilestones} disabled={busy} people={people} />
    {error && <p role="alert" className="secure-message secure-error">{error}</p>}
    {notice && <p role="status" className="secure-message">{notice}</p>}
    <div className="secure-actions">
      <button type="submit" disabled={busy || !dirty}>{busy ? "Saving progress…" : "Save Progress"}</button>
      {(ended ? [{ value: "active", label: "Reopen delivery" }] :
        [{ value: "completed", label: "Complete delivery" }, { value: "closed", label: "Close delivery" }]).map(action =>
        <button type="button" className="secure-secondary" key={action.value} disabled={busy || dirty}
          onClick={() => { if (window.confirm(action.label + " for " + project.name + "?")) void save(action.value as Project["status"]); }}>{action.label}</button>)}
    </div>
  </form>;
}
