import { ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { useReporting } from "./ReportingContext";
import { Dots } from "./Dots";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePortal } from "../services/PortalContext";
import {
  allocate,
  hours,
  latestAllocation,
  project,
  clientProjection,
  attachSource,
  type ReportingState,
} from "./model";
import "./nordic.css";
export function Reporting() {
  const { role } = usePortal();
  const { state, issue, save: saveState, month, setMonth } = useReporting();
  const [error, setError] = useState("");
  const [recap, setRecap] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const internal = project(state, { month });
  const view = clientProjection(state, { month });
  const admin = role === "admin" && !issue;
  function save(next: ReportingState) {
    try {
      saveState(next);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (recap) {
      dialog.current?.showModal();
    } else dialog.current?.close();
  }, [recap]);

  function close() {
    setRecap(false);
    trigger.current?.focus();
  }
  return (
    <section className="nordic">
      {issue && <p role="alert">{issue}</p>}
      <header>
        <img
          src={`${import.meta.env.BASE_URL}branding/zagime/zagime.jpeg`}
          alt={ZAGIME_CLIENT_DISPLAY_NAME}
        />
        <div>
          <small>Morris Interactive · Delivery partner</small>
          <h1>Partnership dashboard</h1>
          <p>Synthetic demonstration</p>
          <label>
            Reporting month
            <input
              aria-label="Reporting month"
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
            />
          </label>
        </div>
      </header>
      <div className="nordic-answer">
        <p>The short answer</p>
        <h2>A clear view of the work, from agreement to delivery.</h2>
        <p>
          All agreements, departments, work orders and hours here are invented
          examples.
        </p>
      </div>
      <div className="nordic-kpis">
        <article>
          <span>Hours delivered</span>
          <strong>{hours(view.totalSeconds)}</strong>
        </article>
        {admin && (
          <article>
            <span>Unallocated source hours</span>
            <strong>{hours(internal.unallocatedSeconds)}</strong>
          </article>
        )}
        <article>
          <span>Agreement monthly cap</span>
          <strong>
            {view.agreements.reduce((n, a) => n + a.capMinutes, 0) / 60} h
          </strong>
        </article>
      </div>
      <button
        ref={trigger}
        onClick={() => {
          setRecap(true);
        }}
      >
        At a glance · Dots recap
      </button>{" "}
      <Link to="/legacy-overview">
        Legacy demonstration overview (separate v1 data)
      </Link>
      {admin && error && <p role="alert">{error}</p>}
      {admin && internal.conflicts.length > 0 && (
        <p role="alert">
          Source corrections require allocation review:{" "}
          {internal.conflicts.join(", ")}
        </p>
      )}
      <nav className="reporting-workflows" aria-label="Reporting workflows">
        {admin && <Link to="/projects/new">New project</Link>}
        <Link to="/projects">M2 projects</Link>
        {admin && <Link to="/time">Reporting allocations</Link>}
      </nav>
      <h2>Agreement → Department → Project</h2>
      {view.agreements.map((a) => (
        <article key={a.id}>
          <h3>{a.name}</h3>
          <p>
            {hours(a.seconds)} h delivered in {month}
          </p>
          <p>
            {view.agreements.find((x) => x.id === a.id)!.capMinutes / 60}{" "}
            h/month · Reserve{" "}
            {view.agreements.find((x) => x.id === a.id)!.reserveMinutes / 60} h.
            Project plans are within this agreement, not additional caps.
          </p>
          {a.departments.map((d) => (
            <details key={d.id} open>
              <summary>
                {d.name} · {d.minutes / 60} h/month · {hours(d.seconds)} h
                delivered
              </summary>
              {view.projects
                .filter(
                  (p) => p.departmentId === d.id && p.agreementId === a.id,
                )
                .map((p) => (
                  <div className="nordic-project" key={p.id}>
                    {admin ? (
                      <label>
                        Project name
                        <input
                          value={p.name}
                          onChange={(e) => {
                            const n = structuredClone(state);
                            n.projects.find((x) => x.id === p.id)!.name =
                              e.target.value;
                            save(n);
                          }}
                        />
                      </label>
                    ) : (
                      <b>{p.name}</b>
                    )}
                    <span>
                      {hours(p.seconds)} h delivered / {p.plan.minutes / 60} h{" "}
                      {p.plan.basis} plan
                    </span>
                    {p.plan.basis === "fixed" && (
                      <span>
                        Lifetime effort: {hours(p.lifetimeSeconds)} h across all
                        months
                      </span>
                    )}
                    {admin ? (
                      <label>
                        Progress %{" "}
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={p.progress}
                          onChange={(e) => {
                            const n = structuredClone(state);
                            n.projects.find((x) => x.id === p.id)!.progress =
                              Number(e.target.value);
                            save(n);
                          }}
                        />
                      </label>
                    ) : (
                      <span>{p.progress}% manager-reported progress</span>
                    )}
                  </div>
                ))}
              {!view.projects.some(
                (p) => p.departmentId === d.id && p.agreementId === a.id,
              ) && <p>No published projects yet.</p>}
            </details>
          ))}
        </article>
      ))}
      {admin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            try {
              save(
                attachSource(state, {
                  ...(String(f.get("target")).startsWith("agreement:")
                    ? { agreementId: String(f.get("target")).slice(10) }
                    : { projectId: String(f.get("target")).slice(8) }),
                  verified: true,
                  source: "synthetic-qbo",
                  externalId: String(f.get("external")),
                  label: String(f.get("label")),
                }),
              );
            } catch (err) {
              setError(String(err));
            }
          }}
        >
          <h3>Attach illustrative source work order</h3>
          <label>
            Agreement or specific delivery project
            <select name="target">
              {state.agreements.map((a) => (
                <option key={a.id} value={`agreement:${a.id}`}>
                  Agreement: {a.name}
                </option>
              ))}
              {state.projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Stable source ID
            <input name="external" required />
          </label>
          <label>
            Display reference
            <input name="label" />
          </label>
          <button>Attach reference</button>
          <p>Project identity and reporting history are preserved.</p>
        </form>
      )}
      {admin && (
        <>
          <h2>Morris local editing</h2>
          <p>
            Use the project list above to edit progress, then allocate source
            hours below. All M2 navigation shares this browser workspace.
          </p>
          <p>
            Every tester can edit synthetic records in this browser. No external
            data is changed.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const n = structuredClone(state);
              n.projects.push({
                id: crypto.randomUUID(),
                agreementId: String(f.get("agreement")),
                departmentId: String(f.get("department")),
                name: String(f.get("name")),
                plan: {
                  basis: f.get("basis") as "monthly" | "fixed",
                  minutes: Number(f.get("hours")) * 60,
                },
                progress: 0,
                published: true,
                internalNotes: "",
                trainingSessions: [],
              });
              save(n);
            }}
          >
            <h3>New project</h3>
            <label>
              Agreement
              <select name="agreement">
                {state.agreements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project name
              <input name="name" required />
            </label>
            <label>
              Department
              <select name="department">
                {state.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Planned hours
              <input
                name="hours"
                type="number"
                min="0"
                step="0.25"
                defaultValue="0"
                required
              />
            </label>
            <label>
              Plan basis
              <select name="basis">
                <option value="fixed">Fixed total</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            <button>Create project</button>
            <p>A work-order number is optional and can be attached later.</p>
          </form>
          <h2>Reporting allocation</h2>
          {state.raw
            .filter((r) => r.date.slice(0, 7) === month)
            .map((r) => (
              <article key={r.id}>
                <h3>
                  {r.date} · {hours(r.seconds)} source hours
                </h3>
                <p>
                  {r.description} · Original reference: {r.sourceWorkOrderId}
                </p>
                <p>
                  Unallocated in this source entry:{" "}
                  {hours(
                    internal.conflicts.includes(r.id)
                      ? r.seconds
                      : Math.max(
                          0,
                          r.seconds -
                            (latestAllocation(state, r.id)?.portions.reduce(
                              (n, p) => n + p.seconds,
                              0,
                            ) ?? 0),
                        ),
                  )}{" "}
                  h
                  {internal.conflicts.includes(r.id) &&
                    " · held for correction review"}
                </p>
                <details>
                  <summary>Source correction history</summary>
                  {(state.sourceCorrections ?? [])
                    .filter((c) => c.sourceId === r.id)
                    .map((c, i) => (
                      <p key={i}>
                        Revision {c.previous.revision} (
                        {hours(c.previous.seconds)} h) → {c.next.revision} (
                        {hours(c.next.seconds)} h)
                      </p>
                    ))}
                </details>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    try {
                      save(
                        allocate(
                          state,
                          r.id,
                          state.projects
                            .map((p) => ({
                              projectId: p.id,
                              seconds: Math.round(Number(f.get(p.id)) * 3600),
                              description: String(f.get("description")),
                            }))
                            .filter((p) => p.seconds > 0),
                          new Date().toISOString(),
                        ),
                      );
                    } catch (err) {
                      setError(String(err));
                    }
                  }}
                >
                  <p>
                    Split hours across projects; leave the remainder
                    unallocated.
                  </p>
                  {state.projects.map((p) => (
                    <label
                      key={`${p.id}-${latestAllocation(state, r.id)?.revision ?? 0}`}
                    >
                      {
                        state.departments.find((d) => d.id === p.departmentId)
                          ?.name
                      }{" "}
                      / {p.name}
                      <input
                        name={p.id}
                        type="number"
                        min="0"
                        step="0.0001"
                        defaultValue={
                          (latestAllocation(state, r.id)?.portions.find(
                            (x) => x.projectId === p.id,
                          )?.seconds ?? 0) / 3600
                        }
                      />
                    </label>
                  ))}
                  <label>
                    Optional client description
                    <input name="description" />
                  </label>
                  <button>Save allocation</button>
                </form>
                <details>
                  <summary>Allocation change history</summary>
                  {state.allocations
                    .filter((a) => a.sourceId === r.id)
                    .map((a) => (
                      <p key={a.revision}>
                        Revision {a.revision} · {a.at} ·{" "}
                        {a.portions
                          .map(
                            (p) =>
                              `${hours(p.seconds)} h → ${state.projects.find((x) => x.id === p.projectId)?.name}`,
                          )
                          .join("; ")}
                      </p>
                    ))}
                </details>
              </article>
            ))}
        </>
      )}
      <dialog ref={dialog} onCancel={close} aria-labelledby="recap-heading">
        <h2 id="recap-heading">At a glance</h2>
        <Dots state={state} month={month} />
        <button onClick={close}>Close</button>
      </dialog>
    </section>
  );
}
