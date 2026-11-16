import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fixtureTotals,
  applyFixtureChanges,
  type FixtureTime,
} from "./fixtures";
const read = (p: string) =>
  JSON.parse(fs.readFileSync("fixtures/synthetic-qbo/" + p, "utf8"));
const entries: FixtureTime[] =
  read("timeActivity.json").QueryResponse.TimeActivity;
const mapping = read("explicit-project-mappings.json");
test("old QBO fixture compatibility: entry count, hours and monthly totals", () => {
  assert.equal(entries.length, 593);
  const t = fixtureTotals(entries, mapping);
  assert.equal(t.seconds / 3600, 1054);
  assert.deepEqual(
    Object.values(t.months).map((x) => x / 3600),
    [72, 129, 178, 195, 216, 264],
  );
  assert.ok(!mapping["101"]);
  assert.ok(!mapping["151"]);
});
test("old fixture preserves twins and quarter-hour records", () => {
  assert.equal(
    entries.filter((e) => ["1366", "1371"].includes(e.Id)).length,
    2,
  );
  assert.equal(
    entries.filter((e) => e.Hours === 0 && e.Minutes === 15).length,
    11,
  );
});
test("old CDC compatibility: correction, deletion, additions and replay", () => {
  const changes: FixtureTime[] = read("cdcChanges.json").CDCResponse.flatMap(
    (c: any) => c.QueryResponse.flatMap((q: any) => q.TimeActivity ?? []),
  );
  const first = applyFixtureChanges(entries, changes);
  assert.equal(fixtureTotals(first.entries, mapping).seconds / 3600, 1056.5);
  assert.equal(applyFixtureChanges(first.entries, changes).writes, 0);
});
for (const [name, total] of Object.entries({
  earlyDays: 110,
  busyYear: 4041,
  toughQuarter: 961,
  wrappingUp: 940,
}))
  test("old fixture variant " + name, () => {
    const customers = read("variants/" + name + "/customers.json").QueryResponse
      .Customer;
    const mappings = Object.fromEntries(
      customers
        .filter((c: any) => c.ParentRef)
        .map((c: any) => [c.Id, "fixture-" + c.Id]),
    );
    assert.equal(
      fixtureTotals(
        read("variants/" + name + "/timeActivity.json").QueryResponse
          .TimeActivity,
        mappings,
      ).seconds / 3600,
      total,
    );
  });
