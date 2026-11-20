import test from "node:test";
import assert from "node:assert/strict";
import { precedingTimeMonth, reportingTimeMonth, timeBucket, timeWindow } from "./time-history";

test("Time windows anchor to reporting calendar months, quarters, annual periods and inclusive custom days", () => {
  assert.deepEqual(timeWindow("2028-02"), { kind: "month", start: "2028-02-01", end: "2028-02-29" });
  assert.deepEqual(timeWindow("2027-11", "quarter"), { kind: "quarter", start: "2027-10-01", end: "2027-12-31" });
  assert.deepEqual(timeWindow("2027-01", "year"), { kind: "year", start: "2027-01-01", end: "2027-12-31" });
  assert.deepEqual(timeWindow("2026-01", "all"), { kind: "all" });
  assert.deepEqual(timeWindow("2027-11", "range", "2023-01-14", "2025-03-05"),
    { kind: "range", start: "2023-01-14", end: "2025-03-05" });
  assert.throws(() => timeWindow("2026-01", "range", "2026-11-14", "2026-10-01"), /Invalid source period/);
  assert.throws(() => timeWindow("2026-01", "range", "2026-02-29", "2026-03-05"), /Invalid source period/);
  assert.throws(() => timeWindow("2026-01", "month", "2026-01-31"), /Invalid source period/);
});

test("Time presets change months at Regina midnight and group across year boundaries", () => {
  assert.equal(reportingTimeMonth(new Date("2027-01-01T05:59:00.000Z")), "2026-12");
  assert.equal(reportingTimeMonth(new Date("2027-01-01T06:00:00.000Z")), "2027-01");
  assert.equal(precedingTimeMonth("2027-01"), "2026-12");
  assert.deepEqual(timeBucket("2027-08-31", "quarter"), { id: "2027-3", label: "2027 Q3" });
  assert.deepEqual(timeBucket("2027-12-31", "year"), { id: "2027", label: "2027" });
});
