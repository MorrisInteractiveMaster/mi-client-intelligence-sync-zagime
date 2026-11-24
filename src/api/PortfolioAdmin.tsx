import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ProjectPage, StaffProjectSummary } from "../projects/model";
import { byOrder, type Portfolio, type PortfolioRecord, type PortfolioSection, type PortfolioTotals } from "../projects/portfolio";
import { ApiError, type SecuredApiClient } from "./client";
import { reportHours, reportMonth } from "./dashboard-format";
import { hoursToSeconds } from "../projects/duration";
import { ContextHelp } from "./ContextHelp";
import { portalNavigate, usePortalLocation } from "./portal-location";

type Snapshot = { revision: number; portfolio: Portfolio; totals?: PortfolioTotals[] };
const editorSections = {
  areas: { title: "Departments", returnTo: "departments" },
  engagements: { title: "Reporting configuration", returnTo: "health" },
  placements: { title: "Project placement", returnTo: "management" },
  directory: { title: "Directory settings", returnTo: "directory" },
  notes: { title: "Executive updates", returnTo: "preview" },
} as const;
const blank = (section: PortfolioSection, month: string, project: string): PortfolioRecord => {
  const id = crypto.randomUUID(), order = 0, visible = false;
  switch (section) {
    case "areas": return { id, order, visible, name: "", description: "" };
    case "engagements": return { id, order, visible, name: "", reference: "", monthlySeconds: 0, areaPlans: [] };
    case "directory": return { id, order, visible, active: true, name: "", role: "", responsibility: "", internalContact: "", publicContact: "", areaId: "", projectIds: [] };
    case "placements": return { id: project, areaId: "", engagementId: "", leadId: "", teamIds: [], start: "", target: "", attention: "", publishDates: false, archived: false };
    case "notes": return { id: month, month, narrative: "", action: "", visible };
  }
};
const numeric = (value: number) => value / 3600;

export function PortfolioAdmin({ client, tenant, month, initialProject, onDenied, onSaved, onDirty }: {
  client: SecuredApiClient; tenant: string; month: string; initialProject?: StaffProjectSummary;
  onDenied: () => void; onSaved: () => void; onDirty: (value: boolean) => void;
}) {
  const requested = usePortalLocation().get("subsection");
  const section: PortfolioSection = requested && Object.hasOwn(editorSections, requested) ? requested as PortfolioSection : initialProject ? "placements" : "areas";
  const { title: sectionTitle, returnTo } = editorSections[section];
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [editing, setEditing] = useState<PortfolioRecord>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [projects, setProjects] = useState<StaffProjectSummary[]>(initialProject ? [initialProject] : []);
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState(initialProject?.id ?? "");
  const [cursor, setCursor] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);
  const initial = useRef(initialProject);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function failure(err: unknown) {
    if (err instanceof ApiError && [401, 403].includes(err.status)) { onDenied(); return; }
    setError(err instanceof Error ? err.message : "The workspace is temporarily unavailable.");
  }
  useEffect(() => {
    const abort = new AbortController();
    client.call<Snapshot>(tenant, "portfolio?month=" + month, { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return;
      setSnapshot(value);
      if (initial.current) {
        const id = initial.current.id;
        setEditing(value.portfolio.placements.find(p => p.id === id) ?? blank("placements", month, id));
        initial.current = undefined;
      }
    }).catch(err => { if (!abort.signal.aborted) failure(err); });
    return () => abort.abort();
  }, [client, tenant, month, reload]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => { if (editing) heading.current?.focus(); }, [editing]);
  useEffect(() => { setEditing(undefined); setDirty(false); setError(""); setNotice(""); }, [section]);
  useEffect(() => {
    if (!dirty) return;
    function prevent(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);
  const config = snapshot?.portfolio;
  function discard() { return !dirty || window.confirm("Discard the unsaved changes?"); }
  function edit(record: PortfolioRecord) {
    if (!discard()) return;
    setEditing(record);
    setDirty(false);
    setError("");
    setNotice("");
  }
  async function find(event?: FormEvent, next?: string) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await client.call<ProjectPage>(tenant, "projects?month=" + month +
        "&limit=25" + (query.trim() ? "&search=" + encodeURIComponent(query.trim()) : "") +
        (next ? "&cursor=" + encodeURIComponent(next) : ""));
      if (!alive.current) return;
      setProjects(prev => next ? [...prev, ...(result.projects ?? [])] : result.projects ?? []);
      setCursor(result.nextCursor);
      if (!result.projects?.length) setNotice("No projects matched.");
    } catch (err) { if (alive.current) failure(err); }
    finally { if (alive.current) setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !snapshot || busy) return;
    const data = new FormData(event.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "");
    const checked = (key: string) => data.has(key);
    const name = get("name"), order = Number(get("order")), visible = checked("visible");
    const names = (k: string) => data.getAll(k).map(String);
    const displayHours = (key: string) => hoursToSeconds(get(key) || "0");
    setError("");
    setNotice("");
    setBusy(true);
    try {
      let entry: PortfolioRecord;
      switch (section) {
        case "areas":
          entry = { id: editing.id, name, order, visible, description: get("description") }; break;
        case "engagements":
          entry = { id: editing.id, name, order, visible, reference: get("reference"), monthlySeconds: displayHours("capacity"),
            areaPlans: config!.areas.filter(a => get("plan:" + a.id) !== "").map(a => ({ areaId: a.id, seconds: displayHours("plan:" + a.id) })) }; break;
        case "directory":
          entry = { id: editing.id, name, order, visible, role: get("role"), responsibility: get("responsibility"),
            internalContact: get("internalContact"), publicContact: get("publicContact"), areaId: get("areaId"),
            projectIds: names("projectIds"), active: checked("active") }; break;
        case "placements":
          entry = { id: editing.id, areaId: get("areaId"), engagementId: get("engagementId"), leadId: get("leadId"),
            teamIds: names("teamIds"), start: get("start"), target: get("target"), attention: get("attention"), publishDates: checked("publishDates"), archived: checked("archived") }; break;
        case "notes":
          entry = { id: editing.id, month: editing.id, narrative: get("narrative"), action: get("action"), visible }; break;
      }
      const capInput = (key: string) => data.has(key) ? (get(key) === "" ? null : displayHours(key)) : undefined;
      const caps = section === "areas" || section === "engagements" ? { monthlyCap: capInput("monthlyCap"), lifetimeCap: capInput("lifetimeCap") } : {};
      const value = await client.call<Snapshot>(tenant, "portfolio", { method: "PATCH", body: { expectedRevision: snapshot.revision, section, record: { ...entry, ...caps } } });
      if (!alive.current) return;
      setSnapshot(value);
      setEditing(undefined);
      setDirty(false);
      setNotice("Saved to the protected workspace.");
      onSaved();
      setReload(x => x + 1);
    } catch (err) { if (alive.current) failure(err); }
    finally { if (alive.current) setBusy(false); }
  }
  if (!config) return <section className="exec-panel">
    <h2>{sectionTitle}</h2>
    {error ? <><p role="alert">{error}</p><button type="button" onClick={() => { setError(""); setReload(x => x + 1); }}>Retry</button></> : <p role="status">Loading portfolio…</p>}
  </section>;

  const record = editing;
  const areaSelect = (value: string) => <label>Service area<select name="areaId" defaultValue={value}><option value="">Unassigned</option>{[...config.areas].sort(byOrder).map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label>;
  const publishedCheck = (value: boolean, label: string) => <label className="exec-check"><input type="checkbox" name="visible" defaultChecked={value} />{label}</label>;
  const selected = projects.find(p => p.id === projectId);
  const currentPlacement = config.placements.find(x => x.id === projectId);
  return <section className="exec-portfolio" aria-labelledby="portfolio-management">
    <div className="delivery-section-heading"><h2 id="portfolio-management">{sectionTitle}</h2>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
        if (discard()) portalNavigate({ staff: returnTo, subsection: null, ...(section === "placements" && { managed: selected?.id ?? null }) });
      }}>Back to workspace</button></div>
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    {notice && <p className="secure-message" role="status">{notice}</p>}
    {error && <button type="button" disabled={busy} onClick={() => { if (discard()) { setEditing(undefined); setDirty(false); setError(""); setReload(x => x + 1); } }}>Refresh settings</button>}
    {section === "placements" ? <div className="exec-panel">
      <form className="exec-project-search" onSubmit={event => void find(event)}>
        <label>Find a project<input type="search" maxLength={120} value={query} onChange={e => setQuery(e.target.value)} /></label>
        <button type="submit" disabled={busy}>Find projects</button>
      </form>
      {projects.length > 0 && <label>Managed project<select value={projectId} onChange={e => setProjectId(e.target.value)}>
        <option value="">Select a project</option>{projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></label>}
      {cursor && <button type="button" disabled={busy} onClick={() => void find(undefined, cursor)}>More projects</button>}
      {selected && <button type="button" disabled={busy} onClick={() => edit(currentPlacement ?? blank("placements", month, selected.id))}>Organize {selected.name}</button>}
    </div> : <div className="exec-panel">
      <div className="secure-section-heading"><button type="button" disabled={busy} onClick={() => edit(section === "notes" ? config.notes.find(n => n.month === month) ?? blank(section, month, "") : blank(section, month, ""))}>{section === "notes" ? "Edit " + reportMonth(month) : "Add record"}</button></div>
      <ul className="exec-admin-list">
        {config[section].slice().sort((a, b) => "order" in a && "order" in b ? byOrder(a, b) : b.id.localeCompare(a.id)).map(item => <li key={item.id}>
          <div><b>{"name" in item ? item.name : reportMonth(item.id)}</b><span>{item.visible ? "Available to eligible clients" : "Morris only"}</span>
            {"monthlySeconds" in item && <small>{reportHours(item.monthlySeconds)} h monthly capacity · {reportHours(item.areaPlans.reduce((sum, p) => sum + p.seconds, 0))} h distributed
              {item.areaPlans.reduce((sum, p) => sum + p.seconds, 0) !== item.monthlySeconds && " · Review plan distribution"}</small>}
          </div>
          <button type="button" disabled={busy} onClick={() => edit(item)}>Edit<span className="exec-sr"> {"name" in item ? item.name : item.id}</span></button>
        </li>)}
      </ul>
    </div>}
    {section === "engagements" && !!snapshot?.totals?.length && <section className="exec-panel">
      <h3>Project plans and allocations · {reportMonth(month)}</h3>
      <ul className="exec-admin-list">{snapshot.totals.map(row => <li key={row.engagementId + ":" + row.areaId}>
        <div><b>{config.engagements.find(e => e.id === row.engagementId)?.name ?? "Independent work"} · {config.areas.find(a => a.id === row.areaId)?.name ?? "Unassigned"}</b>
        <span>{row.projects} projects · {reportHours(row.allocatedSeconds)} h allocated · {reportHours(row.monthlyPlanSeconds)} h monthly project plans · {reportHours(row.lifetimePlanSeconds)} h fixed project plans</span></div>
      </li>)}</ul>
    </section>}
    {record && <form className="exec-panel exec-admin-editor" key={section + ":" + record.id} onSubmit={event => void save(event)} onChange={() => setDirty(true)}>
      <h3 tabIndex={-1} ref={heading}>{sectionTitle} editor</h3>
      <fieldset disabled={busy} className="exec-form-grid">
        {"name" in record && <>
          <label>Name<input name="name" defaultValue={record.name} required maxLength={section === "areas" ? 80 : 120} /></label>
          <label>Display order<input name="order" type="number" min="0" max="1000" defaultValue={record.order} required /></label>
        </>}
        {"description" in record && <label className="exec-span">Description<textarea name="description" defaultValue={record.description} maxLength={500} /></label>}
        {("areaPlans" in record || "description" in record) && <>
          <label>Monthly hours cap<input name="monthlyCap" inputMode="decimal" defaultValue={record.monthlyCap === undefined ? "" : numeric(record.monthlyCap)} placeholder="No cap" /></label>
          <label>Lifetime hours cap<input name="lifetimeCap" inputMode="decimal" defaultValue={record.lifetimeCap === undefined ? "" : numeric(record.lifetimeCap)} placeholder="No cap" /></label>
        </>}
        {"areaPlans" in record && <>
          <label>Internal reference<input name="reference" defaultValue={record.reference} maxLength={120} /></label>
          <label>Monthly group capacity (hours)<input name="capacity" type="number" step="any" min="0" max="1000000" defaultValue={numeric(record.monthlySeconds)} /></label>
          <div className="exec-span exec-form-divider"><h4>Service-area capacity</h4><p>Review discrepancies after saving. The group capacity and project plans are independent.</p></div>
          {[...config.areas].sort(byOrder).map(a => <label key={a.id}>{a.name} monthly capacity (hours)<input name={"plan:" + a.id} type="number" step="any" min="0" max="1000000" defaultValue={record.areaPlans.find(p => p.areaId === a.id)?.seconds !== undefined ? numeric(record.areaPlans.find(p => p.areaId === a.id)!.seconds) : ""} /></label>)}
        </>}
        {"internalContact" in record && <>
          <label>Public role or title<input name="role" defaultValue={record.role} maxLength={120} /></label>
          {areaSelect(record.areaId)}
          <label>Morris-only contact<input name="internalContact" defaultValue={record.internalContact} maxLength={200} /></label>
          <label>Approved client contact<input name="publicContact" defaultValue={record.publicContact} maxLength={200} /></label>
          <label className="exec-span">Responsibilities<textarea name="responsibility" defaultValue={record.responsibility} maxLength={500} /></label>
          <p className="secure-muted exec-span">Use the Organize action on a project to assign this person. Clients see only approved active contacts linked to projects they can access.</p>
          {record.projectIds.map(id => <input key={id} type="hidden" name="projectIds" value={id} />)}
          <label className="exec-check"><input name="active" type="checkbox" defaultChecked={record.active} />Active contact</label>
        </>}
        {"engagementId" in record && <>
          {areaSelect(record.areaId)}
          <label>Reporting group<select name="engagementId" defaultValue={record.engagementId}><option value="">Independent delivery project</option>{[...config.engagements].sort(byOrder).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <label>Responsible lead<select name="leadId" defaultValue={record.leadId}><option value="">No lead</option>{[...config.directory].sort(byOrder).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Team members<select name="teamIds" multiple size={Math.min(5, Math.max(2, config.directory.length))} defaultValue={record.teamIds}>{[...config.directory].sort(byOrder).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Start date<input type="date" name="start" defaultValue={record.start} /></label>
          <label>Target date<input type="date" name="target" defaultValue={record.target} /></label>
          <label className="exec-span">Morris-only attention item<textarea name="attention" maxLength={500} defaultValue={record.attention} /></label>
          <label className="exec-check"><input name="publishDates" type="checkbox" defaultChecked={record.publishDates} />Show dates with published project</label>
          <label className="exec-check"><input name="archived" type="checkbox" defaultChecked={record.archived} />Archive in reporting hierarchy</label>
        </>}
        {"narrative" in record && <>
          <label className="exec-span">Executive narrative<textarea name="narrative" defaultValue={record.narrative} maxLength={2000} /></label>
          <label className="exec-span">Decision or next action<textarea name="action" defaultValue={record.action} maxLength={500} /></label>
        </>}
        {"visible" in record && <div className="exec-span exec-inline">{publishedCheck(record.visible, "Approve for client display")}
          <ContextHelp label="How does client display work?">Only authorized, published projects appear in client reports. Approved executive notes are shared with approved tenant members for the selected reporting month.</ContextHelp></div>}
      </fieldset>
      <div className="secure-actions"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        <button className="secure-secondary" type="button" disabled={busy} onClick={() => { if (discard()) { setEditing(undefined); setDirty(false); } }}>Cancel</button></div>
    </form>}
  </section>;
}
