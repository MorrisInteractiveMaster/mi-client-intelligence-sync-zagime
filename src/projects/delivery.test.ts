import test from "node:test";
import assert from "node:assert/strict";
import { checkHierarchy, deliveryDefaults, MAX_PROJECT_DEPTH, measureDelivery, parseDelivery, rollup } from "./delivery";

test("forty delivery projects roll up to their department and root exactly once", () => {
  const parent = (id: string, parentId?: string, seconds = 0) => ({ id, seconds, lifetimeSeconds: seconds * 3, delivery: { ...deliveryDefaults, parentId } });
  const projects = [parent("engagement", undefined, 1800), parent("hr", "engagement", 600),
    ...Array.from({ length: 40 }, (_, index) => parent("work-" + index, "hr", 900))];
  const graph = new Map(projects.map(p => [p.id, p.delivery.parentId]));
  checkHierarchy(graph);
  const totals = rollup(projects);
  assert.deepEqual(totals.get("engagement"), { monthly: 38_400, lifetime: 115_200, descendants: 41 });
  assert.deepEqual(totals.get("hr"), { monthly: 36_600, lifetime: 109_800, descendants: 40 });
  graph.set("engagement", "work-0");
  assert.throws(() => checkHierarchy(graph), /hierarchy/);
  assert.throws(() => checkHierarchy(new Map([["project", "missing"]])), /hierarchy/);
  assert.throws(() => checkHierarchy(new Map(Array.from({ length: MAX_PROJECT_DEPTH + 1 }, (_, i) => [String(i), i ? String(i - 1) : undefined]))), /hierarchy/);
});

test("milestone weights, cap consumption and schedule produce independent outcomes", () => {
  const delivery = parseDelivery({ ...deliveryDefaults, type: "fixed-fee", monthlyCap: 3600, lifetimeCap: 7200, deadline: "2026-12-01" });
  const project = { progress: 100, status: "active", delivery, milestones: [
    { completed: true, weight: 1, date: "2026-11-01" },
    { completed: false, weight: 3, date: "", status: "blocked" as const },
    { completed: false, weight: 10, date: "2026-11-01", status: "waived" as const },
  ] };
  const spent = measureDelivery(project, { monthly: 3600, lifetime: 7200 }, "2026-11-26");
  assert.deepEqual(spent, { completion: 25, monthlyRemaining: 0, lifetimeRemaining: 0, upcoming: "2026-12-01", health: "Attention needed" });
  assert.equal(measureDelivery(project, { monthly: 10, lifetime: 10 }, "2026-12-02").health, "Overdue");
  assert.equal(measureDelivery(project, { monthly: 3700, lifetime: 7200 }, "2026-11-02").health, "Over budget");
  assert.equal(measureDelivery({ ...project, milestones: [] }, { monthly: 0, lifetime: 0 }, "2026-11-01").completion, undefined);
});

test("training and project settings support independent links and multiple assignments", () => {
  const training = parseDelivery({ ...deliveryDefaults, parentId: "parent", areaId: "hr", type: "training",
    managerIds: ["first", "second"], teamIds: ["one", "two"], workOrderIds: ["132160684", "135372950"],
    training: { days: 3, dates: ["2026-12-05", "2026-12-03"], facilitatorIds: ["one"] } });
  assert.equal(training.managerIds.length, 2);
  assert.deepEqual(training.training?.dates, ["2026-12-03", "2026-12-05"]);
  for (const data of [
    { monthlyCap: -1 }, { managerIds: ["one", "one"] }, { workOrderIds: ["bad"] },
    { training: { days: 1, dates: ["2026-12-35"], facilitatorIds: [] } }, { start: "2026-12-20", deadline: "2026-12-01" },
  ]) assert.throws(() => parseDelivery({ ...training, ...data }));
});
