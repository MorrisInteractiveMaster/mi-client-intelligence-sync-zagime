import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryDefaults } from "../projects/delivery";
import type { StaffProjectSummary } from "../projects/model";
import { staffPulseStatus } from "./staff-overview-metrics";

const project = {
  schemaVersion: 2, id: "project", tenantId: "fixture", name: "Project",
  status: "planned", progress: 0, description: "", plan: { basis: "monthly", targetSeconds: 0 },
  published: false, lifetimeSeconds: 0, seconds: 0, delivery: { ...deliveryDefaults, start: "2026-11-20" },
} satisfies StaffProjectSummary;

test("the staff pulse and drilldown use the same exclusive calendar buckets", () => {
  assert.equal(staffPulseStatus(project, "2026-11-19"), "upcoming");
  assert.equal(staffPulseStatus(project, "2026-11-20"), "active");
  assert.equal(staffPulseStatus(project, "2026-11-21"), "active");
  assert.equal(staffPulseStatus({ ...project, delivery: deliveryDefaults }, "2026-11-21"), "other");
});

test("blocked and terminal projects do not inflate the current status count", () => {
  const blocked: StaffProjectSummary = { ...project, status: "active", deliveryMilestones: [
    { id: "review", title: "Review", date: "", completed: false, visible: false, status: "blocked" },
  ] };
  assert.equal(staffPulseStatus(blocked, "2026-11-20"), "blocked");
  assert.equal(staffPulseStatus({ ...blocked, status: "completed" }, "2026-11-20"), "completed");
  assert.equal(staffPulseStatus({ ...blocked, status: "closed" }, "2026-11-20"), "other");
});
