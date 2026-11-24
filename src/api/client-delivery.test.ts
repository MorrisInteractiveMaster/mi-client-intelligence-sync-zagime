import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDate } from "../projects/delivery";
import type { ProjectReport } from "../projects/model";
import { clientDelivery, deadlineWindow, forProjectFilter, projectCompletionHistory, projectMeasures, publishedMonthlyCap } from "./client-delivery";

type Project = ProjectReport["projects"][number];
type Placement = NonNullable<ProjectReport["portfolio"]>["placements"][number];

function project(id: string, seconds = 0, status: Project["status"] = "active"): Project {
  return { schemaVersion: 2, id, status, name: id, progress: 0, description: "", plan: { basis: "monthly", targetSeconds: 0 },
    seconds, lifetimeSeconds: seconds };
}

function placement(id: string, areaId = "hr", engagementId = ""): Placement {
  return { id, areaId, engagementId, start: "", target: "", archived: false };
}

function report(projects: Project[], hierarchy: ProjectReport["hierarchy"], placements: Placement[] = []): ProjectReport {
  return {
    month: "2026-10", tenant: { id: "fixture", name: "Fixture" }, hierarchy, projects,
    totalSeconds: projects.reduce((total, item) => total + item.seconds, 0),
    portfolio: { areas: [{ id: "hr", name: "HR", description: "", order: 0, visible: true },
      { id: "finance", name: "Finance", description: "", order: 1, visible: true }], engagements: [], placements, directory: [],
    narrative: "", action: "", history: [] },
  };
}

test("engagement and department totals count authorized delivery projects and avoid duplicating automatic attribution", () => {
  const fixture = report([
    project("engagement", 3_600), project("previous-area"), project("Recruitment", 14_400),
    project("Other work", 3_600), project("Independent project", 900, "paused"),
  ],
  { engagement: { kind: "engagement" }, "previous-area": { kind: "service-area", parentId: "engagement" },
    Recruitment: { kind: "project", parentId: "previous-area" },
    "Other work": { kind: "project", parentId: "unpublished" } },
  [placement("Recruitment"), placement("Other work", "finance")]);
  const view = clientDelivery(fixture, "2026-11-23");
  assert.equal(view.counts.all, 3);
  assert.equal(view.parentRows.length, 1);
  assert.equal(view.parentRows[0].counts.all, 1);
  assert.equal(view.parentRows[0].seconds, 18_000);
  assert.deepEqual(view.departmentRows.map(row => [row.name, row.seconds, row.counts.all]), [
    ["HR", 14_400, 1], ["Finance", 3_600, 1],
  ]);
  assert.equal(view.projects.find(item => item.project.id === "Other work")!.parent, undefined);
  assert.deepEqual(view.unaffiliated.map(item => item.project.id), ["Other work", "Independent project"]);
  assert.equal(view.ungroupedSeconds, 4_500);
  assert.equal(fixture.totalSeconds, 22_500);
  assert.equal(view.departmentRows.reduce((sum, row) => sum + row.seconds, 0) + view.ungroupedSeconds, fixture.totalSeconds);
  assert.equal(view.projects.filter(item => forProjectFilter(item, "other", item.project.seconds)).length, 1);
  assert.equal(clientDelivery({ ...fixture, month: "2026-09" }, "2026-11-23").counts.all, view.counts.all);
});

test("upcoming changes at the start of the Regina date without mutating lifecycle state", () => {
  const before = deliveryDate(new Date("2026-11-24T05:59:59Z"));
  const boundary = deliveryDate(new Date("2026-11-24T06:00:00Z"));
  const date = { start: "2026-11-24" };
  const pending = projectMeasures(project("Policy"), date, undefined, before);
  assert.equal(pending.upcoming, true);
  assert.equal(pending.active, false);
  assert.equal(forProjectFilter(pending, "upcoming", 0), true);
  assert.equal(projectMeasures(project("Policy"), date, undefined, boundary).active, true);
  const planned = project("Scheduled", 0, "planned");
  assert.equal(projectMeasures(planned, date, undefined, before).upcoming, true);
  const current = projectMeasures(planned, date, undefined, boundary);
  assert.equal(forProjectFilter(current, "active", 0), true);
  assert.equal(forProjectFilter(current, "planned", 0), false);
  assert.equal(forProjectFilter(projectMeasures(planned, {}, undefined, boundary), "planned", 0), true);
  assert.equal(projectMeasures(project("Paused", 0, "paused"), date, undefined, before).upcoming, false);
  assert.equal(projectMeasures(project("Paused", 0, "paused"), date, undefined, boundary).active, false);
  for (const terminal of ["completed", "closed", "cancelled"] as const) {
    assert.equal(projectMeasures(project(terminal, 0, terminal), date, undefined, before).upcoming, false);
  }
  assert.equal(projectMeasures(project("Archived"), date, { ...placement("Archived"), archived: true }, before).upcoming, false);
});

test("status-only schedule transitions keep dates private and update parent and department counts", () => {
  const scheduled = project("Scheduled delivery", 0, "planned");
  for (const phase of ["upcoming", "current"] as const) {
    const fixture = report([project("parent"), scheduled], {
      parent: { kind: "engagement" },
      [scheduled.id]: { kind: "project", parentId: "parent", schedulePhase: phase },
    }, [placement(scheduled.id)]);
    const overview = clientDelivery(fixture, "2026-11-24");
    const [item] = overview.projects;
    assert.equal(item.start, undefined);
    assert.equal(item.upcoming, phase === "upcoming");
    assert.equal(item.active, phase === "current");
    assert.equal(forProjectFilter(item, "planned", 0), false);
    const counts = { all: 1, upcoming: Number(phase === "upcoming"), active: Number(phase === "current"), completed: 0, blocked: 0, near: 0 };
    assert.deepEqual(overview.parentRows[0].counts, counts);
    assert.deepEqual(overview.departmentRows.find(row => row.id === "hr")!.counts, counts);
    assert.equal(item.project.status, "planned");
  }
});

test("near-completion bounds and risk rankings use only approved progress, blockers and due dates", () => {
  const fixture = report([project("Just below"), project("Near"), project("Complete", 0, "completed"),
    project("Unconfigured"), project("Overdue"), project("Blocked"), project("Soon")],
  { "Just below": { completion: 69 }, Near: { completion: 70 }, Complete: { completion: 100 },
    Overdue: { deadline: "2026-11-17" },
    Blocked: { completion: 82, blocker: { active: true, message: "Awaiting approval" } },
    Soon: { deadline: "2026-12-03" } });
  const view = clientDelivery(fixture, "2026-11-23");
  assert.deepEqual(view.progress.filter(item => item.near).map(item => item.project.id), ["Blocked", "Near"]);
  assert.deepEqual(view.risks.map(item => item.project.id), ["Blocked", "Overdue"]);
  assert.equal(view.risks[0].risk, "Awaiting approval");
  assert.match(view.risks[1].risk!, /Expected completion was/);
  assert.equal(view.projects.find(item => item.project.id === "Soon")?.dueSoon, true);
  assert.equal(view.progress.some(item => item.project.id === "Unconfigured"), false);
});

test("approved legacy branch effort stays in the department total with no phantom delivery project", () => {
  const fixture = report([project("parent", 1_200), project("department", 1_800)], {
    parent: { kind: "engagement" }, department: { kind: "service-area", parentId: "parent" },
  }, [placement("department")]);
  const view = clientDelivery(fixture, "2026-11-23");
  assert.equal(view.counts.all, 0);
  assert.equal(view.parentRows[0].seconds, 3_000);
  assert.equal(view.ungroupedSeconds, 1_200);
  assert.deepEqual(view.departmentRows.map(row => [row.name, row.seconds, row.counts.all]), [
    ["HR", 1_800, 0], ["Finance", 0, 0],
  ]);
});

test("completion trends use published dated completions and never infer an active history", () => {
  const fixture = report([
    project("October completion", 0, "completed"), project("Legacy closeout", 0, "closed"),
    project("Date private", 0, "completed"), project("Still active", 0, "active"),
    project("Future date", 0, "completed"), project("Unusable date", 0, "completed"),
  ], {
    "October completion": { completedOn: "2026-10-31" },
    "Legacy closeout": { completedOn: "2026-09-01" },
    "Still active": { completedOn: "2026-11-05" },
    "Future date": { completedOn: "2027-01-06" },
    "Unusable date": { completedOn: "2026-02-31" },
  });
  const { projects } = clientDelivery(fixture, "2026-11-23");
  assert.deepEqual(projectCompletionHistory(projects, "2026-11-23").map(bucket => [bucket.month, bucket.projects.map(entry => entry.id)]), [
    ["2026-09", ["Legacy closeout"]], ["2026-10", ["October completion"]],
  ]);
});

test("deadline horizons advance in Regina calendar months and keep private dates excluded", () => {
  const now = deliveryDate(new Date("2027-02-01T05:30:00Z"));
  assert.equal(now, "2027-01-31");
  const view = clientDelivery(report([
    project("january"), project("april"), project("may"), project("private"),
    project("completed", 0, "completed"), project("engagement"),
  ], {
    january: { deadline: "2027-01-30" }, april: { deadline: "2027-04-30" }, may: { deadline: "2027-05-01" },
    completed: { deadline: "2027-01-28", completedOn: "2027-01-29" },
    engagement: { kind: "engagement", deadline: "2027-02-01" },
  }), now);
  assert.deepEqual(([3, 6, 9, 12] as const).map(months => deadlineWindow(view.projects, now, months).through),
    ["2027-04-30", "2027-07-31", "2027-10-31", "2028-01-31"]);
  const first = deadlineWindow(view.projects, now, 3);
  assert.deepEqual(first.rows.map(row => [row.project.id, row.days]), [["january", -1], ["april", 89]]);
  assert.equal(first.unscheduled, 1);
  assert.deepEqual(first.completed.map(item => [item.id, item.late]), [["completed", true]]);
  assert.equal(deadlineWindow(view.projects, now, 6).rows.at(-1)?.project.id, "may");
});

test("published cap aggregation keeps nested caps out and preserves zero and over-cap inputs", () => {
  const view = clientDelivery(report([project("parent"), project("child"), project("uncapped"), project("zero")], {
    parent: { kind: "engagement", monthlyCap: 3600, monthlyCapUsed: 4500 },
    child: { parentId: "parent", monthlyCap: 1800, monthlyCapUsed: 1800 },
    zero: { monthlyCap: 0, monthlyCapUsed: 0 },
  }));
  assert.deepEqual(publishedMonthlyCap(view), { count: 2, cap: 3600, used: 4500 });
  assert.deepEqual(publishedMonthlyCap(clientDelivery(report([project("uncapped")], {}))), { count: 0, cap: 0, used: 0 });
});
