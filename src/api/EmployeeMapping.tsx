import { useEffect, useId, useState } from "react";
import { ArrowRight, Link2, Unlink } from "lucide-react";
import type { EmployeeMappingChange, EmployeeMappingReceipt, EmployeeMappingsPage, TimeEmployeeCandidate } from "../projects/employee-mapping";
import { ApiError, type SecuredApiClient } from "./client";
import { reportDay } from "./dashboard-format";
import { PersonPhoto } from "./PersonPhoto";
import "./employee-mapping.css";

type Props = {
  client: SecuredApiClient;
  tenant: string;
  onDenied: () => void;
  onViewTime?: (userId: string) => void;
};

const endpoint = "directory/employee-mappings";
const searchText = (value: string) => value.normalize("NFKC").toLowerCase().trim();

function mergedCandidates(previous: TimeEmployeeCandidate[], next: TimeEmployeeCandidate[]) {
  const employees = new Map(previous.map(person => [person.employeeKey, person]));
  for (const person of next) {
    const existing = employees.get(person.employeeKey);
    if (!existing || !existing.providerName && person.providerName ||
        Boolean(existing.providerName) === Boolean(person.providerName) && person.workDate > existing.workDate)
      employees.set(person.employeeKey, person);
  }
  return [...employees.values()].sort((a, b) => (a.providerName ?? a.userId).localeCompare(b.providerName ?? b.userId));
}

export function EmployeeMapping(props: Props) {
  return <EmployeeMappingPage key={props.tenant} {...props} />;
}

function EmployeeMappingPage({ client, tenant, onDenied, onViewTime }: Props) {
  const heading = useId();
  const sourcePicker = useId(), profilePicker = useId();
  const [page, setPage] = useState<EmployeeMappingsPage>();
  const [employeeKey, setEmployeeKey] = useState("");
  const [profileId, setProfileId] = useState("");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [pendingUnlink, setPendingUnlink] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function failed(reason: unknown) {
    if (reason instanceof ApiError) {
      if (reason.status === 401 || reason.status === 403) onDenied();
      setError(reason.code === "source_conflict"
        ? "The verification entry changed. Reload employees and review the current source details."
        : reason.message);
    } else setError("Employee mapping is temporarily unavailable. Try again.");
  }

  useEffect(() => {
    const controller = new AbortController();
    void client.call<EmployeeMappingsPage>(tenant, endpoint, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setPage({ ...data, candidates: mergedCandidates([], data.candidates) }); })
      .catch(reason => { if (!controller.signal.aborted) failed(reason); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [client, tenant]);

  async function load(cursor?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const path = cursor ? endpoint + "?" + new URLSearchParams({ cursor }) : endpoint;
      const data = await client.call<EmployeeMappingsPage>(tenant, path);
      setPage(previous => ({ ...data, candidates: mergedCandidates(cursor ? previous?.candidates ?? [] : [], data.candidates) }));
      if (!cursor) {
        setEmployeeKey(""); setProfileId(""); setPendingUnlink("");
      }
      if (cursor && !data.candidates.length && data.nextCursor) setNotice("This page contained no verified employees. You can scan more imported time below.");
    } catch (reason) { failed(reason); }
    finally { setBusy(false); }
  }

  async function save(change: EmployeeMappingChange) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.call<EmployeeMappingReceipt>(tenant, endpoint, { method: "PATCH", body: change });
      setPage(previous => previous && { ...previous, revision: result.revision,
        links: [...previous.links.filter(link => link.employeeKey !== change.employeeKey), ...(result.link ? [result.link] : [])] });
      setPendingUnlink("");
      setNotice(result.changed ? (change.action === "unlink" ? "Employee link removed." : "Employee link saved.") : "This employee link is already up to date.");
    } catch (reason) { failed(reason); }
    finally { setBusy(false); }
  }

  const employee = page?.candidates.find(person => person.employeeKey === employeeKey);
  const current = page?.links.find(link => link.employeeKey === employeeKey);
  const profile = page?.profiles.find(person => String(person.id) === profileId);
  const occupied = new Set((page?.links ?? []).filter(link => link.employeeKey !== employeeKey).map(link => link.profileId));
  const selectablePeople = page?.candidates.filter(person => person.employeeKey === employeeKey ||
    searchText([person.providerName, person.userId].join(" ")).includes(searchText(peopleSearch))) ?? [];
  const selectableProfiles = page?.profiles.filter(person => String(person.id) === profileId ||
    searchText([person.name, person.title, person.id].join(" ")).includes(searchText(profileSearch))) ?? [];

  return <section className="employee-mapping" aria-labelledby={heading} aria-busy={busy}>
    <header className="employee-mapping__heading">
      <div>
        <h2 id={heading}>Employee Mapping</h2>
        <p>Connect a verified QuickBooks Time employee to their Morris WordPress profile. Hours and original names still come from QuickBooks Time. Links are private to Morris.</p>
      </div>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load()}>Reload employees</button>
    </header>
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    {notice && <p className="secure-message" role="status">{notice}</p>}
    {!page && busy && <p role="status">Loading verified employees and WordPress profiles…</p>}
    {page && <>
      {!page.candidates.length && <p className="secure-empty">No verified employee IDs in the imported entries scanned so far. If details are missing, use the approved historical enrichment procedure.</p>}
      {!page.profiles.length && <p className="secure-empty">No active WordPress profiles. Sync the Morris Team Directory before linking an employee.</p>}
      <form onSubmit={event => {
        event.preventDefault();
        if (employee && profile && current?.profileId !== profile.id && !occupied.has(profile.id))
          void save({ action: "link", expectedRevision: page.revision, employeeKey, sourceId: employee.sourceId, sourceRevision: employee.sourceRevision, profileId: profile.id });
      }}>
        <div className="employee-mapping__pair">
          <fieldset disabled={busy}>
            <legend>QuickBooks Time employee</legend>
            <label>Search employees<input type="search" value={peopleSearch} maxLength={120} onChange={e => setPeopleSearch(e.target.value)} /></label>
            <div className="employee-mapping__field"><label htmlFor={sourcePicker}>Verified employee</label><select id={sourcePicker} value={employeeKey} onChange={e => {
              setEmployeeKey(e.target.value);
              const link = page.links.find(item => item.employeeKey === e.target.value);
              setProfileId(link && page.profiles.some(item => item.id === link.profileId) ? String(link.profileId) : "");
            }}>
              <option value="">Choose a verified employee</option>
              {selectablePeople.map(person => <option key={person.employeeKey} value={person.employeeKey}>{person.providerName ?? "Name unavailable"} · ID {person.userId} · {reportDay(person.workDate)}</option>)}
            </select></div>
            {employee && <div className="employee-mapping__identity">
              <span className="employee-mapping__name">{employee.providerName ?? "Name unavailable"}</span>
              <span>Time user {employee.userId}</span><span>Verified on {employee.workOrder} · {reportDay(employee.workDate)}</span>
            </div>}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Morris WordPress profile</legend>
            <label>Search WordPress profiles<input type="search" value={profileSearch} maxLength={120} onChange={e => setProfileSearch(e.target.value)} /></label>
            <div className="employee-mapping__field"><label htmlFor={profilePicker}>WordPress profile</label><select id={profilePicker} value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">Choose a profile</option>
              {selectableProfiles.map(person => <option key={person.id} value={person.id} disabled={occupied.has(person.id)}>{person.name} · Profile {person.id}{occupied.has(person.id) ? " (linked)" : ""}</option>)}
            </select></div>
            {profile && <div className="employee-mapping__photo">
              <PersonPhoto name={profile.name} photo={profile.photo} alt={profile.alt} />
              <div className="employee-mapping__identity"><span className="employee-mapping__name">{profile.name}</span><span>{profile.title ?? "Title unavailable"}</span><span>WordPress profile {profile.id}</span></div>
            </div>}
          </fieldset>
        </div>
        <div className="employee-mapping__actions">
          <button type="submit" disabled={busy || !employee || !profile || current?.profileId === profile.id || occupied.has(profile.id)}><Link2 size={17} aria-hidden="true" />Confirm employee link</button>
          {page.nextCursor && <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load(page.nextCursor)}>Scan more imported time</button>}
          <span>{page.candidates.length} verified {page.candidates.length === 1 ? "employee" : "employees"} found</span>
        </div>
      </form>
      <h3>Saved employee links</h3>
      {!page.links.length ? <p className="secure-empty">No employees are linked yet.</p> : <ul className="employee-mapping__links">
        {page.links.map(link => {
          const person = page.profiles.find(item => item.id === link.profileId);
          const source = page.candidates.find(item => item.employeeKey === link.employeeKey);
          return <li key={link.employeeKey}>
            <div><span className="employee-mapping__name">{source?.providerName ?? "QuickBooks Time employee"}</span><span>Time user {link.userId}</span></div>
            <ArrowRight size={17} aria-hidden="true" />
            <div className="employee-mapping__photo">
              {person && <PersonPhoto name={person.name} photo={person.photo} alt={person.alt} />}
              <div><span className="employee-mapping__name">{person?.name ?? "Profile unavailable"}</span><span>WordPress profile {link.profileId}</span></div>
            </div>
            <div className="employee-mapping__actions">
              {onViewTime && <button type="button" className="secure-secondary" disabled={busy} onClick={() => onViewTime(link.userId)}>View employee time</button>}
              <button type="button" className="secure-secondary" disabled={busy} aria-expanded={pendingUnlink === link.employeeKey}
                onClick={() => setPendingUnlink(pendingUnlink === link.employeeKey ? "" : link.employeeKey)}><Unlink size={16} aria-hidden="true" />Remove link</button>
            </div>
            {pendingUnlink === link.employeeKey && <div className="employee-mapping__confirmation">
              <p>Remove the link to {person?.name ?? "this WordPress profile"}? Recorded hours stay with Time user {link.userId}.</p>
              <button type="button" disabled={busy} onClick={() => void save({ action: "unlink", expectedRevision: page.revision, employeeKey: link.employeeKey })}>Confirm removal</button>
              <button type="button" className="secure-secondary" disabled={busy} onClick={() => setPendingUnlink("")}>Cancel</button>
            </div>}
          </li>;
        })}
      </ul>}
    </>}
  </section>;
}
