const dayMs = 86_400_000;
export const venueKinds = ["physical", "virtual", "hybrid", "to-be-determined", "not-applicable"] as const;
export type Venue = { kind: typeof venueKinds[number]; details?: string };
export type ActivitySchedule = {
  mode: "single" | "consecutive" | "separate";
  dates: string[];
  sharedVenue?: Venue;
  venues?: { date: string; venue: Venue }[];
};

export function dateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function consecutiveDates(start: string, end: string): string[] {
  if (!dateOnly(start) || !dateOnly(end)) return [];
  const first = Date.parse(start);
  const count = (Date.parse(end) - first) / dayMs + 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > 60) return [];
  return Array.from({ length: count }, (_, index) => new Date(first + index * dayMs).toISOString().slice(0, 10));
}

export function parseActivitySchedule(value: unknown): ActivitySchedule {
  const invalid = (): never => { throw Error("Invalid delivery activity schedule"); };
  function record(input: unknown, keys: readonly string[]) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !keys.includes(key))) return invalid();
    return input as Record<string, unknown>;
  }
  function parseVenue(input: unknown): Venue {
    const item = record(input, ["kind", "details"]);
    const kind = venueKinds.find(candidate => candidate === item.kind);
    if (!kind || (item.details !== undefined && (typeof item.details !== "string" || item.details.length > 500 ||
      kind === "to-be-determined" || kind === "not-applicable"))) return invalid();
    const details = typeof item.details === "string" ? item.details.trim() : "";
    return { kind, ...(details && { details }) };
  }
  const schedule = record(value, ["mode", "dates", "sharedVenue", "venues"]);
  const mode = schedule.mode;
  if (mode !== "single" && mode !== "consecutive" && mode !== "separate") return invalid();
  if (!Array.isArray(schedule.dates) || schedule.dates.length < 1 || schedule.dates.length > 60 ||
    !schedule.dates.every(dateOnly) || new Set(schedule.dates).size !== schedule.dates.length) return invalid();
  const dates = [...schedule.dates].sort();
  if (mode === "single" && dates.length !== 1 || mode !== "single" && dates.length < 2 ||
    mode === "consecutive" && consecutiveDates(dates[0], dates.at(-1)!).length !== dates.length) return invalid();
  if (schedule.venues !== undefined) {
    if (schedule.sharedVenue !== undefined || !Array.isArray(schedule.venues) || schedule.venues.length !== dates.length) return invalid();
    const venues = schedule.venues.map(input => {
      const { date, venue } = record(input, ["date", "venue"]);
      if (!dateOnly(date) || !dates.includes(date)) return invalid();
      return { date, venue: parseVenue(venue) };
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (new Set(venues.map(item => item.date)).size !== dates.length) return invalid();
    return { mode, dates, venues };
  }
  return { mode, dates, ...(schedule.sharedVenue !== undefined && { sharedVenue: parseVenue(schedule.sharedVenue) }) };
}
