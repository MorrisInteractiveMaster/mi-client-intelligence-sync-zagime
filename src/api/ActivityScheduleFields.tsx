import { CalendarPicker } from "./CalendarPicker";
import { consecutiveDates, venueKinds, type ActivitySchedule, type Venue } from "../projects/activity-schedule";

export type ActivityInput = {
  mode: "unscheduled" | ActivitySchedule["mode"];
  count: number;
  days: string[];
  shared: boolean;
  venue: Venue;
  locations: Record<string, Venue>;
};
const pendingVenue: Venue = { kind: "to-be-determined" };
const labels = {
  physical: "Physical venue", virtual: "Virtual", hybrid: "Hybrid",
  "to-be-determined": "To be determined", "not-applicable": "Not applicable",
};
export function activityInput(value?: ActivitySchedule): ActivityInput {
  return { mode: value?.mode ?? "unscheduled", count: value?.dates.length ?? 1,
    days: value?.mode === "consecutive" ? [value.dates[0], value.dates.at(-1)!] : value?.dates ?? [],
    shared: !value?.venues, venue: value?.sharedVenue ?? pendingVenue,
    locations: Object.fromEntries(value?.venues?.map(item => [item.date, item.venue]) ?? []) };
}
function selectedDates(value: ActivityInput) {
  return value.mode === "consecutive" ? consecutiveDates(value.days[0] ?? "", value.days[1] ?? "")
    : value.days.slice(0, value.mode === "single" ? 1 : value.count).filter(Boolean);
}
export function selectedActivity(value: ActivityInput): ActivitySchedule | undefined {
  if (value.mode === "unscheduled") return;
  const dates = selectedDates(value).sort();
  if (dates.length !== value.count || new Set(dates).size !== dates.length) {
    throw Error("Choose distinct dates that match the number of delivery days.");
  }
  return { mode: value.mode, dates, ...(value.shared || dates.length === 1
    ? { sharedVenue: value.venue }
    : { venues: dates.map(date => ({ date, venue: value.locations[date] ?? pendingVenue })) }) };
}
function VenueFields({ label, value, change }: { label: string; value: Venue; change: (value: Venue) => void }) {
  return <div className="creation-columns">
    <label>{label}<select value={value.kind} onChange={event => {
      const kind = venueKinds.find(option => option === event.target.value);
      if (kind) change({ kind });
    }}>{venueKinds.map(kind => <option key={kind} value={kind}>{labels[kind]}</option>)}</select></label>
    {["physical", "virtual", "hybrid"].includes(value.kind) && <label>Staff-only venue details
      <input value={value.details ?? ""} maxLength={500} onChange={event => change({ ...value, details: event.target.value })} />
    </label>}
  </div>;
}

export function ActivityScheduleFields({ value, change }: { value: ActivityInput; change: (value: ActivityInput) => void }) {
  const dates = [...new Set(selectedDates(value))].sort();
  const dateCount = value.mode === "consecutive" ? 2 : value.mode === "single" ? 1 : value.count;
  return <details open={value.mode !== "unscheduled"}>
    <summary>Delivery activity dates and venue</summary>
    <p>Set activity dates separately from the project start and deadline.</p>
    <label>Delivery days<select aria-label="Delivery days" value={value.mode} onChange={event => {
      const mode = event.target.value as ActivityInput["mode"];
      change({ ...value, mode, count: mode === "single" ? 1 : Math.max(value.count, 2),
        days: mode === value.mode ? value.days : [] });
    }}><option value="unscheduled">Ongoing or unscheduled</option><option value="single">One day</option>
      <option value="consecutive">Consecutive days</option><option value="separate">Separate dates</option></select></label>
    {value.mode !== "unscheduled" && <>
      {value.mode !== "single" && <label>Number of delivery days<input type="number" min="2" max="60" value={value.count}
        onChange={event => { const count = Number(event.target.value); if (Number.isInteger(count) && count >= 2 && count <= 60) change({ ...value, count }); }} /></label>}
      <div className="creation-columns">{Array.from({ length: dateCount }, (_, index) => <CalendarPicker key={index}
        label={value.mode === "consecutive" ? index ? "Last delivery date" : "First delivery date" : value.mode === "single" ? "Delivery date" : "Delivery date " + (index + 1)}
        value={value.days[index] ?? ""} onChange={date => {
          const days = [...value.days];
          days[index] = date;
          change({ ...value, days });
        }} />)}</div>
      <p aria-live="polite">{dates.length} of {value.count} delivery days selected</p>
      {value.count > 1 && <label className="creation-checkbox"><input type="checkbox" checked={value.shared}
        onChange={event => change({ ...value, shared: event.target.checked })} />Use the same venue for all dates</label>}
      {value.shared || value.count === 1 ? <VenueFields label="Venue" value={value.venue} change={venue => change({ ...value, venue })} />
        : dates.map(date => <VenueFields key={date} label={"Venue for " + date} value={value.locations[date] ?? pendingVenue}
          change={venue => change({ ...value, locations: { ...value.locations, [date]: venue } })} />)}
    </>}
  </details>;
}
