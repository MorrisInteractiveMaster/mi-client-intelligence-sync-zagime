import { isBoardRole } from "../projects/directory-role";
import { isOtherContact } from "../projects/other-contacts";
import { useCallback, useEffect, useState } from "react";
import { capRollup, deliveryKindNames, MAX_DELIVERY_PROJECTS, measureDelivery, rollup } from "../projects/delivery";
import type { Project, ProjectPage, StaffProjectSummary } from "../projects/model";
import type { DirectoryEntry, Portfolio } from "../projects/portfolio";
import { ApiError, type SecuredApiClient } from "./client";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { periodHref, portalNavigate, usePortalLocation } from "./portal-location";
import { ProjectClientReport } from "./ProjectClientReport";
import { PersonPhoto } from "./PersonPhoto";
import { CsvExport } from "./CsvExport";
import { csvHours } from "./report-csv";
import { BudgetHealthBoard } from "./BudgetHealthBoard";
import { OtherContacts } from "./OtherContacts";
import { PlatformLink } from "./PlatformHome";
import { SortControls, SortHeader, useSortedRows } from "./SortHeader";

const peopleSort = { name: "Name", role: "Role", visibility: "Client visibility" } as const;
const hierarchySort = { path: "Project / parent", department: "Department / type", managers: "Managers", effort: "Allocated effort",
  cap: "Remaining cap", completion: "Completion and health", publication: "Publication" } as const;
type HierarchyField = keyof typeof hierarchySort;

export async function projectCatalog(client: SecuredApiClient, tenant: string, month: string, signal: AbortSignal) {
  const projects: StaffProjectSummary[] = [];
  let cursor: string | undefined;
  let revision = 0;
  do {
    const page: ProjectPage = await client.call(tenant, "projects?" + new URLSearchParams({ month, limit: "25", ...(cursor ? { cursor } : {}) }), { signal });
    if (revision && page.revision !== revision) throw Error("The project list changed. Refresh the workspace to load the latest list.");
    revision = page.revision;
    projects.push(...(page.projects ?? []));
    cursor = page.nextCursor;
    if (projects.length > MAX_DELIVERY_PROJECTS) throw Error("The project list exceeds the supported size.");
  } while (cursor);
  return projects;
}

export function PeoplePicker({ name, label, people, defaults, onSelectionChange }: {
  name: string; label: string; people: DirectoryEntry[]; defaults: string[]; onSelectionChange?: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(defaults);
  const filtered = people.filter(p => selected.includes(p.id) || (p.active && (p.name + " " + (p.profile?.title || p.role)).toLowerCase().includes(search.trim().toLowerCase())));
  return <fieldset className="delivery-people"><legend>{label} · {selected.length} selected</legend>
    <label>Search {label.toLowerCase()}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="delivery-people-list">{filtered.map(person => <label key={person.id}>
      <input type="checkbox" name={name} value={person.id} checked={selected.includes(person.id)} onChange={e => {
        const next = e.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id);
        setSelected(next);
        onSelectionChange?.(next);
      }} />
      <PersonPhoto name={person.name} photo={person.profile?.photo} alt={person.profile?.alt} /><span>{person.name}<small>{person.profile?.title || person.role}</small></span></label>)}</div>
    {!filtered.length && <p>No people match. Use Team Directory to add or sync profiles.</p>}
    {selected.filter(id => !people.some(p => p.id === id)).map(id => <input type="hidden" key={id} name={name} value={id} />)}
  </fieldset>;
}

export function DeliveryDirectory({ client, tenant, portfolio, revision, onSaved, onDenied }: {
  client: SecuredApiClient; tenant: string; portfolio?: Portfolio; revision: number; onSaved: () => void; onDenied: () => void;
}) {
  const [search, setSearch] = useState("");
  const selected = usePortalLocation().get("person");
  const setSelected = (person: string | null) => portalNavigate({ person });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const person = portfolio?.directory.find(p => p.id === selected);
  const synced = (portfolio?.directory ?? []).filter(p => !isOtherContact(p.profile));
  const matching = synced.filter(p =>
    [p.name, p.profile?.title, p.role].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())));
  const sorted = useSortedRows<DirectoryEntry, keyof typeof peopleSort>(matching, { key: "name", direction: "asc" },
    (row, field) => ({ name: row.name, role: row.profile?.title || row.role, visibility: row.visible ? "Visible" : "Private" })[field], row => row.id);
  const board = sorted.rows.filter(p => isBoardRole(p.profile?.title || p.role));
  const team = sorted.rows.filter(p => !isBoardRole(p.profile?.title || p.role));
  async function act(run: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await run(); onSaved(); }
    catch (e) { if (e instanceof ApiError && e.status === 403) onDenied(); setError(e instanceof Error ? e.message : "The request failed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Team Directory">
    <div className="delivery-section-heading"><div><h3>Morris team</h3><p>Use staff profiles across multiple projects. Contact sharing is reviewed separately.</p></div>
      <button type="button" disabled={busy} onClick={() => void act(async () => {
        const result = await client.call<{ profiles: number }>(tenant, "directory/wordpress-sync", { method: "POST", body: {} });
        setNotice(result.profiles + " public WordPress profiles checked.");
      })}>Sync team from WordPress</button></div>
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    {notice && <p className="secure-message" role="status">{notice}</p>}
    <label>Search people<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    {!!matching.length && <SortControls fields={peopleSort} sort={sorted.sort} onSort={sorted.setSort} label="Sort team directory" />}
    {!portfolio && <p className="secure-empty" role="status">Loading team profiles…</p>}
    {portfolio && !synced.length && <p className="secure-empty">No team profiles yet. Sync the Morris team or add a manual profile.</p>}
    {synced.length ? <>
      {[{ name: "Board", people: board }, { name: "Team", people: team }].map(group => group.people.length > 0 && <section
        key={group.name} aria-label={group.name} className="mi-directory-group">
        <h4>{group.name}</h4>
        <div className="delivery-directory">{group.people.map(p => <button type="button" className="delivery-person" key={p.id}
          onClick={() => setSelected(p.id)} aria-pressed={selected === p.id}>
          <PersonPhoto name={p.name} photo={p.profile?.photo} alt={p.profile?.alt} />
          <span><b>{p.name}</b><small>{p.profile?.title || p.role || "Title unavailable"}</small></span>
        </button>)}</div>
      </section>)}
      {!matching.length && <p className="secure-empty">No profiles match this search.</p>}
    </> : null}
    <OtherContacts />
    {person && <form className="secure-form" key={person.id} onSubmit={e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      const { profile: _, ...previous } = person;
      void act(async () => {
        await client.call(tenant, "portfolio", { method: "PATCH", body: { section: "directory", expectedRevision: revision,
          record: { ...previous, email: data.get("email"), phone: data.get("phone"), internalRole: data.get("internalRole"), staffNotes: data.get("staffNotes"),
            visible: data.has("visible"), shareEmail: data.has("shareEmail"), sharePhone: data.has("sharePhone") } } });
        setNotice("Contact settings saved.");
      });
    }}>
      <div className="delivery-section-heading"><h3>{person.name}</h3><button type="button" className="secure-secondary" onClick={() => setSelected(null)}>Close profile</button></div>
      {person.profile?.url && <a href={person.profile.url} rel="noreferrer">Public Morris profile</a>}
      <div className="secure-editor-grid">
        <label>Email<input name="email" type="email" defaultValue={person.email} maxLength={255} /></label>
        <label>Phone<input name="phone" type="tel" defaultValue={person.phone} maxLength={80} /></label>
        <label>Internal role<input name="internalRole" defaultValue={person.internalRole} maxLength={120} /></label>
        <label className="secure-field-wide">Internal notes<textarea name="staffNotes" defaultValue={person.staffNotes} maxLength={4000} /></label>
        <label className="secure-check"><input name="visible" type="checkbox" defaultChecked={person.visible} /> Show on assigned, authorized client projects</label>
        <label className="secure-check"><input name="shareEmail" type="checkbox" defaultChecked={person.shareEmail} /> Share email with clients</label>
        <label className="secure-check"><input name="sharePhone" type="checkbox" defaultChecked={person.sharePhone} /> Share phone with clients</label>
      </div><button disabled={busy || !revision}>Save contact settings</button>
    </form>}
  </section>;
}

export function DeliveryPreview({ client, tenant, month, standalone = false }: { client: SecuredApiClient; tenant: string; month: string; standalone?: boolean }) {
  const [profiles, setProfiles] = useState<{id: string; label: string}[]>();
  const location = usePortalLocation();
  const requestedScope = location.get("previewScope");
  const scope = requestedScope && profiles?.some(profile => profile.id === requestedScope) ? requestedScope : profiles?.length === 1 ? profiles[0].id : "";
  const mode = location.get("previewMode") === "draft" ? "draft" : "published";
  const previewProject = location.get("previewProject");
  const [error, setError] = useState("");
  useEffect(() => {
    if (standalone && !requestedScope) return;
    const controller = new AbortController();
    client.call<{id: string; label: string}[]>(tenant, "client-preview/scopes", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setProfiles(value);
    }).catch(() => { if (!controller.signal.aborted) setError("Client access profiles are temporarily unavailable."); });
    return () => controller.abort();
  }, [client, tenant, standalone, requestedScope]);
  const onPreviewDenied = useCallback(() => setError("This client access profile is no longer available."), []);
  const entitled = standalone || mode === "draft" || Boolean(scope);
  const controls = <div className="delivery-filters mi-preview-controls">
      {standalone && <PlatformLink href={periodHref("/workspace", month)}>Back to Morris Workspace</PlatformLink>}
      <label>Preview mode<select value={mode} onChange={e => { setError(""); portalNavigate({
        previewMode: e.target.value === "draft" ? "draft" : null,
        view: previewProject ? "project:" + previewProject : location.get("view"), q: null, present: null, chart: null,
      }, true); }}><option value="published">Published client view</option><option value="draft">Staff draft preview</option></select></label>
      {mode === "published" && !standalone && <label>Client access profile<select value={scope} onChange={e => { portalNavigate({ previewScope: e.target.value || null }); setError(""); }}><option value="">Select an approved profile</option>{profiles?.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
      {entitled && <p className="delivery-watermark" data-draft={mode === "draft"}>{mode === "draft" ? "DRAFT PREVIEW · MORRIS STAFF ONLY" : "LIVE PUBLISHED VIEW · MORRIS STAFF PREVIEW"}</p>}
      {standalone && <PlatformLink href={periodHref("/workspace/portfolio", month, { subsection: "notes" })}>Manage executive updates</PlatformLink>}
    </div>;
  return <section aria-label="Preview as client">
    {!standalone && <div className="delivery-section-heading"><p>Published preview follows the selected client access profile. Draft preview includes saved changes and private projects.</p>
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({
        staff: previewProject ? "projects" : "overview", editor: previewProject, previewProject: null, previewMode: null,
        view: null, q: null, status: null, present: null, chart: null,
      })}>{previewProject ? "Back to project" : "Back to overview"}</button></div>}
    {!standalone && controls}
    {error && <p role="alert">{error}</p>}
    {entitled && <div className="delivery-preview-frame">
      <ProjectClientReport client={client} tenant={tenant} month={month} previewToolbar={standalone ? controls : undefined} preview={{ mode, ...(mode === "published" && (!standalone ? scope : requestedScope && scope === requestedScope) ? { scope } : {}) }}
        onDenied={onPreviewDenied} /></div>}
  </section>;
}

export function DeliveryHealth({ projects, portfolio, month, healthOnly = false, overCapOnly = false, onOpen, client, tenant, onRefresh, onDenied, onDirty }: {
  projects: StaffProjectSummary[]; portfolio?: Portfolio; month?: string; healthOnly?: boolean; overCapOnly?: boolean; onOpen: (id: string) => void;
  client?: SecuredApiClient; tenant?: string; onRefresh?: () => void; onDenied?: () => void; onDirty?: (dirty: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState("tree");
  const [area, setArea] = useState("");
  const [group, setGroup] = useState("");
  const [capEditor, setCapEditor] = useState<string>();
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const index = new Map(projects.map(p => [p.id, p]));
  const totals = rollup(projects);
  const caps = capRollup(projects);
  const asOf = today();
  const descendants = new Map<string, StaffProjectSummary[]>();
  for (const project of projects) {
    let parent = project.delivery?.parentId;
    const seen = new Set([project.id]);
    while (parent && !seen.has(parent) && seen.size < 24) {
      seen.add(parent);
      const group = descendants.get(parent);
      if (group) group.push(project);
      else descendants.set(parent, [project]);
      parent = index.get(parent)?.delivery?.parentId;
    }
  }
  const placements = new Map(portfolio?.placements.map(p => [p.id, p]));
  const people = new Map(portfolio?.directory.map(p => [p.id, p.name]));
  const describeBranch = (branch: StaffProjectSummary[]) => {
    const delivery = branch.filter(child => child.delivery?.kind !== "service-area");
    const active = delivery.filter(child => child.status === "active").length;
    const completed = delivery.filter(child => child.status === "completed").length;
    const departments = new Set(branch.map(child => child.delivery?.areaId ?? placements.get(child.id)?.areaId).filter(Boolean)).size;
    return `${departments} ${departments === 1 ? "department" : "departments"} · ${active} active · ${completed} completed`;
  };
  const depth = (p: StaffProjectSummary) => {
    const path = [];
    let parent = p.delivery?.parentId;
    while (parent && path.length < 24 && parent !== p.id) {
      const data = index.get(parent);
      if (!data) break;
      path.unshift(data.name);
      parent = data.delivery?.parentId;
    }
    return path;
  };
  const matchedRows = projects.map(p => ({ p, trail: depth(p), area: p.delivery?.areaId ?? placements.get(p.id)?.areaId, group: p.delivery?.groupId ?? placements.get(p.id)?.engagementId }))
    .filter(({ p }) => {
      if (!overCapOnly) return true;
      const result = measureDelivery(p, caps.get(p.id)!, asOf);
      return (result.monthlyRemaining ?? 0) < 0 || (result.lifetimeRemaining ?? 0) < 0;
    })
    .filter(row => (!area || row.area === area) && (!group || row.group === group) && [row.p.name, ...row.trail].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b) => (layout === "tree" ? [...a.trail, a.p.name].join(" / ").localeCompare([...b.trail, b.p.name].join(" / ")) : a.p.name.localeCompare(b.p.name)));
  const sorted = useSortedRows<typeof matchedRows[number], HierarchyField>(matchedRows, { key: "path", direction: "asc" },
    ({ p, trail, area }, field) => {
      const cap = caps.get(p.id)!;
      const result = measureDelivery({ ...p, milestones: p.deliveryMilestones ?? p.milestones }, cap, asOf);
      return {
        path: (layout === "tree" ? [...trail, p.name] : [p.name]).join(" / "),
        department: portfolio?.areas.find(item => item.id === area)?.name, managers: (p.delivery?.managerIds ?? [placements.get(p.id)?.leadId ?? ""]).map(id => people.get(id)).filter(Boolean).join(", "),
        effort: totals.get(p.id)?.monthly, cap: result.monthlyRemaining ?? result.lifetimeRemaining, completion: result.completion,
        publication: p.published ? "Published" : "Private draft",
      }[field];
    }, row => row.p.id);
  const rows = sorted.rows;
  const budgetRows = [...(portfolio?.areas ?? []).map(item => ({ item, classification: "Department", matches: (p: StaffProjectSummary) => (p.delivery?.areaId ?? placements.get(p.id)?.areaId) === item.id })),
    ...(portfolio?.engagements ?? []).map(item => ({ item, classification: "Reporting group", matches: (p: StaffProjectSummary) => (p.delivery?.groupId ?? placements.get(p.id)?.engagementId) === item.id }))]
    .map(({ item, classification, matches }) => {
      const allocated = projects.filter(matches);
      const month = allocated.reduce((sum, p) => sum + p.seconds, 0), lifetime = allocated.reduce((sum, p) => sum + p.lifetimeSeconds, 0);
      return { item, classification, month, lifetime };
    });
  return <section>
    <div className="delivery-section-heading"><div><h3>{healthOnly ? "Project caps and progress" : "Project hierarchy"}</h3>
      <p>Hours measure effort. Milestones and manual assessments measure completion.</p></div>
      <CsvExport filename={["Morris", healthOnly ? "Delivery_Health" : "Project_Hierarchy", month].filter(Boolean).join("_")}
        label={healthOnly ? "Export budgets and health CSV" : "Export hierarchy CSV"}
        data={{
          headers: ["Project", "Parent path", "Service area", "Monthly reported hours", "Lifetime reported hours", "Monthly cap hours",
            "Monthly cap used hours", "Monthly cap remaining hours", "Lifetime cap hours", "Lifetime cap used hours", "Lifetime cap remaining hours",
            "Completion percent", "Health", "Next date", "Publication", "Delivery status"],
          rows: rows.map(({ p, trail, area }) => {
            const sum = totals.get(p.id)!;
            const cap = caps.get(p.id)!;
            const delivery = p.delivery && (healthOnly && p.draftCaps
              ? { ...p.delivery, monthlyCap: p.draftCaps.monthlyCap, lifetimeCap: p.draftCaps.lifetimeCap } : p.delivery);
            const result = measureDelivery({ ...p, delivery, milestones: p.deliveryMilestones ?? p.milestones }, cap, asOf);
            return [p.name, trail.join(" / "), portfolio?.areas.find(item => item.id === area)?.name,
              csvHours(sum.monthly), csvHours(sum.lifetime), csvHours(delivery?.monthlyCap), csvHours(cap.monthly), csvHours(result.monthlyRemaining),
              csvHours(delivery?.lifetimeCap), csvHours(cap.lifetime), csvHours(result.lifetimeRemaining),
              result.completion, result.health, result.upcoming, p.published ? "Published" : "Private", projectStatus[p.status]];
          }),
        }} />
    </div>
    {healthOnly && !!budgetRows.length && <details className="delivery-details"><summary>Department and group caps</summary>
      <dl>{budgetRows.map(({ item, classification, month, lifetime }) => <div key={classification + item.id}><dt>{item.name} · {classification}</dt>
        <dd>{reportHours(month)} h allocated monthly · {item.monthlyCap === undefined ? "No monthly cap" : reportHours(item.monthlyCap - month) + " h remaining"}</dd>
        <dd>{reportHours(lifetime)} h allocated lifetime · {item.lifetimeCap === undefined ? "No lifetime cap" : reportHours(item.lifetimeCap - lifetime) + " h remaining"}</dd>
      </div>)}</dl></details>}
    <div className="delivery-filters"><label>{healthOnly ? "Search projects" : "Search hierarchy"}<input type="search" value={search} disabled={Boolean(capEditor)} onChange={e => setSearch(e.target.value)} /></label>
      <label>Department<select value={area} disabled={Boolean(capEditor)} onChange={e => setArea(e.target.value)}><option value="">All departments</option>{portfolio?.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {healthOnly && !!portfolio?.engagements.length && <label>Legacy reporting group<select value={group} disabled={Boolean(capEditor)} onChange={e => setGroup(e.target.value)}><option value="">All groups</option>{portfolio.engagements.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
      <label>{healthOnly ? "Order" : "Layout"}<select value={layout} disabled={Boolean(capEditor)} onChange={e => setLayout(e.target.value)}><option value="tree">Hierarchy</option><option value="table">{healthOnly ? "Alphabetical" : "Alphabetical table"}</option></select></label>
      {healthOnly && <SortControls fields={hierarchySort} sort={sorted.sort} onSort={sorted.setSort} disabled={Boolean(capEditor)} label="Sort budget and health cards" />}
    </div>
    {!rows.length && <p className="secure-empty">No projects match.</p>}
    {healthOnly && !!rows.length && <BudgetHealthBoard asOf={asOf} client={client} tenant={tenant}
      editing={capEditor} onEditing={setCapEditor} onDirty={onDirty} onRefresh={onRefresh} onOpen={onOpen} onDenied={onDenied}
      rows={rows.map(({ p, trail, area }) => ({ project: p, trail, department: portfolio?.areas.find(item => item.id === area)?.name,
        branchSummary: descendants.has(p.id) ? describeBranch(descendants.get(p.id)!) : undefined,
        effort: totals.get(p.id)!, consumed: caps.get(p.id)! }))} />}
    {!healthOnly && !!rows.length && <div className="intel-table-scroll" tabIndex={0} aria-label="Project hierarchy table"><table><thead><tr>
      {(Object.keys(hierarchySort) as HierarchyField[]).map(field => <SortHeader key={field} field={field} sort={sorted.sort} onSort={sorted.setSort} label={hierarchySort[field]} />)}
    </tr></thead><tbody>{rows.map(({ p, trail, area }) => {
      const sum = totals.get(p.id)!;
      const cap = caps.get(p.id)!;
      const result = measureDelivery({ ...p, milestones: p.deliveryMilestones ?? p.milestones }, cap, asOf);
      const managers = p.delivery?.managerIds ?? (placements.get(p.id)?.leadId ? [placements.get(p.id)!.leadId] : []);
      const branch = descendants.get(p.id) ?? [];
      const projectsBelow = branch.filter(child => child.delivery?.kind !== "service-area");
      const upcoming = branch.flatMap(child => [child.delivery?.deadline, ...(child.deliveryMilestones ?? [])
        .filter(m => !m.completed && m.status !== "waived").map(m => m.date)]).filter((date): date is string => Boolean(date && date >= asOf)).sort()[0];
      return <tr key={p.id}><th scope="row"><button type="button" className="exec-text-button" style={{ marginInlineStart: layout === "tree" ? Math.min(trail.length, 5) * 12 : 0 }} onClick={() => onOpen(p.id)}>{p.name}</button>
        <small>{trail.length ? trail.join(" / ") : "Client root"}{projectsBelow.length ? " · " + projectsBelow.length + (projectsBelow.length === 1 ? " descendant project" : " descendant projects") : ""}</small>
        {!!branch.length && <small>{describeBranch(branch)}</small>}</th>
        <td>{portfolio?.areas.find(a => a.id === area)?.name ?? "Unclassified"}<small>{p.delivery?.kind ? deliveryKindNames[p.delivery.kind] : "Legacy project"} · {p.delivery?.type ?? "Engagement type not configured"}</small></td>
        <td>{managers.map(id => people.get(id)).filter(Boolean).join(", ") || "Unassigned"}</td>
        <td>{reportHours(sum.monthly)} h monthly<small>{reportHours(sum.lifetime)} h lifetime</small>
          {p.workOrderEffort && <small>{reportHours(p.workOrderEffort.recordedSeconds)} h work-order recorded · {reportHours(p.workOrderEffort.remainingSeconds)} h remaining at work order</small>}</td>
        <td>{result.monthlyRemaining === undefined ? "No monthly cap" : reportHours(result.monthlyRemaining) + " h monthly"}
          <small>{result.lifetimeRemaining === undefined ? "No lifetime cap" : reportHours(result.lifetimeRemaining) + " h lifetime"}</small>
          {p.delivery?.monthlyCap !== undefined && <small>{reportHours(cap.monthly)} of {reportHours(p.delivery.monthlyCap)} h used monthly</small>}
          {p.delivery?.lifetimeCap !== undefined && <small>{reportHours(cap.lifetime)} of {reportHours(p.delivery.lifetimeCap)} h used lifetime</small>}</td>
        <td>{result.completion === undefined ? "Progress not configured" : result.completion + "% complete"}<small>{result.health}{result.upcoming ? " · " + reportDay(result.upcoming) : ""}</small>
          {upcoming && <small>Next child deadline {reportDay(upcoming)}</small>}</td>
        <td>{p.published ? "Published" : "Private draft"}<small>{projectStatus[p.status]}</small></td></tr>;
    })}</tbody></table></div>}
  </section>;
}

export function DeliveryMilestones({ client, tenant, month, projects, onSaved, onOpen }: {
  client: SecuredApiClient; tenant: string; month?: string; projects: StaffProjectSummary[]; onSaved: () => void; onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState("open");
  const [saving, setSaving] = useState<string>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const selected = usePortalLocation().get("milestone");
  const matchingMilestones = projects.flatMap(p => (p.deliveryMilestones ?? []).map(m => ({ p, m, key: p.id + ":" + m.id })))
    .filter(({ p, m, key }) => selected ? selected === key || selected === p.id :
      filter === "all" || (!m.completed && m.status !== "waived" && !completed.has(key)));
  const sorted = useSortedRows<typeof matchingMilestones[number], "date" | "project" | "title" | "status" | "completed">(matchingMilestones,
    { key: "date", direction: "asc" }, ({ p, m }, field) => ({
      date: m.date, project: p.name, title: m.title, status: m.status ?? (m.completed ? "completed" : "not started"), completed: m.completedAt,
    })[field], row => row.key);
  const milestones = sorted.rows;
  async function complete(projectId: string, milestoneId: string, reopen = false) {
    const key = projectId + ":" + milestoneId;
    setSaving(key); setError(""); setMessage("");
    try {
      const { revision, project } = await client.call<{ revision: number; project: Project }>(tenant, "projects/" + projectId);
      if (!project.milestones?.some(m => m.id === milestoneId)) throw Error("This milestone is no longer available.");
      const { name, status, progress, description, internalNotes, plan, workOrderReference, updates, delivery } = project;
      await client.call(tenant, "projects/" + projectId, { method: "PATCH", body: {
        expectedRevision: revision, patch: { name, status, progress, description, internalNotes, plan, workOrderReference, updates, delivery,
          milestones: project.milestones.map(m => m.id === milestoneId ?
            (reopen ? { ...m, completed: false, status: "in-progress", completedAt: undefined } :
              { ...m, completed: true, status: "completed", completedAt: today() }) : m) },
      } });
      setCompleted(previous => reopen ? new Set([...previous].filter(value => value !== key)) : new Set([...previous, key]));
      setMessage(project.published
        ? "Milestone completion saved to the draft. Publish changes from the project editor to update the client report."
        : reopen ? "Milestone reopened. Delivery progress has been recalculated." : "Milestone completed. Delivery progress has been recalculated.");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this milestone."); }
    finally { setSaving(undefined); }
  }
  return <section aria-label="Delivery milestones">
    <div className="secure-actions">
      <CsvExport filename={["Morris", tenant, "Milestones", month, filter].filter(Boolean).join("_")}
        label="Export delivery milestones CSV" disabled={Boolean(saving)}
        data={{
          headers: ["Project", "Milestone", "Due date", "Completed date", "Milestone status"],
          rows: milestones.map(({ p, m }) => [p.name, m.title, m.date, m.completedAt, m.status ?? (m.completed ? "completed" : "not started")]),
        }} />
    </div>
    <div className="delivery-section-heading"><div><h3>Delivery milestones</h3><p>Review due dates and close completed work.</p></div>
      {selected ? <button type="button" className="secure-secondary" onClick={() => portalNavigate({ milestone: null })}>Back to all milestones</button> :
        <label>Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open milestones</option><option value="all">All milestones</option></select></label>}</div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {!milestones.length && <p className="secure-empty">No milestones match. Add milestones from a project’s editor.</p>}
    {milestones.length > 1 && <SortControls fields={{ date: "Due date", project: "Project", title: "Milestone", status: "Status", completed: "Completion date" }}
      sort={sorted.sort} onSort={sorted.setSort} label="Sort staff milestones" />}
    <ul className="delivery-milestones">{milestones.map(({ p, m, key }) => <li key={key}>
      <div><button type="button" className="exec-text-button" onClick={() => portalNavigate({ milestone: key })}>{m.title}</button>
        <small>{p.name} · {m.date ? reportDay(m.date) : "No due date"} · {m.completed || completed.has(key) ? "Completed" : m.status?.replaceAll("-", " ") ?? "Not started"}</small></div>
      <button type="button" className="exec-text-button" onClick={() => onOpen(p.id)}>Open project</button>
      {!m.completed && m.status !== "waived" && !completed.has(key) && <button type="button" className="secure-secondary" disabled={Boolean(saving)} onClick={() => void complete(p.id, m.id)}>Mark complete</button>}
      {(m.completed || completed.has(key)) && <button type="button" className="secure-secondary" disabled={Boolean(saving)} onClick={() => void complete(p.id, m.id, true)}>Reopen milestone</button>}
    </li>)}</ul>
  </section>;
}
