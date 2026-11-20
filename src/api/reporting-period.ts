import { precedingTimeMonth } from "../projects/time-history";
import { validMonth } from "./portal-location";

type RangePreset = "year" | "last-year" | "all" | "custom";
export type ReportingMonthRange = { preset: RangePreset; from?: string; through?: string };

export function followingTimeMonth(month: string) {
  const [year, period] = month.split("-").map(Number);
  return period === 12 ? String(year + 1).padStart(4, "0") + "-01" :
    year + "-" + String(period + 1).padStart(2, "0");
}

export function historyRange(preset: RangePreset, currentMonth: string): ReportingMonthRange {
  if (preset === "year") return { preset, from: currentMonth.slice(0, 4) + "-01", through: currentMonth };
  if (preset === "last-year") {
    const year = Number(currentMonth.slice(0, 4)) - 1;
    return { preset, from: year + "-01", through: year + "-12" };
  }
  return { preset };
}

export function readReportingRange(params: URLSearchParams, currentMonth: string): ReportingMonthRange | undefined {
  const scope = params.get("period-scope");
  if (scope === "year" || scope === "last-year" || scope === "all") return historyRange(scope, currentMonth);
  if (scope !== "custom") return undefined;
  const from = params.get("from-month");
  const through = params.get("through-month");
  return validMonth(from) && validMonth(through) && from <= through && through <= currentMonth
    ? { preset: scope, from, through } : undefined;
}

export function reportingMonthOptions(month: string, currentMonth: string, availableMonths: readonly string[]) {
  return [...new Set([month, currentMonth, precedingTimeMonth(currentMonth),
    ...availableMonths.filter(candidate => validMonth(candidate) && candidate <= currentMonth)])].sort();
}
