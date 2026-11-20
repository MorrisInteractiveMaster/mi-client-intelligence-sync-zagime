import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectReport } from "../projects/model";
import { chartRows, dotScale } from "./DotAnalytics";

const report: ProjectReport = {
  month: "2026-11",
  tenant: { id: "fixture", name: "Fixture" },
  totalSeconds: 4_500,
  projects: [
    {
      schemaVersion: 2, id: "monthly", name: "Monthly delivery", status: "active",
      progress: 30, description: "", lifetimeSeconds: 3_600, seconds: 3_600,
      plan: { basis: "monthly", targetSeconds: 7_200 },
    },
    {
      schemaVersion: 2, id: "fixed", name: "Fixed delivery", status: "completed",
      progress: 100, description: "", lifetimeSeconds: 9_000, seconds: 900,
      plan: { basis: "fixed", targetSeconds: 9_000 },
    },
  ],
};

test("chart comparisons pair monthly allocations with their own plans", () => {
  const rows = chartRows(report, "plan");
  assert.deepEqual(rows.map(row => [row.id, row.seconds, row.projectIds]), [
    ["allocated", 3_600, ["monthly"]],
    ["target", 7_200, ["monthly"]],
  ]);
  assert.deepEqual(chartRows({ ...report, projects: [] }, "trend"), []);
});

test("distribution and current month retain approved scope and integer seconds", () => {
  assert.deepEqual(chartRows(report, "distribution").map(row => [row.id, row.seconds, row.projectIds]), [
    ["unassigned", 4_500, ["monthly", "fixed"]],
  ]);
  assert.deepEqual(chartRows(report, "trend").map(row => [row.month, row.seconds]), [["2026-11", 4_500]]);
  assert.equal(dotScale(0), 1);
  assert.equal(dotScale(4_501, 48), 94);
});
