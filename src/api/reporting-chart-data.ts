import type { ProjectReport } from "../projects/model";
import { reportMonth } from "./dashboard-format";

export type ChartKind = "distribution" | "trend" | "plan";
export const chartKinds: ChartKind[] = ["trend", "distribution", "plan"];
export type Row = { id: string; label: string; seconds: number; projectIds: string[]; destination?: string; month?: string };
export type MonthRange = { from?: string; through?: string };
export type PlotUnit = "hours" | "percent" | "projects";

export function axisMaximum(value: number, unit: PlotUnit = "hours") {
  if (unit === "projects") return Math.max(2, Math.ceil(value / 2) * 2);
  const minimum = unit === "hours" ? 3600 : 100;
  if (value <= minimum) return minimum;
  const normalized = unit === "hours" ? value / 3600 : value;
  const magnitude = 10 ** Math.floor(Math.log10(normalized));
  const multiple = [1, 2, 2.5, 5, 10].find(step => step * magnitude >= normalized) ?? 10;
  return multiple * magnitude * (unit === "hours" ? 3600 : 1);
}

export function chartRows(report: ProjectReport, kind: ChartKind, monthRange?: MonthRange): Row[] {
  const projects = report.projects;
  if (kind === "trend") {
    const history = new Map((report.portfolio?.history ?? []).map(row => [row.month, row.seconds]));
    if (projects.length) history.set(report.month, report.totalSeconds);
    return [...history].filter(([month]) => (!monthRange?.from || month >= monthRange.from) &&
      (!monthRange?.through || month <= monthRange.through)).sort(([a], [b]) => a.localeCompare(b))
      .map(([month, seconds]) => ({ id: month, label: reportMonth(month), seconds, projectIds: [], month, destination: "projects" }));
  }
  if (!projects.length) return [];
  if (kind === "plan") {
    const planned = projects.filter(project => project.plan.basis === "monthly" && project.plan.targetSeconds > 0);
    if (!planned.length) return [];
    const projectIds = planned.map(project => project.id);
    return [
      { id: "allocated", label: "Reported effort", seconds: planned.reduce((n, p) => n + p.seconds, 0), projectIds },
      { id: "target", label: "Monthly target", seconds: planned.reduce((n, p) => n + p.plan.targetSeconds, 0), projectIds },
    ];
  }

  const placements = new Map(report.portfolio?.placements.map(item => [item.id, item.areaId]));
  const areaLabels = new Map(report.portfolio?.areas.map(area => [area.id, area.name]));
  const groups = new Map<string, Row>();
  const add = (id: string, label: string, seconds: number, projectId: string, destination?: string) => {
    if (seconds === 0) return;
    const row = groups.get(id) ?? { id, label, seconds: 0, projectIds: [], destination };
    row.seconds += seconds;
    row.projectIds.push(projectId);
    groups.set(id, row);
  };
  for (const project of projects) {
    const area = placements.get(project.id);
    const label = area ? areaLabels.get(area) : undefined;
    add(area && label ? area : "unassigned", label ?? "No department",
      project.seconds, project.id, label ? "area:" + area : undefined);
  }
  return [...groups.values()].sort((a, b) => b.seconds - a.seconds || a.label.localeCompare(b.label));
}

export function comparableYears(month: string, rows: Row[]) {
  const year = Number(month.slice(0, 4));
  const latestMonth = Number(month.slice(5, 7));
  const byMonth = new Map(rows.map(row => [row.month, row]));
  return Array.from({ length: latestMonth }, (_, index) => {
    const suffix = String(index + 1).padStart(2, "0");
    return { month: reportMonth(year + "-" + suffix).split(" ")[0],
      prior: byMonth.get((year - 1) + "-" + suffix), current: byMonth.get(year + "-" + suffix) };
  });
}
