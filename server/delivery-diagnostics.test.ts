import test from "node:test";
import assert from "node:assert/strict";
import { inspectDeliverySnapshot } from "../scripts/inspect-delivery-snapshot";
import { deliveryDefaults } from "../src/projects/delivery";

test("compatibility diagnostics retain recorded time and identities across a project-only upgrade", () => {
  const fixture = {
    projects: [{ id: "root", schemaVersion: 2 }, { id: "child", schemaVersion: 2 }],
    timeMappings: [{ account: "fixture", jobcodeId: "123", projectId: "root" }],
    rawTime: [{ record: { id: "entry", seconds: 3600, revision: "1", sourceWorkOrderId: "123" } }],
    allocationHeads: [{ sourceId: "entry", portions: [{ projectId: "child", seconds: 1200 }] }],
  };
  const before = inspectDeliverySnapshot(fixture);
  const after = inspectDeliverySnapshot({ ...fixture, projects: [
    fixture.projects[0], { ...fixture.projects[1], delivery: { ...deliveryDefaults, parentId: "root" } },
  ] });
  assert.equal(before.sourceIdentityDigest, after.sourceIdentityDigest);
  assert.equal(after.recordedSeconds, 3600);
  assert.equal(after.unallocatedSeconds, 2400);
  assert.throws(() => inspectDeliverySnapshot({ ...fixture, rawTime: [
    { record: { ...fixture.rawTime[0].record, seconds: 1100 } },
  ] }), /corrected source duration/);
});
