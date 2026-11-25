import { forProjectFilter, type clientDelivery } from "./client-delivery";
import { compareValues } from "../projects/sort";

type Row = ReturnType<typeof clientDelivery>["projects"][number];
export const explorerPageSizes = [10, 20, 50] as const;
export const explorerSorts = {
  name: "Name", status: "Delivery status", completion: "Work completion",
  deadline: "Expected completion", hours: "Approved effort", start: "Start date",
};
export const completionBands = [
  ["low", "0–25%"], ["quarter", "26–50%"], ["half", "51–75%"],
  ["near", "76–99%"], ["complete", "100%"], ["unassessed", "Not assessed"],
] as const;
export const milestoneStates = [["completed", "Completed"], ["working", "In progress"], ["overdue", "Overdue"], ["blocked", "Blocked"]] as const;
export type ExplorerScope = { department?: string; parent?: string; completion?: string; completedMonth?: string; milestone?: string };
export const explorerScopeFields = ["explorer-department", "explorer-parent", "explorer-completion", "explorer-completed-month", "explorer-milestone"] as const;

const searchable = (input: string) => input.trim().normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-CA");

export function explorerStatus(row: Row) {
  return row.active ? "active" : row.completed ? "completed" : row.upcoming ? "upcoming" : "other";
}

export function completionBand(value?: number) {
  if (value === undefined) return "unassessed";
  if (value === 100) return "complete";
  if (value > 75) return "near";
  if (value > 50) return "half";
  if (value > 25) return "quarter";
  return "low";
}

export function milestoneState(item: NonNullable<Row["project"]["milestones"]>[number], today: string) {
  if (item.status === "waived") return;
  if (item.completed) return "completed";
  if (item.status === "blocked" && !item.blocker?.resolvedOn) return "blocked";
  if (item.date && item.date < today) return "overdue";
  if (item.status === "in-progress") return "working";
}

export function explorerResults(projects: readonly Row[], params: URLSearchParams, today: string) {
  const query = searchable(params.get("q") ?? "").slice(0, 120);
  const status = params.get("status") ?? "all";
  const [department, parent, band, completedMonth, milestone] = explorerScopeFields.map(field => params.get(field));
  const deadline = params.get("explorer-deadline");
  const sort = params.get("project-sort");
  const matches = projects.filter(row => {
    if (department && department !== row.department?.id || parent && parent !== row.parent?.id) return false;
    if (!searchable([row.project.name, row.department?.name, row.parent?.name].filter(Boolean).join(" ")).includes(query)) return false;
    if (status === "unaffiliated" ? row.parent : !forProjectFilter(row, status, row.project.seconds)) return false;
    if (band && completionBand(row.completion) !== band) return false;
    if (completedMonth && (!(row.completed || row.project.status === "closed") || !row.delivery?.completedOn?.startsWith(completedMonth + "-") || row.delivery.completedOn > today)) return false;
    if (milestone && !row.project.milestones?.some(item => milestoneState(item, today) === milestone)) return false;
    if (deadline === "overdue") return Boolean(row.deadline && row.deadline < today && row.overdue);
    if (deadline === "soon") return row.dueSoon;
    if (deadline === "unscheduled") return !row.deadline;
    return true;
  }).sort((a, b) => {
    const stable = a.project.name.localeCompare(b.project.name, "en-CA", { numeric: true }) || a.project.id.localeCompare(b.project.id);
    const direction = params.get("project-direction") === "desc" ? "desc" : params.get("project-direction") === "asc" ? "asc" :
      sort === "completion" || sort === "hours" ? "desc" : "asc";
    const value = (row: Row) => sort === "status" ? explorerStatus(row) : sort === "start" || sort === "deadline" ? row[sort] :
      sort === "completion" ? row.completion : sort === "hours" ? row.project.seconds : row.project.name;
    return compareValues(value(a), value(b), direction) || stable;
  });
  const size = explorerPageSizes.find(value => value === Number(params.get("explorer-size"))) ?? 20;
  const requested = Number(params.get("explorer-page"));
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const page = Number.isSafeInteger(requested) ? Math.max(1, Math.min(requested, pages)) : 1;
  const offset = (page - 1) * size;
  return { matches, size, pages, page, offset, visible: matches.slice(offset, offset + size) };
}
