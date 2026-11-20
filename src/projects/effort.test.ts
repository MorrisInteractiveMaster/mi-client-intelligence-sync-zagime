import test from "node:test";
import assert from "node:assert/strict";
import { workOrderEffort } from "./effort";

test("October work-order effort shows 20.75 hours before classification, then 16.75 remaining and 4 assigned", () => {
  const recorded = 74700;
  const assigned = 14400;
  const before = workOrderEffort({ recorded, allocated: 0 }, { recorded: 1644300, allocated: 0 }, 0);
  const after = workOrderEffort({ recorded, allocated: assigned }, { recorded: 1644300, allocated: assigned }, 0);
  assert.equal(before.remainingSeconds, recorded);
  assert.equal(after.remainingSeconds, 60300);
  assert.equal(after.remainingSeconds + assigned, before.recordedSeconds);
  assert.equal(after.lifetimeRecordedSeconds, before.lifetimeRecordedSeconds);
  assert.throws(() => workOrderEffort({ recorded: 1, allocated: 2 }, { recorded: 1, allocated: 0 }, 0));
});
