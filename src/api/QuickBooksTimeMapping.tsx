import { ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { useEffect, useState } from "react";
import type { StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import { type TimeMapping, type TimeMappingReview, type TimeStatus, workOrderQueue } from "../projects/time";
import { ApiError, type SecuredApiClient } from "./client";
import { reportHours, reportMonth, reportTimestamp } from "./dashboard-format";
import { SearchableCombobox } from "./SearchableCombobox";
import { PlatformLink } from "./PlatformHome";
import { periodHref } from "./portal-location";
import { SortControls, useSortedRows } from "./SortHeader";

const queues = {
  awaiting: "Awaiting mapping",
  mapped: "Mapped",
  review: "Needs review",
  inactive: "Inactive or removed",
} as const;
const mappingSort = { name: "Work order name", jobcode: "Jobcode", status: "Mapping status", recorded: "Recorded this month",
  history: "Historical recorded", allocated: "Existing allocations", synced: "Last successful sync" } as const;
type HistoricalBatch = { classified: number; examined: number; next?: string };

export function QuickBooksTimeMapping({ client, tenant, month, projects, portfolio, onDenied, onSaved }: {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  projects: StaffProjectSummary[];
  portfolio?: Portfolio;
  onDenied: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<TimeStatus>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [request, setRequest] = useState(0);
  const [queue, setQueue] = useState<keyof typeof queues | "all">("all");
  const [selected, select] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Record<string, HistoricalBatch>>({});
  const sorted = useSortedRows<TimeMapping, keyof typeof mappingSort>(status?.mappings ?? [], { key: "name", direction: "asc" },
    (row, field) => ({ name: row.sourceName ?? projects.find(project => project.id === row.projectId)?.name ?? row.jobcodeId,
      jobcode: row.jobcodeId, status: queues[workOrderQueue(row)], recorded: row.recordedSeconds, history: row.lifetimeRecordedSeconds,
      allocated: row.lifetimeAllocatedSeconds, synced: row.lastSuccess })[field], row => row.jobcodeId);

  useEffect(() => {
    const abort = new AbortController();
    setStatus(undefined);
    client.call<TimeStatus>(tenant, "time?" + new URLSearchParams({ month }), { signal: abort.signal })
      .then(value => { if (!abort.signal.aborted) setStatus(value); })
      .catch(error => {
        if (abort.signal.aborted) return;
        if (error instanceof ApiError && [401, 403].includes(error.status)) onDenied();
        else setError("QuickBooks Time mapping is temporarily unavailable.");
      });
    return () => abort.abort();
  }, [client, tenant, month, request, onDenied]);

  async function confirm(mapping: TimeMapping, projectId: string, review: TimeMappingReview) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.call<{ historical?: HistoricalBatch }>(tenant, "time/mapping", {
        method: "POST",
        body: { jobcodeId: mapping.jobcodeId, projectId, review },
      });
      if (result.historical) setHistory(current => ({ ...current, [mapping.jobcodeId]: result.historical! }));
      setNotice(result.historical
        ? "Mapping saved. Historical staff classifications are being reviewed in batches."
        : "Mapping saved. Source records and existing classifications were preserved.");
      setRequest(value => value + 1);
      onSaved();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onDenied();
      setError(reason instanceof ApiError && reason.status === 409
        ? "The mapping or recorded hours changed during review. Open the work order again to review the latest information."
        : "The operation could not be confirmed. Refresh the mapping before retrying historical classification.");
      setRequest(value => value + 1);
    } finally {
      setBusy(false);
    }
  }

  async function applyHistory(jobcodeId: string) {
    setBusy(true);
    setError("");
    try {
      const after = history[jobcodeId]?.next;
      const result = await client.call<HistoricalBatch>(tenant, "time/classify-history", {
        method: "POST", body: { jobcodeId, ...(after && { after }) },
      });
      setHistory(current => ({ ...current, [jobcodeId]: result }));
      onSaved();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onDenied();
      setError("Historical classification could not be confirmed. You can retry the same batch.");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-label="QuickBooks Time Mapping" className="mi-mapping">
    <p>Review work orders discovered through the existing {ZAGIME_CLIENT_DISPLAY_NAME} customer connection and choose where their source-recorded hours appear.</p>
    <div className="secure-actions">
      <PlatformLink href={periodHref("/workspace/time", month)}>Time Allocation</PlatformLink>
      <PlatformLink href={periodHref("/workspace/integrations/time", month)}>Connection status</PlatformLink>
    </div>
    {notice && <p role="status" className="secure-message">{notice}</p>}
    {error && <p role="alert" className="secure-message secure-error">{error} <button className="secure-secondary" type="button"
      onClick={() => { setError(""); setRequest(value => value + 1); }}>Refresh work orders</button></p>}
    {!status && !error && <p role="status">Loading work orders…</p>}
    {status && <>
      {!status.customerVerified && <p className="secure-empty">New customer mappings require a verified QuickBooks Time customer connection.</p>}
      {status.verifiedCustomerId && <p className="secure-muted">Verified customer jobcode {status.verifiedCustomerId}
        {status.lastDailySuccess && " · Last successful sync " + reportTimestamp(status.lastDailySuccess)}</p>}
      {!status.canManage && <p className="secure-muted">The authorized Time administrator can confirm a mapping.</p>}
      <label>Mapping status
        <select value={queue} onChange={event => { setQueue(event.target.value as typeof queue); select(undefined); }}>
          <option value="all">All work orders ({status.mappings.length})</option>
          {Object.entries(queues).map(([value, label]) => <option key={value} value={value}>
            {label} ({status.mappings.filter(mapping => workOrderQueue(mapping) === value).length})
          </option>)}
        </select>
      </label>
      {!status.mappings.some(mapping => queue === "all" || workOrderQueue(mapping) === queue) &&
        <p className="secure-empty">No work orders match this status.</p>}
      <div className="mi-mapping-list">
        <SortControls fields={mappingSort} sort={sorted.sort} onSort={sorted.setSort} label="Sort work orders" />
        {sorted.rows.filter(mapping => queue === "all" || workOrderQueue(mapping) === queue).map(mapping => {
          const current = projects.find(project => project.id === mapping.projectId);
          const open = selected === mapping.jobcodeId;
          return <article className="secure-card mi-mapping-order" key={mapping.jobcodeId}>
            <header className="delivery-section-heading">
              <div><p className="mi-kicker">{queues[workOrderQueue(mapping)]} · Jobcode {mapping.jobcodeId}</p>
                <h3>{mapping.sourceName ?? current?.name ?? "Work order " + mapping.jobcodeId}</h3>
                {mapping.mappingState !== "registered" && current && <p>Reporting project: <PlatformLink className="exec-text-button"
                  href={periodHref("/workspace/projects/" + current.id, month)}>{current.name}</PlatformLink></p>}
              </div>
              <button type="button" className="secure-secondary" aria-expanded={open} onClick={() => select(open ? undefined : mapping.jobcodeId)}>
                {open ? "Close review" : mapping.canReview && status.canManage ? "Review mapping" : "View work order"}
              </button>
            </header>
            {open && <div className="mi-mapping-detail">
              <dl className="secure-metrics">
                <div><dt>Recorded in {reportMonth(month)}</dt><dd>{mapping.recordedSeconds === undefined ? "—" : reportHours(mapping.recordedSeconds) + " h"}</dd></div>
                <div><dt>Historical recorded time</dt><dd>{mapping.lifetimeRecordedSeconds === undefined ? "—" : reportHours(mapping.lifetimeRecordedSeconds) + " h"}</dd></div>
                <div><dt>Existing allocations</dt><dd>{mapping.lifetimeAllocatedSeconds === undefined ? "—" : reportHours(mapping.lifetimeAllocatedSeconds) + " h"}</dd></div>
              </dl>
              {mapping.lastSuccess && <p>Last successful work-order sync {reportTimestamp(mapping.lastSuccess)}</p>}
              {status.canManage && mapping.mappingState === "linked" && current?.delivery?.kind === "project" && <>
                {history[mapping.jobcodeId] && <p role="status">{history[mapping.jobcodeId].examined} records checked in the last batch.
                  {" "}{history[mapping.jobcodeId].classified} staff-only classifications saved.</p>}
                <button type="button" className="secure-secondary" disabled={busy} onClick={() => void applyHistory(mapping.jobcodeId)}>
                  {history[mapping.jobcodeId]?.next ? "Continue historical classification" : "Check historical entries"}
                </button>
              </>}
              {mapping.failed && <p className="secure-error">The latest sync failed. Review sync status before confirming a mapping.</p>}
              {mapping.canReview && !mapping.failed && status.canManage
                ? <MappingReview mapping={mapping} projects={projects} portfolio={portfolio} month={month} busy={busy} confirm={confirm} />
                : <p>Existing, inactive and unverified mappings require separate reconciliation before they can be changed.</p>}
            </div>}
          </article>;
        })}
      </div>
    </>}
  </section>;
}

function MappingReview({ mapping, projects, portfolio, month, busy, confirm }: {
  mapping: TimeMapping;
  projects: StaffProjectSummary[];
  portfolio?: Portfolio;
  month: string;
  busy: boolean;
  confirm: (mapping: TimeMapping, projectId: string, review: TimeMappingReview) => Promise<void>;
}) {
  const requested = projects.filter(project => project.delivery?.pendingTimeJobcodeId === mapping.jobcodeId &&
    (project.delivery.kind === "engagement" || project.delivery.kind === "project"));
  const suggestion = requested.length === 1 ? requested[0] : undefined;
  const [kind, setKind] = useState<TimeMappingReview["targetKind"] | "">(
    suggestion?.delivery?.kind === "engagement" ? "engagement" : suggestion ? "project" : "");
  const [target, setTarget] = useState(suggestion?.id ?? "");
  const [approved, setApproved] = useState(false);
  const candidates = projects.filter(project => project.status !== "closed" && project.status !== "cancelled" &&
    project.delivery?.kind === kind && (kind === "engagement" ? !project.delivery.parentId : Boolean(
      projects.some(parent => parent.id === project.delivery?.parentId && parent.delivery?.kind === "engagement" && !parent.delivery.parentId) &&
      portfolio?.areas.some(area => area.id === project.delivery?.areaId))));
  const selected = candidates.find(project => project.id === target);
  const parent = projects.find(project => project.id === selected?.delivery?.parentId);
  const department = portfolio?.areas.find(area => area.id === selected?.delivery?.areaId);
  const recordedSeconds = mapping.lifetimeRecordedSeconds;
  const allocatedSeconds = mapping.lifetimeAllocatedSeconds;

  return <form className="secure-form mi-mapping-review" onSubmit={event => {
    event.preventDefault();
    if (!kind || !selected || !approved || busy || recordedSeconds === undefined || allocatedSeconds === undefined) return;
    void confirm(mapping, selected.id, { targetKind: kind, previousProjectId: mapping.projectId, recordedSeconds, allocatedSeconds,
      ...(parent && department ? { parentId: parent.id, areaId: department.id } : {}) });
  }}>
    {requested.length > 0 && <p>Projects requesting this work order {requested.map(project => project.name).join(", ")}.</p>}
    <div className="secure-editor-grid">
      <label>Work-order type
        <select value={kind} required onChange={event => {
          setKind(event.target.value as typeof kind); setTarget(""); setApproved(false);
        }}>
          <option value="">Choose the work-order type</option>
          <option value="engagement">Parent Project</option>
          <option value="project">Delivery Project</option>
        </select>
      </label>
      <SearchableCombobox label="Reporting project" value={target} required disabled={!kind}
        onChange={value => { setTarget(value); setApproved(false); }}
        options={candidates.map(project => ({ value: project.id, label: project.name }))}
        placeholder="Search existing projects" />
    </div>
    {!!kind && candidates.length === 0 && <p>No projects of this type are ready for mapping. Delivery Projects require a Parent Project and Department.</p>}
    <PlatformLink href={periodHref("/workspace/projects/new", month)}>Create a project</PlatformLink>
    {selected && recordedSeconds !== undefined && allocatedSeconds !== undefined && <div className="mi-mapping-preview">
      <h4>Review reporting impact</h4>
      <p>{selected.name}{parent && department && " · " + parent.name + " / " + department.name}</p>
      <p>{reportHours(recordedSeconds - allocatedSeconds)} h of source effort will be attributed in the Morris workspace.
        {allocatedSeconds > 0 && " The existing " + reportHours(allocatedSeconds) + " h of allocations stay assigned where they are."}
        {kind === "project" && " Eligible entries receive a staff-only classification. Approved client effort stays unchanged."}</p>
      <label className="secure-check"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />
        I reviewed the project and affected hours.</label>
    </div>}
    <button type="submit" disabled={busy || !selected || !approved || recordedSeconds === undefined}>
      {busy ? "Confirming…" : "Confirm mapping"}
    </button>
  </form>;
}
