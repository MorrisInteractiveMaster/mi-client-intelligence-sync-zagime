import { isZagimeClient, ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ProjectPage, StaffProjectSummary } from "../projects/model";
import type { Portfolio } from "../projects/portfolio";
import type { Allocation } from "../reporting/model";
import { calendarDate, canAllocateToDelivery } from "../projects/delivery";
import { precedingTimeMonth, reportingTimeMonth, timeEntrySortFields, timeSortOrders, type TimeEntrySortField, type TimeGrouping, type TimePeriod } from "../projects/time-history";
import { SortHeader, type SortState } from "./SortHeader";
import { ApiError, type SecuredApiClient } from "./client";
import { reportDay, reportHours, reportMonth, reportTimestamp } from "./dashboard-format";
import { canSelectTimeForBulk, sourceMappingLabels, sourceStatus, type AllocationAnnotations, type HistoryRow, type SourceFilters, type SourceSummary, type StaffSource } from "./types";
import { BulkAllocationResults } from "./BulkAllocationResults";
import { TimeHistorySummary } from "./TimeHistorySummary";
import { CsvExport } from "./CsvExport";
import { allAuthorizedRows, authorizedPages, sourceCsv } from "./report-csv";
import { PlatformLink } from "./PlatformHome";
import { WorkspaceToolbarControls } from "./WorkspaceToolbar";
import { TimeConsultantFilter } from "./TimeConsultantFilter";
import { SearchableCombobox } from "./SearchableCombobox";
import { MAX_BULK_ALLOCATION_ENTRIES, type BulkAllocationRequest, type BulkAllocationResponse } from "../projects/bulk-allocation";
import "./time-allocation.css";

const blank: AllocationAnnotations = { reportingDescription: "", internalNote: "" };
const sourceStatusLabels = { allocated: "Classified", partial: "Partially classified", unallocated: "Not assigned to a delivery project", review: "Needs review", deleted: "Deleted" };
const entryLabels: Record<TimeEntrySortField, string> = {
  date: "Date", consultant: "Consultant", notes: "Original description", workOrder: "Work order",
  recorded: "Recorded", reporting: "Reporting", assignment: "Assignment", status: "Status",
};
type AppliedFilters = SourceFilters & { search?: string };
type BulkBatch = { key: string; body: BulkAllocationRequest; labels: Record<string, string>; seconds?: Record<string, number>;
  outcomes?: BulkAllocationResponse["outcomes"] };
function recoverBulk(key?: string): BulkBatch | undefined {
  if (!key) return;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const value = JSON.parse(raw) as BulkBatch;
    const started = Number(value.key.split("-")[0]);
    if (!Number.isSafeInteger(started) || Date.now() - started >= 86_400_000 || !value.body.entries.length) {
      sessionStorage.removeItem(key);
      return;
    }
    return { ...value, labels: {} };
  } catch { return; }
}
const timePresets = {
  all: "All History", current: "This Month", previous: "Previous Month", year: "This Year",
  priorYear: "Last Year", specific: "Specific month", quarter: "Specific quarter", range: "Custom Date Range",
} as const;
type TimePreset = keyof typeof timePresets;
type SavedScope = { preset: TimePreset; reference: string; start: string; end: string; order: "oldest" | "newest"; group: TimeGrouping };

function validSavedScope(value: unknown): value is SavedScope {
  if (!value || typeof value !== "object") return false;
  const { preset, reference, start, end, order, group } = value as Partial<SavedScope>;
  if (typeof preset !== "string" || !Object.hasOwn(timePresets, preset) || typeof reference !== "string" ||
      (reference !== "" && !calendarDate(reference + "-01")) ||
      typeof start !== "string" || typeof end !== "string" || !order || !timeSortOrders.includes(order) ||
      !group || !["month", "quarter", "year"].includes(group)) return false;
  if (preset === "specific" || preset === "quarter") return calendarDate(reference + "-01");
  if (preset === "range") return calendarDate(start) && calendarDate(end) && start <= end;
  return true;
}

type Props = {
  client: SecuredApiClient; tenant: string; month: string; projects: StaffProjectSummary[]; portfolio?: Portfolio;
  onDenied: () => void; onSaved: () => void;
  sourceLink?: { id?: string; href(id: string): string; backHref: string; createHref?(id: string, parent: string, department: string): string };
  onUnsavedChange?: (dirty: boolean) => void;
  canPublish?: boolean;
  operatorKey?: string;
  initialConsultant?: string;
  initialWorkOrder?: string;
  initialPeriod?: string | null;
  initialStart?: string | null;
  initialEnd?: string | null;
  initialStatus?: string | null;
};
export function TimeAllocation(props: Props) {
  return <MonthAllocation key={JSON.stringify([props.tenant, props.month, props.sourceLink?.id, props.initialConsultant, props.initialWorkOrder, props.initialPeriod, props.initialStart, props.initialEnd, props.initialStatus])} {...props} />;
}

function MonthAllocation({ client, tenant, month, projects, portfolio, onDenied, onSaved, sourceLink, onUnsavedChange, initialConsultant, initialWorkOrder, initialPeriod, initialStart, initialEnd, initialStatus, canPublish, operatorKey }: Props) {
  const journalKey = operatorKey ? "morris-time-pending-" + operatorKey : undefined;
  const linkedConsultant = initialConsultant && /^[A-Za-z0-9_-]{1,128}$/.test(initialConsultant) ? initialConsultant : "";
  const linkedWorkOrder = initialWorkOrder && /^[A-Za-z0-9_-]{1,128}$/.test(initialWorkOrder) ? initialWorkOrder : "";
  const linkedStart = initialPeriod === "range" && calendarDate(initialStart) && calendarDate(initialEnd) && initialStart <= initialEnd ? initialStart : undefined;
  const linkedEnd = linkedStart && calendarDate(initialEnd) ? initialEnd : undefined;
  const linkedPeriod = linkedStart ? "range" : initialPeriod === "all" || (initialPeriod !== "month" && linkedConsultant) ? "all" : undefined;
  const linkedStatus = initialStatus === "review" ? "review" : undefined;
  const periodSelectId = useId();
  const [rows, setRows] = useState<StaffSource[]>();
  const [lastPage, setLastPage] = useState<StaffSource[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState<SourceSummary>();
  const [applied, setApplied] = useState<AppliedFilters>({});
  const [appliedMonth, setAppliedMonth] = useState(month);
  const [preset, setPreset] = useState<TimePreset>(linkedPeriod ?? "specific");
  const [reference, setReference] = useState(month);
  const [start, setStart] = useState(linkedStart ?? "");
  const [end, setEnd] = useState(linkedEnd ?? "");
  const [order, setOrder] = useState<SavedScope["order"]>("oldest");
  const [group, setGroup] = useState<TimeGrouping>("month");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SourceFilters["status"]>(linkedStatus);
  const [workOrder, setWorkOrder] = useState(linkedWorkOrder);
  const [area, setArea] = useState("");
  const routeFilters = new URLSearchParams(window.location.search);
  const initialParent = routeFilters.get("time-parent");
  const initialMapping = routeFilters.get("time-mapping");
  const [parentFilter, setParentFilter] = useState(initialParent && /^[a-zA-Z0-9_-]{1,128}$/.test(initialParent) ? initialParent : "");
  const [mappingFilter, setMappingFilter] = useState<SourceFilters["mapping"]>(
    initialMapping && Object.hasOwn(sourceMappingLabels, initialMapping) ? initialMapping as SourceFilters["mapping"] : undefined);
  const [projectFilter, setProjectFilter] = useState("");
  const [provenance, setProvenance] = useState<SourceFilters["provenance"]>();
  const [from, setFrom] = useState("");
  const [through, setThrough] = useState("");
  const [selected, setSelected] = useState<StaffSource[]>([]);
  const [bulkProject, setBulkProject] = useState("");
  const [bulkDepartment, setBulkDepartment] = useState("");
  const [approveAutomatic, setApproveAutomatic] = useState(false);
  const [bulkProcessed, setBulkProcessed] = useState(0);
  const [batch, setBatch] = useState<BulkBatch | undefined>(() => recoverBulk(journalKey));
  const [bulkResult, setBulkResult] = useState<BulkAllocationResponse | undefined>(() => batch?.outcomes ? { outcomes: batch.outcomes } : undefined);
  const [unconfirmed, setUnconfirmed] = useState<BulkAllocationRequest | undefined>(() => batch?.body);
  const bulkInFlight = useRef(false);
  const [editor, setEditor] = useState<StaffSource>();
  const [portions, setPortions] = useState<Allocation[]>([]);
  const [annotations, setAnnotations] = useState<AllocationAnnotations>(blank);
  const [advancedSplit, setAdvancedSplit] = useState(false);
  const [inspectDescription, setInspectDescription] = useState<StaffSource>();
  const descriptionDialog = useRef<HTMLDialogElement>(null);
  const bulkReview = useRef<HTMLDialogElement>(null);
  const headerCheckbox = useRef<HTMLInputElement>(null);
  const [parent, setParent] = useState("");
  const [classification, setClassification] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>();
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [undo, setUndo] = useState<{ source: StaffSource; revision: number }>();
  const editButton = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const idIndex = new Map(projects.map(project => [project.id, project]));
  const placements = new Map(portfolio?.placements.map(placement => [placement.id, placement]));
  const resolvedArea = (id: string) => idIndex.get(id)?.delivery?.areaId ?? placements.get(id)?.areaId ?? "";
  const resolvedParent = (id: string) => {
    const parentId = idIndex.get(id)?.delivery?.parentId ?? "";
    const container = idIndex.get(parentId)?.delivery;
    return container?.kind === "service-area" ? container.parentId ?? "" : parentId;
  };
  const areaLabel = (id: string) => portfolio?.areas.find(item => item.id === id)?.name ?? "Unclassified";
  const projectName = (id: string) => idIndex.get(id)?.name ?? "Assigned project";
  const failed = (e: unknown) => {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) onDenied();
    setError(e instanceof Error ? e.message : "The request could not be completed.");
  };
  const linkedId = sourceLink?.id;
  function clearSelection() {
    setSelected([]);
    setApproveAutomatic(false);
    setBulkProject("");
    setBulkDepartment("");
  }
  async function load(next?: string, filters = applied, anchor = appliedMonth, openLinked = false, keepSelection = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    if (!next && !keepSelection) clearSelection();
    try {
      const requestFilters = linkedId ? { period: "all" as const, entry: linkedId } : filters;
      const query = new URLSearchParams({ month: anchor, limit: "25", ...(next ? { cursor: next } : {}) });
      for (const [name, value] of Object.entries(requestFilters)) if (value) query.set(name, value);
      const page = await client.call<ProjectPage>(tenant, "sources?" + query, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!page.sourceSummary) throw Error("The server did not provide time counts.");
      setRevision(page.revision);
      setRows(old => next ? [...(old ?? []), ...(page.sources ?? [])] : page.sources ?? []);
      setLastPage(page.sources ?? []);
      setSummary(page.sourceSummary);
      setApplied(requestFilters);
      setAppliedMonth(anchor);
      setCursor(page.nextCursor);
      if (openLinked && page.sources?.[0]) edit(page.sources[0]);
    } catch (e) { if (!controller.signal.aborted) failed(e); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    mounted.current = true;
    setRows(undefined); setSummary(undefined); setCursor(undefined); setApplied({});
    setSearch(""); setStatus(linkedStatus); setWorkOrder(linkedWorkOrder); setArea(""); setProjectFilter("");
    setFrom(""); setThrough(""); setEditor(undefined); setSelected([]); setUndo(undefined); setNotice("");
    const initialFilters: AppliedFilters = linkedId ? { period: "all", entry: linkedId }
      : { period: linkedPeriod, start: linkedStart, end: linkedEnd, status: linkedStatus, consultant: linkedConsultant,
        workOrder: linkedWorkOrder, parent: parentFilter, mapping: mappingFilter };
    const params = new URLSearchParams(window.location.search);
    const linkedSort = timeEntrySortFields.find(field => field === params.get("entry-sort"));
    if (!linkedId && linkedSort) Object.assign(initialFilters, { sort: linkedSort, direction: params.get("entry-direction") === "desc" ? "desc" : "asc" });
    void load(undefined, initialFilters, month, Boolean(linkedId));
    return () => { mounted.current = false; request.current?.abort(); };
  }, [client, tenant, month, linkedId, linkedConsultant, linkedWorkOrder, linkedPeriod, linkedStart, linkedEnd, linkedStatus]);
  useEffect(() => {
    if (editor && drawer.current && !drawer.current.open) {
      drawer.current.showModal();
      heading.current?.focus();
    }
  }, [editor?.id]);
  const clientName = isZagimeClient(tenant) ? ZAGIME_CLIENT_DISPLAY_NAME : tenant;
  const draftAnnotations = { reportingDescription: annotations.reportingDescription, internalNote: annotations.internalNote,
    ...(parent ? { parentId: parent } : {}), ...(classification ? { areaId: classification } : {}) };
  const defaultParent = (source: StaffSource) => {
    if (source.reportingParentId) return source.reportingParentId;
    if (source.automaticClassification) return source.automaticClassification.parentId;
    const target = projects.find(project => project.id === (source.reportingProjectId ?? source.sourceProjectId));
    if (target?.delivery?.kind === "engagement") return target.id;
    return target?.delivery?.parentId ?? "";
  };
  const defaultDepartment = (source: StaffSource) =>
    source.automaticClassification?.areaId ?? projects.find(project => project.id === source.reportingProjectId)?.delivery?.areaId ?? "";
  const priorAnnotations = editor?.annotations ?? (editor ? { ...blank, reportingDescription: editor.description.slice(0, 1000) } : blank);
  const dirty = Boolean(editor && (JSON.stringify(portions) !== JSON.stringify(editor.portions) ||
    draftAnnotations.reportingDescription !== priorAnnotations.reportingDescription ||
    draftAnnotations.internalNote !== priorAnnotations.internalNote || parent !== (priorAnnotations.parentId ?? defaultParent(editor)) ||
    classification !== (priorAnnotations.areaId ?? defaultDepartment(editor))));
  const notesOnly = Boolean(editor && !editor.needsReview && JSON.stringify(portions) === JSON.stringify(editor.portions) &&
    parent === (priorAnnotations.parentId ?? defaultParent(editor)) && classification === (priorAnnotations.areaId ?? (editor ? defaultDepartment(editor) : "")));
  useEffect(() => { onUnsavedChange?.(dirty); return () => { onUnsavedChange?.(false); }; }, [dirty, onUnsavedChange]);
  function edit(source: StaffSource) {
    editButton.current = document.activeElement as HTMLElement;
    setEditor(source);
    setPortions(source.automaticClassification
      ? [{ projectId: source.automaticClassification.projectId, seconds: source.automaticClassification.seconds, description: "" }]
      : source.portions);
    setAnnotations(source.annotations ?? { ...blank, reportingDescription: source.description.slice(0, 1000) });
    setHistory(undefined);
    setHistoryCursor(undefined);
    setAdvancedSplit(source.portions.length > 1 || source.portions.some(part => part.seconds !== source.seconds));
    setParent(source.annotations?.parentId ?? defaultParent(source));
    setClassification(source.annotations?.areaId ?? defaultDepartment(source));
  }
  function close(force = false) {
    if (!force && dirty && !window.confirm("Discard unsaved allocation changes?")) return false;
    drawer.current?.close();
    setEditor(undefined);
    editButton.current?.focus();
    return true;
  }
  function changePeriod(chosen: SavedScope) {
    const current = reportingTimeMonth();
    let timePeriod: TimePeriod = "month";
    let anchor = chosen.reference || month;
    if (chosen.preset === "all") timePeriod = "all";
    if (chosen.preset === "current") anchor = current;
    if (chosen.preset === "previous") anchor = precedingTimeMonth(current);
    if (chosen.preset === "year" || chosen.preset === "priorYear") {
      timePeriod = "year";
      anchor = chosen.preset === "year" ? current : Number(current.slice(0, 4)) - 1 + "-01";
    }
    if (chosen.preset === "quarter") timePeriod = "quarter";
    if (chosen.preset === "range") timePeriod = "range";
    const { from: _, through: __, start: ___, end: ____, ...withoutDates } = applied;
    const filters = { ...withoutDates, period: timePeriod, order: chosen.order, group: chosen.group,
      ...(timePeriod === "range" ? { start: chosen.start, end: chosen.end } : {}) };
    setFrom(""); setThrough("");
    void load(undefined, filters, anchor);
  }
  const chosenScope = { preset, reference, start, end, order, group };
  const savedScopeKey = "morris-time-reporting-period-" + tenant;
  function saveScope() {
    setError(""); setNotice("");
    if (!validSavedScope(chosenScope)) { setError("Choose a valid reporting month or date range before saving."); return; }
    try {
      localStorage.setItem(savedScopeKey, JSON.stringify(chosenScope));
      setNotice("Reporting scope saved on this device.");
    } catch { setError("This browser could not save the reporting scope."); }
  }
  function restoreScope() {
    setError(""); setNotice("");
    try {
      const value: unknown = JSON.parse(localStorage.getItem(savedScopeKey) ?? "null");
      if (!value) { setNotice("No reporting scope has been saved on this device."); return; }
      if (!validSavedScope(value)) { setError("The saved reporting scope is unavailable. Select a new scope."); return; }
      setPreset(value.preset); setReference(value.reference); setStart(value.start); setEnd(value.end); setOrder(value.order); setGroup(value.group);
      changePeriod(value);
    } catch { setError("This browser could not open the saved reporting scope."); }
  }
  const periodLabel = summary?.period.kind === "all" ? "All history" : summary?.period.start
    ? summary.period.kind === "month" ? reportMonth(summary.period.start.slice(0, 7))
      : reportDay(summary.period.start) + " to " + reportDay(summary.period.end!)
    : reportMonth(month);
  const scope = [
    applied.search ? "Search: " + applied.search : "",
    applied.workOrder ? "Work order: " + (summary?.workOrders.find(item => item.id === applied.workOrder)?.label ?? applied.workOrder) : "",
    applied.consultant ? "Consultant: " + (applied.consultant === "unavailable" ? "Unavailable" : summary?.consultants.find(item => item.id === applied.consultant)?.label ?? applied.consultant) : "",

    applied.provenance ? "Classification: " + applied.provenance : "",
    applied.area ? "Department: " + areaLabel(applied.area) : "",
    applied.parent ? "Parent Project: " + projectName(applied.parent) : "",
    applied.mapping ? "Mapping: " + sourceMappingLabels[applied.mapping] : "",
    applied.project ? "Project: " + projectName(applied.project) : "",
    applied.from ? "From " + reportDay(applied.from) : "",
    applied.through ? "Through " + reportDay(applied.through) : "",
    applied.status ? (applied.status === "queue" ? "Has unallocated time" : sourceStatusLabels[applied.status]) : "",
  ].filter(Boolean);
  const remaining = editor ? editor.seconds - portions.reduce((sum, part) => sum + part.seconds, 0) : 0;
  const selectedRows = selected;
  const selectedIds = new Set(selected.map(row => row.id));
  const consultantIds = applied.consultants?.split(",") ?? (applied.consultant ? [applied.consultant] : []);
  const visibleEligible = (rows ?? []).filter(canSelectTimeForBulk);
  const visibleSelected = visibleEligible.filter(row => selectedIds.has(row.id)).length;
  const allVisibleSelected = visibleEligible.length > 0 && visibleSelected === visibleEligible.length;
  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = visibleSelected > 0 && !allVisibleSelected;
  }, [visibleSelected, allVisibleSelected]);
  useEffect(() => { if (inspectDescription) descriptionDialog.current?.showModal(); }, [inspectDescription]);
  function selectVisible(values: StaffSource[], checked: boolean) {
    const eligible = values.filter(canSelectTimeForBulk);
    const ids = new Set(eligible.map(row => row.id));
    setSelected(old => checked ? [...old, ...eligible.filter(row => !old.some(current => current.id === row.id))] :
      old.filter(row => !ids.has(row.id)));
  }
  function filterConsultants(ids: string[]) {
    if (ids.length > 20) { setError("Choose up to 20 verified source identities at once."); return; }
    setNotice("");
    void load(undefined, { ...applied, consultant: ids.length === 1 ? ids[0] : undefined,
      consultants: ids.length > 1 ? ids.join(",") : undefined });
  }
  const showConsultant = applied.sort === "consultant" || (summary?.visibleColumns?.consultant ?? rows?.some(row => row.consultantName));
  const showNotes = applied.sort === "notes" || (summary?.visibleColumns?.notes ?? rows?.some(row => row.description));
  const entrySort: SortState<TimeEntrySortField> = { key: applied.sort ?? "date", direction: applied.direction ?? (applied.order === "newest" ? "desc" : "asc") };
  const sortEntries = (value: SortState<TimeEntrySortField>) => {
    const href = new URL(window.location.href);
    href.searchParams.set("entry-sort", value.key);
    href.searchParams.set("entry-direction", value.direction);
    window.history.replaceState(window.history.state, "", href);
    void load(undefined, { ...applied, sort: value.key, direction: value.direction }, appliedMonth, false, true);
  };
  const header = (field: TimeEntrySortField) => linkedId ? <th scope="col">{entryLabels[field]}</th> :
    <SortHeader field={field} label={entryLabels[field]} sort={entrySort} onSort={sortEntries} disabled={busy} title={field === "notes" ? "Original description from QuickBooks Time" : undefined} />;
  const bulkParents = new Set(selectedRows.map(row => row.reportingParentId).filter(Boolean));
  const compatibleTargets = projects.filter(project => canAllocateToDelivery(project.delivery) &&
    (!bulkParents.size || bulkParents.size === 1 && bulkParents.has(resolvedParent(project.id))));
  const bulkTargets = compatibleTargets.filter(project => !bulkDepartment || resolvedArea(project.id) === bulkDepartment);
  const selectedRecorded = selectedRows.reduce((sum, row) => sum + row.seconds, 0);
  const selectedRemaining = selectedRows.reduce((sum, row) => sum + row.unallocatedSeconds, 0);
  const destination = [resolvedParent(bulkProject) && projectName(resolvedParent(bulkProject)),
    resolvedArea(bulkProject) && areaLabel(resolvedArea(bulkProject)), bulkProject && projectName(bulkProject)].filter(Boolean).join(" / ");
  const deliveryOptions = projects.filter(project => canAllocateToDelivery(project.delivery) &&
    (!parent || resolvedParent(project.id) === parent) && (!classification || resolvedArea(project.id) === classification));
  function chooseDelivery(id: string, index: number) {
    setPortions(old => old.length ? old.map((part, i) => i === index ? { ...part, projectId: id } : part) :
      [{ projectId: id, seconds: editor!.seconds, description: "" }]);
    if (!advancedSplit && id) {
      setParent(defaultParent(editor!) || resolvedParent(id));
      setClassification(resolvedArea(id));
    }
  }
  const canBulk = selectedRows.length > 0 && (approveAutomatic ? canPublish && bulkProject &&
    selectedRows.every(row => row.automaticClassification?.projectId === bulkProject) :
    bulkTargets.some(project => project.id === bulkProject) && selectedRows.every(canSelectTimeForBulk));
  async function selectMatches(automatic = false) {
    if (busy || !summary?.matched) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams({ month: appliedMonth, selection: automatic ? "automatic" : "bulk" });
      for (const [name, value] of Object.entries(applied)) if (value) query.set(name, value);
      const available = await allAuthorizedRows("sources", query, controller.signal, authorizedPages(client, tenant));
      if (!mounted.current || controller.signal.aborted) return;
      if (available.some(row => automatic ? !row.automaticClassification || row.automaticClassification.projectId !== applied.project :
        !canSelectTimeForBulk(row))) throw Error("The selection changed. Try again.");
      setSelected(available);
      setApproveAutomatic(automatic);
      setBulkDepartment("");
      setBulkProject("");
      if (automatic && applied.project) setBulkProject(applied.project);
      setNotice(available.length ? "" : "No matching entries are eligible for this operation.");
    } catch (reason) {
      if (mounted.current && !controller.signal.aborted) failed(reason);
    } finally {
      if (mounted.current && !controller.signal.aborted) setBusy(false);
    }
  }
  async function write(source: StaffSource, expected: number, parts: Allocation[], notes: AllocationAnnotations) {
    return client.call<{ revision: number; changed: boolean }>(tenant, "allocations/" + source.id, {
      method: "PATCH", body: { expectedRevision: expected, expectedSourceRevision: source.sourceRevision, portions: parts, annotations: notes },
    });
  }
  async function save(source: StaffSource, parts: Allocation[], notes: AllocationAnnotations, expected = revision, allowUndo = true, notesOnlySave = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await write(source, expected, parts, notes);
      if (!mounted.current) return;
      setUndo(result.changed && allowUndo && !source.needsReview ? { source, revision: result.revision } : undefined);
      setNotice(result.changed ? notesOnlySave ? "Notes saved." : allowUndo ? "Allocation saved." : "Previous allocation restored." : "No changes to save.");
      close(true); onSaved(); await load();
    } catch (e) { failed(e); }
    finally { setBusy(false); }
  }
  async function submitBulk(current: BulkBatch, body: BulkAllocationRequest) {
    if (bulkInFlight.current) return;
    bulkInFlight.current = true;
    setBusy(true); setError(""); setNotice(""); setUndo(undefined);
    setBulkProcessed(0);
    let offset = 0;
    let changed = false;
    const retryableEntries: BulkAllocationRequest["entries"] = [];
    const settled = new Map((batch?.key === current.key ? bulkResult?.outcomes ?? current.outcomes : current.outcomes)
      ?.map(outcome => [outcome.sourceId, outcome]));
    function journal(entries: BulkAllocationRequest["entries"]) {
      if (!journalKey) return;
      try {
        if (entries.length) sessionStorage.setItem(journalKey, JSON.stringify({
          key: current.key, body: { ...body, entries }, seconds: current.seconds, outcomes: [...settled.values()],
        }));
        else sessionStorage.removeItem(journalKey);
      } catch { /* Retry remains available within the open workspace. */ }
    }
    journal(body.entries);
    try {
      while (offset < body.entries.length && mounted.current) {
        const entries = body.entries.slice(offset, offset + MAX_BULK_ALLOCATION_ENTRIES);
        const response = await client.call<BulkAllocationResponse>(tenant, "allocations/bulk", {
          method: "POST", key: current.key, body: { ...body, entries },
        });
        if (!mounted.current) return;
        const returned = new Set(response.outcomes.map(row => row.sourceId));
        if (returned.size !== entries.length || response.outcomes.length !== entries.length ||
          entries.some(entry => !returned.has(entry.sourceId))) throw Error("Incomplete bulk result");
        const retryable = new Set(response.outcomes.filter(row => row.status === "retryable").map(row => row.sourceId));
        retryableEntries.push(...entries.filter(entry => retryable.has(entry.sourceId)));
        offset += entries.length;
        for (const outcome of response.outcomes) settled.set(outcome.sourceId, outcome);
        journal([...retryableEntries, ...body.entries.slice(offset)]);
        setBulkProcessed(offset);
        changed ||= response.outcomes.some(outcome => outcome.status === "saved" || outcome.status === "already_saved");
        setBulkResult({ outcomes: [...settled.values()] });
      }
      if (!mounted.current) return;
      setUnconfirmed(undefined);
      if (changed) onSaved();
      await load();
    } catch (e) {
      if (!mounted.current) return;
      setUnconfirmed({ ...body, entries: [...retryableEntries, ...body.entries.slice(offset)] });
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) failed(e);
      else setError("The server outcome could not be confirmed. Check the result with the same request.");
    } finally {
      bulkInFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function bulk() {
    if (!canBulk || unconfirmed) return;
    bulkReview.current?.close();
    const current = {
      key: Date.now() + "-" + crypto.randomUUID(),
      body: { projectId: bulkProject, ...(approveAutomatic && { approveAutomatic: true as const }), entries: selectedRows.map(source => ({
        sourceId: source.id, expectedSourceRevision: source.sourceRevision, expectedAllocationRevision: source.allocationRevision,
      })) },
      seconds: Object.fromEntries(selectedRows.map(source => [source.id, source.unallocatedSeconds])),
      labels: Object.fromEntries(selectedRows.map(source => [source.id,
        [reportDay(source.date), source.workOrderName || source.sourceWorkOrderId,
          source.consultantName || source.sourcePersonId, reportHours(source.seconds) + " h"].filter(Boolean).join(" · ")])),
    };
    setBatch(current); setBulkResult(undefined);
    void submitBulk(current, current.body);
  }
  async function revisions(source: StaffSource, next?: string) {
    try {
      const p = await client.call<ProjectPage>(tenant, "sources/" + source.id + "/history?" + new URLSearchParams({ month: source.date.slice(0, 7), limit: "10", ...(next ? { cursor: next } : {}) }));
      setHistory(old => next ? [...(old ?? []), ...(p.history ?? [])] : p.history ?? []);
      setHistoryCursor(p.nextCursor);
    } catch (e) { failed(e); }
  }
  return <div className="delivery-allocation">
    <div className="delivery-section-heading time-workbench-heading"><div><h3>Recorded time · {periodLabel}</h3><p>Review QuickBooks Time records and classify hours when a delivery project is known.</p></div>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load(undefined, applied, appliedMonth, Boolean(linkedId))}>Load authorized time</button>{linkedId && <WorkspaceToolbarControls />}</div>
    {linkedId && sourceLink && <PlatformLink href={sourceLink.backHref}>Back to Time Allocation</PlatformLink>}
    {!linkedId && <div className="time-workbench-controls"><form className="time-history-toolbar" aria-label="Reporting period" onSubmit={event => { event.preventDefault(); changePeriod(chosenScope); }}>
      <div><label htmlFor={periodSelectId}>Period</label><select id={periodSelectId} value={preset} onChange={e => setPreset(e.target.value as TimePreset)}>
        {Object.entries(timePresets).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></div>
      {(preset === "specific" || preset === "quarter") && <label>Reporting month<input type="month" required value={reference} onChange={e => setReference(e.target.value)} /></label>}
      {preset === "range" && <>
        <label>Period starts<input type="date" value={start} required max={end || undefined} onChange={e => setStart(e.target.value)} /></label>
        <label>Period ends<input type="date" value={end} required min={start || undefined} onChange={e => setEnd(e.target.value)} /></label>
      </>}
      <button type="submit" disabled={busy}>Apply period</button>
      <details className="time-advanced time-period-options"><summary>Reporting options</summary><div className="time-advanced-grid">
      <label>Sort time entries<select value={order} onChange={e => setOrder(e.target.value as SavedScope["order"])}>
        <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
      </select></label>
      <label>Summarize by<select value={group} onChange={e => setGroup(e.target.value as TimeGrouping)}>
        <option value="month">Month</option><option value="quarter">Quarter</option><option value="year">Year</option>
      </select></label>
      <button type="button" className="secure-secondary" disabled={busy} onClick={saveScope}>Save reporting scope</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={restoreScope}>Use saved scope</button>
      </div></details>
      <WorkspaceToolbarControls />
    </form>
    <form className="time-filter-form" aria-label="Time entry filters" onSubmit={event => {
      event.preventDefault();
      const url = new URL(window.location.href);
      for (const [key, value] of [["time-parent", parentFilter], ["time-mapping", mappingFilter]] as const) {
        if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      }
      window.history.replaceState(window.history.state, "", url);
      void load(undefined, { ...applied, search: search.trim(), status, workOrder,
        provenance, parent: parentFilter, mapping: mappingFilter, area, project: projectFilter, from, through });
    }}>
      <label>{summary?.period.kind === "month" || !summary ? "Search month" : "Search period"}<input type="search" value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /></label>
      <details className="time-advanced time-filter-options"><summary>Advanced filters</summary><div className="time-advanced-grid">
      <label>Work order<select value={workOrder} onChange={e => setWorkOrder(e.target.value)}><option value="">All</option>
        {workOrder && !summary?.workOrders.some(item => item.id === workOrder) && <option value={workOrder}>{workOrder}</option>}
        {summary?.workOrders.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Classification source<select value={provenance ?? ""} onChange={event => setProvenance(
        (event.target.value || undefined) as SourceFilters["provenance"])}>
        <option value="">All</option><option value="automatic">Automatic mapping</option>
        <option value="manual">Manual allocation</option><option value="unclassified">No delivery classification</option>
      </select></label>
      <label>Parent Project<select value={parentFilter} onChange={e => {
        setParentFilter(e.target.value); setArea(""); setProjectFilter("");
      }}><option value="">All</option>{projects.filter(p => p.delivery?.kind === "engagement" && !p.delivery.parentId)
        .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Department<select value={area} onChange={e => { setArea(e.target.value); setProjectFilter(""); }}><option value="">All</option>{portfolio?.areas
        .filter(item => !parentFilter || projects.some(p => resolvedParent(p.id) === parentFilter && resolvedArea(p.id) === item.id))
        .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>Delivery Project<select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="">All</option>{projects
        .filter(p => p.delivery?.kind !== "engagement" && p.delivery?.kind !== "service-area" &&
          (!parentFilter || resolvedParent(p.id) === parentFilter) && (!area || resolvedArea(p.id) === area))
        .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Mapping status<select value={mappingFilter ?? ""} onChange={e => setMappingFilter((e.target.value || undefined) as SourceFilters["mapping"])}><option value="">All</option>
        {Object.entries(sourceMappingLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Allocation status<select value={status ?? ""} onChange={e => setStatus((e.target.value || undefined) as SourceFilters["status"])}><option value="">All</option><option value="queue">Has unallocated time</option>{Object.entries(sourceStatusLabels).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>From<input type="date" min={summary?.period.start} max={summary?.period.end} value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>Through<input type="date" min={from || summary?.period.start} max={summary?.period.end} value={through} onChange={e => setThrough(e.target.value)} /></label>
      </div></details>
      <button type="submit" disabled={busy}>Apply filters</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
        setSearch(""); setStatus(undefined); setWorkOrder(""); setProvenance(undefined);
        setParentFilter(""); setMappingFilter(undefined);
        const url = new URL(window.location.href);
        url.searchParams.delete("time-parent"); url.searchParams.delete("time-mapping");
        window.history.replaceState(window.history.state, "", url);
        setArea(""); setProjectFilter(""); setFrom(""); setThrough("");
        const { period, start, end, order, group, sort, direction } = applied;
        void load(undefined, { period, start, end, order, group, sort, direction });
      }}>Clear filters</button>
    </form></div>}
    {summary && !linkedId && <>
      <div className="time-scope-actions">
        <p role="status" className="time-scope-status">Scope · {scope.length ? scope.join(" · ") : summary.period.kind === "month" ? "Entire month" : periodLabel} · {summary.matched} {summary.matched === 1 ? "match" : "matches"} out of {summary.monthTotal} {summary.period.kind === "month" ? "month" : "period"} entries · {reportHours(summary.hours.recordedSeconds)} h recorded</p>
        <CsvExport label="Export time entries CSV"
        filename={["Morris", clientName, "Time", applied.workOrder, applied.consultant,
          summary.period.kind === "month" ? appliedMonth : summary.period.start ?? "All_History",
          summary.period.kind === "month" ? undefined : summary.period.end].filter(Boolean).join("_")}
        scope={JSON.stringify([applied, appliedMonth, revision])} disabled={busy || !summary.matched} onDenied={onDenied}
        load={async signal => {
          const query = new URLSearchParams({ month: appliedMonth });
          for (const [name, value] of Object.entries(applied)) if (value) query.set(name, value);
          return sourceCsv(await allAuthorizedRows("sources", query, signal, authorizedPages(client, tenant)));
        }} />
      </div>
    </>}
    {error && <p className="secure-message secure-error" role="alert">{error}</p>}
    {notice && <p className="secure-message" role="status">{notice}</p>}
    {undo && <button type="button" className="secure-secondary" disabled={busy} onClick={() => { const prior = undo; setUndo(undefined); void save(prior.source, prior.source.portions, prior.source.annotations ?? blank, prior.revision, false); }}>Undo last change</button>}
    {summary && !linkedId && <div className="time-table-filters">
      <TimeConsultantFilter choices={summary.consultants} selected={consultantIds} disabled={busy} onChange={filterConsultants} />
      <p role="status">{summary.matched} matching {summary.matched === 1 ? "entry" : "entries"} · {reportHours(summary.hours.recordedSeconds)} h recorded</p>
    </div>}
    {!!rows?.length && !linkedId && <div className="time-selection-tools" aria-label="Select time entries">
      <button type="button" className="secure-secondary" disabled={busy || approveAutomatic || !lastPage.some(canSelectTimeForBulk)}
        onClick={() => selectVisible(lastPage, true)}>Select eligible entries on this page</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => void selectMatches()}>Select all eligible matches</button>
      {canPublish && applied.project && <button type="button" className="secure-secondary" disabled={busy}
        onClick={() => void selectMatches(true)}>Select this project’s automatic classifications</button>}
    </div>}
    {!!selected.length && <section className="time-bulk-tools" aria-label="Bulk allocation">
      <div className="time-bulk-summary">
        <p role="status"><b>{selectedRows.length} selected</b> · {reportHours(selectedRecorded)} h recorded · {reportHours(selectedRemaining)} h remaining</p>
        <button type="button" className="exec-text-button" disabled={busy} onClick={clearSelection}>Clear selection</button>
      </div>
      {bulkParents.size > 1 ? <div className="time-parent-groups">
        <p role="alert">These entries span different Parent Projects. Choose one group to review its allocation.</p>
        {[...new Set(selectedRows.map(row => row.reportingParentId ?? ""))].map(id => {
          const entries = selectedRows.filter(row => (row.reportingParentId ?? "") === id);
          return <button key={id} type="button" className="secure-secondary" disabled={busy} onClick={() => {
            clearSelection(); setSelected(entries);
          }}>Keep {entries.length} from {id ? projectName(id) : "entries without a mapped parent"}</button>;
        })}
      </div> : <p className="time-parent-summary">{bulkParents.size === 1
        ? "Parent Project: " + projectName([...bulkParents][0] ?? "") : "No fixed Parent Project in this selection."}</p>}
      <div className="time-bulk-destination">
        {!approveAutomatic && <>
          <label>Department<select value={bulkDepartment} disabled={busy || bulkParents.size > 1} onChange={e => {
            setBulkDepartment(e.target.value); setBulkProject("");
          }}><option value="">All compatible departments</option>{portfolio?.areas.filter(item =>
            compatibleTargets.some(project => resolvedArea(project.id) === item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <SearchableCombobox label="Delivery Project" value={bulkProject} placeholder="Select delivery project"
            disabled={busy || bulkParents.size > 1}
            empty="No delivery projects are available for this parent project and department."
            options={bulkTargets.map(p => ({ value: p.id, label: p.name, detail: areaLabel(resolvedArea(p.id)) }))}
            onChange={id => { setBulkProject(id); setBulkDepartment(resolvedArea(id)); }} />
        </>}
        <button type="button" disabled={busy || !canBulk || Boolean(unconfirmed)}
          onClick={() => bulkReview.current?.showModal()}>{approveAutomatic ? "Review effort approval" : "Review allocation"}</button>
      </div>
      {destination && <p className="time-parent-summary">{destination}</p>}
    </section>}
    <dialog className="time-review-dialog" ref={bulkReview} aria-label="Review allocation">
      <h3>{approveAutomatic ? "Review effort approval" : "Review allocation"}</h3>
      <p>{selectedRows.length} entries · {reportHours(selectedRecorded)} h recorded · {reportHours(selectedRemaining)} h to {approveAutomatic ? "approve" : "allocate"}</p>
      <p>{destination}</p>
      {approveAutomatic && <p>Authorized clients can see approved effort on published projects.</p>}
      <div><button type="button" className="secure-secondary" onClick={() => bulkReview.current?.close()}>Back</button>
        <button type="button" onClick={bulk} disabled={busy || !canBulk}>{approveAutomatic ? "Approve selected effort" : "Apply allocation"}</button></div>
    </dialog>
    {busy && batch && <p role="status">{bulkProcessed} entries checked in this request.</p>}
    {batch && unconfirmed && <div className="secure-actions">
      <span>{unconfirmed.entries.length} entries in the saved operation</span>
      <button type="button" disabled={busy} onClick={() => void submitBulk(batch, unconfirmed)}>Check this bulk request again</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
        if (!confirm("Discard this pending request? Previous successful allocations stay saved.")) return;
        try { if (journalKey) sessionStorage.removeItem(journalKey); } catch { /* The request can be cleared from this view. */ }
        setUnconfirmed(undefined);
      }}>Discard pending request</button>
    </div>}
    {batch && bulkResult && <BulkAllocationResults result={bulkResult} seconds={batch.seconds} describeEntry={id => batch.labels[id] ?? id} busy={busy}
      onRetry={unconfirmed ? undefined : () => {
        const retryable = new Set(bulkResult.outcomes.filter(outcome => outcome.status === "retryable").map(outcome => outcome.sourceId));
        const entries = batch.body.entries.filter(entry => retryable.has(entry.sourceId));
        if (entries.length) void submitBulk(batch, { ...batch.body, entries });
      }} />}
    {!rows && !error && <p role="status">Loading recorded time…</p>}
    {rows && rows.length === 0 && <p className="secure-empty">{linkedId ? "This time entry is unavailable in this workspace." : "No entries match these filters."}</p>}
    {!!rows?.length && !linkedId && <div className="mi-entry-sort-mobile">
      <label>Sort time entries by<select value={entrySort.key} disabled={busy} onChange={e => sortEntries({ key: e.target.value as TimeEntrySortField, direction: "asc" })}>
        {timeEntrySortFields.map(field => <option key={field} value={field}>{entryLabels[field]}</option>)}</select></label>
      <label>Direction<select value={entrySort.direction} disabled={busy} onChange={e => sortEntries({ ...entrySort, direction: e.target.value === "desc" ? "desc" : "asc" })}>
        <option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
    </div>}
    {!!rows?.length && <div className="intel-table-scroll time-entries" tabIndex={0} role="region" aria-label="Recorded time table">
      <table role="table"><colgroup><col className="time-col-select" /><col className="time-col-date" />
        {showConsultant && <col className="time-col-consultant" />}{showNotes && <col />}
        <col className="time-col-work-order" /><col className="time-col-hours" /><col className={showNotes ? "time-col-reporting" : undefined} />
        <col className="time-col-assignment" /><col className="time-col-status" /><col className="time-col-actions" />
      </colgroup><thead role="rowgroup"><tr role="row"><th scope="col" className="time-select-cell">
        <input ref={headerCheckbox} type="checkbox" aria-label="Select all eligible visible entries" title="Select all eligible visible entries"
          disabled={busy || approveAutomatic || !visibleEligible.length || Boolean(linkedId)} checked={allVisibleSelected}
          onChange={e => selectVisible(rows ?? [], e.target.checked)} /></th>{header("date")}{showConsultant && header("consultant")}{showNotes && header("notes")}
        {header("workOrder")}{header("recorded")}{header("reporting")}{header("assignment")}{header("status")}<th scope="col">Actions</th></tr></thead>
      <tbody role="rowgroup">{rows.map(source => <tr key={source.id} role="row">
        <td role="cell" data-cell="Select" className="time-select-cell"><input aria-label={"Select entry on " + source.date}
          type="checkbox" disabled={busy || !selectedIds.has(source.id) && (approveAutomatic || !canSelectTimeForBulk(source))}
          checked={selectedIds.has(source.id)} onChange={e => e.target.checked ? selectVisible([source], true) :
            setSelected(old => old.filter(row => row.id !== source.id))} /></td>
        <td role="cell" data-cell="Date">{reportDay(source.date)}</td>
        {showConsultant && <td role="cell" data-cell="Consultant"><div className="time-profile">
          {source.wordpressProfile?.photo && <img src={source.wordpressProfile.photo} alt={source.wordpressProfile.alt || ""} width="32" height="32" loading="lazy" />}
          <span>{source.consultantName}{source.wordpressProfile?.title && <small>{source.wordpressProfile.title}</small>}</span>
        </div></td>}
        {showNotes && <td role="cell" data-cell="Original description">{source.description ?
          <button type="button" className="time-description" title="Read full QuickBooks Time description"
            onClick={() => setInspectDescription(source)}><span className="mi-time-note-preview">{source.description}</span></button> : "—"}</td>}
        <td role="cell" data-cell="Work order"><b>{source.workOrderName || source.sourceWorkOrderId}</b></td>
        <td role="cell" data-cell="Recorded">{reportHours(source.seconds)} h</td><td role="cell" data-cell="Reporting"><span className="mi-time-note-preview">{source.annotations?.reportingDescription ?? source.automaticClassification?.reportingDescription ?? "—"}</span></td>
        <td role="cell" data-cell="Assignment">{source.portions.length ? source.portions.map(p => <div key={p.projectId}>{projectName(p.projectId)}<small>{resolvedParent(p.projectId) ? projectName(resolvedParent(p.projectId)) + " · " : ""}{areaLabel(resolvedArea(p.projectId))}</small></div>) :
          source.automaticClassification ? <div>{projectName(source.automaticClassification.projectId)}
            <small>{projectName(source.automaticClassification.parentId)} · {areaLabel(source.automaticClassification.areaId)}</small>
          </div> : "Unassigned"}
          {(source.annotations?.parentId || source.annotations?.areaId) && <small>Reporting: {source.annotations.parentId ? projectName(source.annotations.parentId) + " · " : ""}{areaLabel(source.annotations.areaId ?? "")}</small>}</td>
        <td role="cell" data-cell="Status">{source.automaticClassification ? "Automatic · staff only" : sourceStatus(source) === "unallocated" ? "Unassigned" : sourceStatusLabels[sourceStatus(source)]}
          {source.unallocatedSeconds > 0 && <small>{reportHours(source.unallocatedSeconds)} h remaining</small>}
          {source.mappingStatus && !["unmapped", "delivery"].includes(source.mappingStatus) && <small>{sourceMappingLabels[source.mappingStatus]}</small>}</td>
        <td role="cell" data-cell="Actions"><button type="button" className="secure-secondary time-manage" disabled={busy} onClick={() => edit(source)}>Manage Time</button></td>
      </tr>)}</tbody></table></div>}
    {cursor && <button type="button" className="secure-secondary" disabled={busy} onClick={() => void load(cursor)}>More recorded time</button>}
    {summary && !linkedId && <div className="time-secondary-analysis">
      <TimeHistorySummary summary={summary} filenamePrefix={["Morris", clientName, summary.period.start ?? "All_History", summary.period.end].filter(Boolean).join("_")} grouping={applied.group ?? "month"} busy={busy} onConsultant={id => {
        filterConsultants([id]);
      }} onWorkOrder={id => {
        setWorkOrder(id); void load(undefined, { ...applied, workOrder: id });
      }} />
      <dl className="time-counts" aria-label="Counts across all matching entries before the allocation status filter">
        <div><dt>Total in filter scope</dt><dd>{summary.counts.total}</dd></div>
        {Object.entries(sourceStatusLabels).map(([id, label]) => <div key={id}><dt>{label}</dt><dd>{summary.counts[id as keyof typeof sourceStatusLabels]}</dd></div>)}
      </dl>
      {Boolean(summary.hours.automaticallyClassifiedSeconds) && <p className="time-scope-status">
        {reportHours(summary.hours.automaticallyClassifiedSeconds ?? 0)} h classified by mapping for staff review
      </p>}
      <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
        const queue = applied.status === "queue" ? undefined : "queue";
        setStatus(queue); void load(undefined, { ...applied, status: queue });
      }} aria-pressed={applied.status === "queue"}>Time awaiting classification · {summary.counts.remaining}</button>
    </div>}
    {editor && <dialog className="time-alloc-drawer" ref={drawer} aria-label="Time allocation" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
      <div className="time-drawer-heading"><h3 ref={heading} tabIndex={-1}>Manage Time</h3><button type="button" className="secure-secondary" aria-label="Close allocation" disabled={busy} onClick={() => close()}><X size={18} aria-hidden="true" /></button></div>
      <dl className="time-source-summary">
        <div><dt>Consultant</dt><dd>{editor.consultantName || "Unavailable"}</dd></div>
        <div><dt>Date</dt><dd>{reportDay(editor.date)}</dd></div>
        <div><dt>Work order</dt><dd>{editor.workOrderName || editor.sourceWorkOrderId}</dd></div>
        <div><dt>Recorded</dt><dd>{reportHours(editor.seconds)} h</dd></div>
      </dl>
      <section className="time-original-note"><h4>Original QuickBooks Time Description</h4><p>{editor.description || "No original description."}</p></section>
      <details><summary>Original source details</summary><dl>
        {editor.sourcePersonId && <div><dt>Consultant identifier</dt><dd>{editor.sourcePersonId}</dd></div>}
        <div><dt>Recorded seconds</dt><dd>{editor.seconds.toLocaleString("en-CA")}</dd></div>
        <div><dt>Accounting approval</dt><dd>{approvalLabel(editor)}</dd></div>
        <div><dt>Source revision</dt><dd><code>{editor.sourceRevision}</code></dd></div>
        {editor.modifiedAt && <div><dt>Source last modified</dt><dd>{reportTimestamp(editor.modifiedAt)}</dd></div>}
      </dl></details>
      {editor.automaticClassification && <p role="status">The reviewed work-order mapping classified this time for staff. Saving uses the existing reporting approval rules.</p>}
      {editor.needsReview && <p role="status">QuickBooks changed this entry. Review the prior split before saving.</p>}
      {error && <p className="secure-message secure-error" role="alert">{error}</p>}
      <section className="time-destination" aria-label="Allocation destination">
        <h4>Allocation destination</h4>
        {defaultParent(editor) ? <dl className="time-source-parent"><div><dt>Parent Project</dt><dd>{projectName(defaultParent(editor))}</dd></div></dl> :
          <SearchableCombobox label="Parent Project" value={parent}
            options={projects.filter(p => p.id === parent || p.delivery?.kind === "engagement" || projects.some(child => child.delivery?.parentId === p.id))
              .map(p => ({ value: p.id, label: p.name }))}
            onChange={id => { setParent(id); setClassification(""); }} placeholder="Select parent project" />}
        <div className="time-destination-controls">
          <label>Department<select value={classification} onChange={e => {
            setClassification(e.target.value);
            if (!advancedSplit && portions[0] && e.target.value && resolvedArea(portions[0].projectId) !== e.target.value) setPortions([]);
          }}><option value="">All compatible departments</option>{portfolio?.areas
            .filter(a => !parent || a.id === classification || projects.some(p => resolvedParent(p.id) === parent && resolvedArea(p.id) === a.id))
            .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          {!advancedSplit && <div>
            <SearchableCombobox label="Delivery Project" value={portions[0]?.projectId ?? ""} placeholder="Select delivery project"
              empty="No delivery projects are available for this parent project and department."
              options={deliveryOptions.map(p => ({ value: p.id, label: p.name, detail: areaLabel(resolvedArea(p.id)) }))}
              onChange={id => chooseDelivery(id, 0)} />
            {!!portions[0]?.projectId && <button type="button" className="exec-text-button" onClick={() => setPortions([])}>Clear delivery project</button>}
          </div>}
        </div>
        {!deliveryOptions.length && <div><p>No delivery projects are available for this parent project and department.</p>
          {sourceLink?.createHref && <PlatformLink href={sourceLink.createHref(editor.id, parent, classification)}
            beforeNavigate={() => !dirty || window.confirm("Open project setup and discard unsaved allocation edits?")}>Create delivery project</PlatformLink>}</div>}
        {advancedSplit && portions.map((p, index) => <div className="time-split-row" key={index}>
          <SearchableCombobox label={"Delivery project for split " + (index + 1)} value={p.projectId} placeholder="Select delivery project"
            empty="No delivery projects are available for this parent project and department."
            options={[...deliveryOptions, ...projects.filter(project => project.id === p.projectId && !deliveryOptions.includes(project))]
              .map(project => ({ value: project.id, label: project.name, detail: areaLabel(resolvedArea(project.id)) }))}
            onChange={id => chooseDelivery(id, index)} />
          <label>Allocated seconds<input type="number" min="1" step="1" value={p.seconds}
            onChange={e => setPortions(old => old.map((part, i) => i === index ? { ...part, seconds: Number(e.target.value) } : part))} /></label>
          <button type="button" className="secure-secondary" onClick={() => setPortions(old => old.filter((_, i) => i !== index))}>Remove split</button>
        </div>)}
        <button type="button" className="exec-text-button" disabled={busy || editor.conflict || portions.length >= 10} onClick={() => {
          if (!advancedSplit) { setAdvancedSplit(true); if (!portions.length) setPortions([{ projectId: "", seconds: editor.seconds, description: "" }]); }
          else setPortions(old => [...old, { projectId: "", seconds: 0, description: "" }]);
        }}>{advancedSplit ? "Add split" : "Advanced split allocation"}</button>
      </section>
      <label className="time-drawer-notes">Reporting description<textarea aria-label="Reporting description" value={annotations.reportingDescription} maxLength={1000}
        onChange={e => setAnnotations({ ...annotations, reportingDescription: e.target.value })} /></label>
      <label className="time-drawer-notes">Internal note <span>Private to Morris staff</span><textarea aria-label="Internal note" value={annotations.internalNote} maxLength={4000}
        onChange={e => setAnnotations({ ...annotations, internalNote: e.target.value })} /></label>
      <p>{remaining >= 0 ? reportHours(remaining) + " h will remain at the work order." : "The split exceeds the original recorded time."}</p>
      <div className="time-drawer-utilities">
        {!history && <button type="button" className="secure-secondary" disabled={busy} onClick={() => void revisions(editor)}>Activity History</button>}
        {sourceLink && <button type="button" className="secure-secondary" onClick={async () => {
          try {
            await navigator.clipboard.writeText(new URL(sourceLink.href(editor.id), window.location.href).href);
            setNotice("Entry link copied.");
          } catch { setError("Could not copy the link. Open the entry link to copy its address."); }
        }}>Copy entry link</button>}
        {!linkedId && sourceLink && <PlatformLink className="secure-secondary" href={sourceLink.href(editor.id)}>Link to this entry</PlatformLink>}
        {notice === "Entry link copied." && <span role="status">{notice}</span>}
      </div>
      {history?.length === 0 && <p>No allocation revisions yet.</p>}
      {history?.map(item => <details key={item.revision}><summary>Revision {item.revision} · {reportTimestamp(item.at)} · {reportHours(item.portions.reduce((sum,p) => sum + p.seconds, 0))} h</summary>
        <ul>{item.portions.map(part => <li key={part.projectId}>{projectName(part.projectId)} · {reportHours(part.seconds)} h</li>)}</ul>
        {item.annotations?.reportingDescription && <p>{item.annotations.reportingDescription}</p>}{item.annotations?.internalNote && <p>{item.annotations.internalNote}</p>}
        {!editor.conflict && <button type="button" className="secure-secondary" onClick={() => { setAdvancedSplit(item.portions.length > 1 || item.portions.some(part => part.seconds !== editor.seconds)); setPortions(item.portions); setAnnotations(item.annotations ?? blank); setParent(item.annotations?.parentId ?? ""); setClassification(item.annotations?.areaId ?? ""); }}>Use this revision as a draft</button>}</details>)}
      {historyCursor && <button type="button" className="secure-secondary" onClick={() => void revisions(editor, historyCursor)}>More allocation history</button>}
      <footer className="time-drawer-footer">
        <button type="button" className="secure-secondary" disabled={busy} onClick={() => close()}>Cancel</button>
        <button type="button" disabled={busy || editor.conflict || remaining < 0 ||
          new Set(portions.map(p => p.projectId)).size !== portions.length || portions.some(p => !p.projectId || !Number.isSafeInteger(p.seconds) || p.seconds <= 0)}
          onClick={() => void save(editor, portions, notesOnly ? {
            ...priorAnnotations, reportingDescription: annotations.reportingDescription, internalNote: annotations.internalNote,
          } : draftAnnotations, revision, true, notesOnly)}>{notesOnly ? "Save notes" : "Save allocation"}</button>
      </footer>
    </dialog>}
    {inspectDescription && <dialog className="time-review-dialog" ref={descriptionDialog} aria-label="Original QuickBooks Time Description"
      onClose={() => setInspectDescription(undefined)}>
      <h3>Original QuickBooks Time Description</h3><p>{inspectDescription.description}</p>
      <button type="button" className="secure-secondary" onClick={() => descriptionDialog.current?.close()}>Close</button>
    </dialog>}
  </div>;
}

function approvalLabel(source: StaffSource) {
  if (source.provider === "quickbooks-time" || !source.approval || source.approval === "unknown") return "Approval not verified";
  return { approved: "Source approval recorded", pending: "Source approval pending", submitted: "Source submitted for approval",
    rejected: "Source approval rejected" }[source.approval];
}
