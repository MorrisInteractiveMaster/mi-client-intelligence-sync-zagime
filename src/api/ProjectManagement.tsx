import { ManagementDialog } from "./ManagementDialog";
import { Check, ClipboardList, ShieldAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { deliveryDefaults, measureDelivery, type Delivery } from "../projects/delivery";
import { milestoneTemplates } from "../projects/milestone-templates";
import {
  MAX_PROJECT_MILESTONES, MAX_PROJECT_TIMELINE_ITEMS, MAX_PROJECT_UPDATE_TEXT,
  type Project, type ProjectMilestone, type StaffProjectDetail, type StaffProjectSummary,
} from "../projects/model";
import type { ServiceArea } from "../projects/portfolio";
import { CalendarPicker } from "./CalendarPicker";
import { ApiError, type SecuredApiClient } from "./client";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { SearchableCombobox } from "./SearchableCombobox";
import { SortControls, useSortedRows } from "./SortHeader";
import "./project-management.css";

function departmentName(areaId: string | undefined, areas?: ServiceArea[]) {
  return areas?.find(area => area.id === areaId)?.name;
}

function projectLocation(project: StaffProjectSummary, index: ReadonlyMap<string, StaffProjectSummary>, areas?: ServiceArea[]) {
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
  const department = departmentName(project.delivery?.areaId ?? project.reportPreview?.placement?.areaId, areas);
  if (department && !ancestors.includes(department)) ancestors.push(department);
  return ancestors;
}

function isMiscellaneous(areaId: string | undefined, areas?: ServiceArea[]) {
  return [areaId, departmentName(areaId, areas)].some(value => /^misc(?:ellaneous)?\.?$/i.test(value?.trim() ?? ""));
}

export function ProjectManagement({ client, tenant, selected, projects, areas, canPublish, onSelect, onSetup, onDirty, onDenied, onSaved }: {
  client: SecuredApiClient;
  tenant: string;
  selected?: string | null;
  projects: StaffProjectSummary[];
  areas?: ServiceArea[];
  canPublish: boolean;
  onSelect: (project?: string) => void;
  onSetup: (id: string) => void;
  onDirty: (dirty: boolean) => void;
  onDenied: () => void;
  onSaved: () => void;
}) {
  const index = new Map(projects.map(project => [project.id, project]));
  const summary = selected ? index.get(selected) : undefined;
  const path = summary ? projectLocation(summary, index, areas) : [];
  const sorted = useSortedRows<StaffProjectSummary, "name" | "location" | "workOrder" | "status">(projects, { key: "name", direction: "asc" },
    (project, field) => ({ name: project.name, location: projectLocation(project, index, areas).join(" / "),
      workOrder: project.workOrderReference, status: projectStatus[project.status] })[field], project => project.id);
  const options = sorted.rows.map(project => {
    const reference = project.workOrderReference;
    const ancestors = projectLocation(project, index, areas);
    return { value: project.id, label: project.name, detail: [...ancestors, reference].filter(Boolean).join(" / "),
      search: project.delivery?.workOrderIds?.join(" ") };
  });
  return <section className="mi-project-management" aria-label="Project management">
    <div className="mi-management-search">
      <SearchableCombobox label="Find a project" value={selected ?? ""} options={options}
        placeholder="Search by project, parent, department or work order"
        onChange={value => onSelect(value || undefined)} />
      {options.length > 1 && <SortControls fields={{ name: "Name", location: "Parent and department", workOrder: "Work order", status: "Status" }}
        sort={sorted.sort} onSort={sorted.setSort} label="Sort project choices" />}
    </div>
    {Boolean(summary?.pendingMappedEffort?.monthly) && <p>{reportHours(summary!.pendingMappedEffort!.monthly)} h automatically classified and awaiting approval in the selected month.</p>}
    {selected ? <ProgressEditor key={selected} id={selected} path={path} client={client} tenant={tenant} areas={areas}
      legacyArea={summary?.reportPreview?.placement?.areaId}
      canPublish={canPublish} onSetup={onSetup} onDirty={onDirty} onDenied={onDenied} onSaved={onSaved} /> :
      <div className="mi-project-management-empty"><ClipboardList aria-hidden="true" size={28} />
        <h3>Choose a project to manage delivery</h3><p>Update progress, milestones and client-facing notes in one place.</p>
      </div>}
  </section>;
}

type PendingAction = { type: "project-completed" | "project-blocked" | "publish" } |
  { type: "milestone-completed" | "milestone-blocked"; milestone: ProjectMilestone };
const emptyBlocker = { active: false, message: "", internal: "" };

function ProgressEditor({ id, path, client, tenant, areas, legacyArea, canPublish, onSetup, onDirty, onDenied, onSaved }: {
  id: string; path: string[]; client: SecuredApiClient; tenant: string; areas?: ServiceArea[]; legacyArea?: string; canPublish: boolean;
  onSetup: (id: string) => void; onDirty: (dirty: boolean) => void; onDenied: () => void; onSaved: () => void;
}) {
  const [detail, setDetail] = useState<StaffProjectDetail>();
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [status, setStatus] = useState<Project["status"]>("planned");
  const [blocker, setBlocker] = useState<NonNullable<Delivery["blocker"]>>(emptyBlocker);
  const [disclosure, setDisclosure] = useState<Pick<Delivery, "publishSummary" | "publishStartStatus">>({});
  const [manual, setManual] = useState<number>();
  const [completedOn, setCompletedOn] = useState("");
  const [rangePreview, setRangePreview] = useState<number>();
  const [projectUpdate, setProjectUpdate] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [action, setAction] = useState<PendingAction>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dragging = useRef(false);
  const locked = useRef(false);
  const attempted = useRef<AbortController | undefined>(undefined);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  const rangeId = useId();
  function hydrate(value: StaffProjectDetail) {
    const p = value.project;
    setDetail(value);
    setMilestones(p.milestones ?? []);
    setStatus(p.status);
    setBlocker(p.delivery?.blocker ?? emptyBlocker);
    setDisclosure({ publishSummary: p.delivery?.publishSummary, publishStartStatus: p.delivery?.publishStartStatus });
    setManual(p.delivery?.manualCompletion);
    setCompletedOn(p.delivery?.completedOn ?? "");
    setPrivateNotes(p.internalNotes);
    setProjectUpdate("");
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

  const updatedBlocker = blocker.active || blocker.message || blocker.internal || blocker.resolvedOn ? blocker : undefined;
  const project = detail?.project;
  const updates = project?.updates ?? [];
  const currentDelivery = project?.delivery;
  const delivery = currentDelivery || updatedBlocker || manual !== undefined || completedOn
    ? { ...(currentDelivery ?? deliveryDefaults), ...disclosure, blocker: updatedBlocker, manualCompletion: manual, completedOn: completedOn || undefined }
    : undefined;
  const dirty = Boolean(project && (status !== project.status || JSON.stringify(project.milestones ?? []) !== JSON.stringify(milestones) ||
    projectUpdate.trim() || project.internalNotes !== privateNotes ||
    JSON.stringify(currentDelivery?.blocker) !== JSON.stringify(updatedBlocker) ||
    currentDelivery?.publishSummary !== disclosure.publishSummary || currentDelivery?.publishStartStatus !== disclosure.publishStartStatus ||
    currentDelivery?.manualCompletion !== manual || (currentDelivery?.completedOn ?? "") !== completedOn));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  function updateMilestone(milestone: ProjectMilestone, change: Partial<ProjectMilestone>) {
    setMilestones(items => items.map(item => item.id === milestone.id ? { ...item, ...change } : item));
    setNotice("Milestone updated. Save to keep the change.");
  }
  function chooseProgress(value: number) {
    setRangePreview(undefined);
    if (value === 100) setAction({ type: "project-completed" });
    else {
      setManual(value);
      if (status === "completed") { setStatus("active"); setCompletedOn(""); }
    }
  }

  async function save(publish: boolean) {
    if (!detail || !project || locked.current || (publish && !canPublish)) return;
    const body = projectUpdate.trim();
    if (body && updates.length >= MAX_PROJECT_TIMELINE_ITEMS) {
      setError("This project has reached its update limit.");
      return;
    }
    const nextUpdates = body ? [...updates, { id: crypto.randomUUID(), title: "Project update", body, date: today(), visible: true }] : updates;
    locked.current = true;
    setBusy(true); setError(""); setNotice("");
    const request = new AbortController();
    attempted.current = request;
    try {
      const { name, description, plan, workOrderReference, progress } = project;
      const route = "projects/" + id;
      const result = await client.call<Pick<StaffProjectDetail, "revision" | "draft">>(tenant, route, { method: "PATCH", signal: request.signal,
        body: { expectedRevision: detail.revision, publish, patch: { name, description, internalNotes: privateNotes, plan, workOrderReference,
          ...(project.updates || body ? { updates: nextUpdates } : {}),
          ...(project.milestones || milestones.length ? { milestones } : {}),
          progress, status, delivery } } });
      if (request.signal.aborted) return;
      hydrate({ revision: result.revision, draft: result.draft, project: { ...project, status, internalNotes: privateNotes,
        published: publish || project.published, updates: nextUpdates, milestones, delivery } });
      setNotice(publish ? "Project changes published." : "Draft saved.");
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
  const misc = isMiscellaneous(currentDelivery?.areaId ?? legacyArea, areas);
  const progress = rangePreview ?? manual ?? (!currentDelivery && project.progress > 0 ? Math.round(project.progress) : undefined);
  const measure = measureDelivery({ progress: project.progress, status, milestones, delivery }, { monthly: 0, lifetime: 0 }, today());
  return <form className="mi-management-editor secure-form" aria-label="Delivery progress"
    onSubmit={event => { event.preventDefault(); void save(false); }}>
    <header className="mi-management-heading">
      <div>{!!path.length && <p className="mi-management-path">{path.join(" / ")}</p>}
        <p className="mi-management-subtitle">{project.workOrderReference && project.workOrderReference + " · "}
          {project.published ? (detail?.draft ? "Published · Draft changes" : "Published") : "Private project"}</p>
      </div>
      <button type="button" className="secure-secondary" onClick={() => onSetup(id)}>Project setup</button>
    </header>
    <section className="mi-management-progress" aria-labelledby={rangeId + "-section"}>
      <div className="mi-management-heading">
        <div><h4 id={rangeId + "-section"}>Work completion</h4><p>Set your assessment of total work completed.</p></div>
        <output htmlFor={rangeId} className="mi-manual-progress-value">{progress === undefined ? "Not set" : progress + "%"}</output>
      </div>
      <input type="range" id={rangeId} min={0} max={100} step={1} value={progress ?? 0} disabled={busy}
        aria-label="Project completion" aria-valuetext={progress === undefined ? "No completion recorded" : progress + " percent"}
        style={{ "--mi-progress": (progress ?? 0) + "%" } as CSSProperties}
        onPointerDown={() => { dragging.current = true; }}
        onPointerCancel={() => { dragging.current = false; setRangePreview(undefined); }}
        onPointerUp={event => {
          dragging.current = false;
          const value = Number(event.currentTarget.value);
          if (value !== manual) chooseProgress(value);
        }}
        onChange={event => {
          const percentage = Number(event.target.value);
          if (dragging.current) setRangePreview(percentage);
          else chooseProgress(percentage);
        }} />
      <div className="mi-completion-presets" aria-label="Quick completion percentages">
        {[25, 50, 75, 100].map(value => <button type="button" className="secure-secondary" aria-pressed={manual === value}
          disabled={busy} key={value} onClick={() => chooseProgress(value)}>{value}%</button>)}
      </div>
      <div className="mi-progress-facts">
        <label>Delivery status<select value={status} disabled={busy} onChange={event => {
          const value = event.target.value as Project["status"];
          if (value === "completed") setAction({ type: "project-completed" });
          else {
            if (status === "completed") { setCompletedOn(""); if (manual === 100) setManual(undefined); }
            setStatus(value);
          }
        }}>
          {Object.entries(projectStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        {!misc && <div><strong>Milestone completion</strong><p>{measure.milestoneCompletion === undefined
          ? "No milestones set" : measure.milestoneCompletion + "% · " + milestones.filter(item => item.completed).length + " complete"}</p></div>}
        {completedOn && <div><strong>Completed</strong><p>{reportDay(completedOn)}</p></div>}
        {currentDelivery?.deadline && <div><strong>Target date</strong><p>{reportDay(currentDelivery.deadline)}</p></div>}
      </div>
    </section>
    <section className="mi-management-blocker" data-blocked={blocker.active} aria-label="Project blocker">
      <div><h4>{blocker.active ? <><ShieldAlert size={19} aria-hidden="true" /> Project blocked</> : "Project blocker"}</h4>
        {blocker.message && <p>{blocker.message}</p>}
        {blocker.resolvedOn && <p>Resolved {reportDay(blocker.resolvedOn)}</p>}
        {blocker.internal && <details><summary>Private blocker note</summary><p>{blocker.internal}</p></details>}
      </div>
      {blocker.active ? <button type="button" className="secure-secondary" disabled={busy}
        onClick={() => setBlocker({ ...blocker, active: false, resolvedOn: today() })}>Resolve blocker</button> :
        <button type="button" className="secure-secondary mi-blocker-toggle" disabled={busy} onClick={() => setAction({ type: "project-blocked" })}><ShieldAlert size={17} aria-hidden="true" /> Report blocker</button>}
    </section>
    {currentDelivery && canPublish && <details className="mi-publication-settings"><summary>Client visibility settings</summary>
      <p>Changes remain private until they are published.</p>
      <label><input type="checkbox" checked={disclosure.publishSummary ?? false} disabled={busy}
        onChange={event => setDisclosure(value => ({ ...value, publishSummary: event.target.checked }))} /> Publish schedule dates and hour caps</label>
      <label><input type="checkbox" checked={disclosure.publishStartStatus ?? false} disabled={busy}
        onChange={event => setDisclosure(value => ({ ...value, publishStartStatus: event.target.checked }))} /> Publish the delivery phase when the start date is private</label>
    </details>}
    {!misc && <section className="mi-management-checklist" aria-label="Milestones">
      <div className="mi-management-heading"><div><h4>Milestones</h4><p>Check off delivery steps and flag blocked work.</p></div></div>
      {milestones.length ? <ul>
        {milestones.map(milestone => <li key={milestone.id} data-blocked={milestone.status === "blocked"}>
          <label className="mi-milestone-check"><input type="checkbox" checked={milestone.completed} disabled={busy} onChange={event => {
            if (event.target.checked) setAction({ type: "milestone-completed", milestone });
            else updateMilestone(milestone, { status: "not-started", completed: false, completedAt: undefined });
          }} /><span>{milestone.title}</span></label>
          <div className="mi-milestone-actions">
            {milestone.status === "blocked"
              ? <button type="button" className="secure-secondary" disabled={busy} onClick={() =>
                updateMilestone(milestone, { status: "in-progress", blocker: milestone.blocker && {
                  ...milestone.blocker, resolvedOn: today(),
                } })}>Resolve blocker</button>
              : !milestone.completed && <button type="button" className="secure-secondary" disabled={busy}
                onClick={() => setAction({ type: "milestone-blocked", milestone })}>Block</button>}
          </div>
          {(milestone.body || milestone.blocker || milestone.completedAt || milestone.status === "blocked") &&
            <div className="mi-milestone-detail">
              {milestone.status === "blocked" && <b><ShieldAlert size={15} aria-hidden="true" /> Blocked</b>}
              {milestone.completedAt && <p><Check size={15} aria-hidden="true" /> Completed {reportDay(milestone.completedAt)}</p>}
              {milestone.body && <p>{milestone.body}</p>}
              {milestone.blocker && <p>{milestone.blocker.message}
                {milestone.blocker.resolvedOn && " · Resolved " + reportDay(milestone.blocker.resolvedOn)}</p>}
              {milestone.blocker?.internal && <details><summary>Private blocker note</summary><p>{milestone.blocker.internal}</p></details>}
            </div>}
        </li>)}
      </ul> : <p>No milestones yet.</p>}
      <MilestoneAdd existing={milestones} disabled={busy} onAdd={newItems => {
        setMilestones([...milestones, ...newItems]); setNotice("Milestones added to this edit. Save to keep the changes.");
      }} />
    </section>}
    <section className="mi-management-notes" aria-label="Project communications">
      <h4>Project communications</h4>
      <label>Project Update<textarea maxLength={MAX_PROJECT_UPDATE_TEXT} rows={3} value={projectUpdate} disabled={busy || updates.length >= MAX_PROJECT_TIMELINE_ITEMS}
        onChange={event => setProjectUpdate(event.target.value)} placeholder="Share a concise update about the work" /></label>
      <p>Authorized clients can see project updates after publication.</p>
      {updates.length >= MAX_PROJECT_TIMELINE_ITEMS && <p>All {MAX_PROJECT_TIMELINE_ITEMS} project update slots are in use.</p>}
      {updates.length > 0 && <details><summary>Previous updates ({updates.length})</summary>
        <ul>{updates.slice().reverse().map(update => <li key={update.id}><span>{reportDay(update.date)}{!update.visible && " · Private"}</span>
          <p>{update.body}</p></li>)}</ul>
      </details>}
      <details><summary>Private staff notes</summary>
        <label>Staff notes<textarea maxLength={4000} value={privateNotes} disabled={busy}
          onChange={event => setPrivateNotes(event.target.value)} /></label>
      </details>
    </section>
    {error && <p role="alert" className="secure-message secure-error">{error}</p>}
    {notice && <p role="status" className="secure-message">{notice}</p>}
    <div className="mi-management-save">
      <button type="submit" className={canPublish ? "secure-secondary" : undefined} disabled={busy || !dirty}>{busy ? "Saving…" : "Save Draft"}</button>
      {canPublish && <button type="button" disabled={busy || !(dirty || detail?.draft || !project.published)}
        onClick={() => setAction({ type: "publish" })}>Save &amp; Publish</button>}
      {dirty && <span>Unsaved changes</span>}
    </div>
    {action && <ManagementAction key={action.type} action={action} close={() => setAction(undefined)}
      defaultDate={action.type === "project-completed" && completedOn ? completedOn : today()}
      onComplete={date => {
        if (action.type === "project-completed") {
          setManual(100); setStatus("completed"); setCompletedOn(date); setNotice("Completion confirmed. Save to keep the change.");
        } else if (action.type === "milestone-completed") {
          const milestone = action.milestone;
          updateMilestone(milestone, { completed: true, status: "completed", completedAt: date,
            blocker: milestone.blocker && { ...milestone.blocker, resolvedOn: milestone.blocker.resolvedOn ?? today() } });
        }
      }} onBlock={(message, internal) => {
        if (action.type === "project-blocked") setBlocker({ active: true, message, internal });
        else if (action.type === "milestone-blocked") updateMilestone(action.milestone, {
          status: "blocked", completed: false, completedAt: undefined,
          blocker: { message, internal, blockedOn: today() },
        });
      }} onPublish={() => { void save(true); }} />}
  </form>;
}

function MilestoneAdd({ existing, disabled, onAdd }: {
  existing: ProjectMilestone[]; disabled: boolean; onAdd: (items: ProjectMilestone[]) => void;
}) {
  const [template, setTemplate] = useState<keyof typeof milestoneTemplates>("General delivery");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [customTitle, setCustomTitle] = useState("");
  const [customNote, setCustomNote] = useState("");
  const templateItems = milestoneTemplates[template].filter(title => !existing.some(item => item.title === title));
  const titles = Object.entries(selected);
  const count = titles.length + Number(Boolean(customTitle.trim()));
  return <details className="mi-add-milestones">
    <summary>Add milestones</summary>
    <label>Template<select value={template} disabled={disabled} onChange={event => setTemplate(event.target.value as keyof typeof milestoneTemplates)}>
      {Object.keys(milestoneTemplates).map(name => <option key={name}>{name}</option>)}
    </select></label>
    <fieldset disabled={disabled} className="mi-template-choices"><legend>Choose milestones</legend>
      {templateItems.map(title => <div key={title}>
        <label className="mi-milestone-check"><input type="checkbox" checked={Object.hasOwn(selected, title)} onChange={event => {
          if (event.target.checked) setSelected({ ...selected, [title]: "" });
          else { const next = { ...selected }; delete next[title]; setSelected(next); }
        }} />{title}</label>
        {Object.hasOwn(selected, title) && <input aria-label={title + " optional note"} maxLength={MAX_PROJECT_UPDATE_TEXT}
          placeholder="Optional note" value={selected[title]} onChange={event => setSelected({ ...selected, [title]: event.target.value })} />}
      </div>)}
      {!templateItems.length && <p>All milestones from this template are already on the project.</p>}
    </fieldset>
    <label>Custom milestone title<input maxLength={120} value={customTitle} disabled={disabled} onChange={event => setCustomTitle(event.target.value)} /></label>
    {customTitle.trim() && <label>Optional milestone note<input maxLength={MAX_PROJECT_UPDATE_TEXT} value={customNote}
      disabled={disabled} onChange={event => setCustomNote(event.target.value)} /></label>}
    <button type="button" className="secure-secondary" disabled={disabled || !count || count + existing.length > MAX_PROJECT_MILESTONES}
      onClick={() => {
        const additions = customTitle.trim() ? [...titles, [customTitle.trim(), customNote]] : titles;
        onAdd(additions.map(([title, body]) => ({ id: crypto.randomUUID(), title, date: "", visible: true,
          status: "not-started", completed: false, ...(body.trim() && { body: body.trim() }) })));
        setSelected({}); setCustomTitle(""); setCustomNote("");
      }}>Add selected milestones{count ? " (" + count + ")" : ""}</button>
    {count + existing.length > MAX_PROJECT_MILESTONES && <p role="status">A project can have up to {MAX_PROJECT_MILESTONES} milestones.</p>}
  </details>;
}

function ManagementAction({ action, close, defaultDate, onComplete, onBlock, onPublish }: {
  action: PendingAction; close: () => void; defaultDate: string; onComplete: (date: string) => void;
  onBlock: (message: string, internal: string) => void; onPublish: () => void;
}) {
  const completion = action.type === "project-completed" || action.type === "milestone-completed";
  const publish = action.type === "publish";
  const [date, setDate] = useState(defaultDate);
  const [message, setMessage] = useState("");
  const [internal, setInternal] = useState("");
  const title = action.type === "project-completed" ? "Confirm Project Completion" : action.type === "milestone-completed"
    ? "Complete milestone" : publish ? "Publish project changes?" : "Report blocker";
  return <ManagementDialog title={title} close={close}>
    {"milestone" in action && <p>{action.milestone.title}</p>}
    {completion ? <CalendarPicker label="Completion date" required max={today()} value={date} onChange={setDate} />
      : publish ? <p>Authorized clients will see the project and its current client-facing updates, milestones and blockers.</p>
      : <><label>Client-facing explanation<textarea rows={3} maxLength={MAX_PROJECT_UPDATE_TEXT}
          placeholder="What is preventing progress?" value={message} onChange={event => setMessage(event.target.value)} /></label>
        <label>Private blocker details (optional)<textarea rows={3} maxLength={2000} value={internal}
          onChange={event => setInternal(event.target.value)} /></label></>}
    <footer>
      <button type="button" className="secure-secondary" onClick={close}>Cancel</button>
      <button type="button" className="secure-secondary mi-picker-primary" disabled={completion ? !date : !publish && !message.trim()}
        onClick={() => {
          if (completion) onComplete(date);
          else if (publish) onPublish();
          else onBlock(message.trim(), internal.trim());
          close();
        }}>{publish ? "Publish" : "Confirm"}</button>
    </footer>
  </ManagementDialog>;
}
