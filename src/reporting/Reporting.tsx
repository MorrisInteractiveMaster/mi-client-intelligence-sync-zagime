import { Dots } from "./Dots";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePortal } from "../services/PortalContext";
import {
  allocate,
  demo,
  hours,
  latestAllocation,
  persist,
  project,
  validate,
  attachSource,
  type ReportingState,
} from "./model";
import "./nordic.css";
export function Reporting() {
  const { role } = usePortal();
  const loadIssue = useRef("");
  const [state, setState] = useState<ReportingState>(() => {
    try {
      const text = localStorage.getItem("mi-reporting-v2");
      if (text) {
        const s = JSON.parse(text);
        validate(s);
        return s;
      }
    } catch {
      loadIssue.current =
        "Saved reporting data could not be loaded. A read-only synthetic preview is shown; your saved data has not been changed.";
    }
    return demo();
  });
  const [error, setError] = useState("");
  const [recap, setRecap] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const view = project(state);
  const admin = role === "admin" && !loadIssue.current;
  function save(next: ReportingState) {
    try {
      persist(localStorage, state, next);
      setState(next);
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
      {loadIssue.current && <p role="alert">{loadIssue.current}</p>}
      <header>
        <img
          src={`${import.meta.env.BASE_URL}branding/zagime/zagime.jpeg`}
          alt="Zagimē Anishinabēk"
        />
        <div>
          <small>Morris Interactive · Delivery partner</small>
          <h1>Partnership dashboard</h1>
          <p>Synthetic demonstration · October 2026</p>
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
        <article>
          <span>Unallocated source hours</span>
          <strong>{hours(view.unallocatedSeconds)}</strong>
        </article>
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
      <Link to="/legacy-overview">Original portfolio overview</Link>
      {error && <p role="alert">{error}</p>}
      {view.conflicts.length > 0 && (
        <p role="alert">
          Source corrections require allocation review:{" "}
          {view.conflicts.join(", ")}
        </p>
      )}
      <h2>Agreement → Department → Project</h2>
      {state.agreements.map((a) => (
        <article key={a.id}>
          <h3>{a.name}</h3>
          <p>
            {view.agreements.find((x) => x.id === a.id)!.capMinutes / 60}{" "}
            h/month · Reserve{" "}
            {view.agreements.find((x) => x.id === a.id)!.reserveMinutes / 60} h.
            Project plans are within this agreement, not additional caps.
          </p>
          {state.departments.map((d) => (
            <details key={d.id} open>
              <summary>
                {d.name} ·{" "}
                {(state.budgets.find(
                  (b) =>
                    b.agreementId === a.id &&
                    b.departmentId === d.id &&
                    b.month === "2026-10",
                )?.minutes ?? 0) / 60}{" "}
                h/month ·{" "}
                {hours(view.departments.find((x) => x.id === d.id)!.seconds)} h
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
              {!view.projects.some((p) => p.departmentId === d.id) && (
                <p>No published projects yet.</p>
              )}
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
                  projectId: String(f.get("project")),
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
            Existing delivery project
            <select name="project">
              {state.projects.map((p) => (
                <option key={p.id} value={p.id}>
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
                agreementId: "agreement-demo",
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
          {state.raw.map((r) => (
            <article key={r.id}>
              <h3>
                {r.date} · {hours(r.seconds)} source hours
              </h3>
              <p>
                {r.description} · Original reference: {r.sourceWorkOrderId}
              </p>
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
                  Split hours across projects; leave the remainder unallocated.
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
        <Dots state={state} />
        <button onClick={close}>Close</button>
      </dialog>
    </section>
  );
}
