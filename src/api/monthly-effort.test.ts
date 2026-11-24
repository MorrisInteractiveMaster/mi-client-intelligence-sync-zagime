import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectReport } from "../projects/model";
import { monthlyEffort } from "./monthly-effort";

const month = "2026-11";
const project = (id: string, seconds: number): ProjectReport["projects"][number] => ({
  schemaVersion: 2, id, name: id, status: "active", progress: 0, description: "",
  plan: { basis: "fixed", targetSeconds: 0 }, seconds, lifetimeSeconds: seconds,
});
const fixture: ProjectReport = {
  month, totalSeconds: 7200, tenant: { id: "fixture", name: "Fixture" },
  projects: [project("finance", 3600), project("hr", 3600)],
  portfolio: {
    areas: [], engagements: [], placements: [], directory: [], narrative: "", action: "",
    history: [{ month: "2026-07", seconds: 0 }, { month: "2026-09", seconds: 10800 }, { month: "2026-10", seconds: 3600 }],
  },
  historyByProject: {
    finance: [{ month: "2026-09", seconds: 7200 }],
    hr: [{ month: "2026-09", seconds: 3600 }, { month: "2026-10", seconds: 3600 }],
    hidden: [{ month: "2026-09", seconds: 500000 }],
  },
};

test("portfolio months divide by the shared period total and keep calendar gaps distinct from zero", () => {
  const { label, from, through, rows } = monthlyEffort(fixture);
  assert.equal(label, "Share of selected-period effort");
  assert.equal(from, "2026-07");
  assert.equal(through, month);
  assert.deepEqual(rows.map(row => [row.month, row.seconds, row.denominator]),
    [["2026-07", 0, 21600], ["2026-08", undefined, 21600], ["2026-09", 10800, 21600],
      ["2026-10", 3600, 21600], [month, 7200, 21600]]);
  assert.deepEqual(rows.map(row => row.share), [0, undefined, 50, 3600 / 21600 * 100, 7200 / 21600 * 100]);
});

test("department and project filters use the whole authorized portfolio for each reported month", () => {
  const { label, rows } = monthlyEffort(fixture, ["finance", "finance", "hidden"]);
  assert.equal(label, "Share of monthly portfolio effort");
  assert.deepEqual(rows.map(row => [row.seconds, row.denominator, row.share]),
    [[0, 0, undefined], [undefined, undefined, undefined], [7200, 10800, 7200 / 10800 * 100],
      [0, 3600, 0], [3600, 7200, 50]]);
  assert.deepEqual(monthlyEffort(fixture, []).rows.map(row => row.share), [undefined, undefined, 0, 0, 0]);
});

test("old reports without project history do not imply expired periods had zero scoped effort", () => {
  const { rows } = monthlyEffort({ ...fixture, historyByProject: undefined }, ["finance"]);
  assert.equal(rows.find(row => row.month === "2026-09")?.seconds, undefined);
  assert.equal(rows.find(row => row.month === "2026-07")?.seconds, 0);
  assert.equal(rows.at(-1)?.share, 50);
  const empty = monthlyEffort({ ...fixture, portfolio: undefined, totalSeconds: 0, projects: [] });
  assert.deepEqual(empty.rows, [{ month, seconds: 0, denominator: 0, share: undefined }]);
});

test("the denominator includes only the visible calendar window and keeps an older selected reporting month", () => {
  const historical = { ...fixture, portfolio: { ...fixture.portfolio!,
    history: [...fixture.portfolio!.history, { month: "2023-01", seconds: 18000 }, { month: "2022-08", seconds: 9000 }] } };
  assert.equal(monthlyEffort(historical).rows.at(-1)?.denominator, 21600);
  const past = monthlyEffort({ ...historical, month: "2023-01", totalSeconds: 3661 });
  assert.equal(past.through, "2023-01");
  assert.deepEqual(past.rows.at(-1), { month: "2023-01", seconds: 3661, denominator: 12661, share: 3661 / 12661 * 100 });
});
