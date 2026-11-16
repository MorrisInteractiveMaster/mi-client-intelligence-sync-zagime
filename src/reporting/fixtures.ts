export interface FixtureTime {
  Id: string;
  SyncToken: string;
  TxnDate: string;
  Hours?: number;
  Minutes?: number;
  CustomerRef?: { value: string };
  status?: string;
}
export function applyFixtureChanges(
  entries: FixtureTime[],
  changes: FixtureTime[],
) {
  const map = new Map(entries.map((e) => [e.Id, e]));
  let writes = 0;
  for (const c of changes) {
    const old = map.get(c.Id);
    if (c.status === "Deleted") {
      if (map.delete(c.Id)) writes++;
    } else if (!old || Number(c.SyncToken) > Number(old.SyncToken)) {
      map.set(c.Id, c);
      writes++;
    }
  }
  return { entries: [...map.values()], writes };
}
export function fixtureTotals(
  entries: FixtureTime[],
  mapping: Record<string, string>,
) {
  const unique = new Map(entries.map((e) => [e.Id, e]));
  const months: Record<string, number> = {};
  let seconds = 0;
  for (const e of unique.values()) {
    if (!mapping[e.CustomerRef?.value ?? ""]) continue;
    const duration = (e.Hours ?? 0) * 3600 + (e.Minutes ?? 0) * 60;
    seconds += duration;
    const month = e.TxnDate.slice(0, 7);
    months[month] = (months[month] ?? 0) + duration;
  }
  return { seconds, months };
}
import type { RawTime } from "./model";
/** Synthetic Accounting fixture adapter only, not a QuickBooks Time API contract. */
export function rawFixtureInput(
  entries: (FixtureTime & {
    EmployeeRef?: { value: string };
    VendorRef?: { value: string };
    Description?: string;
  })[],
  tenantId: string,
  mapping: Record<string, string>,
): RawTime[] {
  return [
    ...new Map(
      entries
        .filter((e) => mapping[e.CustomerRef?.value ?? ""])
        .map((e) => [e.Id, e]),
    ).values(),
  ].map((e) => ({
    id: "fixture-" + e.Id,
    tenantId,
    sourcePersonId: e.EmployeeRef?.value ?? e.VendorRef?.value ?? "unknown",
    sourceWorkOrderId: e.CustomerRef!.value,
    date: e.TxnDate,
    seconds: (e.Hours ?? 0) * 3600 + (e.Minutes ?? 0) * 60,
    description: e.Description ?? "",
    revision: e.SyncToken,
  }));
}
