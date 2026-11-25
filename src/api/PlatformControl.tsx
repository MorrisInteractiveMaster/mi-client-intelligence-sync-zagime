import { WorkspaceToolbarControls } from "./WorkspaceToolbar";
import { isZagimeClient } from "../config/client-identity";
import { ArrowLeft, ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ProjectPage, ProjectWorkspace, StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import type { PlatformControl as ControlData } from "../projects/control";
import { ApiError, type SecuredApiClient } from "./client";
import { DeliveryDirectory, projectCatalog } from "./DeliveryOperations";
import { reportTimestamp } from "./dashboard-format";
import { PlatformLink } from "./PlatformHome";
import { clientBase, controlSections, type ControlSection } from "./platform-routes";
import { navigatePlatform, periodHref, portalNavigate } from "./portal-location";
import { TimeConnectionPanel } from "./TimeConnectionPanel";
import { EmployeeMapping } from "./EmployeeMapping";
import { ReportingMonthField } from "./ReportingPeriod";

type Props = {
  client: SecuredApiClient;
  workspace: ProjectWorkspace;
  section?: ControlSection;
  month: string;
  onDenied: () => void;
  onUnsavedChange: (dirty: boolean) => void;
  homeLink: ReactNode;
};

export function PlatformControl({ client, workspace, section, month, onDenied, onUnsavedChange, homeLink }: Props) {
  const tenant = workspace.tenant.id;
  const [control, setControl] = useState<ControlData>();
  const [portfolio, setPortfolio] = useState<Portfolio>();
  const [projects, setProjects] = useState<StaffProjectSummary[]>([]);
  const [scopes, setScopes] = useState<{ id: string; label: string }[]>();
  const [audits, setAudits] = useState<ProjectPage["audits"]>();
  const [auditCursor, setAuditCursor] = useState<string>();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sectionMenu = useRef<HTMLDetailsElement>(null);
  const refresh = () => setVersion(v => v + 1);
  const permit = () => !dirty || window.confirm("Leave without saving these settings?");
  const title = section ? controlSections[section] : "Control Panel";
  function fail(reason: unknown) {
    if (reason instanceof ApiError && [401, 403].includes(reason.status)) onDenied();
    else setError(reason instanceof Error ? reason.message : "This request could not be completed.");
  }
  useEffect(() => {
    document.title = title + " · Morris Interactive";
    const controller = new AbortController(), signal = controller.signal;
    setError(""); setNotice(""); setDirty(false);
    setAudits(undefined); setAuditCursor(undefined);
    client.call<ControlData>(tenant, "control", { signal }).then(data => {
      if (signal.aborted) return;
      setControl(data);
      if (section === "access" || section === "onboarding")
        return client.call<{ id: string; label: string }[]>(tenant, "client-preview/scopes", { signal }).then(result => {
          if (!signal.aborted) setScopes(result);
        });
      if (section === "team")
        return client.call<{ portfolio: Portfolio }>(tenant, "portfolio?month=" + month, { signal }).then(result => {
          if (!signal.aborted) setPortfolio(result.portfolio);
        });
      if (section === "time" || section === "work-orders")
        return projectCatalog(client, tenant, month, signal).then(result => {
          if (!signal.aborted) setProjects(result);
        });
      if (section === "audit")
        return client.call<ProjectPage>(tenant, "audits?month=" + month, { signal }).then(result => {
          if (!signal.aborted) { setAudits(result.audits ?? []); setAuditCursor(result.nextCursor); }
        });
    }).catch(reason => { if (!signal.aborted) fail(reason); });
    return () => controller.abort();
  }, [client, tenant, section, month, version, title, onDenied]);
  useEffect(() => { onUnsavedChange(dirty); return () => onUnsavedChange(false); }, [dirty, onUnsavedChange]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); }
    catch (reason) { fail(reason); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!control) return;
    const form = new FormData(event.currentTarget);
    const settings = {
      ...control.settings,
      ...(section === "branding" && !isZagimeClient(tenant) ? { clientLabel: String(form.get("clientLabel")) } : {}),
      ...(section === "presentation" ? { presentationTitle: String(form.get("presentationTitle")) } : {}),
      ...(section === "publication" ? { ownerPublishes: form.has("ownerPublishes") } : {}),
    };
    await run(async () => {
      const updated = await client.call<ControlData>(tenant, "control", { method: "PATCH", body: { expectedRevision: control.revision, settings } });
      setControl(updated); setDirty(false); setNotice("Settings saved.");
    });
  }
  function sectionLinks(compact = false) {
    const beforeNavigate = () => {
      if (!permit()) return false;
      const menu = sectionMenu.current;
      if (compact && menu) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
      return true;
    };
    return <nav aria-label="Control Panel sections" className="platform-control-nav">
      <PlatformLink href={periodHref("/control", month)} beforeNavigate={beforeNavigate} aria-current={!section ? "page" : undefined}>Control Panel home</PlatformLink>
      {Object.entries(controlSections).map(([key, label]) =>
        <PlatformLink key={key} href={periodHref("/control/" + key, month)} aria-current={key === section ? "page" : undefined} beforeNavigate={beforeNavigate}>{label}</PlatformLink>)}
      {homeLink}
    </nav>;
  }
  return <main id="platform-content" className="platform-control">
    <div className="platform-control-layout">
      <aside className="platform-control-rail">
        <div className="platform-control-wide-nav">{sectionLinks()}</div>
        <details className="platform-control-compact-nav" ref={sectionMenu} onKeyDown={event => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}>
          <summary>Control Panel sections <ChevronDown size={16} aria-hidden="true" /></summary>
          {sectionLinks(true)}
        </details>
      </aside>
      <section className="platform-control-card" aria-label={title}>
        <header className="mi-page-heading"><p className="mi-kicker">{workspace.tenant.name}</p><h2>{title}</h2></header>
        <div className="mi-control-toolbar"><PlatformLink href={periodHref("/workspace", month)} beforeNavigate={permit} className="platform-back"><ArrowLeft size={16} aria-hidden="true" /> Back to Morris Workspace</PlatformLink>
        <ReportingMonthField month={month} onMonth={selected => { if (permit()) portalNavigate({ month: selected }); }} /><WorkspaceToolbarControls /></div>
        {error && <p role="alert" className="secure-message secure-error">{error} <button type="button" className="secure-secondary" disabled={busy} onClick={() => { if (permit()) refresh(); }}>Reload</button></p>}
        {notice && <p role="status" className="secure-message">{notice}</p>}
        {!control && !error && <p role="status">Checking Control Panel access…</p>}
        {control && (!section ? <>
          <h3>Administration for {workspace.tenant.name}</h3>
          <div className="platform-control-shortcuts">
            <PlatformLink href={periodHref("/control/access", month)}>Review client access <ArrowUpRight size={16} aria-hidden="true" /></PlatformLink>
            <PlatformLink href={periodHref("/control/time", month)}>Check QuickBooks Time <ArrowUpRight size={16} aria-hidden="true" /></PlatformLink>
            <PlatformLink href={periodHref("/control/audit", month)}>Review recent activity <ArrowUpRight size={16} aria-hidden="true" /></PlatformLink>
          </div>
        </> : <>
          {section === "access" && <><h3>Approved client access profiles</h3><p>Published previews use the project grants of the selected client profile.</p>
            {!scopes ? <p role="status">Loading approved profiles…</p> : scopes.length ? <ul>{scopes.map(scope => <li key={scope.id}>
              <PlatformLink href={periodHref(clientBase, month, { previewScope: scope.id })}>{scope.label}</PlatformLink>
            </li>)}</ul> : <p>No approved profiles currently have published access.</p>}</>}
          {section === "staff" && <><h3>Workspace permissions</h3><dl className="platform-policy-list">
            <div><dt>Platform administrator</dt><dd>Verified Morris Microsoft account with the owner-configured administrator identity. Can manage Control Panel settings.</dd></div>
            <div><dt>Morris operational staff</dt><dd>Verified Morris Microsoft account scoped to this client workspace. Can manage projects, team assignments and Time allocations.</dd></div>
            <div><dt>Client user</dt><dd>Approved Google account with explicit access to published projects.</dd></div>
          </dl></>}
          {section === "team" && <DeliveryDirectory client={client} tenant={tenant} portfolio={portfolio} revision={control.revision} onSaved={refresh} onDenied={onDenied} />}
          {(section === "time" || section === "work-orders") && <TimeConnectionPanel client={client} tenant={tenant} month={month} projects={projects}
            refreshVersion={version} busy={busy} run={run} onChanged={refresh} onDenied={onDenied} manage={section === "work-orders"} />}
          {section === "audit" && <><h3>Workspace audit history</h3>
            {!audits ? <p role="status">Loading audit history…</p> : audits.length ? <ul className="platform-audit">{audits.map(item =>
              <li key={item.id}><span>{item.action.replace(/-/g, " ")}</span><time dateTime={item.at}>{reportTimestamp(item.at)}</time></li>)}</ul> : <p>No audit entries are available.</p>}
            {auditCursor && <button type="button" disabled={busy} onClick={() => void run(async () => {
              const page = await client.call<ProjectPage>(tenant, "audits?" + new URLSearchParams({ month, cursor: auditCursor }));
              setAudits(previous => [...(previous ?? []), ...(page.audits ?? [])]); setAuditCursor(page.nextCursor);
            })}>More audit entries</button>}</>}
          {section === "onboarding" && <><h3>Client onboarding status</h3><dl className="platform-policy-list">
            <div><dt>Approved workspace</dt><dd>{workspace.tenant.name}</dd></div>
            <div><dt>Approved access profiles</dt><dd>{scopes ? scopes.length : "Checking…"}</dd></div>
            <div><dt>Additional clients</dt><dd>Onboard each legal client after verifying data residency, tenant binding, identity, source scope and publication approval with the owner.</dd></div>
          </dl><PlatformLink href={periodHref("/control/access", month)}>View current client access</PlatformLink></>}
          {section === "employee-mapping" && <EmployeeMapping client={client} tenant={tenant} onDenied={onDenied}
            onViewTime={userId => navigatePlatform(periodHref("/workspace/time", month, { consultant: userId, period: "all" }))} />}
          {["branding", "publication", "presentation"].includes(section) && <form key={section + "-" + control.revision} className="secure-form" onSubmit={save} onChange={() => setDirty(true)}>
            <h3>{title} settings</h3>
            {section === "branding" && (isZagimeClient(tenant) ? <p>Client display name: {workspace.tenant.name}</p> : <label title="The label does not change the underlying source customer or project permissions.">Client dashboard display label
              <input maxLength={95} name="clientLabel" defaultValue={control.settings.clientLabel} placeholder={workspace.tenant.name} /></label>)}
            {section === "presentation" && <label>Title on the opening presentation chapter
              <input maxLength={100} name="presentationTitle" defaultValue={control.settings.presentationTitle} placeholder={workspace.tenant.name} /></label>}
            {section === "publication" && <label className="secure-check"><input type="checkbox" name="ownerPublishes" defaultChecked={control.settings.ownerPublishes} /> Require a platform administrator to publish or unpublish</label>}
            <button type="submit" disabled={busy || !dirty}>{busy ? "Saving…" : "Save settings"}</button>
          </form>}
        </>)}
      </section>
    </div>
  </main>;
}
