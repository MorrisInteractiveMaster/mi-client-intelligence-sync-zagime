import { useEffect, useState } from "react";
import type { TimeStatus } from "../projects/time";
import type { SecuredApiClient } from "./client";

export function TimeConnectionPanel({
  client,
  tenant,
  month,
  refreshVersion,
  projects,
  busy,
  run,
  onChanged,
}: {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  refreshVersion: number;
  projects: { id: string; name: string }[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<TimeStatus>();
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setUnavailable(false);
    client
      .call<TimeStatus>(tenant, "time?month=" + month, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setStatus(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setUnavailable(true);
      });
    return () => abort.abort();
  }, [client, tenant, month, refreshVersion]);
  if (unavailable)
    return <p>QuickBooks Time connection status is unavailable.</p>;
  if (!status) return <p role="status">Checking QuickBooks Time connection…</p>;
  if (status.state === "disconnected")
    return <p>QuickBooks Time is disconnected.</p>;
  return (
    <section aria-label="QuickBooks Time connection">
      {status.month === month && status.state === "configured" && (
        <p>
          {new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 3,
          }).format((status.recordedSeconds ?? 0) / 3600)}{" "}
          h recorded with unknown approval in {month}.{" "}
          {new Intl.NumberFormat(undefined, {
            maximumFractionDigits: 3,
          }).format((status.unallocatedSeconds ?? 0) / 3600)}{" "}
          h unallocated.
        </p>
      )}
      {status.state === "unmapped" && (
        <p>No QuickBooks Time jobcodes are mapped.</p>
      )}
      {status.mappings.map((mapping) => (
        <article className="secure-card" key={mapping.jobcodeId}>
          <h3>
            {projects.find((p) => p.id === mapping.projectId)?.name ??
              mapping.projectId}
          </h3>
          <p>QuickBooks Time jobcode {mapping.jobcodeId}</p>
          <p>
            {mapping.lastSuccess
              ? "Last successful sync " + mapping.lastSuccess
              : "Awaiting first sync"}
          </p>
          {mapping.through && (
            <p>Source changes checked through {mapping.through}</p>
          )}
          {mapping.failed && (
            <p role="alert">
              The last sync failed. The previous checkpoint was retained.
            </p>
          )}
          {status.canManage && (
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
      {status.canManage && (
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
