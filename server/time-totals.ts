import type { DocumentReference, Transaction } from "firebase-admin/firestore";

export interface TimeTotals {
  recorded: number;
  allocated: number;
}
export async function timeTotalsWrite(
  tx: Transaction,
  root: DocumentReference,
  changes: { month: string; recorded: number; allocated: number }[],
) {
  const months = [...new Set(changes.map((c) => c.month))];
  if (!months.length) return () => {};
  const refs = months.map((month) =>
    root.collection("timeMonthlyTotals").doc(month),
  );
  const snapshots = await tx.getAll(...refs);
  const totals = months.map((month, i) => {
    const old = snapshots[i].data();
    const result = {
      recorded: old?.recorded ?? 0,
      allocated: old?.allocated ?? 0,
    } as TimeTotals;
    for (const c of changes)
      if (c.month === month) {
        result.recorded += c.recorded;
        result.allocated += c.allocated;
      }
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
