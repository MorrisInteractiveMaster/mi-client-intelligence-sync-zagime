import { useEffect, useRef, useState } from "react";
import type { ProjectPage, StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import type { Allocation } from "../reporting/model";
import { ApiError, type SecuredApiClient } from "./client";
import { reportDay, reportHours, reportTimestamp } from "./dashboard-format";
import type { AllocationAnnotations, HistoryRow, StaffSource } from "./types";

const blank = { reportingDescription: "", internalNote: "" };
const statusOf = (source: StaffSource) => source.deleted ? "Deleted" : source.needsReview || source.conflict ? "Review required"
  : !source.seconds || !source.unallocatedSeconds ? "Allocated" : source.unallocatedSeconds === source.seconds ? "Unallocated" : "Partially allocated";

export function TimeAllocation({ client, tenant, month, projects, portfolio, onDenied, onSaved }: {
  client: SecuredApiClient; tenant: string; month: string; projects: StaffProjectSummary[]; portfolio?: Portfolio;
  onDenied: () => void; onSaved: () => void;
}) {
  const [rows, setRows] = useState<StaffSource[]>();
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [workOrder, setWorkOrder] = useState("");
  const [consultant, setConsultant] = useState("");
  const [area, setArea] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkProject, setBulkProject] = useState("");
  const [editor, setEditor] = useState<StaffSource>();
  const [portions, setPortions] = useState<Allocation[]>([]);
  const [annotations, setAnnotations] = useState<AllocationAnnotations>(blank);
  const [projectSearch, setProjectSearch] = useState("");
  const [parent, setParent] = useState("");
  const [classification, setClassification] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [undo, setUndo] = useState<{ source: StaffSource; revision: number }>();
  const editButton = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const idIndex = new Map(projects.map(project => [project.id, project]));
  const placements = new Map(portfolio?.placements.map(placement => [placement.id, placement]));
  const resolvedArea = (id: string) => idIndex.get(id)?.delivery?.areaId ?? placements.get(id)?.areaId ?? "";
  const resolvedParent = (id: string) => idIndex.get(id)?.delivery?.parentId ?? "";
  const areaLabel = (id: string) => portfolio?.areas.find(item => item.id === id)?.name ?? "Unclassified";
  const projectName = (id: string) => idIndex.get(id)?.name ?? "Assigned project";
  const failed = (e: unknown) => {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onDenied();
    setError(e instanceof Error ? e.message : "The request could not be completed.");
  };
  async function load(next?: string, all = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      let position = next;
      let pageRevision = 0;
      const collected: StaffSource[] = [];
      do {
        const query = new URLSearchParams({ month, limit: "25", ...(position ? { cursor: position } : {}) });
        const page = await client.call<ProjectPage>(tenant, "sources?" + query, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (pageRevision && page.revision !== pageRevision) throw Error("The time list changed. Reload the month before editing.");
        pageRevision = page.revision;
        collected.push(...(page.sources ?? []));
        position = page.nextCursor;
      } while (all && position && collected.length < 500);
      setRevision(pageRevision);
      setRows(old => next ? [...(old ?? []), ...collected] : collected);
      setCursor(position);
      if (!next) setSelected([]);
    } catch (e) { if (!controller.signal.aborted) failed(e); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => { void load(); return () => request.current?.abort(); }, [client, tenant, month]);
  useEffect(() => { if (editor) heading.current?.focus(); }, [editor?.id]);
  function edit(source: StaffSource) {
    editButton.current = document.activeElement as HTMLElement;
    setEditor(source);
    setPortions(source.portions);
    setAnnotations(source.annotations ?? blank);
    setHistory(undefined);
    setHistoryCursor(undefined);
    setProjectSearch("");
    setParent(source.annotations?.parentId ?? "");
    setClassification(source.annotations?.areaId ?? "");
  }
  function close() { setEditor(undefined); editButton.current?.focus(); }
  const searchKey = search.trim().toLowerCase();
  const filtered = (rows ?? []).filter(source => {
    const searchable = [source.workOrderName, source.sourceWorkOrderId, source.description, source.annotations?.reportingDescription,
      source.sourcePersonId, ...source.portions.map(p => projectName(p.projectId))].join(" ").toLowerCase();
    return (!searchKey || searchable.includes(searchKey)) && (!workOrder || source.sourceWorkOrderId === workOrder) &&
      (!consultant || source.sourcePersonId === consultant) &&
      (!status || (status === "queue" ? source.unallocatedSeconds > 0 : statusOf(source) === status)) &&
      (!area || source.annotations?.areaId === area || source.portions.some(p => resolvedArea(p.projectId) === area)) &&
      (!projectFilter || source.portions.some(p => p.projectId === projectFilter)) &&
      (!from || source.date >= from) && (!through || source.date <= through);
  });
  const remaining = editor ? editor.seconds - portions.reduce((sum, part) => sum + part.seconds, 0) : 0;
  const selectedRows = (rows ?? []).filter(source => selected.includes(source.id));
  const canBulk = selectedRows.length > 0 && selectedRows.length <= 25 && bulkProject &&
    selectedRows.every(source => source.seconds > 0 && !source.conflict && !source.needsReview && !source.portions.length);
  async function write(source: StaffSource, expected: number, parts: Allocation[], notes: AllocationAnnotations) {
    return client.call<{ revision: number; changed: boolean }>(tenant, "allocations/" + source.id, {
      method: "PATCH", body: { expectedRevision: expected, expectedSourceRevision: source.sourceRevision, portions: parts, annotations: notes },
    });
  }
  async function save(source: StaffSource, parts: Allocation[], notes: AllocationAnnotations, expected = revision, allowUndo = true) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await write(source, expected, parts, notes);
      setUndo(result.changed && allowUndo && !source.needsReview ? { source, revision: result.revision } : undefined);
      setNotice(result.changed ? allowUndo ? "Allocation saved." : "Previous allocation restored." : "No changes to save.");
      close(); onSaved(); await load();
    } catch (e) { failed(e); }
    finally { setBusy(false); }
  }
  async function bulk() {
    if (!canBulk || !confirm("Assign all recorded time on " + selectedRows.length + " selected entries to " + projectName(bulkProject) + "?")) return;
    setBusy(true); setError(""); setNotice(""); setUndo(undefined);
    let current = revision, done = 0, failure: unknown;
    try {
      for (const source of selectedRows) {
        const response = await write(source, current, [{ projectId: bulkProject, seconds: source.seconds, description: "" }], source.annotations ?? blank);
        current = response.revision; done++;
      }
    } catch (e) { failure = e; }
    if (done) onSaved();
    await load();
    setNotice(done + " of " + selectedRows.length + " entries saved.");
    if (failure) failed(failure);
    setBusy(false);
  }
  async function revisions(source: StaffSource, next?: string) {
    if (!next) edit(source);
    try {
      const p = await client.call<ProjectPage>(tenant, "sources/" + source.id + "/history?" + new URLSearchParams({ month, limit: "10", ...(next ? { cursor: next } : {}) }));
      setHistory(old => next ? [...(old ?? []), ...(p.history ?? [])] : p.history ?? []);
      setHistoryCursor(p.nextCursor);
    } catch (e) { failed(e); }
  }
  return <div className="delivery-allocation">
    <div className="delivery-section-heading"><div><h3>Recorded time across projects</h3><p>Assign recorded time to delivery work. Source details stay in QuickBooks Time.</p></div>
      <div className="secure-actions"><button type="button" className="secure-secondary" disabled={busy} onClick={() => void load()}>Load authorized time</button>
        {cursor && <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load(cursor, true)}>Load month entries in batches</button>}</div></div>
    <div className="delivery-filters">
      <label>Search loaded time<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Work order<select value={workOrder} onChange={e => setWorkOrder(e.target.value)}><option value="">All</option>{[...new Map(rows?.map(s => [s.sourceWorkOrderId, s.workOrderName || s.sourceWorkOrderId])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label>Consultant<select value={consultant} onChange={e => setConsultant(e.target.value)}><option value="">All available</option>{[...new Set(rows?.flatMap(s => s.sourcePersonId ? [s.sourcePersonId] : []))].map(id => <option key={id}>{id}</option>)}</select></label>
      <label>Department<select value={area} onChange={e => setArea(e.target.value)}><option value="">All</option>{portfolio?.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Project<select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="">All</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Allocation status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option><option value="queue">Has unallocated time</option>{["Unallocated", "Partially allocated", "Allocated", "Review required", "Deleted"].map(s => <option key={s}>{s}</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Through<input type="date" value={through} onChange={e => setThrough(e.target.value)} /></label>
    </div>
    <div className="delivery-section-heading"><button type="button" className="secure-secondary" onClick={() => setStatus(status === "queue" ? "" : "queue")} aria-pressed={status === "queue"}>Unallocated queue · {rows?.filter(s => s.unallocatedSeconds > 0).length ?? 0} loaded</button>
      <span>{filtered.length} shown · {rows?.length ?? 0} loaded {cursor ? "· More entries available" : ""}</span></div>
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    {notice && <p className="secure-message" role="status">{notice}</p>}
    {undo && <button type="button" className="secure-secondary" disabled={busy} onClick={() => { const prior = undo; setUndo(undefined); void save(prior.source, prior.source.portions, prior.source.annotations ?? blank, prior.revision, false); }}>Undo last change</button>}
    {selected.length > 0 && <div className="delivery-section-heading">
      <label>Assign {selected.length} unallocated entries<select value={bulkProject} onChange={e => setBulkProject(e.target.value)}><option value="">Choose project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button type="button" disabled={busy || !canBulk} onClick={() => void bulk()}>Assign selected time</button></div>}
    {!rows && <p role="status">Loading recorded time…</p>}
    {rows && filtered.length === 0 && <p className="secure-empty">No loaded entries match these filters.</p>}
    {filtered.length > 0 && <div className="intel-table-scroll" tabIndex={0} aria-label="Recorded time table">
      <table><thead><tr><th scope="col">Select</th><th scope="col">Work order and consultant</th><th scope="col">Date</th><th scope="col">Recorded</th><th scope="col">Reporting</th><th scope="col">Assignment</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
      <tbody>{filtered.map(source => <tr key={source.id}>
        <td><input aria-label={"Select entry on " + source.date} type="checkbox" disabled={source.conflict || source.needsReview || source.portions.length > 0 || source.seconds === 0}
          checked={selected.includes(source.id)} onChange={e => setSelected(old => e.target.checked ? [...old, source.id] : old.filter(id => id !== source.id))} /></td>
        <td><b>{source.workOrderName || source.sourceWorkOrderId}</b><small>{source.sourcePersonId || "Consultant unavailable"}</small></td><td>{reportDay(source.date)}</td>
        <td>{reportHours(source.seconds)} h</td><td><span>{source.annotations?.reportingDescription || "No reporting description"}</span><small>{source.description}</small></td>
        <td>{source.portions.length ? source.portions.map(p => <div key={p.projectId}>{projectName(p.projectId)}<small>{resolvedParent(p.projectId) ? projectName(resolvedParent(p.projectId)) + " · " : ""}{areaLabel(resolvedArea(p.projectId))}</small></div>) : "Unassigned"}
          {(source.annotations?.parentId || source.annotations?.areaId) && <small>Reporting: {source.annotations.parentId ? projectName(source.annotations.parentId) + " · " : ""}{areaLabel(source.annotations.areaId ?? "")}</small>}</td>
        <td>{statusOf(source)}<small>{reportHours(source.unallocatedSeconds)} h unallocated</small></td>
        <td><button type="button" className="exec-text-button" disabled={busy || source.conflict} onClick={() => edit(source)}>Allocate recorded hours</button>
          <button type="button" className="exec-text-button" disabled={busy} onClick={() => void revisions(source)}>Allocation history</button></td>
      </tr>)}</tbody></table></div>}
    {cursor && <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load(cursor)}>More recorded time</button>}
    {editor && <section className="delivery-allocation-editor" aria-label="Time allocation" onKeyDown={e => { if (e.key === "Escape" && !busy) close(); }}>
      <div className="delivery-section-heading"><h3 ref={heading} tabIndex={-1}>Allocate {reportHours(editor.seconds)} recorded hours</h3><button type="button" className="secure-secondary" disabled={busy} onClick={close}>Close allocation</button></div>
      <p>{reportDay(editor.date)} · {editor.workOrderName || editor.sourceWorkOrderId} · {editor.description} · {editor.seconds.toLocaleString("en-CA")} original seconds</p>
      <details><summary>Original source details</summary><p>Consultant {editor.sourcePersonId || "unavailable"}. Revision <code>{editor.sourceRevision}</code>.</p>{editor.modifiedAt && <p>Last source modification {reportTimestamp(editor.modifiedAt)}</p>}</details>
      {editor.needsReview && <p role="status">QuickBooks changed this entry. The prior split is shown for review. Saving re-applies only the amounts you approve.</p>}
      <div className="delivery-filters">
        <label>Reporting description<textarea value={annotations.reportingDescription} maxLength={1000} onChange={e => setAnnotations({ ...annotations, reportingDescription: e.target.value })} /></label>
        <label>Internal note<textarea value={annotations.internalNote} maxLength={4000} onChange={e => setAnnotations({ ...annotations, internalNote: e.target.value })} /></label>
        <label>Reporting parent<select value={parent} onChange={e => setParent(e.target.value)}><option value="">None selected</option>{projects.filter(p => p.id === parent || p.delivery?.kind === "engagement" || projects.some(child => child.delivery?.parentId === p.id)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Reporting department<select value={classification} onChange={e => setClassification(e.target.value)}><option value="">None selected</option>{portfolio?.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Find an assignment project<input type="search" value={projectSearch} onChange={e => setProjectSearch(e.target.value)} /></label>
      </div>
      {portions.map((p, index) => <div className="secure-split" key={index}>
        <label>Delivery project<select aria-label="Delivery project" value={p.projectId} onChange={e => setPortions(old => old.map((part, i) => i === index ? { ...part, projectId: e.target.value } : part))}>
          <option value="">Choose project</option>{p.projectId && !idIndex.has(p.projectId) && <option value={p.projectId}>Existing assignment</option>}
          {projects.filter(project => project.id === p.projectId || ((!parent || resolvedParent(project.id) === parent || project.id === parent) &&
            (!classification || resolvedArea(project.id) === classification) && project.name.toLowerCase().includes(projectSearch.trim().toLowerCase()))).map(project => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
        <label>Allocated seconds<input type="number" min="1" step="1" value={p.seconds} onChange={e => setPortions(old => old.map((part, i) => i === index ? { ...part, seconds: Number(e.target.value) } : part))} /></label>
        <span>{reportHours(p.seconds)} h</span><button type="button" className="secure-secondary" onClick={() => setPortions(old => old.filter((_, i) => i !== index))}>Remove split</button></div>)}
      <p>{remaining >= 0 ? reportHours(remaining) + " h will remain unallocated." : "The split exceeds the original recorded time."} One hour equals 3,600 seconds.</p>
      <div className="secure-actions"><button type="button" className="secure-secondary" disabled={busy || editor.conflict || portions.length >= 10} onClick={() => setPortions(old => [...old, { projectId: "", seconds: 0, description: "" }])}>Add split</button>
        {!portions.length && editor.seconds > 0 && <button type="button" className="secure-secondary" disabled={busy || editor.conflict} onClick={() => setPortions([{ projectId: "", seconds: editor.seconds, description: "" }])}>Assign full entry</button>}
        <button type="button" disabled={busy || editor.conflict || remaining < 0 || new Set(portions.map(p => p.projectId)).size !== portions.length || portions.some(p => !p.projectId || !Number.isSafeInteger(p.seconds) || p.seconds <= 0)} onClick={() => void save(editor, portions, {
          reportingDescription: annotations.reportingDescription, internalNote: annotations.internalNote,
          ...(parent ? { parentId: parent } : {}), ...(classification ? { areaId: classification } : {}),
        })}>Save allocation</button></div>
      {history?.length === 0 && <p>No allocation revisions yet.</p>}
      {history?.map(item => <details key={item.revision}><summary>Revision {item.revision} · {reportTimestamp(item.at)} · {reportHours(item.portions.reduce((sum,p) => sum + p.seconds, 0))} h</summary>
        <ul>{item.portions.map(part => <li key={part.projectId}>{projectName(part.projectId)} · {reportHours(part.seconds)} h</li>)}</ul>
        {item.annotations?.reportingDescription && <p>{item.annotations.reportingDescription}</p>}{item.annotations?.internalNote && <p>{item.annotations.internalNote}</p>}
        {!editor.conflict && <button type="button" className="secure-secondary" onClick={() => { setPortions(item.portions); setAnnotations(item.annotations ?? blank); setParent(item.annotations?.parentId ?? ""); setClassification(item.annotations?.areaId ?? ""); }}>Use this revision as a draft</button>}</details>)}
      {historyCursor && <button type="button" className="secure-secondary" onClick={() => void revisions(editor, historyCursor)}>More allocation history</button>}
    </section>}
  </div>;
}
