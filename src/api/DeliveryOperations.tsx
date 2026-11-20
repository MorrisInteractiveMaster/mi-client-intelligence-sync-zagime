import { useEffect, useState } from "react";
import { deliveryDefaults, engagementTypes, MAX_DELIVERY_PROJECTS, measureDelivery, rollup, type Delivery } from "../projects/delivery";
import { hoursToSeconds } from "../projects/duration";
import type { Project, ProjectPage, StaffProjectSummary } from "../projects/model";
import type { DirectoryEntry, Portfolio, ProjectPlacement } from "../projects/portfolio";
import type { TimeMapping } from "../projects/time";
import { ApiError, type SecuredApiClient } from "./client";
import { projectStatus, reportDay, reportHours, today } from "./dashboard-format";
import { portalNavigate, usePortalLocation } from "./portal-location";
import { ProjectClientReport } from "./ProjectClientReport";
import { PersonPhoto } from "./PersonPhoto";

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

function PeoplePicker({ name, label, people, defaults }: { name: string; label: string; people: DirectoryEntry[]; defaults: string[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(defaults);
  const filtered = people.filter(p => selected.includes(p.id) || (p.active && (p.name + " " + (p.profile?.title || p.role)).toLowerCase().includes(search.trim().toLowerCase())));
  return <fieldset className="delivery-people"><legend>{label} · {selected.length} selected</legend>
    <label>Search {label.toLowerCase()}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <div className="delivery-people-list">{filtered.map(person => <label key={person.id}>
      <input type="checkbox" name={name} value={person.id} checked={selected.includes(person.id)} onChange={e => setSelected(before => e.target.checked ? [...before, person.id] : before.filter(id => id !== person.id))} />
      <PersonPhoto name={person.name} photo={person.profile?.photo} alt={person.profile?.alt} /><span>{person.name}<small>{person.profile?.title || person.role}</small></span></label>)}</div>
    {!filtered.length && <p>No people match. Use Team Directory to add or sync profiles.</p>}
    {selected.filter(id => !people.some(p => p.id === id)).map(id => <input type="hidden" key={id} name={name} value={id} />)}
  </fieldset>;
}

export function readDeliveryForm(form: FormData, original?: Project, placement?: ProjectPlacement): Delivery {
  const get = (key: string) => String(form.get(key) ?? "").trim();
  const optional = (key: string) => get(key) || undefined;
  const cap = (key: "monthlyCap" | "lifetimeCap") => {
    const value = get(key), old = original?.delivery?.[key];
    if (!value) return;
    return value === String(old === undefined ? "" : old / 3600) ? old : hoursToSeconds(value);
  };
  const type = get("deliveryType") as Delivery["type"];
  const days = Number(get("trainingDays"));
  const trainingDates = get("trainingDates").split(/[\s,]+/).filter(Boolean);
  const hasTraining = type === "training" && (days > 0 || trainingDates.length > 0 || get("trainingPreparation") || get("trainingFollowUp") || get("trainingCompletion") || form.has("facilitatorIds"));
  return {
    kind: get("deliveryKind") as Delivery["kind"], type,
    parentId: optional("parentId"), areaId: optional("deliveryArea"), groupId: optional("deliveryGroup"),
    workOrderIds: form.has("workOrdersLoaded") ? form.getAll("deliveryWorkOrders").map(String) : original?.delivery?.workOrderIds,
    monthlyCap: cap("monthlyCap"), lifetimeCap: cap("lifetimeCap"),
    manualCompletion: get("progress") ? Number(get("progress")) : undefined,
    start: optional("deliveryStart"), deadline: optional("deliveryDeadline"),
    publishSummary: form.get("publishSummary") === "on",
    managerIds: form.has("peopleLoaded") ? form.getAll("managerIds").map(String) : original?.delivery?.managerIds ?? (placement?.leadId ? [placement.leadId] : []),
    teamIds: form.has("peopleLoaded") ? form.getAll("teamIds").map(String) : original?.delivery?.teamIds ?? placement?.teamIds ?? [],
    ...(hasTraining ? { training: { days: days || trainingDates.length || 1, dates: trainingDates,
      preparation: optional("trainingPreparation"), followUp: optional("trainingFollowUp"), completion: optional("trainingCompletion"),
      facilitatorIds: form.has("peopleLoaded") ? form.getAll("facilitatorIds").map(String) : original?.delivery?.training?.facilitatorIds ?? [] } } : {}),
  };
}

export function DeliveryFields({ project, projects, portfolio, mappings }: {
  project?: Project; projects: StaffProjectSummary[]; portfolio?: Portfolio; mappings?: TimeMapping[];
}) {
  const oldPlacement = portfolio?.placements.find(item => item.id === project?.id);
  const d = project?.delivery ?? { ...deliveryDefaults, areaId: oldPlacement?.areaId, groupId: oldPlacement?.engagementId,
    start: oldPlacement?.start, deadline: oldPlacement?.target, managerIds: oldPlacement?.leadId ? [oldPlacement.leadId] : [], teamIds: oldPlacement?.teamIds ?? [] };
  const [projectSearch, setProjectSearch] = useState("");
  const [type, setType] = useState(d.type);
  const [parent, setParent] = useState(d.parentId ?? "");
  const list = projects.filter(p => p.id !== project?.id && (p.id === parent || p.name.toLowerCase().includes(projectSearch.trim().toLowerCase())));
  const hourText = (value?: number) => value === undefined ? "" : String(value / 3600);
  return <div className="delivery-fields">
    <fieldset className="secure-editor-grid"><legend>Client and project hierarchy</legend>
      <label>Project type<select name="deliveryKind" defaultValue={d.kind}><option value="project">Delivery project</option><option value="engagement">Parent engagement</option></select></label>
      <label>Find parent projects<input type="search" value={projectSearch} onChange={e => setProjectSearch(e.target.value)} /></label>
      <label>Parent project<select name="parentId" value={parent} onChange={e => setParent(e.target.value)}><option value="">Client root</option>
        {parent && !list.some(p => p.id === parent) && <option value={parent}>Current parent</option>}
        {list.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </fieldset>
    <details className="delivery-details"><summary>Department, group and work orders</summary><div className="secure-editor-grid">
      <label>Service area<select name="deliveryArea" defaultValue={d.areaId ?? ""}><option value="">Unclassified</option>
        {!portfolio && d.areaId && <option value={d.areaId}>Current department</option>}{portfolio?.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Reporting group<select name="deliveryGroup" defaultValue={d.groupId ?? ""}><option value="">None</option>
        {!portfolio && d.groupId && <option value={d.groupId}>Current group</option>}{portfolio?.engagements.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      {mappings && <fieldset className="secure-field-wide"><legend>Verified QuickBooks Time work orders</legend><input type="hidden" name="workOrdersLoaded" value="1" />
        <p>Linking a work order here leaves recorded time and historical allocations in place.</p>
        {mappings.map(m => <label className="secure-check" key={m.jobcodeId}><input type="checkbox" name="deliveryWorkOrders" value={m.jobcodeId} defaultChecked={d.workOrderIds?.includes(m.jobcodeId)} /> {m.sourceName ?? m.jobcodeId}</label>)}
        {d.workOrderIds?.filter(id => !mappings.some(m => m.jobcodeId === id)).map(id => <input key={id} type="hidden" name="deliveryWorkOrders" value={id} />)}
      </fieldset>}
    </div></details>
    <details className="delivery-details"><summary>Caps, engagement and dates</summary><div className="secure-editor-grid">
      <label>Engagement type<select name="deliveryType" value={type} onChange={e => setType(e.target.value as Delivery["type"])}>{engagementTypes.map(t => <option value={t} key={t}>{t === "fixed-fee" ? "Fixed fee" : t === "training" ? "Training or workshop" : "Hourly"}</option>)}</select></label>
      <label>Monthly cap (hours)<input name="monthlyCap" inputMode="decimal" defaultValue={hourText(d.monthlyCap)} placeholder="No cap" /></label>
      <label>Lifetime cap (hours)<input name="lifetimeCap" inputMode="decimal" defaultValue={hourText(d.lifetimeCap)} placeholder="No cap" /></label>
      <label>Start date<input name="deliveryStart" type="date" defaultValue={d.start} /></label>
      <label>Deadline<input name="deliveryDeadline" type="date" defaultValue={d.deadline} /></label>
      <label className="secure-check"><input name="publishSummary" type="checkbox" defaultChecked={d.publishSummary} /> Share caps, dates and delivery completion with authorized clients</label>
      {type === "training" && <>
        <label>Session days<input name="trainingDays" type="number" min={1} max={60} defaultValue={d.training?.days} /></label>
        <label>Session dates<input name="trainingDates" placeholder="YYYY-MM-DD, YYYY-MM-DD" defaultValue={d.training?.dates.join(", ")} /></label>
        <label>Preparation date<input name="trainingPreparation" type="date" defaultValue={d.training?.preparation} /></label>
        <label>Follow-up date<input name="trainingFollowUp" type="date" defaultValue={d.training?.followUp} /></label>
        <label>Session completion date<input name="trainingCompletion" type="date" defaultValue={d.training?.completion} /></label>
        {portfolio && <PeoplePicker name="facilitatorIds" label="Facilitators" people={portfolio.directory} defaults={d.training?.facilitatorIds ?? []} />}
      </>}
    </div></details>
    {portfolio && <details className="delivery-details"><summary>Project managers and team</summary><input type="hidden" name="peopleLoaded" value="1" />
      <PeoplePicker name="managerIds" label="Project managers" people={portfolio.directory} defaults={d.managerIds} />
      <PeoplePicker name="teamIds" label="Team members" people={portfolio.directory} defaults={d.teamIds} />
    </details>}
  </div>;
}

export function DeliveryDirectory({ client, tenant, portfolio, revision, onSaved, onDenied }: {
  client: SecuredApiClient; tenant: string; portfolio?: Portfolio; revision: number; onSaved: () => void; onDenied: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const person = portfolio?.directory.find(p => p.id === selected);
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
    {!portfolio && <p className="secure-empty" role="status">Loading team profiles…</p>}
    {portfolio && !portfolio.directory.length && <p className="secure-empty">No team profiles yet. Sync the Morris team or add a manual profile in portfolio management.</p>}
    <div className="delivery-directory">{portfolio?.directory.filter(p => p.name.toLowerCase().includes(search.trim().toLowerCase())).map(p => <button type="button" className="delivery-person" key={p.id} onClick={() => setSelected(p.id)} aria-pressed={selected === p.id}>
      <PersonPhoto name={p.name} photo={p.profile?.photo} alt={p.profile?.alt} /><span><b>{p.name}</b><small>{p.profile?.title || p.role || "Title unavailable"}</small></span></button>)}</div>
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
      <div className="delivery-section-heading"><h3>{person.name}</h3><button type="button" className="secure-secondary" onClick={() => setSelected(undefined)}>Close profile</button></div>
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

export function DeliveryPreview({ client, tenant, month }: { client: SecuredApiClient; tenant: string; month: string }) {
  const [profiles, setProfiles] = useState<{id: string; label: string}[]>();
  const [scope, setScope] = useState("");
  const location = usePortalLocation();
  const mode = location.get("previewMode") === "draft" ? "draft" : "published";
  const previewProject = location.get("previewProject");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    client.call<{id: string; label: string}[]>(tenant, "client-preview/scopes", { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setProfiles(value); if (value.length === 1) setScope(value[0].id); }
    }).catch(() => { if (!controller.signal.aborted) setError("Client access profiles are temporarily unavailable."); });
    return () => controller.abort();
  }, [client, tenant]);
  const entitled = mode === "draft" || Boolean(scope);
  return <section aria-label="Preview as client">
    <div className="delivery-section-heading"><div><h3>Preview as client</h3><p>Published preview follows the selected client access profile. Draft preview includes saved changes and private projects.</p></div>
      <button type="button" className="secure-secondary" onClick={() => portalNavigate({
        staff: previewProject ? "projects" : "overview", editor: previewProject, previewProject: null, previewMode: null,
        view: null, q: null, status: null, present: null, chart: null,
      })}>{previewProject ? "Back to project" : "Back to overview"}</button></div>
    <div className="delivery-filters">
      <label>Preview mode<select value={mode} onChange={e => { setError(""); portalNavigate({
        previewMode: e.target.value === "draft" ? "draft" : null,
        view: previewProject ? "project:" + previewProject : null, q: null, present: null, chart: null,
      }, true); }}><option value="published">Live published view</option><option value="draft">Staff-only draft preview</option></select></label>
      {mode === "published" && <label>Client access profile<select value={scope} onChange={e => { setScope(e.target.value); setError(""); }}><option value="">Select an approved profile</option>{profiles?.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>}
    </div>
    {error && <p role="alert">{error}</p>}
    {entitled && <div className="delivery-preview-frame"><p className="delivery-watermark">{mode === "draft" ? "DRAFT PREVIEW · MORRIS STAFF ONLY" : "LIVE PUBLISHED VIEW · MORRIS STAFF PREVIEW"}</p>
      <ProjectClientReport client={client} tenant={tenant} month={month} preview={{ mode, ...(mode === "published" ? { scope } : {}) }}
        onDenied={() => setError("This client access profile is no longer available.")} /></div>}
  </section>;
}

export function DeliveryHealth({ projects, portfolio, healthOnly = false, onOpen }: {
  projects: StaffProjectSummary[]; portfolio?: Portfolio; healthOnly?: boolean; onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [layout, setLayout] = useState("tree");
  const [area, setArea] = useState("");
  const [group, setGroup] = useState("");
  const index = new Map(projects.map(p => [p.id, p]));
  const totals = rollup(projects);
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
  const rows = projects.map(p => ({ p, trail: depth(p), area: p.delivery?.areaId ?? placements.get(p.id)?.areaId, group: p.delivery?.groupId ?? placements.get(p.id)?.engagementId }))
    .filter(row => (!area || row.area === area) && (!group || row.group === group) && [row.p.name, ...row.trail].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b) => (layout === "tree" ? [...a.trail, a.p.name].join(" / ").localeCompare([...b.trail, b.p.name].join(" / ")) : a.p.name.localeCompare(b.p.name)));
  const budgetRows = [...(portfolio?.areas ?? []).map(item => ({ item, classification: "Department", matches: (p: StaffProjectSummary) => (p.delivery?.areaId ?? placements.get(p.id)?.areaId) === item.id })),
    ...(portfolio?.engagements ?? []).map(item => ({ item, classification: "Reporting group", matches: (p: StaffProjectSummary) => (p.delivery?.groupId ?? placements.get(p.id)?.engagementId) === item.id }))]
    .map(({ item, classification, matches }) => {
      const allocated = projects.filter(matches);
      const month = allocated.reduce((sum, p) => sum + p.seconds, 0), lifetime = allocated.reduce((sum, p) => sum + p.lifetimeSeconds, 0);
      return { item, classification, month, lifetime };
    });
  return <section>
    <div className="delivery-section-heading"><div><h3>{healthOnly ? "Budgets and delivery health" : "Project hierarchy"}</h3>
      <p>Allocated hours measure effort. Milestones and manual assessments measure completion.</p></div></div>
    {healthOnly && !!budgetRows.length && <details className="delivery-details"><summary>Department and group caps</summary>
      <dl>{budgetRows.map(({ item, classification, month, lifetime }) => <div key={classification + item.id}><dt>{item.name} · {classification}</dt>
        <dd>{reportHours(month)} h allocated monthly · {item.monthlyCap === undefined ? "No monthly cap" : reportHours(item.monthlyCap - month) + " h remaining"}</dd>
        <dd>{reportHours(lifetime)} h allocated lifetime · {item.lifetimeCap === undefined ? "No lifetime cap" : reportHours(item.lifetimeCap - lifetime) + " h remaining"}</dd>
      </div>)}</dl></details>}
    <div className="delivery-filters"><label>Search hierarchy<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Department<select value={area} onChange={e => setArea(e.target.value)}><option value="">All departments</option>{portfolio?.areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Reporting group<select value={group} onChange={e => setGroup(e.target.value)}><option value="">All groups</option>{portfolio?.engagements.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Layout<select value={layout} onChange={e => setLayout(e.target.value)}><option value="tree">Hierarchy</option><option value="table">Alphabetical table</option></select></label>
    </div>
    {!rows.length && <p className="secure-empty">No projects match.</p>}
    {!!rows.length && <div className="intel-table-scroll" tabIndex={0} aria-label="Project hierarchy table"><table><thead><tr>
      <th scope="col">Project / parent</th><th scope="col">Department / type</th><th scope="col">Managers</th><th scope="col">Allocated effort</th><th scope="col">Remaining cap</th><th scope="col">Completion and health</th><th scope="col">Publication</th>
    </tr></thead><tbody>{rows.map(({ p, trail, area }) => {
      const sum = totals.get(p.id)!;
      const result = measureDelivery({ ...p, milestones: p.deliveryMilestones ?? p.milestones }, sum, asOf);
      const managers = p.delivery?.managerIds ?? (placements.get(p.id)?.leadId ? [placements.get(p.id)!.leadId] : []);
      const branch = descendants.get(p.id) ?? [];
      const active = branch.filter(child => child.status === "active").length;
      const completed = branch.filter(child => child.status === "completed").length;
      const departments = new Set(branch.map(child => child.delivery?.areaId ?? placements.get(child.id)?.areaId).filter(Boolean)).size;
      const upcoming = branch.flatMap(child => [child.delivery?.deadline, ...(child.deliveryMilestones ?? [])
        .filter(m => !m.completed && m.status !== "waived").map(m => m.date)]).filter((date): date is string => Boolean(date && date >= asOf)).sort()[0];
      return <tr key={p.id}><th scope="row"><button type="button" className="exec-text-button" style={{ marginInlineStart: layout === "tree" ? Math.min(trail.length, 5) * 12 : 0 }} onClick={() => onOpen(p.id)}>{p.name}</button>
        <small>{trail.length ? trail.join(" / ") : "Client root"}{sum.descendants ? " · " + sum.descendants + " descendant projects" : ""}</small>
        {!!branch.length && <small>{departments} {departments === 1 ? "department" : "departments"} · {active} active · {completed} completed</small>}</th>
        <td>{portfolio?.areas.find(a => a.id === area)?.name ?? "Unclassified"}<small>{p.delivery?.type ?? "Engagement type not configured"}</small></td>
        <td>{managers.map(id => people.get(id)).filter(Boolean).join(", ") || "Unassigned"}</td>
        <td>{reportHours(sum.monthly)} h monthly<small>{reportHours(sum.lifetime)} h lifetime</small></td>
        <td>{result.monthlyRemaining === undefined ? "No monthly cap" : reportHours(result.monthlyRemaining) + " h monthly"}
          <small>{result.lifetimeRemaining === undefined ? "No lifetime cap" : reportHours(result.lifetimeRemaining) + " h lifetime"}</small></td>
        <td>{result.completion === undefined ? "Not configured" : result.completion + "% complete"}<small>{result.health}{result.upcoming ? " · " + reportDay(result.upcoming) : ""}</small>
          {upcoming && <small>Next child deadline {reportDay(upcoming)}</small>}</td>
        <td>{p.published ? "Published" : "Private draft"}<small>{projectStatus[p.status]}</small></td></tr>;
    })}</tbody></table></div>}
  </section>;
}

export function DeliveryMilestones({ client, tenant, projects, onSaved, onOpen }: {
  client: SecuredApiClient; tenant: string; projects: StaffProjectSummary[]; onSaved: () => void; onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState("open");
  const [saving, setSaving] = useState<string>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const milestones = projects.flatMap(p => (p.deliveryMilestones ?? []).map(m => ({ p, m, key: p.id + ":" + m.id })))
    .filter(({ m, key }) => filter === "all" || (!m.completed && m.status !== "waived" && !completed.has(key)))
    .sort((a, b) => (a.m.date || "9999").localeCompare(b.m.date || "9999"));
  async function complete(projectId: string, milestoneId: string) {
    const key = projectId + ":" + milestoneId;
    setSaving(key); setError(""); setMessage("");
    try {
      const { revision, project } = await client.call<{ revision: number; project: Project }>(tenant, "projects/" + projectId);
      if (!project.milestones?.some(m => m.id === milestoneId)) throw Error("This milestone is no longer available.");
      const { name, status, progress, description, internalNotes, plan, workOrderReference, updates, delivery } = project;
      await client.call(tenant, "projects/" + projectId, { method: "PATCH", body: {
        expectedRevision: revision, patch: { name, status, progress, description, internalNotes, plan, workOrderReference, updates, delivery,
          milestones: project.milestones.map(m => m.id === milestoneId ? { ...m, completed: true, status: "completed", completedAt: today() } : m) },
      } });
      setCompleted(previous => new Set([...previous, key]));
      setMessage(project.published
        ? "Milestone completion saved to the draft. Publish changes from the project editor to update the client report."
        : "Milestone completed. Delivery progress has been recalculated.");
      onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save this milestone."); }
    finally { setSaving(undefined); }
  }
  return <section aria-label="Delivery milestones">
    <div className="delivery-section-heading"><div><h3>Delivery milestones</h3><p>Review due dates and close completed work.</p></div>
      <label>Show<select value={filter} onChange={e => setFilter(e.target.value)}><option value="open">Open milestones</option><option value="all">All milestones</option></select></label></div>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {!milestones.length && <p className="secure-empty">No milestones match. Add milestones from a project’s editor.</p>}
    <ul className="delivery-milestones">{milestones.map(({ p, m, key }) => <li key={key}>
      <div><b>{m.title}</b><small>{p.name} · {reportDay(m.date)} · {m.completed || completed.has(key) ? "Completed" : m.status?.replaceAll("-", " ") ?? "Not started"}</small></div>
      <button type="button" className="exec-text-button" onClick={() => onOpen(p.id)}>Open project</button>
      {!m.completed && m.status !== "waived" && !completed.has(key) && <button type="button" className="secure-secondary" disabled={Boolean(saving)} onClick={() => void complete(p.id, m.id)}>Mark complete</button>}
    </li>)}</ul>
  </section>;
}
