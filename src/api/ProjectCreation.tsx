import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, FolderKanban, Layers3 } from "lucide-react";
import { isProgramType, type Delivery } from "../projects/delivery";
import { hoursToSeconds } from "../projects/duration";
import type { ManagedProject, Project, StaffProjectSummary } from "../projects/model";
import type { TimeMapping } from "../projects/time";
import { byOrder, type Portfolio } from "../projects/portfolio";
import { CalendarMultiPicker, CalendarPicker } from "./CalendarPicker";
import { PeoplePicker } from "./DeliveryOperations";
import { ManagementDialog } from "./ManagementDialog";
import { SearchableCombobox } from "./SearchableCombobox";
import { ActivityScheduleFields, activityInput, selectedActivity } from "./ActivityScheduleFields";
import "./project-creation.css";

const projectKinds = [
  { value: "engagement", label: "Parent Project", description: "Organize work across departments.", Icon: FolderKanban },
  { value: "project", label: "Delivery Project", description: "Track work within a parent project and department.", Icon: Layers3 },
] as const;
const arrangements = [
  { value: "hourly", label: "Hourly" },
  { value: "fixed-fee", label: "Fixed Fee" },
  { value: "training", label: "Training & Workshops" },
] as const;

const titles = {
  identity: "Project identity",
  location: "Location",
  description: "Client description",
  arrangement: "Schedule and hours",
  people: "People",
  review: "Review",
};
type Step = keyof typeof titles;

function amount(value: string, previous?: number) {
  return !value.trim() ? undefined : previous !== undefined && value === String(previous / 3600) ? previous : hoursToSeconds(value.trim());
}

export function ProjectCreation({ fromTime, initialName, projects, portfolio, project, busy, canPublish, discovered, onDirty, onCancel, onSave }: {
  projects: StaffProjectSummary[];
  portfolio?: Portfolio;
  project?: Project;
  fromTime?: { parent: string; area: string };
  initialName?: string;
  busy: boolean;
  canPublish: boolean;
  discovered?: TimeMapping[];
  onDirty: () => void;
  onCancel: () => void;
  onSave: (project: ManagedProject, publish: boolean) => void;
}) {
  const saved = project?.delivery;
  const legacyRecord = Boolean(project && saved?.structure !== 3);
  const [remediate, setRemediate] = useState(false);
  const legacy = legacyRecord && !remediate;
  const canPublishNow = canPublish;
  const [step, setStep] = useState<Step>("identity");
  const [kind, setKind] = useState<Delivery["kind"]>(saved?.kind ?? (project || fromTime ? "project" : "engagement"));
  const [name, setName] = useState(project?.name ?? initialName ?? "");
  const [parent, setParent] = useState(saved?.parentId ?? fromTime?.parent ?? "");
  const [area, setArea] = useState(saved?.areaId ?? fromTime?.area ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [reference, setReference] = useState(project?.workOrderReference ?? "");
  const [pendingJobCode, setPendingJobCode] = useState(saved?.pendingTimeJobcodeId ?? "");
  const [type, setType] = useState<Delivery["type"]>(saved?.type ?? "hourly");
  const [monthly, setMonthly] = useState(saved?.monthlyCap === undefined ? "" : String(saved.monthlyCap / 3600));
  const [lifetime, setLifetime] = useState(saved?.lifetimeCap === undefined ? "" : String(saved.lifetimeCap / 3600));
  const [countForParent, setCountForParent] = useState(saved?.countAgainstParentCap !== false);
  const [start, setStart] = useState(saved?.start ?? "");
  const [deadline, setDeadline] = useState(saved?.deadline ?? "");
  const [days, setDays] = useState(saved?.training?.days.toString() ?? "1");
  const [dates, setDates] = useState(saved?.training?.dates ?? []);
  const [venue, setVenue] = useState(saved?.training?.venue ?? "");
  const [activity, setActivity] = useState(() => activityInput(saved?.activity));
  const [managers, setManagers] = useState(saved?.managerIds ?? []);
  const [team, setTeam] = useState(saved?.teamIds ?? []);
  const [facilitators, setFacilitators] = useState(saved?.training?.facilitatorIds ?? []);
  const publishSummary = saved?.publishSummary ?? false;
  const publishStartStatus = saved?.publishStartStatus ?? !project;
  const [pendingPublication, setPendingPublication] = useState<ManagedProject>();
  const [error, setError] = useState("");
  const [invalidStep, setInvalidStep] = useState<Step>();
  const heading = useRef<HTMLHeadingElement>(null);
  const fieldId = useId();

  useEffect(() => { heading.current?.focus(); }, [step]);

  const parents = projects.filter(p => p.delivery?.kind === "engagement" && !p.delivery.parentId && p.id !== project?.id);
  const departments = [...(portfolio?.areas ?? [])].sort(byOrder);
  const legacyDepartment = legacyRecord ? projects.find(p => p.id === parent && p.delivery?.kind === "service-area") : undefined;
  const selectedParent = parents.find(item => item.id === (legacyDepartment?.delivery?.parentId ?? parent));
  const selectedDepartment = departments.find(item => item.id === (area || legacyDepartment?.delivery?.areaId));
  const miscellaneous = kind === "project" && (selectedDepartment?.id === "miscellaneous" ||
    selectedDepartment?.name.trim().toLowerCase() === "miscellaneous");
  const program = isProgramType(type);
  const hasActivityDates = activity.mode !== "unscheduled";
  const daysCount = Number(days);
  const validDays = Number.isSafeInteger(daysCount) && daysCount >= 1 && daysCount <= 60;
  const requiresCompleteProgram = !legacy || type !== saved?.type;
  const latest = [...dates].sort().at(-1);
  const steps: Step[] = [
    "identity", ...(kind !== "engagement" ? ["location" as const] : []),
    ...(!miscellaneous ? ["description" as const] : []),
    "arrangement", "people", "review",
  ];
  const position = steps.indexOf(step);
  const path = [selectedParent?.name ?? (legacy && kind !== "engagement" ? "Existing hierarchy" : undefined),
    selectedDepartment?.name, name.trim()].filter(Boolean);
  const people = portfolio?.directory ?? [];

  function change<T>(setter: (value: T) => void, value: T) {
    setter(value);
    onDirty();
    setError("");
    setInvalidStep(undefined);
  }

  function validate(part: Step) {
    if (part === "identity" && !name.trim()) throw Error("Enter a project name.");
    if (part === "location" && !legacy && (!selectedParent || !selectedDepartment))
      throw Error("Choose a parent project and department.");
    if (part === "arrangement") {
      selectedActivity(activity);
      if (program && !hasActivityDates && (!validDays || dates.length > daysCount || requiresCompleteProgram && dates.length !== daysCount))
        throw Error("Choose exactly one distinct calendar date per program day.");
      if ((!program || hasActivityDates) && start && deadline && start > deadline)
        throw Error("Choose an expected end date on or after the start date.");
      if (!program) {
        if (type === "hourly" || miscellaneous) amount(monthly, saved?.monthlyCap);
        amount(lifetime, saved?.lifetimeCap);
      }
    }
    if (part === "people") {
      if (!legacy && !managers.length) throw Error("Choose at least one project manager.");
      if (program && requiresCompleteProgram && !facilitators.length) throw Error("Choose at least one facilitator.");
    }
  }

  function next() {
    try {
      validate(step);
      setError("");
      setStep(steps[position + 1]);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Check the fields and try again.");
      setInvalidStep(step);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step !== "review") { next(); return; }
    let checking: Step = "identity";
    try {
      for (const part of steps) {
        checking = part;
        validate(part);
      }
      const publish = canPublishNow && (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "publish";
      const {
        start: _start, deadline: _deadline,
        monthlyCap: _monthly, lifetimeCap: _lifetime, training: sourceProgram, ...unchanged
      } = saved ?? {};
      const existingProgram = saved && isProgramType(saved.type);
      const monthlyCap = program ? existingProgram ? saved?.monthlyCap : undefined :
        type === "hourly" || miscellaneous ? amount(monthly, saved?.monthlyCap) :
          legacy && type === saved?.type ? saved?.monthlyCap : undefined;
      const lifetimeCap = program ? existingProgram ? saved?.lifetimeCap : undefined : amount(lifetime, saved?.lifetimeCap);
      const selectedSchedule = selectedActivity(activity);
      const schedule = program && !selectedSchedule && (!legacy || dates.length > 0)
        ? { start: [...dates].sort()[0], deadline: latest }
        : { start: start || undefined, deadline: deadline || undefined };
      const training = miscellaneous ? sourceProgram : program && (!legacy || sourceProgram || dates.length || selectedSchedule)
        ? { ...sourceProgram, days: selectedSchedule?.dates.length ?? daysCount, dates: selectedSchedule?.dates ?? dates,
          facilitatorIds: facilitators, venue: selectedSchedule ? undefined : venue.trim() || undefined }
        : undefined;
      const delivery: Delivery = {
        ...unchanged,
        ...(legacy ? {} : { structure: 3, parentId: kind === "project" ? parent : undefined, areaId: kind === "project" ? area : undefined }),
        kind, type, managerIds: managers, teamIds: team,
        ...(!miscellaneous && kind === "project" && type === "hourly" ? { countAgainstParentCap: countForParent } : {}),
        ...(publishSummary || saved?.publishSummary !== undefined ? { publishSummary } : {}),
        ...(publishStartStatus || saved?.publishStartStatus !== undefined ? { publishStartStatus } : {}),
        monthlyCap, lifetimeCap, training, ...schedule, activity: selectedSchedule,
        pendingTimeJobcodeId: kind === "service-area" ? undefined : pendingJobCode || undefined,
      };
      const candidate: ManagedProject = {
        name: name.trim(),
        status: project?.status ?? "planned",
        progress: project?.progress ?? 0,
        description,
        internalNotes: project?.internalNotes ?? "",
        workOrderReference: reference,
        plan: project?.plan ?? { basis: "fixed", targetSeconds: 0 },
        delivery,
      };
      if (publish) setPendingPublication(candidate);
      else onSave(candidate, false);
    } catch (problem) {
      setStep(checking);
      setError(problem instanceof Error ? problem.message : "The project could not be saved.");
      setInvalidStep(checking);
    }
  }

  return <><form className="secure-form creation-wizard" data-step={step} aria-label={project ? "Edit a project" : "Create a project"} onSubmit={submit} noValidate>
    <header className="creation-head">
      {project?.published && <p>{canPublishNow ? "Save a private draft or publish these changes to authorized clients." :
        "Changes are saved as a private draft for review."}</p>}
    </header>
    <ol className="creation-steps" aria-label="Project setup steps">{steps.map((item, index) =>
      <li key={item} aria-label={titles[item]} aria-current={step === item ? "step" : undefined} data-completed={position > index || undefined}>
        <span className="creation-step-number" aria-hidden="true">{position > index ? <Check size={14} /> : index + 1}</span>
        <span className="creation-step-title">{titles[item]}</span>
      </li>)}</ol>
    <div className="creation-body">
      <p className="creation-step-label">Step {position + 1} of {steps.length}</p>
      <h2 ref={heading} tabIndex={-1}>{titles[step]}</h2>
    </div>
    <fieldset className="creation-fields" disabled={busy} aria-describedby={error ? fieldId + "-error" : undefined}>
      <legend className="creation-legend">{titles[step]}</legend>
      {step === "identity" && <>
        {legacy ? <div>
          <p className="secure-muted">This project keeps its existing structure until you explicitly change it.</p>
          <button type="button" className="secure-secondary" onClick={() => {
            if (kind === "service-area") setKind("project");
            if (selectedParent) setParent(selectedParent.id);
            if (selectedDepartment) setArea(selectedDepartment.id);
            change(setRemediate, true);
          }}>Update project hierarchy</button>
        </div> :
          <div className="creation-kinds">{projectKinds.map(option =>
            <label key={option.value} className={kind === option.value ? "creation-kind-selected" : undefined}>
              <input type="radio" name="project-kind" aria-label={option.label} aria-describedby={fieldId + option.value}
                checked={kind === option.value} onChange={() => change(setKind, option.value)} />
              <span className="creation-kind-icon"><option.Icon size={21} aria-hidden="true" /></span>
              <span className="creation-kind-copy"><span>{option.label}</span><small id={fieldId + option.value}>{option.description}</small></span>
            </label>)}</div>}
        <label>Project name<input value={name} maxLength={200} required aria-invalid={invalidStep === "identity" || undefined}
          aria-describedby={invalidStep === "identity" ? fieldId + "-error" : undefined}
          onChange={event => change(setName, event.target.value)} /></label>
      </>}
      {step === "location" && <>
        {!legacy && <div className="creation-columns">
          <SearchableCombobox label="Parent Project" value={parent} onChange={value => change(setParent, value)} required
            options={parents.map(item => ({ value: item.id, label: item.name }))} />
          <SearchableCombobox label="Department" value={area} onChange={value => change(setArea, value)} required
            options={departments.map(item => ({ value: item.id, label: item.name }))} />
        </div>}
        {legacy && <p className="secure-muted">The existing parent and department are preserved. Review hierarchy changes separately.</p>}
        {!legacy && !parents.length && <p>Create a Parent Project first to organize this delivery work.</p>}
        <div className="creation-path" aria-label="Project location">{path.map((item, index) =>
          <span key={index}>{index > 0 && <ChevronRight size={15} aria-hidden="true" />}{item}</span>)}</div>
      </>}
      {step === "description" && <>
        <label>Client-facing description<textarea rows={4} value={description} maxLength={4000} onChange={event => change(setDescription, event.target.value)} /></label>
        <label>Work-order reference <small>Optional. This label is separate from the approved Time mapping.</small>
          <input value={reference} maxLength={120} onChange={event => change(setReference, event.target.value)} /></label>
      </>}
      {step === (miscellaneous ? "location" : "description") && kind !== "service-area" && <div>
        <SearchableCombobox label="QuickBooks Time Work Order" value={pendingJobCode} onChange={value => change(setPendingJobCode, value)}
          placeholder="Find a discovered work order"
          options={(discovered ?? []).filter(row => row.canReview || row.jobcodeId === pendingJobCode)
            .map(row => ({ value: row.jobcodeId, label: row.sourceName ?? row.jobcodeId }))} />
        <p>Optional. A selected work order stays pending until an authorized Time administrator confirms the mapping.</p>
      </div>}
      {step === "arrangement" && <>
        {!miscellaneous && <label>Arrangement<select aria-label="Arrangement" value={program ? "training" : type} onChange={event => change(setType, event.target.value as Delivery["type"])}>
          {arrangements.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select></label>}
        {!program && <div className="creation-columns">
          {(type === "hourly" || miscellaneous) && <label>Monthly budgeted hours<input inputMode="decimal" value={monthly}
            onChange={event => change(setMonthly, event.target.value)} placeholder="No monthly cap" /></label>}
          <label>{type === "hourly" || miscellaneous ? "Whole-project budgeted hours" : "Hour cap"}
            <input inputMode="decimal" value={lifetime} onChange={event => change(setLifetime, event.target.value)} placeholder="No cap" /></label>
        </div>}
        {!miscellaneous && type === "hourly" && kind === "project" && <label className="creation-checkbox">
          <input type="checkbox" checked={countForParent} onChange={event => change(setCountForParent, event.target.checked)} />
          Count this project&rsquo;s delivery hours against the parent&rsquo;s budget</label>}
        {program && !hasActivityDates ? <>
          <div className="creation-columns">
            <label>Program length in days<input type="number" min={1} max={60} value={days}
              onChange={event => change(setDays, event.target.value)} /></label>
            <label>Venue<input value={venue} maxLength={200} onChange={event => change(setVenue, event.target.value)} /></label>
          </div>
          <CalendarMultiPicker label="Program dates" values={dates} onChange={value => change(setDates, value)} limit={validDays ? daysCount : 1} />
          {latest && <p>Expected completion <strong><time dateTime={latest}>{latest}</time></strong></p>}
        </> : <div className="creation-columns">
          <CalendarPicker label="Start date" value={start} onChange={value => change(setStart, value)} />
          <CalendarPicker label="Expected end date" value={deadline} onChange={value => change(setDeadline, value)} min={start || undefined} />
        </div>}
        <ActivityScheduleFields value={activity} change={value => change(setActivity, value)} />
      </>}
      {step === "people" && <div className="creation-columns">
        <PeoplePicker name="projectManagers" label="Project Managers" people={people} defaults={managers} onSelectionChange={value => change(setManagers, value)} />
        {program && <PeoplePicker name="programFacilitators" label="Facilitators" people={people} defaults={facilitators} onSelectionChange={value => change(setFacilitators, value)} />}
        <PeoplePicker name="projectTeam" label="Team Members" people={people} defaults={team} onSelectionChange={value => change(setTeam, value)} />
      </div>}
      {step === "review" && <>
        <div className="creation-path" aria-label="Project location">{path.map((item, index) =>
          <span key={index}>{index > 0 && <ChevronRight size={15} aria-hidden="true" />}{item}</span>)}</div>
        <dl className="creation-summary">
          {!miscellaneous && <div><dt>Arrangement</dt><dd>{arrangements.find(item => item.value === (program ? "training" : type))?.label}</dd></div>}
          {!program && <div><dt>Hours caps</dt><dd>{[
            ((type === "hourly" || miscellaneous) && monthly) && monthly + " h per month", lifetime && lifetime + " h total",
          ].filter(Boolean).join(" / ") || "No cap"}</dd></div>}
          <div><dt>Schedule</dt><dd>{program && !hasActivityDates ? dates.slice().sort().join(", ") || "No dates selected" :
            [start, deadline].filter(Boolean).join(" to ") || "No dates selected"}</dd></div>
          {activity.mode !== "unscheduled" && <div><dt>Activity dates</dt><dd>{selectedActivity(activity)?.dates.join(", ")}</dd></div>}
          {program && !hasActivityDates && venue.trim() && <div><dt>Venue</dt><dd>{venue}</dd></div>}
          <div><dt>Project managers</dt><dd>{people.filter(person => managers.includes(person.id)).map(person => person.name).join(", ") || "None selected"}</dd></div>
          {program && <div><dt>Facilitators</dt><dd>{people.filter(person => facilitators.includes(person.id)).map(person => person.name).join(", ") || "None selected"}</dd></div>}
          {team.length > 0 && <div><dt>Team members</dt><dd>{people.filter(person => team.includes(person.id)).map(person => person.name).join(", ")}</dd></div>}
          {!miscellaneous && reference.trim() && <div><dt>Work-order reference</dt><dd>{reference}</dd></div>}
          {pendingJobCode && <div><dt>QuickBooks Time Work Order</dt><dd>{discovered?.find(row => row.jobcodeId === pendingJobCode)?.sourceName ?? pendingJobCode} · Pending review</dd></div>}
          {!miscellaneous && description.trim() && <div><dt>Client description</dt><dd>{description}</dd></div>}
        </dl>
        {!project && !canPublish && <p className="secure-muted">A publisher must approve this project before clients can see it.</p>}
      </>}
      {error && <p id={fieldId + "-error"} className="secure-error" role="alert">{error}</p>}
    </fieldset>
    <div className="creation-actions">
      <button type="button" className="secure-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      <div>
        {position > 0 && <button type="button" className="secure-secondary" disabled={busy}
          onClick={() => { setStep(steps[position - 1]); setError(""); setInvalidStep(undefined); }}>Back</button>}
        {step === "review" ? <>
          <button type="submit" className={canPublishNow ? "secure-secondary" : undefined} disabled={busy}>{!project || project.published ? "Save Draft" : "Save Changes"}</button>
          {canPublishNow && <button type="submit" value="publish" disabled={busy}>{project ? "Save & Publish" : "Create & Publish"}</button>}
        </> : <button type="submit" disabled={busy}>Continue</button>}
      </div>
    </div>
  </form>
    {pendingPublication && <ManagementDialog title={project ? "Publish project changes?" : "Publish new project?"}
      close={() => setPendingPublication(undefined)}>
      <p><strong>{pendingPublication.name}</strong></p>
      <p>Authorized clients can see the project name, status and approved description after publication.</p>
      <p>{publishSummary ? "The previously approved schedule and cap settings remain eligible for publishing."
        : "Schedule dates and hour caps remain private."} {publishStartStatus && !publishSummary &&
        "Clients may see the delivery phase without seeing the start date."} Only approved directory details appear for assigned people.</p>
      <footer>
        <button type="button" className="secure-secondary" onClick={() => setPendingPublication(undefined)}>Cancel</button>
        <button type="button" className="mi-picker-primary" onClick={() => {
          setPendingPublication(undefined);
          onSave(pendingPublication, true);
        }}>Publish</button>
      </footer>
    </ManagementDialog>}
  </>;
}
