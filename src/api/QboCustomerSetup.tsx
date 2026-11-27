import { Building2, Check, ChevronRight, FolderKanban, Link2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { QboCustomer, QboProjectRow, QboSetup } from "../projects/qbo-discovery";
import { PlatformLink } from "./PlatformHome";
import { periodHref } from "./portal-location";
import type { SecuredApiClient } from "./client";

export function QboCustomerSetup({ client, tenant, setup, reload, month }: {
  client: SecuredApiClient; tenant: string; setup: QboSetup; reload: () => void; month: string;
}) {
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<{ value: string; page: number; matches: QboCustomer[]; more: boolean }>();
  const [customer, setCustomer] = useState<QboCustomer>();
  const [changing, setChanging] = useState(false);
  const [selected, setSelected] = useState<QboProjectRow>();
  const [target, setTarget] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [targetFilter, setTargetFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  useEffect(() => {
    setSearch(undefined); setCustomer(undefined); setChanging(false); setSelected(undefined); setTarget("");
  }, [setup.company.realm, setup.binding]);
  async function request<T>(action: string, fields: Record<string, unknown> = {}) {
    return client.call<T>(tenant, "invoices/discovery", {
      method: "POST", body: { action, realm: setup.company.realm, bindingId: setup.binding ?? null, ...fields },
    });
  }
  async function submit(action: string, fields: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setStatus("");
    try {
      await request(action, fields);
      reload(); setStatus(message); setSelected(undefined);
    } catch {
      setError("QuickBooks setup could not be updated. Confirm the connection and try again.");
      reload();
    } finally { setBusy(false); }
  }
  async function find(value: string, page: number) {
    setBusy(true); setError(""); setCustomer(undefined);
    try {
      const data = await request<{ matches: QboCustomer[]; more: boolean }>("search", { term: value, page });
      setSearch({ value, page, ...data });
    } catch {
      setError("Customer search could not be completed. Try again or reconnect to QuickBooks Online.");
    } finally { setBusy(false); }
  }
  const visible = setup.projects.filter(project => project.name.toLocaleLowerCase().includes(projectFilter.trim().toLocaleLowerCase()));
  const targets = setup.choices.filter(item => (item.name + " " + (item.workOrder ?? "")).toLocaleLowerCase().includes(targetFilter.trim().toLocaleLowerCase()));
  return <section className="mi-qbo-setup" aria-label="QuickBooks connection setup" aria-busy={busy}>
    <header className="mi-qbo-company">
      <Building2 size={22} aria-hidden="true" />
      <div><p className="mi-kicker">Connected company</p><h3>{setup.company.name}</h3>
        <p>{setup.company.currency} home currency · {setup.confirmed ? "Confirmed by Morris staff" : "Awaiting staff confirmation"}</p></div>
      {setup.confirmed ? <span className="mi-qbo-confirmed"><Check size={15} aria-hidden="true" /> Confirmed</span> :
        <button type="button" disabled={busy} onClick={() => void submit("confirm-company", {}, "Company confirmed. Search for the customer to connect.")}>Confirm company</button>}
    </header>
    {!setup.confirmed && <p>Check that this is the correct QuickBooks company before selecting a customer.</p>}
    {setup.confirmed && setup.root && !changing && <div className="mi-qbo-binding">
      <div><b>Bound customer</b><h3>{setup.root.name}</h3><p>{setup.projects.length} discovered projects and jobs · {setup.projects.filter(row => row.linked).length} linked</p></div>
      <button type="button" className="secure-secondary" onClick={() => { setChanging(true); setSearch(undefined); setCustomer(undefined); }}>Change customer</button>
    </div>}
    {setup.confirmed && (!setup.root || changing) && <div className="mi-qbo-picker">
      <form onSubmit={event => { event.preventDefault(); void find(term.trim(), 1); }}>
        <label>Search for a customer<input type="search" placeholder="Enter the customer’s name" value={term}
          minLength={2} maxLength={100} onChange={event => setTerm(event.target.value)} required /></label>
        <button type="submit" disabled={busy || term.trim().length < 2}><Search size={16} aria-hidden="true" /> Search</button>
        {changing && <button type="button" className="secure-secondary" disabled={busy} onClick={() => setChanging(false)}>Cancel</button>}
      </form>
      {search && <div>
        <p role="status">{search.matches.length ? search.matches.length + " matching top-level customers on this page" : "No matching top-level customers on this page"}</p>
        <div className="mi-qbo-choice-list">
          {search.matches.map(match => <button type="button" key={match.id} className="secure-secondary" aria-pressed={customer?.id === match.id}
            disabled={busy} onClick={() => setCustomer(match)}>
            <span>{match.name}</span><small>{match.active ? "Active" : "Inactive"} · Ref. ending {match.id.slice(-6)}</small><ChevronRight size={16} aria-hidden="true" /></button>)}
        </div>
        {(search.more || search.page > 1) && <div className="mi-invoice-pagination">
          <button type="button" className="secure-secondary" disabled={busy || search.page === 1} onClick={() => void find(search.value, search.page - 1)}>Previous customer results</button>
          <span>Page {search.page}</span>
          <button type="button" className="secure-secondary" disabled={busy || !search.more} onClick={() => void find(search.value, search.page + 1)}>Next customer results</button>
        </div>}
      </div>}
      {customer && <div className="mi-qbo-binding">
        <div><b>Selected customer</b><h3>{customer.name}</h3><p>Confirm that this customer belongs to the current platform workspace.</p></div>
        <button type="button" disabled={busy} onClick={() => {
          if (window.confirm(setup.root ? "Replace the bound customer? This removes the previous invoice snapshot and all its approvals." :
            "Bind " + customer.name + " to this workspace and discover its projects?")) {
            void submit("bind", { rootId: customer.id }, "Customer bound. Review discovered projects, then sync invoices.");
          }
        }}>Confirm customer binding</button>
      </div>}
    </div>}
    {setup.root && !changing && <details className="mi-qbo-inventory" open={setup.projects.length < 12 || undefined}>
      <summary><FolderKanban size={18} aria-hidden="true" /> Discovered projects and jobs <b>{setup.projects.length}</b></summary>
      <p>Exact work-order matches are suggestions. Linked platform projects keep their existing visibility and QuickBooks Time mappings.</p>
      {!setup.native && <p>Projects stored only as native QuickBooks projects need the optional Intuit Projects permission for verification.</p>}
      {setup.held ? <p role="status">{setup.held} invoice{setup.held === 1 ? " has" : "s have"} project references that could not be verified. These invoices are excluded from the register.</p> : null}
      {setup.projects.length > 8 && <label>Find a discovered project<input type="search" value={projectFilter} onChange={event => setProjectFilter(event.target.value)} /></label>}
      {!visible.length && <p>{setup.projects.length ? "No matches." : "QuickBooks returned no descendants for this customer."}</p>}
      <ul>
        {visible.map(project => <li key={project.key}>
          <div><b>{project.name}</b><p>{project.kind === "job" ? "Customer job" : "Native QuickBooks project"}
            {!project.active && " · Historical"}{project.newlyDiscovered && " · Newly discovered"}</p></div>
          {project.linked ? <span className="mi-qbo-confirmed"><Check size={15} aria-hidden="true" /> Linked to {setup.choices.find(choice => choice.id === project.linked)?.name ?? "platform project"}</span> :
            <div className="mi-qbo-link-actions"><span>Unmapped{project.suggestions.length === 1 ? " · Suggested match" : project.suggestions.length > 1 ? " · Multiple possible matches" : ""}</span>
              <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
                setSelected(project); setTarget(project.suggestions.length === 1 ? project.suggestions[0] : ""); setTargetFilter("");
              }}><Link2 size={15} aria-hidden="true" /> Link to Existing Project</button>
              <PlatformLink className="mi-qbo-create-link" href={periodHref("/workspace/projects/new", month, { "qbo-source": project.key })}>Create Project</PlatformLink>
            </div>}
        </li>)}
      </ul>
    </details>}
    {selected && <form className="mi-qbo-link-project" onSubmit={event => {
      event.preventDefault(); void submit("link", { source: selected.key, projectId: target }, "Project linked. Review any affected invoice approvals.");
    }}>
      <h3>Link {selected.name}</h3>
      <label>Find a platform project<input type="search" value={targetFilter} onChange={e => setTargetFilter(e.target.value)} /></label>
      <label>Platform project<select aria-label="Platform project" value={target} onChange={e => setTarget(e.target.value)} required>
        <option value="">Select a project</option>
        {targets.map(item => <option key={item.id} value={item.id}>{item.name}{item.workOrder ? " · " + item.workOrder : ""}</option>)}
      </select></label>
      <button type="submit" disabled={!target || busy}>Confirm link</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => setSelected(undefined)}>Cancel</button>
    </form>}
    <details className="mi-qbo-diagnostics"><summary>Connection diagnostics</summary>
      <p>Verified realm {setup.company.realm}{setup.root && " · CustomerRef " + setup.root.id}</p>
      {setup.discoveredAt && <p>Inventory checked <time dateTime={setup.discoveredAt}>{new Date(setup.discoveredAt).toLocaleString("en-CA", { timeZone: "America/Regina" })} Regina</time></p>}
      {setup.projects.length > 0 && <ul>{setup.projects.map(project => <li key={project.key}>{project.name} · {project.key}</li>)}</ul>}
    </details>
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
