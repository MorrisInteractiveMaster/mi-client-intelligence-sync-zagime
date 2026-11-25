import { isBoardRole } from "../projects/directory-role";
import test from "node:test";
import assert from "node:assert/strict";
import { clientDisplayName, ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { parseTimeMappingReview, workOrderQueue } from "../projects/time";
import { parsePlatformPath, staffPath } from "./platform-routes";

test("Zagime has one canonical display name independent of its tenant ID and stored label", () => {
  assert.equal(ZAGIME_CLIENT_DISPLAY_NAME, "Zagimē A. FN Workshop");
  assert.equal(clientDisplayName({ id: "zagime-production", name: "Legacy registered name" }, "Old branding"), ZAGIME_CLIENT_DISPLAY_NAME);
  assert.equal(clientDisplayName({ id: "zagime", name: "Legacy short name" }), ZAGIME_CLIENT_DISPLAY_NAME);
  assert.equal(clientDisplayName({ id: "other-tenant", name: "Other" }, "Other approved brand"), "Other approved brand");
});

test("mapping review rejects stale-shape or impossible recorded and allocated seconds", () => {
  const review = { targetKind: "project", previousProjectId: "work-order", recordedSeconds: 74700, allocatedSeconds: 14400, parentId: "parent", areaId: "hr" };
  assert.deepEqual(parseTimeMappingReview(review), review);
  for (const invalid of [
    { ...review, allocatedSeconds: 74701 }, { ...review, recordedSeconds: 0.5 },
    { ...review, targetKind: "service-area" }, { ...review, areaId: undefined }, { ...review, unexpected: true },
    { ...review, previousProjectId: "../elsewhere" }, undefined,
  ]) assert.throws(() => parseTimeMappingReview(invalid), /Invalid Time request/);
});

test("mapping queues distinguish verified registrations, linked, failed and inactive work orders", () => {
  const order = { jobcodeId: "132160684", projectId: "anchor", sourceState: "active" } as const;
  assert.equal(workOrderQueue({ ...order, mappingState: "registered", canReview: true }), "awaiting");
  assert.equal(workOrderQueue({ ...order, mappingState: "registered" }), "review");
  assert.equal(workOrderQueue({ ...order, mappingState: "linked" }), "mapped");
  assert.equal(workOrderQueue({ ...order, mappingState: "linked", failed: true }), "review");
  assert.equal(workOrderQueue({ ...order, sourceState: "inactive" }), "inactive");
  assert.equal(workOrderQueue({ ...order, sourceState: "missing" }), "inactive");
  assert.equal(staffPath("mapping"), "/workspace/time/mapping");
  assert.deepEqual(parsePlatformPath("/workspace/time/mapping"), { kind: "staff", section: "mapping" });
});

test("the directory only groups explicit Board roles", () => {
  for (const title of ["Board Member", "Board Chair", "Director of the Board", "Board of Directors"])
    assert.equal(isBoardRole(title), true);
  for (const title of ["Director of Finance", "Senior Consultant", "Other contacts", ""])
    assert.equal(isBoardRole(title), false);
});
