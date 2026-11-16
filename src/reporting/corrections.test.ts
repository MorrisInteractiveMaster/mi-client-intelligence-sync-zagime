import test from "node:test";
import assert from "node:assert/strict";
import {
  demo,
  allocate,
  project,
  clientProjection,
  recapInput,
  reconcile,
  attachSource,
  type ReportingState,
} from "./model";
function scenario() {
  let s = demo();
  s.agreements.push({
    ...structuredClone(s.agreements[0]),
    id: "agreement-two",
    name: "Second synthetic agreement",
  });
  for (const month of ["2026-09", "2026-10"]) {
    if (month === "2026-09")
      for (const a of s.agreements)
        a.caps.push({ month, minutes: 12000, revision: 1, note: "September" });
    for (const agreementId of ["agreement-demo", "agreement-two"]) {
      if (month === "2026-10" && agreementId === "agreement-demo") continue;
      for (const departmentId of ["hr", "health", "cfw"])
        s.budgets.push({ agreementId, departmentId, month, minutes: 4000 });
    }
  }
  s.projects.push({
    ...structuredClone(s.projects[0]),
    id: "project-two",
    agreementId: "agreement-two",
    name: "Second training project",
    trainingSessions: [
      { id: "s1", date: "2026-09-12", minutes: 60 },
      { id: "s2", date: "2026-10-14", minutes: 90 },
    ],
  });
  s.raw.push({
    ...s.raw[0],
    id: "september",
    date: "2026-09-12",
    seconds: 14400,
  });
  s = allocate(
    s,
    "raw-demo",
    [
      { projectId: "delivery-0", seconds: 18000, description: "" },
      { projectId: "project-two", seconds: 7200, description: "" },
    ],
    "oct",
  );
  s = allocate(
    s,
    "september",
    [{ projectId: "project-two", seconds: 10800, description: "" }],
    "sep",
  );
  return s;
}
test("monthly portfolio and agreement-department totals partition split source time once", () => {
  const s = scenario();
  const oct = project(s, { month: "2026-10" });
  assert.equal(oct.totalSeconds, 25200);
  assert.equal(oct.unallocatedSeconds, 3600);
  assert.equal(oct.agreements[0].seconds, 18000);
  assert.equal(oct.agreements[1].seconds, 7200);
  assert.deepEqual(
    oct.departments.filter((d) => d.id === "health").map((d) => d.seconds),
    [18000, 7200],
  );
  assert.equal(
    oct.agreements.reduce((n, a) => n + a.seconds, 0),
    oct.totalSeconds,
  );
});
test("historical months stay distinct and fixed training lifetime spans periods", () => {
  const s = scenario();
  const sep = project(s, { month: "2026-09" }),
    oct = project(s, { month: "2026-10" });
  assert.equal(sep.totalSeconds, 10800);
  assert.equal(sep.unallocatedSeconds, 3600);
  const training = oct.projects.find((p) => p.id === "project-two")!;
  assert.equal(training.seconds, 7200);
  assert.equal(training.lifetimeSeconds, 18000);
  assert.equal(training.plan.basis, "fixed");
  assert.equal(training.plan.minutes, 1800);
  assert.equal(recapInput(s, { month: "2026-09" }).projects[1].months[0], 3);
});
test("agreement filter scopes portions, budgets and explicitly mapped source remainders", () => {
  let s = scenario();
  s = attachSource(s, {
    agreementId: "agreement-demo",
    source: "synthetic-qbo",
    externalId: "external-demo",
    label: "Umbrella",
    verified: true,
  });
  const a = project(s, { month: "2026-10", agreementId: "agreement-demo" });
  assert.equal(a.agreements.length, 1);
  assert.equal(a.totalSeconds, 18000);
  assert.equal(a.unallocatedSeconds, 3600);
  assert.equal(a.departments.find((d) => d.id === "health")!.seconds, 18000);
  assert.equal(
    project(s, { month: "2026-10", agreementId: "agreement-two" })
      .unallocatedSeconds,
    0,
  );
});
test("source correction review is month-scoped, audited and manual revisions survive", () => {
  let s = scenario();
  const manual = structuredClone(s.allocations);
  s = reconcile(s, {
    ...s.raw.find((r) => r.id === "september")!,
    seconds: 3600,
    revision: "1",
  });
  assert.deepEqual(s.allocations, manual);
  assert.deepEqual(project(s, { month: "2026-09" }).conflicts, ["september"]);
  assert.deepEqual(project(s, { month: "2026-10" }).conflicts, []);
  assert.equal(project(s, { month: "2026-09" }).unallocatedSeconds, 3600);
  assert.equal(s.sourceCorrections![0].previous.revision, "0");
  assert.equal(s.sourceCorrections![0].previous.seconds, 14400);
  assert.equal(s.sourceCorrections![0].next.seconds, 3600);
  assert.equal(s.sourceCorrections![0].next.revision, "1");
});
test("stale and equal conflicting source revisions fail; identical replay is no-op", () => {
  const s = scenario(),
    r = s.raw[0];
  assert.equal(reconcile(s, { ...r }), s);
  const next = reconcile(s, { ...r, seconds: r.seconds + 900, revision: "2" });
  assert.throws(() => reconcile(next, { ...r, revision: "1" }), /Stale/);
  assert.throws(() => reconcile(next, { ...r, revision: "2" }), /Stale/);
  assert.equal(next.sourceCorrections!.length, 1);
});
test("agreement umbrella mapping supports multiple granular allocations without fabricated project links", () => {
  let s = scenario();
  s = attachSource(s, {
    agreementId: "agreement-demo",
    source: "synthetic-qbo",
    externalId: "umbrella-id",
    label: "Illustrative",
    verified: true,
  });
  s = allocate(
    s,
    "raw-demo",
    [
      { projectId: "delivery-0", seconds: 18000, description: "" },
      { projectId: "delivery-1", seconds: 10800, description: "" },
    ],
    "now",
  );
  assert.equal(s.links.filter((l) => l.projectId).length, 0);
  assert.equal(project(s).totalSeconds, 28800);
  const before = structuredClone(s.projects);
  s = attachSource(s, {
    projectId: "delivery-1",
    source: "synthetic-qbo",
    externalId: "specific-id",
    label: "Later",
    verified: true,
  });
  assert.deepEqual(s.projects, before);
  assert.throws(() =>
    attachSource(s, {
      agreementId: "agreement-two",
      source: "synthetic-qbo",
      externalId: "umbrella-id",
      label: "Ambiguous",
    }),
  );
});
test("client projection excludes raw identities, correction cases and unpublished details", () => {
  let s = scenario();
  s.projects[0].published = false;
  s.projects[0].name = "SECRET PROJECT";
  s.projects[0].internalNotes = "SECRET NOTES";
  s = reconcile(s, { ...s.raw[0], seconds: 3600, revision: "1" });
  const client = clientProjection(s);
  const text = JSON.stringify(client);
  for (const forbidden of [
    "SECRET",
    "sourcePersonId",
    "sourceWorkOrderId",
    "conflicts",
    "sourceCorrections",
    "unallocatedSeconds",
    "raw-demo",
  ])
    assert.ok(!text.includes(forbidden), forbidden);
  assert.equal(client.totalSeconds, 0);
  assert.ok(project(s).conflicts.includes("raw-demo"));
});
test("invalid reporting scopes are rejected; caps and plans are separate", () => {
  const s = scenario();
  assert.throws(() => project(s, { month: "2026-13" }));
  assert.throws(() => project(s, { month: "2026-10", agreementId: "missing" }));
  const oct = project(s);
  assert.equal(
    oct.agreements.reduce((n, a) => n + a.capMinutes, 0),
    28800,
  );
  assert.equal(
    oct.projects.reduce((n, p) => n + p.plan.minutes, 0),
    6600,
  );
});
