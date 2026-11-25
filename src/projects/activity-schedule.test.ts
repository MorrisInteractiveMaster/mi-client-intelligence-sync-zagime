import assert from "node:assert/strict";
import test from "node:test";
import { consecutiveDates, parseActivitySchedule } from "./activity-schedule";
import { deliveryDefaults, parseDelivery } from "./delivery";

test("date-only delivery activity preserves inclusive days across month and leap-year boundaries", () => {
  assert.deepEqual(consecutiveDates("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  assert.deepEqual(consecutiveDates("2026-11-25", "2026-11-24"), []);
  assert.deepEqual(consecutiveDates("2026-01-01", "2026-12-01"), []);
  assert.throws(() => parseActivitySchedule({ mode: "consecutive", dates: ["2028-02-28", "2028-03-01"] }));
});

test("separate activity dates and per-day venues stay distinct from lifecycle dates", () => {
  const delivery = parseDelivery({ ...deliveryDefaults, start: "2026-11-01", deadline: "2026-12-01", activity: {
    mode: "separate", dates: ["2026-11-22", "2026-11-15"], venues: [
      { date: "2026-11-22", venue: { kind: "virtual", details: " Staff instructions " } },
      { date: "2026-11-15", venue: { kind: "physical" } },
    ],
  } });
  assert.equal(delivery.start, "2026-11-01");
  assert.equal(delivery.deadline, "2026-12-01");
  assert.deepEqual(delivery.activity?.dates, ["2026-11-15", "2026-11-22"]);
  assert.equal(delivery.activity?.venues?.[1].venue.details, "Staff instructions");
  assert.throws(() => parseActivitySchedule({ mode: "separate", dates: ["2026-11-22", "2026-11-22"] }));
  assert.throws(() => parseActivitySchedule({ mode: "single", dates: ["2026-11-22"],
    sharedVenue: { kind: "not-applicable", details: "Should not be stored" } }));
});
