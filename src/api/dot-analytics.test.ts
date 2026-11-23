import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectReport } from "../projects/model";
import { axisMaximum, chartRows, comparableYears } from "./reporting-chart-data";

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
  assert.equal(axisMaximum(0), 3600);
  assert.equal(axisMaximum(4_501), 7200);
  assert.equal(axisMaximum(106, "percent"), 200);
});

test("year comparison aligns months and preserves unavailable versus zero values", () => {
  const rows = [
    { id: "2025-11", label: "November 2025", month: "2025-11", seconds: 0, projectIds: [] },
    ...chartRows(report, "trend"),
  ];
  const comparison = comparableYears(report.month, rows);
  assert.equal(comparison.length, 11);
  assert.equal(comparison[0].prior, undefined);
  assert.equal(comparison[10].prior?.seconds, 0);
  assert.equal(comparison[10].current?.seconds, 4500);
});

test("historical chart stays chronological and preserves later buckets while a historical month is open", () => {
  const history = { areas: [], engagements: [], placements: [], directory: [], narrative: "", action: "",
    history: [{ month: "2026-11", seconds: 12_600 }, { month: "2026-09", seconds: 7_200 }, { month: "2026-10", seconds: 100 }] };
  const historical = { ...report, month: "2026-10", portfolio: history };
  assert.deepEqual(chartRows(historical, "trend").map(row => [row.month, row.seconds]), [
    ["2026-09", 7200], ["2026-10", 4500], ["2026-11", 12600],
  ]);
  assert.deepEqual(chartRows(historical, "trend", { from: "2026-11", through: "2026-11" }).map(row => row.month), ["2026-11"]);
});

test("distribution includes only authorized approved allocations even if sent optional staff work-order metadata", () => {
  const portfolio = { areas: [{ id: "hr", name: "HR", description: "", order: 0, visible: true }], directory: [],
    engagements: [], placements: [{ id: "monthly", areaId: "hr", engagementId: "", start: "", target: "", archived: false }],
    narrative: "", action: "", history: [] };
  const projects = [{ ...report.projects[0], seconds: 1_800, workOrderEffort: {
    recordedSeconds: 5_400, remainingSeconds: 3_600, assignedSeconds: 1_800,
    lifetimeRecordedSeconds: 5_400, lifetimeRemainingSeconds: 3_600,
  } }];
  assert.deepEqual(chartRows({ ...report, projects, portfolio, totalSeconds: 1_800 }, "distribution").map(row => [row.id, row.seconds]), [
    ["hr", 1800],
  ]);
});
