export type WorkOrderEffort = {
  recordedSeconds: number;
  remainingSeconds: number;
  assignedSeconds: number;
  lifetimeRecordedSeconds: number;
  lifetimeRemainingSeconds: number;
};

export function workOrderEffort(current: { recorded: number; allocated: number },
  lifetime: { recorded: number; allocated: number }, assignedSeconds: number): WorkOrderEffort {
  for (const totals of [current, lifetime]) {
    if (![totals.recorded, totals.allocated].every(n => Number.isSafeInteger(n) && n >= 0) ||
      totals.allocated > totals.recorded) throw Error("Invalid reporting summary");
  }
  return {
    recordedSeconds: current.recorded,
    remainingSeconds: current.recorded - current.allocated,
    assignedSeconds,
    lifetimeRecordedSeconds: lifetime.recorded,
    lifetimeRemainingSeconds: lifetime.recorded - lifetime.allocated,
  };
}
