import test from "node:test";
import assert from "node:assert/strict";
import {
  demo,
  allocate,
  project,
  clientProjection,
  reconcile,
  persist,
  hours,
  validate,
} from "./model";
test("three-level relationships and agreement department capacity do not duplicate project plans", () => {
  const s = demo();
  validate(s);
  assert.equal(
    s.budgets.reduce((n, b) => n + b.minutes, 0),
    14400,
  );
  assert.equal(
    s.projects.reduce((n, p) => n + p.plan.minutes, 0),
    4800,
  );
  s.budgets[0].minutes++;
  assert.throws(() => validate(s));
});
test("eight source hours split five and three exactly once with immutable source", () => {
  const s = demo(),
    raw = structuredClone(s.raw);
  const n = allocate(
    s,
    "raw-demo",
    [
      { projectId: "delivery-0", seconds: 18000, description: "five" },
      { projectId: "delivery-1", seconds: 10800, description: "three" },
    ],
    "now",
  );
  assert.deepEqual(n.raw, raw);
  assert.equal(project(n).totalSeconds, 28800);
  assert.equal(project(n).unallocatedSeconds, 0);
});
test("partial allocations leave explicit unallocated hours; reject over-allocation", () => {
  const s = allocate(
    demo(),
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 900, description: "" }],
    "now",
  );
  assert.equal(project(s).unallocatedSeconds, 27900);
  assert.equal(hours(project(s).totalSeconds), "0.25");
  assert.throws(() =>
    allocate(
      s,
      "raw-demo",
      [{ projectId: "delivery-0", seconds: 28801, description: "" }],
      "later",
    ),
  );
});
test("source correction preserves allocation history and flags conflict without inflating totals", () => {
  let s = allocate(
    demo(),
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 28800, description: "" }],
    "now",
  );
  const history = structuredClone(s.allocations);
  s = reconcile(s, { ...s.raw[0], seconds: 18000, revision: "1" });
  assert.deepEqual(s.allocations, history);
  assert.deepEqual(project(s).conflicts, ["raw-demo"]);
  assert.equal(project(s).totalSeconds, 0);
});
test("publication excludes internal notes and hidden hours; recomputes from edits", () => {
  const s = allocate(
    demo(),
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 3600, description: "private" }],
    "now",
  );
  assert.equal(project(s).totalSeconds, 3600);
  assert.ok(!JSON.stringify(clientProjection(s)).includes("internalNotes"));
  s.projects[0].published = false;
  assert.equal(clientProjection(s).totalSeconds, 0);
});
test("stable identity survives source attachment and department rename", () => {
  const s = demo();
  s.links.push({
    projectId: s.projects[0].id,
    source: "synthetic-qbo",
    externalId: "new-source",
    label: "illustrative",
  });
  s.departments[1].name = "Renamed";
  validate(s);
  assert.equal(s.projects[0].id, "delivery-0");
  assert.equal(s.projects[0].departmentId, "health");
});
test("fixed training plans allow nonconsecutive sessions and milestone reopening history", () => {
  const s = demo();
  s.projects[0].trainingSessions = [
    { id: "one", date: "2026-10-01", minutes: 60 },
    { id: "two", date: "2026-10-15", minutes: 90 },
  ];
  s.milestones = [
    {
      projectId: "delivery-0",
      id: "m",
      due: "2026-10-16",
      note: "Done",
      done: true,
      at: "one",
    },
    {
      projectId: "delivery-0",
      id: "m",
      due: "2026-10-16",
      note: "Reopen",
      done: false,
      at: "two",
    },
  ];
  s.blockers = [
    {
      id: "b",
      projectId: "delivery-0",
      description: "Synthetic blocker",
      resolved: false,
    },
  ];
  validate(s);
  assert.equal(s.projects[0].plan.basis, "fixed");
  assert.equal(s.milestones.length, 2);
});
test("no-op allocation and persistence produce zero writes; no network dependency", () => {
  const s = demo();
  assert.equal(allocate(s, "raw-demo", [], "now"), s);
  let writes = 0;
  assert.equal(
    persist(
      {
        setItem() {
          writes++;
        },
      },
      s,
      structuredClone(s),
    ),
    false,
  );
  assert.equal(writes, 0);
});
import { recapInput, attachSource } from "./model";
test("recap and Nordic use identical decimal totals, including no-data and large values", () => {
  let s = allocate(
    demo(),
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 900, description: "" }],
    "now",
  );
  assert.equal(
    recapInput(s).projects.reduce((n, p) => n + p.months[0], 0),
    project(s).totalSeconds / 3600,
  );
  s.raw[0].seconds = 360000000;
  s = allocate(
    s,
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 360000000, description: "" }],
    "later",
  );
  assert.equal(recapInput(s).projects[0].months[0], 100000);
  s.projects[0].published = false;
  assert.equal(recapInput(s).projects[0].months[0], 0);
});
test("source attachment preserves stable project and history; duplicate external IDs rejected", () => {
  const s = allocate(
    demo(),
    "raw-demo",
    [{ projectId: "delivery-0", seconds: 900, description: "" }],
    "now",
  );
  const next = attachSource(s, {
    projectId: "delivery-0",
    source: "synthetic-qbo",
    externalId: "stable",
    label: "Demo",
  });
  assert.deepEqual(next.projects, s.projects);
  assert.deepEqual(next.allocations, s.allocations);
  assert.throws(() =>
    attachSource(next, {
      projectId: "delivery-1",
      source: "synthetic-qbo",
      externalId: "stable",
      label: "Duplicate",
    }),
  );
});
test("reserve capacity and latest monthly revisions are projected without project budget duplication", () => {
  const s = demo();
  s.agreements[0].caps.push({
    month: "2026-10",
    minutes: 15000,
    revision: 2,
    note: "Reserve",
  });
  assert.equal(project(s).agreements[0].reserveMinutes, 600);
});
test("auxiliary domain references, revisions and training basis fail validation", () => {
  const s = demo();
  s.assignments.push({ projectId: "missing", memberId: "missing" });
  assert.throws(() => validate(s));
  const t = demo();
  t.projects[0].plan.basis = "monthly";
  t.projects[0].trainingSessions.push({
    id: "session",
    date: "2026-10-01",
    minutes: 60,
  });
  assert.throws(() => validate(t));
});
