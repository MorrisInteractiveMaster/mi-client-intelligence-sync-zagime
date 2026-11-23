import { reportingAnchors, type ReportingAnchors } from "./time-attribution";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { workOrderEffort } from "../src/projects/effort";

export interface TimeTotals {
  recorded: number;
  allocated: number;
}
export async function readWorkOrderEffort(tx: Transaction, root: DocumentReference, ids: string[],
  month: string, assigned: readonly number[], anchors?: ReportingAnchors) {
  const selected = anchors ?? await reportingAnchors(tx, root, ids);
  const keys = [...new Set(ids.flatMap(id => selected.get(id) ?? []))];
  const read = async (period: string) => {
    if (!keys.length) return new Map<string, TimeTotals>();
    const rows = await tx.getAll(...keys.map(id => timeProjectTotal(root, id, period)));
    return new Map(keys.map((id, i) => [id, rows[i].data() as TimeTotals | undefined]));
  };
  const [current, lifetime] = await Promise.all([read(month), read("lifetime")]);
  const sum = (id: string, totals: Map<string, TimeTotals | undefined>) =>
    (selected.get(id) ?? []).reduce((result, anchor) => {
      const entry = totals.get(anchor);
      return entry ? { recorded: result.recorded + entry.recorded, allocated: result.allocated + entry.allocated } : result;
    }, { recorded: 0, allocated: 0 });
  return ids.map((id, i) => workOrderEffort(sum(id, current), sum(id, lifetime), assigned[i]));
}
export function timeProjectTotal(
  root: DocumentReference,
  project: string,
  period: string,
) {
  return root
    .collection("timeProjectTotals")
    .doc(project)
    .collection("periods")
    .doc(period);
}
export async function timeTotalsWrite(
  tx: Transaction,
  root: DocumentReference,
  changes: {
    project: string;
    month: string;
    recorded: number;
    allocated: number;
  }[],
) {
  const deltas = new Map<
    string,
    { ref: DocumentReference; recorded: number; allocated: number }
  >();
  for (const c of changes) {
    for (const ref of [
      root.collection("timeMonthlyTotals").doc(c.month),
      timeProjectTotal(root, c.project, c.month),
      timeProjectTotal(root, c.project, "lifetime"),
    ]) {
      const delta = deltas.get(ref.path) ?? { ref, recorded: 0, allocated: 0 };
      delta.recorded += c.recorded;
      delta.allocated += c.allocated;
      deltas.set(ref.path, delta);
    }
  }
  const entries = [...deltas.values()].filter((d) => d.recorded || d.allocated);
  if (!entries.length) return () => {};
  const refs = entries.map((d) => d.ref);
  const snapshots = await tx.getAll(...refs);
  const totals = entries.map((delta, i) => {
    const old = snapshots[i].data();
    const result = {
      recorded: (old?.recorded ?? 0) + delta.recorded,
      allocated: (old?.allocated ?? 0) + delta.allocated,
    } as TimeTotals;
    if (
      ![result.recorded, result.allocated].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) ||
      result.allocated > result.recorded
    )
      throw Error("Invalid reporting summary");
    return result;
  });
  return () => refs.forEach((ref, i) => tx.set(ref, totals[i]));
}
