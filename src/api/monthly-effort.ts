import type { ProjectReport } from "../projects/model";
import { precedingTimeMonth } from "../projects/time-history";
import { metricPercent } from "./insight-metrics";
import { followingTimeMonth } from "./reporting-period";

const windowMonths = 24;

type EffortReport = Pick<ProjectReport, "month" | "totalSeconds" | "portfolio" | "historyByProject" | "projects">;

function windowStart(end: string) {
  let month = end;
  for (let offset = 1; offset < windowMonths; offset++) month = precedingTimeMonth(month);
  return month;
}

export function monthlyEffort(report: EffortReport, projectIds?: readonly string[]) {
  const filtered = projectIds !== undefined;
  const totals = new Map((report.portfolio?.history ?? []).map(entry => [entry.month, entry.seconds]));
  totals.set(report.month, report.totalSeconds);
  const publishedMonths = [...totals.keys()].sort();
  const latest = publishedMonths.at(-1)!;
  // Keep the latest history visible when the reporting month is in the window.
  const through = report.month < windowStart(latest) ? report.month : latest;
  const from = publishedMonths.find(month => month >= windowStart(through))!;
  const selectedProjects = filtered ? new Set(projectIds) : undefined;
  const scoped = new Map<string, number>();
  if (selectedProjects) {
    for (const project of report.projects) {
      if (!selectedProjects.has(project.id)) continue;
      for (const entry of report.historyByProject?.[project.id] ?? [])
        scoped.set(entry.month, (scoped.get(entry.month) ?? 0) + entry.seconds);
    }
    scoped.set(report.month, report.projects.reduce((sum, project) =>
      sum + (selectedProjects.has(project.id) ? project.seconds : 0), 0));
  }
  let periodSeconds = 0;
  for (const month of publishedMonths) {
    if (month >= from && month <= through) periodSeconds += totals.get(month)!;
  }
  const label = filtered ? "Share of monthly portfolio effort" : "Share of selected-period effort";
  const rows = [];
  for (let month = from; month <= through; month = followingTimeMonth(month)) {
    const portfolioSeconds = totals.get(month);
    // The current server returns sparse positive project buckets for every reported month.
    // An older response without the breakdown cannot establish a filtered historical total.
    const seconds = filtered ? scoped.get(month) ??
      (portfolioSeconds === 0 || (portfolioSeconds !== undefined && report.historyByProject !== undefined) ? 0 : undefined)
      : portfolioSeconds;
    const denominator = filtered ? portfolioSeconds : Number.isSafeInteger(periodSeconds) ? periodSeconds : undefined;
    rows.push({ month, seconds, denominator,
      share: seconds === undefined || denominator === undefined ? undefined : metricPercent(seconds, denominator) });
    if (month === through) break;
  }
  return { label, from, through, rows };
}
