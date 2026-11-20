import test from "node:test";
import assert from "node:assert/strict";
import { advance, nextPage } from "./recover-time-details.mjs";

const inventory = (month) => ({ month, recordedSeconds: 1800, active: 1, deleted: 0,
  outsideCurrentMapping: 0, consultantIds: 0, consultantNames: 0, verifiedNotes: 0, emptyNotes: 0,
  unavailableNotes: 0, missingCurrentDetails: 1, missingConsultantId: 1, missingConsultantName: 1, missingOriginalNotes: 1 });
const result = { scanned: 1, eligible: 1, deleted: 0, outsideScope: 0, unchanged: 0, unavailable: 0,
  notCurrent: 0, conflicts: 0, wouldWrite: 1, written: 0 };

test("recovery inventories all months, resumes page cursors and stops for owner approval", () => {
  let state = { version: 1, stage: "inventory", before: {}, after: {}, dryRun: {}, apply: {} };
  const step = (receipt) => {
    state = advance(state, nextPage(state), receipt);
    state = JSON.parse(JSON.stringify(state));
  };
  step({ scanned: 1, outsideAccount: 0, months: [inventory("2026-06")], nextCursor: "second" });
  assert.equal(nextPage(state)?.cursor, "second");
  step({ scanned: 1, outsideAccount: 0, months: [inventory("2026-10")] });
  assert.equal(nextPage(state)?.month, "2026-06");
  step({ ...result, month: "2026-06", applied: false, nextCursor: "another" });
  assert.equal(nextPage(state)?.cursor, "another");
  step({ ...result, month: "2026-06", applied: false });
  step({ ...result, month: "2026-10", applied: false });
  assert.equal(state.stage, "awaiting-approval");
  state.stage = "apply";
  assert.throws(() => step({ ...result, month: "2026-06", applied: false }), /does not match/);
  step({ ...result, month: "2026-06", applied: true, written: 1 });
  step({ ...result, month: "2026-10", applied: true, written: 1 });
  assert.equal(state.stage, "coverage");
  assert.throws(() => step({ scanned: 2, outsideAccount: 0,
    months: [inventory("2026-06"), { ...inventory("2026-10"), recordedSeconds: 2000 }] }), /inventory changed/);
  step({ scanned: 2, outsideAccount: 0, months: [inventory("2026-06"), inventory("2026-10")] });
  assert.equal(state.stage, "done");
});
