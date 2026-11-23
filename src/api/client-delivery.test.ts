import assert from "node:assert/strict";
import test from "node:test";
import { deliveryDate } from "../projects/delivery";
import { workOrderEffort } from "../projects/effort";
import type { ProjectReport } from "../projects/model";
import { clientDelivery, forProjectFilter, projectMeasures } from "./client-delivery";

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
  const source = { recorded: 74_700, allocated: 14_400 };
  const fixture = report([{
    ...project("engagement", 60_300),
    workOrderEffort: workOrderEffort(source, source, 0),
  }, project("previous-area"), project("Recruitment", 14_400), project("Other work", 3_600)],
  { engagement: { kind: "engagement" }, "previous-area": { kind: "service-area", parentId: "engagement" },
    Recruitment: { kind: "project", parentId: "previous-area" },
    "Other work": { kind: "project", parentId: "unpublished" } },
  [placement("engagement"), placement("Recruitment"), placement("Other work", "finance")]);
  const view = clientDelivery(fixture, "2026-11-23");
  assert.equal(view.counts.all, 2);
  assert.equal(view.parentRows.length, 1);
  assert.equal(view.parentRows[0].counts.all, 1);
  assert.equal(view.parentRows[0].seconds, 74_700);
  assert.deepEqual(view.departmentRows.map(row => [row.name, row.seconds, row.counts.all]), [
    ["HR", 14_400, 1], ["Finance", 3_600, 1],
  ]);
  assert.equal(view.projects.find(item => item.project.id === "Other work")!.parent, undefined);
  assert.equal(fixture.totalSeconds, 78_300);
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
  assert.equal(projectMeasures(project("Paused", 0, "paused"), date, undefined, boundary).active, false);
  for (const terminal of ["completed", "closed", "cancelled"] as const) {
    assert.equal(projectMeasures(project(terminal, 0, terminal), date, undefined, before).upcoming, false);
  }
  assert.equal(projectMeasures(project("Archived"), date, { ...placement("Archived"), archived: true }, before).upcoming, false);
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
