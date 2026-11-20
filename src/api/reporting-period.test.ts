import test from "node:test";
import assert from "node:assert/strict";
import { followingTimeMonth, readReportingRange, reportingMonthOptions } from "./reporting-period";
import { reportingTimeMonth } from "../projects/time-history";

test("reporting months include scoped later months and use Regina calendar navigation", () => {
  assert.equal(followingTimeMonth("2025-12"), "2026-01");
  assert.equal(reportingTimeMonth(new Date("2026-11-01T05:59:59Z")), "2026-10");
  assert.equal(reportingTimeMonth(new Date("2026-11-01T06:00:00Z")), "2026-11");
  assert.deepEqual(reportingMonthOptions("2026-10", "2026-11", ["2026-09", "2026-11", "2026-12", "unexpected"]),
    ["2026-09", "2026-10", "2026-11"]);
});

test("reporting history presets and custom ranges are URL-scoped and reject future or inverted ranges", () => {
  const range = (query: string) => readReportingRange(new URLSearchParams(query), "2026-11");
  assert.deepEqual(range("period-scope=year"), { preset: "year", from: "2026-01", through: "2026-11" });
  assert.deepEqual(range("period-scope=last-year"), { preset: "last-year", from: "2025-01", through: "2025-12" });
  assert.deepEqual(range("period-scope=all"), { preset: "all" });
  assert.deepEqual(range("period-scope=custom&from-month=2026-09&through-month=2026-11"),
    { preset: "custom", from: "2026-09", through: "2026-11" });
  assert.equal(range("period-scope=custom&from-month=2026-11&through-month=2026-10"), undefined);
  assert.equal(range("period-scope=custom&from-month=2026-10&through-month=2026-12"), undefined);
});
