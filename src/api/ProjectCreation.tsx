import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, FolderTree, Layers3, ListChecks, Target, UsersRound } from "lucide-react";
import { deliveryKindNames, deliveryKinds, engagementTypes, type Delivery } from "../projects/delivery";
import { hoursToSeconds } from "../projects/duration";
import { milestoneTemplates } from "../projects/milestone-templates";
import { MAX_PROJECT_MILESTONES, type ManagedProject, type StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import { PeoplePicker } from "./DeliveryOperations";
import "./project-creation.css";

const steps = ["Type and name", "Location", "Budget and dates", "People", "Milestones", "Review"] as const;
const icons = [FolderTree, Layers3, Target, UsersRound, CalendarDays, ListChecks];
const descriptions = {
  engagement: "The parent for a client workstream. Add projects or service areas when you’re ready.",
  "service-area": "A department within a parent engagement, with its own optional budget.",
  project: "A piece of work with its own team, milestones and time allocations.",
};
const capFields = ["monthlyCap", "lifetimeCap"] as const;
const capLabel = { monthlyCap: "Monthly cap", lifetimeCap: "Lifetime cap" };

export function ProjectCreation({ projects, portfolio, busy, onDirty, onCancel, onSave }: {
  projects: StaffProjectSummary[];
  portfolio?: Portfolio;
  busy: boolean;
  onDirty: () => void;
  onCancel: () => void;
  onSave: (project: ManagedProject, openDetails: boolean) => void;
}) {
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Delivery["kind"]>("engagement");
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [department, setDepartment] = useState("");
  const [area, setArea] = useState("");
  const [cap, setCap] = useState("none");
  const [values, setValues] = useState({ monthlyCap: "", lifetimeCap: "" });
  const [managers, setManagers] = useState<string[]>([]);
  const [team, setTeam] = useState<string[]>([]);
  const [template, setTemplate] = useState<keyof typeof milestoneTemplates>("General delivery");
  const [selected, setSelected] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const milestoneIds = useRef(new Map<string, string>());

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step]);

  const parents = projects.filter(item => item.delivery?.kind === "engagement" && !item.delivery.parentId);
  const departments = projects.filter(item => item.delivery?.kind === "service-area" && item.delivery.parentId === parent);
  const parentLabel = parents.find(item => item.id === parent)?.name;
  const departmentEntry = departments.find(item => item.id === department);
  const assignedArea = portfolio?.areas.find(item => item.id === area);
  const parentOptions = parents;
  const canLocate = kind === "engagement" || Boolean(parentLabel &&
    (kind !== "service-area" || assignedArea) && (!department || departmentEntry));
  const canSave = Boolean(name.trim() && canLocate);
  const hasCap = (key: typeof capFields[number]) => cap === "both" || (key === "monthlyCap" ? cap === "monthly" : cap === "lifetime");
  const breadcrumb = [kind === "engagement" ? undefined : parentLabel, departmentEntry?.name, name.trim()].filter(Boolean);

  function proceed(direction: number) {
    if (direction > 0 && ((step === 0 && !name.trim()) || (step === 1 && !canLocate))) return;
    if (direction > 0 && step === 3) setNotice("Team selected. These assignments will be saved with the project.");
    if (direction < 0) setNotice("");
    setError("");
    setStep(current => current + direction);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const read = (key: string) => String(form.get(key) ?? "").trim();
    try {
      const budget = Object.fromEntries(capFields.filter(hasCap).map(key => {
        if (!values[key].trim()) throw Error("Enter the amount for each selected cap, or choose No cap.");
        return [key, hoursToSeconds(values[key])];
      }));
      const start = read("start"), deadline = read("deadline");
      if (start && deadline && start > deadline) throw Error("Choose a deadline on or after the start date.");
      const names = custom.trim() ? [...new Set([...selected, custom.trim()])] : selected;
      if (names.length > MAX_PROJECT_MILESTONES) throw Error("Remove a milestone before adding another.");
      const milestones = names.map(title => {
        const id = milestoneIds.current.get(title) ?? crypto.randomUUID();
        milestoneIds.current.set(title, id);
        return { id, title, date: "", completed: false, status: "not-started" as const, visible: false };
      });
      const input: ManagedProject = {
        name, status: "planned", progress: 0, description: "", internalNotes: "",
        plan: { basis: read("planBasis") === "monthly" ? "monthly" : "fixed", targetSeconds: hoursToSeconds(read("planHours") || "0") },
        milestones,
        delivery: {
          structure: 2, kind, type: read("engagementType") as Delivery["type"],
          managerIds: form.getAll("managerIds").map(String), teamIds: form.getAll("teamIds").map(String),
          ...budget,
          ...(kind === "engagement" ? { allowDirectAllocation: read("allowDirect") === "yes" } :
            { parentId: kind === "project" && departmentEntry ? departmentEntry.id : parent }),
          ...(kind === "service-area" ? { areaId: area } : departmentEntry ? { areaId: departmentEntry.delivery!.areaId } : {}),
          ...(kind === "project" && { countAgainstParentCap: read("countForParent") === "yes" }),
          ...(start && { start }), ...(deadline && { deadline }),
        },
      };
      onSave(input, (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "details");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The project could not be saved.");
    }
  }

  return <form className="secure-form creation-wizard" aria-label="Create a project" onSubmit={submit} onChange={onDirty}>
    <header className="creation-head">
      <div><p className="secure-eyebrow">Projects · New</p><h3>Create a project</h3></div>
      <p>Start with a name and location. Add a budget, people and milestones here or when you’re ready.</p>
    </header>
    <ol className="creation-steps" aria-label="Creation steps">{steps.map((label, index) => {
      const Icon = icons[index];
      return <li key={label} aria-current={step === index ? "step" : undefined} data-completed={step > index || undefined}>
        <Icon aria-hidden="true" size={16} /><span>{label}</span>
      </li>;
    })}</ol>
    <div className="creation-body" key={"heading-" + step}>
      <p className="creation-step-label">Step {step + 1} of {steps.length}</p>
      <h4 ref={heading} tabIndex={-1}>{steps[step]}</h4>
    </div>
    <fieldset className="creation-fields" hidden={step !== 0} disabled={busy}>
      <legend className="creation-legend">Project type and name</legend>
      <div className="creation-kinds">{deliveryKinds.map(option => <label key={option} className={kind === option ? "creation-kind-selected" : ""}>
        <input type="radio" name="projectKind" value={option} aria-label={deliveryKindNames[option]} checked={kind === option} onChange={() => {
          setKind(option); setParent(""); setDepartment(""); setArea(""); setParentSearch("");
        }} />
        <span>{deliveryKindNames[option]}<small>{descriptions[option]}</small></span>
      </label>)}</div>
      <label>Project name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
    </fieldset>
    <fieldset className="creation-fields" hidden={step !== 1} disabled={busy}>
      <legend className="creation-legend">Location in the hierarchy</legend>
      {kind === "engagement" ? <p>This engagement sits at the top of the client’s project hierarchy.</p> : parents.length ? <>
        <label>Parent engagement<select aria-label="Parent engagement" value={parent} onChange={e => { setParent(e.target.value); setDepartment(""); }}>
          <option value="">Choose a parent</option>{parentOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        {kind === "service-area" && <label>Service area classification<select aria-label="Service area classification" value={area} onChange={e => setArea(e.target.value)}>
          <option value="">Choose a classification</option>{portfolio?.areas.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
        {kind === "project" && parent && <label>Service area (optional)<select aria-label="Service area (optional)" value={department} onChange={e => setDepartment(e.target.value)}>
          <option value="">Place directly under the engagement</option>{departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
      </> : <p>Create a parent engagement first. Select Parent engagement on the preceding step to begin.</p>}
      {Boolean(breadcrumb.length) && <p className="creation-path">{breadcrumb.join(" / ")}</p>}
    </fieldset>
    <fieldset className="creation-fields secure-editor-grid" hidden={step !== 2} disabled={busy}>
      <legend className="creation-legend">Optional cap and dates</legend>
      <label>Engagement type<select name="engagementType">{engagementTypes.map(type => <option key={type} value={type}>{type === "fixed-fee" ? "Fixed fee" : type === "training" ? "Training and facilitation" : "Hourly"}</option>)}</select></label>
      <label>Budget cap<select aria-label="Budget cap" value={cap} onChange={e => setCap(e.target.value)}><option value="none">No cap</option>
        <option value="monthly">Monthly cap</option><option value="lifetime">Lifetime cap</option><option value="both">Monthly and lifetime caps</option>
      </select></label>
      {capFields.filter(hasCap).map(key => <label key={key}>{capLabel[key]} (hours)<input inputMode="decimal" value={values[key]} onChange={e => setValues(previous => ({ ...previous, [key]: e.target.value }))} /></label>)}
      {kind === "project" && <label>Count toward the parent engagement’s cap<select name="countForParent" aria-label="Count toward the parent engagement’s cap"><option value="yes">Yes</option><option value="no">No</option></select><small>Allocated effort stays visible either way.</small></label>}
      {kind === "engagement" && <label>Allow allocation directly to this engagement<select name="allowDirect"><option value="yes">Yes</option><option value="no">No</option></select></label>}
      <label>Start date<input type="date" name="start" /></label>
      <label>Deadline<input type="date" name="deadline" /></label>
      <details className="delivery-details secure-field-wide"><summary>Optional reporting target</summary><div className="secure-editor-grid">
        <label>Target period<select name="planBasis"><option value="fixed">Lifetime target</option><option value="monthly">Monthly target</option></select></label>
        <label>Planned hours<input name="planHours" inputMode="decimal" /></label>
      </div></details>
    </fieldset>
    <fieldset className="creation-fields" hidden={step !== 3} disabled={busy}>
      <legend className="creation-legend">Assign Morris people</legend>
      <PeoplePicker name="managerIds" label="Project managers" defaults={[]} people={portfolio?.directory ?? []} onSelectionChange={setManagers} />
      <PeoplePicker name="teamIds" label="Team members" defaults={[]} people={portfolio?.directory ?? []} onSelectionChange={setTeam} />
    </fieldset>
    <fieldset className="creation-fields" hidden={step !== 4} disabled={busy}>
      <legend className="creation-legend">Choose optional milestones</legend>
      <label>Milestone template<select aria-label="Milestone template" value={template} onChange={e => setTemplate(e.target.value as keyof typeof milestoneTemplates)}>
        {Object.keys(milestoneTemplates).map(label => <option key={label}>{label}</option>)}
      </select></label>
      <p>{selected.length} of {MAX_PROJECT_MILESTONES} selected. Dates, owners and visibility can be set later.</p>
      <div className="creation-template-grid">{milestoneTemplates[template].map(title => <label className="secure-check" key={title}>
        <input type="checkbox" checked={selected.includes(title)} disabled={selected.length >= MAX_PROJECT_MILESTONES && !selected.includes(title)}
          onChange={e => setSelected(current => e.target.checked ? [...current, title] : current.filter(item => item !== title))} /> {title}
      </label>)}</div>
      <div className="secure-actions">
        <button type="button" className="secure-secondary" disabled={selected.length >= MAX_PROJECT_MILESTONES}
          onClick={() => { setSelected(current => [...new Set([...current, ...milestoneTemplates[template]])].slice(0, MAX_PROJECT_MILESTONES)); onDirty(); }}>Select all in this template</button>
        {Boolean(selected.length) && <button type="button" className="secure-secondary" onClick={() => { setSelected([]); onDirty(); }}>Clear selection</button>}
      </div>
      <label>Custom milestone (optional)<input maxLength={120} value={custom} onChange={e => setCustom(e.target.value)} /></label>
      <button type="button" className="secure-secondary" disabled={!custom.trim() || selected.length >= MAX_PROJECT_MILESTONES} onClick={() => {
        setSelected(current => [...new Set([...current, custom.trim()])]); setCustom(""); onDirty();
      }}>Add custom milestone</button>
    </fieldset>
    <fieldset className="creation-fields" hidden={step !== 5} disabled={busy}>
      <legend className="creation-legend">Draft project summary</legend>
      <dl className="creation-summary">
        <div><dt>Project</dt><dd>{name.trim()}</dd></div>
        <div><dt>Type</dt><dd>{deliveryKindNames[kind]}</dd></div>
        <div><dt>Location</dt><dd>{breadcrumb.join(" / ")}</dd></div>
        <div><dt>Budget</dt><dd>{cap === "none" ? "No cap" : capFields.filter(hasCap).map(key =>
          capLabel[key] + " " + (values[key] ? values[key] + " h" : "needs an amount")).join(" · ")}</dd></div>
        <div><dt>People</dt><dd>{managers.length} {managers.length === 1 ? "manager" : "managers"} · {team.length} {team.length === 1 ? "team member" : "team members"}</dd></div>
        <div><dt>Milestones</dt><dd>{selected.length || custom.trim() ? new Set([...selected, ...(custom.trim() ? [custom.trim()] : [])]).size : "Add later"}</dd></div>
        <div><dt>Visibility</dt><dd>Private draft</dd></div>
      </dl>
    </fieldset>
    {notice && <p role="status">{notice}</p>}
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    <div className="creation-actions secure-actions">
      <button type="button" className="secure-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      {step > 0 && <button type="button" className="secure-secondary" disabled={busy} onClick={() => proceed(-1)}>Back</button>}
      {step < 5 && <button type="button" className={canSave ? "secure-secondary" : undefined} disabled={busy || step === 0 && !name.trim() || step === 1 && !canLocate}
        onClick={() => proceed(1)}>{step === 3 ? "Save team selection" : "Next"}</button>}
      {canSave && <button type="submit" disabled={busy}>{busy ? "Saving…" : step === 5 ? "Save draft" : "Create " + deliveryKindNames[kind].toLowerCase()}</button>}
      {step === 5 && <button type="submit" value="details" className="secure-secondary" disabled={!canSave || busy}>Save and add details</button>}
    </div>
  </form>;
}
