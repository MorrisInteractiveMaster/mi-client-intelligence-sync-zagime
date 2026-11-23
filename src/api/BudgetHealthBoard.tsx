import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, PencilLine } from "lucide-react";
import { applyDeliveryCapChange, canEditMonthlyCap, deliveryCaps, type DeliveryCapChange, type DeliveryCaps } from "../projects/caps";
import { measureDelivery } from "../projects/delivery";
import { hoursToSeconds } from "../projects/duration";
import type { StaffProjectDetail, StaffProjectSummary } from "../projects/model";
import { ApiError, type SecuredApiClient } from "./client";
import { projectStatus, reportDay, reportHours } from "./dashboard-format";
import { DottedTrack } from "./EffortVisuals";
import { metricPercent } from "./insight-metrics";
import "./budget-health.css";

type Hours = { monthly: number; lifetime: number };
type CapKey = keyof DeliveryCaps;
const capFields = [
  ["monthlyCap", "Monthly"],
  ["lifetimeCap", "Lifetime"],
] as const;

const fieldValue = (seconds?: number) => seconds === undefined ? "" : String(seconds / 3600);
const exactHours = (seconds: number) => reportHours(seconds) + " h (" + seconds.toLocaleString("en-CA") + " seconds)";

function CapReading({ title, consumed, limit }: { title: string; consumed: number; limit?: number }) {
  const used = limit === undefined ? undefined : metricPercent(consumed, limit);
  return <div className="mi-cap-reading">
    <p><span>{title} cap</span><strong>{limit === undefined ? "Unlimited" : reportHours(limit) + " h"}</strong></p>
    {used !== undefined
      ? <DottedTrack label="Used" value={used} detail={exactHours(consumed) + " of " + exactHours(limit!)} />
      : <p className="mi-cap-unmetered"><span>{limit === 0 && consumed > 0 ? "Over cap" : "Cap-counted effort"}</span>
        <span title={exactHours(consumed)}>{reportHours(consumed)} h</span></p>}
  </div>;
}

export type BudgetHealthRow = {
  project: StaffProjectSummary;
  trail: string[];
  department?: string;
  branchSummary?: string;
  effort: Hours;
  consumed: Hours;
};

export function BudgetHealthBoard({ rows, asOf, client, tenant, editing, onEditing, onDirty, onRefresh, onOpen, onDenied }: {
  rows: BudgetHealthRow[];
  asOf: string;
  client?: SecuredApiClient;
  tenant?: string;
  editing?: string;
  onEditing: (id?: string) => void;
  onDirty?: (dirty: boolean) => void;
  onRefresh?: () => void;
  onOpen: (id: string) => void;
  onDenied?: () => void;
}) {
  const [override, setOverride] = useState<{ project: StaffProjectSummary; caps: DeliveryCaps; draft: boolean }>();
  const [message, setMessage] = useState("");
  const launch = useRef<HTMLButtonElement>(null);
  function close() {
    onEditing();
    onDirty?.(false);
    requestAnimationFrame(() => launch.current?.focus());
  }
  return <>
    <p className="mi-cap-feedback" role="status">{message}</p>
    <ul className="mi-budget-health-board" aria-label="Project hours caps">
      {rows.map(({ project, trail, department, branchSummary, effort, consumed }) => {
        const changed = override?.project === project ? override : undefined;
        const capDisplay = changed?.caps ?? project.draftCaps ?? (project.delivery ? deliveryCaps(project.delivery) : {});
        const draft = changed?.draft ?? project.draftCaps !== undefined;
        const delivery = project.delivery && { ...project.delivery, monthlyCap: capDisplay.monthlyCap, lifetimeCap: capDisplay.lifetimeCap };
        const result = measureDelivery({ ...project, delivery, milestones: project.deliveryMilestones ?? project.milestones }, consumed, asOf);
        const selected = editing === project.id;
        return <li key={project.id} className="mi-budget-health-row" data-editing={selected || undefined}>
          <div className="mi-budget-identity">
            <h4><button type="button" className="exec-text-button mi-budget-open" onClick={() => onOpen(project.id)}>
              <span>{project.name}</span><ArrowUpRight size={15} aria-hidden="true" /></button></h4>
            {(trail.length > 0 || department) && <p>{[...trail, department].filter(Boolean).join(" / ")}</p>}
            {branchSummary && <p>{branchSummary}</p>}
            <p className="mi-budget-reported" title={exactHours(effort.monthly) + " for the selected month, " + exactHours(effort.lifetime) + " lifetime"}>
              {reportHours(effort.monthly)} h reported for the selected month · {reportHours(effort.lifetime)} h lifetime</p>
            <p>{projectStatus[project.status]} · {project.published ? "Published" : "Private"}</p>
            {draft && <span className="mi-budget-draft">Caps pending publication</span>}
          </div>
          <CapReading title="Monthly" consumed={consumed.monthly} limit={capDisplay.monthlyCap} />
          <CapReading title="Lifetime" consumed={consumed.lifetime} limit={capDisplay.lifetimeCap} />
          <div className="mi-budget-delivery">
            {result.completion === undefined ? <p>Completion not configured</p> :
              <DottedTrack label="Work completion" value={result.completion} tone="teal" />}
            <small>{result.health}{result.upcoming ? " · " + reportDay(result.upcoming) : ""}</small>
          </div>
          {client && tenant && project.delivery && <button type="button" className="secure-secondary mi-cap-open"
            aria-label={`Edit cap for ${project.name}`} aria-expanded={selected} disabled={Boolean(editing)}
            onClick={event => {
              launch.current = event.currentTarget;
              onEditing(project.id);
              setMessage("");
            }}><PencilLine size={16} aria-hidden="true" /><span>Edit cap</span></button>}
          {selected && client && tenant && <InlineCapEditor client={client} tenant={tenant} project={project}
            onDirty={onDirty} onClose={close} onDenied={onDenied}
            onSaved={(caps, draft, changed) => {
              setOverride({ project, caps, draft });
              setMessage(changed ? (draft ? "Caps saved to the private project draft." : "Caps saved and utilization updated.") : "Caps are unchanged.");
              close();
              if (changed) onRefresh?.();
            }} />}
        </li>;
      })}
    </ul>
  </>;
}

function InlineCapEditor({ client, tenant, project, onDirty, onClose, onDenied, onSaved }: {
  client: SecuredApiClient;
  tenant: string;
  project: StaffProjectSummary;
  onDirty?: (dirty: boolean) => void;
  onClose: () => void;
  onDenied?: () => void;
  onSaved: (caps: DeliveryCaps, draft: boolean, changed: boolean) => void;
}) {
  const [detail, setDetail] = useState<StaffProjectDetail>();
  const [values, setValues] = useState<Partial<Record<CapKey, string>>>({});
  const [validation, setValidation] = useState<Partial<Record<CapKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [conflict, setConflict] = useState(false);
  const formTitle = useId();
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController>(null);
  const denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    const controller = new AbortController();
    client.call<StaffProjectDetail>(tenant, "projects/" + project.id, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        if (!result.project.delivery) throw Error("Set up delivery before changing the caps.");
        setDetail(result);
      }).catch(failure => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && [401, 403].includes(failure.status)) denied.current?.();
        setError(failure instanceof Error ? failure.message : "The cap values could not be loaded.");
      });
    return () => controller.abort();
  }, [client, tenant, project.id, reload]);
  useEffect(() => { if (detail) input.current?.focus(); }, [detail]);
  useEffect(() => () => request.current?.abort(), []);

  function refresh() {
    setDetail(undefined);
    setValues({});
    setValidation({});
    setError("");
    setConflict(false);
    onDirty?.(false);
    setReload(value => value + 1);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail?.project.delivery || request.current || conflict) return;
    const delivery = detail.project.delivery;
    const invalid: typeof validation = {};
    const caps: DeliveryCapChange = {};
    for (const [key] of capFields) {
      const entered = values[key]?.trim();
      if (entered === undefined || entered === fieldValue(delivery[key])) continue;
      try { caps[key] = entered === "" ? null : hoursToSeconds(entered); }
      catch (failure) { invalid[key] = failure instanceof Error ? failure.message : "Enter a valid number of hours."; }
    }
    setValidation(invalid);
    if (Object.keys(invalid).length) return;
    if (!Object.keys(caps).length) { onClose(); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const result = await client.call<{ changed: boolean; draft?: object }>(tenant, "projects/" + project.id + "/caps", {
        method: "PATCH", body: { expectedRevision: detail.revision, caps }, signal: controller.signal,
      });
      if (!controller.signal.aborted)
        onSaved(deliveryCaps(applyDeliveryCapChange(delivery, caps)), Boolean(result.draft), result.changed);
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure instanceof ApiError && failure.status === 409) {
        setConflict(true);
        setError("The project changed while you were editing. Reload the latest caps before saving.");
      } else {
        if (failure instanceof ApiError && [401, 403].includes(failure.status)) denied.current?.();
        setError(failure instanceof Error ? failure.message : "Caps could not be saved.");
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const delivery = detail?.project.delivery;
  const fields = delivery && canEditMonthlyCap(delivery) ? capFields : capFields.slice(1);
  return <form className="secure-form mi-cap-editor" aria-labelledby={formTitle} noValidate onSubmit={submit}
    onKeyDown={event => {
      if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); }
    }}>
    <div className="mi-cap-editor-header">
      <h5 id={formTitle}>Edit caps for {project.name}</h5>
      <p>Leave a field blank for unlimited hours.{project.published && " Changes stay private until published."}</p>
    </div>
    {delivery && <fieldset className="mi-cap-fields" disabled={busy || conflict}>
      {fields.map(([key, title], index) => <div key={key}><label>{title} cap (hours)
        <input ref={index === 0 ? input : undefined} inputMode="decimal" value={values[key] ?? fieldValue(delivery[key])}
          placeholder="Unlimited" autoComplete="off" aria-invalid={Boolean(validation[key]) || undefined}
          aria-describedby={validation[key] ? `${formTitle}-${key}` : undefined}
          onChange={event => {
            setValues({ ...values, [key]: event.target.value });
            onDirty?.(true);
            setValidation({ ...validation, [key]: undefined });
          }} /></label>
        {validation[key] && <small className="secure-error" id={`${formTitle}-${key}`} role="alert">{validation[key]}</small>}
      </div>)}
    </fieldset>}
    {!delivery && !error && <p role="status">Loading cap values…</p>}
    {error && <p role="alert" className="secure-error">{error}</p>}
    <div className="mi-cap-editor-actions">
      {(conflict || !delivery && error) && <button type="button" className="secure-secondary" onClick={refresh}>Reload cap values</button>}
      <button type="button" className="secure-secondary" onClick={onClose} disabled={busy}>Cancel</button>
      {delivery && <button type="submit" disabled={busy || conflict}>{busy ? "Saving…" : "Save"}</button>}
    </div>
  </form>;
}
