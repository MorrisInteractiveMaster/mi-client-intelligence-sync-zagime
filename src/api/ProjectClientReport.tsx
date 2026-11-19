import { useEffect, useState } from "react";
import type { ProjectReport } from "../projects/model";
import { ApiError, type SecuredApiClient } from "./client";
import {
  projectStatus,
  reportDay,
  reportHours,
  reportMonth,
} from "./dashboard-format";

const searchText = (value: string) =>
  value.trim().normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

type ReportScope = {
  client: SecuredApiClient;
  tenant: string;
  month: string;
  onDenied: () => void;
};

export function ProjectClientReport(props: ReportScope) {
  return (
    <ScopedClientReport
      key={JSON.stringify([props.tenant, props.month])}
      {...props}
    />
  );
}

function ScopedClientReport({ client, tenant, month, onDenied }: ReportScope) {
  const [result, setResult] = useState<{
    client: SecuredApiClient;
    report?: ProjectReport;
  }>();
  const [epoch, setEpoch] = useState(0);
  const [search, setSearch] = useState("");
  const current = result?.client === client ? result : undefined;
  useEffect(() => {
    const abort = new AbortController();
    client
      .call<ProjectReport>(tenant, "report?month=" + month, {
        signal: abort.signal,
      })
      .then((data) => {
        if (abort.signal.aborted) return;
        if (data.month !== month || data.tenant.id !== tenant)
          throw Error("Unexpected reporting scope");
        setResult({ client, report: data });
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return;
        if (failure instanceof ApiError && [401, 403].includes(failure.status))
          onDenied();
        else setResult({ client });
      });
    return () => abort.abort();
  }, [client, tenant, month, epoch, onDenied]);

  if (current && !current.report)
    return (
      <section className="secure-empty">
        <h2>Reporting is temporarily unavailable</h2>
        <p role="alert">
          The published report could not be loaded. Try again in a moment.
        </p>
        <button
          onClick={() => {
            setResult(undefined);
            setEpoch((value) => value + 1);
          }}
        >
          Retry report
        </button>
      </section>
    );
  const report = current?.report;
  if (!report)
    return (
      <p className="secure-empty" role="status">
        Loading approved reporting…
      </p>
    );

  const visible = [...report.projects].sort((a, b) =>
    a.name.localeCompare(b.name, "en-CA"),
  );
  const matching = visible.filter((project) =>
    searchText(project.name).includes(searchText(search)),
  );
  const period = reportMonth(report.month);
  return (
    <>
      <section className="secure-hero" aria-labelledby="published-tenant">
        <div>
          <p className="secure-eyebrow">Project intelligence · {period}</p>
          <h2 id="published-tenant">{report.tenant.name}</h2>
          <p>Published project progress, milestones and reporting hours.</p>
        </div>
      </section>
      <dl className="secure-metrics" aria-label="Published portfolio summary">
        <div>
          <dt>Published projects</dt>
          <dd>{visible.length}</dd>
        </div>
        <div>
          <dt>Completed projects</dt>
          <dd>{visible.filter((p) => p.status === "completed").length}</dd>
        </div>
        <div>
          <dt>Allocated hours · {period}</dt>
          <dd>{reportHours(report.totalSeconds)} h</dd>
        </div>
      </dl>
      <section aria-labelledby="published-projects">
        <div className="secure-section-heading">
          <div>
            <h2 id="published-projects">Published projects</h2>
            <p>
              Hours reflect published reporting allocations for the selected
              month.
            </p>
          </div>
          {visible.length > 0 && (
            <label className="secure-search-label">
              Search published projects
              <input
                type="search"
                maxLength={120}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          )}
        </div>
        {!visible.length && (
          <p className="secure-empty">
            No approved projects are available for this period.
          </p>
        )}
        {visible.length > 0 && !matching.length && (
          <div className="secure-empty">
            <p role="status">No published projects match.</p>
            <button onClick={() => setSearch("")}>Clear search</button>
          </div>
        )}
        <div className="secure-project-grid">
          {matching.map((project) => (
            <article
              className="secure-card secure-published-project"
              key={project.id}
            >
              <p className="secure-badge" data-status={project.status}>
                {projectStatus[project.status]}
              </p>
              <h3>{project.name}</h3>
              {project.description && (
                <p className="secure-project-description">
                  {project.description}
                </p>
              )}
              <div className="secure-progress">
                <span>{project.progress}% progress</span>
                <progress
                  aria-label={project.name + " progress"}
                  max={100}
                  value={project.progress}
                />
              </div>
              <dl className="secure-project-hours">
                <div>
                  <dt>{period} allocated</dt>
                  <dd>{reportHours(project.seconds)} h</dd>
                </div>
                <div>
                  <dt>Lifetime allocated</dt>
                  <dd>{reportHours(project.lifetimeSeconds)} h</dd>
                </div>
                {project.plan.targetSeconds > 0 && (
                  <div>
                    <dt>
                      {project.plan.basis === "monthly"
                        ? "Monthly"
                        : "Lifetime"}{" "}
                      target
                    </dt>
                    <dd>{reportHours(project.plan.targetSeconds)} h</dd>
                  </div>
                )}
              </dl>
              {Boolean(
                project.milestones?.length || project.updates?.length,
              ) && (
                <details>
                  <summary>Updates and milestones</summary>
                  {!!project.milestones?.length && (
                    <div>
                      <h4>Milestones</h4>
                      <ul className="secure-timeline">
                        {[...project.milestones]
                          .sort((a, b) => a.date.localeCompare(b.date))
                          .map((item) => (
                            <li key={item.id}>
                              <b>{item.title}</b>
                              <p>
                                <time dateTime={item.date}>
                                  {reportDay(item.date)}
                                </time>{" "}
                                · {item.completed ? "Complete" : "Upcoming"}
                              </p>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                  {!!project.updates?.length && (
                    <div>
                      <h4>Project updates</h4>
                      <ul className="secure-timeline">
                        {[...project.updates]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .map((item) => (
                            <li key={item.id}>
                              <time dateTime={item.date}>
                                {reportDay(item.date)}
                              </time>
                              <b>{item.title}</b>
                              <p className="secure-project-description">
                                {item.body}
                              </p>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
                </details>
              )}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
