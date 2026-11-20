import { calendarDate } from "./delivery";

export const timePeriods = ["month", "quarter", "year", "range", "all"] as const;
export type TimePeriod = typeof timePeriods[number];
export const timeSortOrders = ["oldest", "newest"] as const;
export type TimeSortOrder = typeof timeSortOrders[number];
export type TimeGrouping = "month" | "quarter" | "year";
export type TimeWindow = { kind: TimePeriod; start?: string; end?: string };

function endOfMonth(month: string) {
  const date = new Date(month + "-15T12:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

export function timeWindow(month: string, kind: TimePeriod = "month", start?: string, end?: string): TimeWindow {
  if (!calendarDate(month + "-01") || !timePeriods.includes(kind)) throw Error("Invalid source period");
  if (kind === "range") {
    if (!start || !end || !calendarDate(start) || !calendarDate(end) || start > end) throw Error("Invalid source period");
    return { kind, start, end };
  }
  if (start || end) throw Error("Invalid source period");
  if (kind === "all") return { kind };
  if (kind === "month") return { kind, start: month + "-01", end: endOfMonth(month) };
  const [year, value] = month.split("-");
  if (kind === "year") return { kind, start: year + "-01-01", end: year + "-12-31" };
  const first = Math.floor((Number(value) - 1) / 3) * 3 + 1;
  return { kind, start: year + "-" + String(first).padStart(2, "0") + "-01",
    end: endOfMonth(year + "-" + String(first + 2).padStart(2, "0")) };
}

export function reportingTimeMonth(now: Date = new Date()) {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Regina", year: "numeric", month: "2-digit" })
    .formatToParts(now);
  return local.find(part => part.type === "year")!.value + "-" + local.find(part => part.type === "month")!.value;
}

export function precedingTimeMonth(month: string) {
  const base = new Date(month + "-15T12:00:00Z");
  base.setUTCMonth(base.getUTCMonth() - 1);
  return base.toISOString().slice(0, 7);
}

export function timeBucket(date: string, grouping: TimeGrouping) {
  const [year, month] = date.split("-");
  if (grouping === "year") return { id: year, label: year };
  if (grouping === "quarter") {
    const quarter = Math.floor((Number(month) - 1) / 3) + 1;
    return { id: year + "-" + quarter, label: year + " Q" + quarter };
  }
  return { id: year + "-" + month, label: year + "-" + month };
}
