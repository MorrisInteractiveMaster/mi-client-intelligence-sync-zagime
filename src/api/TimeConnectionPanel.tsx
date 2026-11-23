import { useEffect, useState } from "react";
import type { TimeStatus } from "../projects/time";
import { ApiError, type SecuredApiClient } from "./client";
import { PlatformLink } from "./PlatformHome";
import { periodHref } from "./portal-location";
import { reportHours, reportMonth, reportTimestamp } from "./dashboard-format";

export function TimeConnectionPanel({
  client,
  tenant,
  month,
  projectId,
  refreshVersion,
  projects,
  busy,
  run,
  onChanged,
  onDenied,
  manage = true,
}: {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  projectId?: string;
  refreshVersion: number;
  projects: { id: string; name: string }[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
  onDenied: () => void;
  manage?: boolean;
}) {
  const [status, setStatus] = useState<TimeStatus>();
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setUnavailable(false);
    setStatus(undefined);
    client
      .call<TimeStatus>(
        tenant,
        "time?" +
          new URLSearchParams({
            month,
            ...(projectId ? { project: projectId } : {}),
          }),
        { signal: abort.signal },
      )
      .then((value) => {
        if (!abort.signal.aborted) setStatus(value);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        if (error instanceof ApiError && [401, 403].includes(error.status))
          onDenied();
        else setUnavailable(true);
      });
    return () => abort.abort();
  }, [client, tenant, month, projectId, refreshVersion, retry, onDenied]);
  if (unavailable)
    return (
      <div className="secure-empty">
        <p role="alert">QuickBooks Time connection status is unavailable.</p>
        <button onClick={() => setRetry((value) => value + 1)}>
          Retry connection status
        </button>
      </div>
    );
  if (!status) return <p role="status">Checking QuickBooks Time connection…</p>;
  if (status.state === "disconnected")
    return <p>QuickBooks Time is disconnected.</p>;
  return (
    <section aria-label="QuickBooks Time connection">
      {status.customerScoped && !status.customerVerified && (
        <p role="status">
          Waiting for the approved QuickBooks Time customer setup.
        </p>
      )}
      {status.lastDailySuccess && (
        <p>
          Last successful daily sync {reportTimestamp(status.lastDailySuccess)}
        </p>
      )}
      {status.dailyState === "running" && (
        <p role="status">Daily sync in progress.</p>
      )}
      {status.dailyState === "failed" && (
        <p role="alert">
          The daily sync did not complete (
          {status.errorStage ?? "retry required"}). Completed work-order
          checkpoints were retained.
        </p>
      )}
      {status.runningFailed && (
        <p role="status">
          The latest on-clock snapshot could not be refreshed.
        </p>
      )}
      {status.running && (
        <p>
          On-clock snapshot at {reportTimestamp(status.running.observedAt)} ·{" "}
          {status.running.count} running · {reportHours(status.running.seconds)}{" "}
          h elapsed. These hours are separate from recorded totals.
        </p>
      )}
      {status.month === month && status.state === "configured" && (
        <>
          <h4>QuickBooks Time · {reportMonth(month)}</h4>
          <p className="secure-muted">
            Source-recorded hours have unknown approval. Allocations are Morris
            reporting splits.
          </p>
          <dl
            className="secure-metrics"
            aria-label="QuickBooks Time for the month"
          >
            <div>
              <dt>Source-recorded</dt>
              <dd>{reportHours(status.recordedSeconds ?? 0)} h</dd>
            </div>
            <div>
              <dt>Allocated from these entries</dt>
              <dd>{reportHours(status.allocatedSeconds ?? 0)} h</dd>
            </div>
            <div>
              <dt>Unallocated</dt>
              <dd>{reportHours(status.unallocatedSeconds ?? 0)} h</dd>
            </div>
          </dl>
        </>
      )}
      {status.state === "unmapped" && (
        <p>
          {projectId
            ? "No QuickBooks Time jobcodes are mapped to this project."
            : "No QuickBooks Time jobcodes are mapped."}
        </p>
      )}
      {status.state === "configured" &&
        status.lifetimeRecordedSeconds !== undefined && (
          <p>
            {reportHours(status.lifetimeRecordedSeconds)} h source-recorded ·{" "}
            {reportHours(status.lifetimeUnallocatedSeconds ?? 0)} h unallocated
            across imported months.
          </p>
        )}
      {status.customerScoped && <p><PlatformLink href={periodHref("/workspace/time/mapping", month)}>Open QuickBooks Time Mapping</PlatformLink></p>}
      {status.mappings.map((mapping) => (
        <article className="secure-card" key={mapping.jobcodeId}>
          <h4>
            {mapping.sourceName ??
              projects.find((p) => p.id === mapping.projectId)?.name ??
              mapping.projectId}
          </h4>
          <p>QuickBooks Time jobcode {mapping.jobcodeId}</p>
          {mapping.mappingState && (
            <p>
              {mapping.mappingState === "registered"
                ? "Registered as its own project"
                : "Linked to an existing project"}{" "}
              ·{" "}
              {projects.find((p) => p.id === mapping.projectId)?.name ??
                mapping.projectId}
            </p>
          )}
          {status.month === month && mapping.recordedSeconds !== undefined && (
            <p>
              {reportHours(mapping.recordedSeconds)} h recorded ·{" "}
              {reportHours(mapping.allocatedSeconds ?? 0)} h allocated ·{" "}
              {reportHours(mapping.unallocatedSeconds ?? 0)} h unallocated ·{" "}
              {reportHours(mapping.lifetimeRecordedSeconds ?? 0)} h lifetime
              recorded
            </p>
          )}
          {mapping.sourceState === "inactive" && (
            <p role="status">Inactive in QuickBooks Time.</p>
          )}
          {mapping.sourceState === "missing" && (
            <p role="status">
              Outside the current customer catalog. Prior recorded hours are
              retained for review.
            </p>
          )}
          {mapping.sourceProject?.state === "verified" && (
            <p>
              Time project {mapping.sourceProject.name} (
              {mapping.sourceProject.id})
              {mapping.sourceProject.active ? "" : " · inactive"}
            </p>
          )}
          {mapping.sourceProject?.state === "unavailable" && (
            <p>Time project metadata is unavailable for this connection.</p>
          )}
          {mapping.sourceProject?.state === "no-match" && (
            <p>QuickBooks Time returned no project for this jobcode.</p>
          )}
          <p>
            {mapping.lastSuccess
              ? "Last successful sync " + reportTimestamp(mapping.lastSuccess)
              : "Awaiting first sync"}
          </p>
          {mapping.through && (
            <p>
              Source changes checked through {reportTimestamp(mapping.through)}
            </p>
          )}
          {mapping.failed && (
            <p role="alert">
              The last sync failed. The previous checkpoint was retained.
            </p>
          )}
          {manage && status.canManage && mapping.sourceState !== "missing" && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  try {
                    await client.call(tenant, "time/sync", {
                      method: "POST",
                      body: { jobcodeId: mapping.jobcodeId },
                    });
                  } finally {
                    onChanged();
                  }
                })
              }
            >
              Sync jobcode {mapping.jobcodeId}
            </button>
          )}
        </article>
      ))}
      {manage &&
        status.canManage &&
        !projectId &&
        !status.customerScoped && (
          <form
            className="secure-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run(async () => {
                await client.call(tenant, "time/mapping", {
                  method: "POST",
                  body: {
                    jobcodeId: data.get("jobcode"),
                    projectId: data.get("project"),
                  },
                });
                onChanged();
              });
            }}
          >
            <label>
              Approved QuickBooks Time jobcode ID
              <input
                  name="jobcode"
                  required
                  inputMode="numeric"
                  pattern="[1-9][0-9]{0,19}"
                />
            </label>
            <label htmlFor="time-mapping-project">Reporting project</label>
            <select
              id="time-mapping-project"
              name="project"
              required
              defaultValue=""
            >
              <option value="">Choose project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <button disabled={busy || projects.length === 0}>
              Approve Time mapping
            </button>
          </form>
        )}
    </section>
  );
}
