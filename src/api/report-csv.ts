import type { ProjectPage, ProjectReport, StaffProjectSummary } from "../projects/model";
import type { SecuredApiClient } from "./client";
import { projectStatus, today } from "./dashboard-format";
import { projectMeasures } from "./client-delivery";
import { sourceExportPageSize, sourceStatus, type SourceHours, type SourceHoursGroup, type SourceSummary, type StaffSource } from "./types";

type CsvCell = string | number | null | undefined;
export type CsvData = { headers: readonly string[]; rows: readonly (readonly CsvCell[])[] };

export const csvHours = (seconds?: number) => seconds === undefined ? undefined : seconds / 3600;
export function csvFilename(label: string) {
  const safe = label.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return (safe.slice(0, 160).replace(/^_+|_+$/g, "") || "Morris_Report") + ".csv";
}

function cell(value: CsvCell): string {
  if (value == null) return '""';
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw Error("The report contains an invalid numeric value.");
    return String(value);
  }
  // Excel can interpret a formula after leading whitespace or control characters.
  const safe = /^[\s\p{C}]*[=+\-@]|^[\t\r\n]/u.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function csvText(data: CsvData): string {
  if (data.rows.some(row => row.length !== data.headers.length)) throw Error("The report columns do not match.");
  return "\uFEFF" + [data.headers, ...data.rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

type PageLoader = (url: string, signal: AbortSignal) => Promise<ProjectPage>;
type ReportResource = "sources" | "projects";

export async function allAuthorizedRows<R extends ReportResource>(
  resource: R, parameters: URLSearchParams, signal: AbortSignal, request: PageLoader,
): Promise<NonNullable<ProjectPage[R]>> {
  const query = new URLSearchParams(parameters);
  query.set("limit", String(resource === "sources" ? sourceExportPageSize : 25));
  if (resource === "sources") query.set("download", "csv");
  query.delete("cursor");
  const rows: (StaffSource | StaffProjectSummary)[] = [];
  const seenRows = new Set<string>();
  const cursors = new Set<string>();
  let revision: number | undefined;
  let expected: number | undefined;
  do {
    signal.throwIfAborted();
    const page = await request(resource + "?" + query, signal);
    signal.throwIfAborted();
    if (revision !== undefined && revision !== page.revision ||
      expected !== undefined && page.sourceSummary?.matched !== expected)
      throw Error("The report changed. Refresh the view and export again.");
    revision = page.revision;
    if (resource === "sources") {
      expected = page.sourceSummary?.matched;
      if (expected === undefined) throw Error("The server did not provide a record count.");
    }
    const batch = page[resource];
    if (!batch) throw Error("The server did not provide the report rows.");
    for (const row of batch) {
      if (seenRows.has(row.id)) throw Error("The server repeated a report record.");
      seenRows.add(row.id);
      rows.push(row);
    }
    if (!page.nextCursor) break;
    if (cursors.has(page.nextCursor)) throw Error("The report cursor did not advance.");
    cursors.add(page.nextCursor);
    query.set("cursor", page.nextCursor);
  } while (true);
  if (expected !== undefined && rows.length !== expected)
    throw Error("The export was incomplete. Refresh the view and try again.");
  return rows as NonNullable<ProjectPage[R]>;
}

export const authorizedPages = (client: SecuredApiClient, tenant: string): PageLoader =>
  (url, signal) => client.call<ProjectPage>(tenant, url, { signal });

const effortHeaders = ["Recorded hours", "Work-order attributed hours", "Classified hours", "Remaining at parent hours",
  "Allocated hours", "Unallocated hours"];
const effortCells = (row: SourceHours) => [csvHours(row.recordedSeconds), csvHours(row.attributedSeconds),
  csvHours(row.classifiedSeconds), csvHours(row.remainingAtParentSeconds), csvHours(row.allocatedSeconds),
  csvHours(row.unallocatedSeconds)];

export function hoursBreakdown(label: string, groups: SourceHoursGroup[]): CsvData {
  return { headers: [label, ...effortHeaders], rows: groups.map(group => [group.label, ...effortCells(group)]) };
}

export function overviewCsv(summary: SourceSummary): CsvData {
  return {
    headers: ["Dataset", "Name", "Start date", "End date", ...effortHeaders],
    rows: [
      ["Total", "All matching time", summary.period.start, summary.period.end, ...effortCells(summary.hours)],
      ...[["Period", summary.hours.byPeriod], ["Work order", summary.hours.byWorkOrder],
        ["Consultant", summary.hours.byConsultant], ["Morris profile", summary.hours.byMorrisProfile ?? []]]
        .flatMap(([label, groups]) => (groups as SourceHoursGroup[]).map(group =>
          [label as string, group.label, summary.period.start, summary.period.end, ...effortCells(group)])),
    ],
  };
}

export function sourceCsv(rows: StaffSource[]): CsvData {
  return {
    headers: ["Work date", "QuickBooks Time Work Order", "Work order ID", "Entry ID", "Consultant", "Provider user ID", "Recorded hours",
      "Not yet allocated hours", "Status", "Provider approval", "Reporting description", "Original QuickBooks Time Description",
      "Staff-only automatic classification hours", "Mapped Delivery Project ID"],
    rows: rows.map(row => [row.date, row.workOrderName ?? row.sourceWorkOrderId, row.sourceWorkOrderId, row.id,
      row.consultantName, row.sourcePersonId, csvHours(row.deleted ? undefined : row.seconds), csvHours(row.unallocatedSeconds),
      row.automaticClassification ? "automatically classified" : sourceStatus(row), row.approval,
      row.annotations?.reportingDescription ?? row.automaticClassification?.reportingDescription,
      row.originalNotesState === "populated" ? row.description : undefined, csvHours(row.automaticClassification?.seconds),
      row.automaticClassification?.projectId]),
  };
}

type ClientProject = ProjectReport["projects"][number];
export function publishedProjectCsv(report: ProjectReport, projects: ClientProject[]): CsvData {
  const published = new Map(report.projects.map(project => [project.id, project]));
  const placements = new Map(report.portfolio?.placements.map(item => [item.id, item]));
  const areas = new Map(report.portfolio?.areas.map(item => [item.id, item.name]));
  const asOf = today();
  return {
    headers: ["Month", "Project", "Parent Project", "Department", "Delivery status", "Progress percent",
      "Reported hours", "Lifetime reported hours", "Monthly cap hours", "Monthly used hours", "Lifetime cap hours", "Lifetime used hours",
      "Start date", "Deadline"],
    rows: projects.flatMap(item => {
      const project = published.get(item.id);
      if (!project) return [];
      const hierarchy = report.hierarchy?.[project.id];
      const placement = placements.get(project.id);
      const lifecycle = hierarchy?.schedulePhase ? projectMeasures(project, hierarchy, placement, asOf) : undefined;
      const status = placement?.archived ? "Archived" : lifecycle?.upcoming ? "Upcoming" : projectStatus[lifecycle?.active ? "active" : project.status];
      return [[report.month, project.name, published.get(hierarchy?.parentId ?? "")?.name, areas.get(placement?.areaId ?? ""),
        status, hierarchy?.completion ?? project.progress,
        csvHours(project.seconds), csvHours(project.lifetimeSeconds),
        csvHours(hierarchy?.monthlyCap), csvHours(hierarchy?.monthlyCapUsed),
        csvHours(hierarchy?.lifetimeCap), csvHours(hierarchy?.lifetimeCapUsed), hierarchy?.start, hierarchy?.deadline]];
    }),
  };
}

export function staffProjectCsv(month: string, projects: StaffProjectSummary[]): CsvData {
  return {
    headers: ["Month", "Project", "Work order", "Delivery status", "Publication", "Progress percent", "Work-order recorded hours",
      "Reported hours", "Lifetime reported hours", "Monthly cap hours", "Lifetime cap hours", "Start date", "Deadline", "Automatically classified hours awaiting approval"],
    rows: projects.map(item => [month, item.name, item.workOrderReference, projectStatus[item.status], item.published ? "Published" : "Private",
      item.progress, csvHours(item.workOrderEffort?.recordedSeconds), csvHours(item.seconds), csvHours(item.lifetimeSeconds),
      csvHours(item.delivery?.monthlyCap), csvHours(item.delivery?.lifetimeCap), item.delivery?.start, item.delivery?.deadline,
      csvHours(item.pendingMappedEffort?.monthly)]),
  };
}

export function milestoneCsv(projects: readonly (ClientProject | StaffProjectSummary)[], staff = false, milestoneId?: string): CsvData {
  return {
    headers: ["Project", "Milestone", "Due date", "Completed date", "Milestone status"],
    rows: projects.flatMap(project => (staff && "deliveryMilestones" in project ? project.deliveryMilestones : project.milestones)
      ?.filter(item => !milestoneId || milestoneId === item.id)
      .map(item => [project.name, item.title, item.date, item.completedAt, item.status ?? (item.completed ? "completed" : "not started")]) ?? []),
  };
}
