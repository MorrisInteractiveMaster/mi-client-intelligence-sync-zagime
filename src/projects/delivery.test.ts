import test from "node:test";
import assert from "node:assert/strict";
import { canAllocateToDelivery, capRollup, checkDeliveryStructure, checkHierarchy, deliveryDefaults, MAX_PROJECT_DEPTH, measureDelivery, parseDelivery, rollup, type Delivery } from "./delivery";

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

test("explicit delivery hierarchies bind service-area decisions and retain existing legacy shapes", () => {
  const make = (kind: Delivery["kind"], parentId?: string, areaId?: string) =>
    parseDelivery({ ...deliveryDefaults, structure: 2, kind, parentId, areaId });
  const valid = new Map([
    ["engagement", make("engagement")], ["direct", make("project", "engagement")],
    ["area", make("service-area", "engagement", "health")], ["project", make("project", "area", "health")],
    ["legacy", deliveryDefaults], ["legacy-child", { ...deliveryDefaults, parentId: "legacy" }],
  ]);
  checkDeliveryStructure(valid);
  for (const next of [make("project"), make("project", "area", "hr"), make("project", "direct"),
    make("service-area", "area", "health"), make("engagement", "project")])
    assert.throws(() => checkDeliveryStructure(new Map([...valid, ["new", next]])), /hierarchy/);
  assert.equal(canAllocateToDelivery(valid.get("area")), false);
  assert.equal(canAllocateToDelivery(valid.get("direct")), true);
  assert.equal(canAllocateToDelivery({ ...valid.get("engagement")!, allowDirectAllocation: false }), false);
  assert.equal(canAllocateToDelivery(undefined), true);
});

test("excluding an allocation from an engagement cap preserves all effort and the department cap", () => {
  const make = (id: string, seconds: number, delivery: Delivery) => ({ id, seconds, lifetimeSeconds: seconds * 3, delivery });
  const rows = [
    make("parent", 1800, { ...deliveryDefaults, structure: 2, kind: "engagement", monthlyCap: 36_000, lifetimeCap: 72_000 }),
    make("department", 0, { ...deliveryDefaults, structure: 2, kind: "service-area", parentId: "parent", areaId: "hr", monthlyCap: 20_000 }),
    make("first", 10_800, { ...deliveryDefaults, structure: 2, parentId: "department", areaId: "hr" }),
    make("second", 7200, { ...deliveryDefaults, structure: 2, parentId: "department", areaId: "hr", countAgainstParentCap: false }),
    make("direct", 900, { ...deliveryDefaults, structure: 2, parentId: "parent" }),
  ];
  const effort = rollup(rows);
  const budgets = capRollup(rows);
  assert.deepEqual(effort.get("parent"), { monthly: 20_700, lifetime: 62_100, descendants: 4 });
  assert.deepEqual(budgets.get("parent"), { monthly: 13_500, lifetime: 40_500, descendants: 4 });
  assert.deepEqual(budgets.get("department"), effort.get("department"));
  const parent = measureDelivery({ ...rows[0], progress: 0, status: "active" }, budgets.get("parent")!, "2026-11-20");
  assert.equal(parent.monthlyRemaining, 22_500);
  assert.equal(parent.lifetimeRemaining, 31_500);
  assert.equal(parent.completion, undefined);
});
