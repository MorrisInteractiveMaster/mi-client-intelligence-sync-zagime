import assert from "node:assert/strict";
import test from "node:test";
import { managedProject, publicProject, type ManagedProject, type ProjectView } from "./model";

const blockedMilestone = {
  id: "client-review",
  title: "Client review",
  date: "",
  completed: false,
  status: "blocked" as const,
  visible: true,
  blocker: { message: "Waiting for approval", internal: "Private staff detail", blockedOn: "2026-11-05" },
};
const project = {
  name: "Illustrative work",
  description: "",
  status: "active",
  progress: 0,
  internalNotes: "Private project detail",
  plan: { basis: "monthly", targetSeconds: 0 },
} satisfies ManagedProject;

test("milestone blocker and completion dates round-trip while private details stay out of reports", () => {
  const completed = { ...blockedMilestone, completed: true, status: "completed" as const, completedAt: "2026-11-15",
    blocker: { ...blockedMilestone.blocker, resolvedOn: "2026-11-14" } };
  assert.deepEqual(managedProject({ ...project, milestones: [blockedMilestone] }).milestones, [blockedMilestone]);
  assert.deepEqual(managedProject({ ...project, milestones: [completed] }).milestones, [completed]);
  assert.throws(() => managedProject({ ...project, milestones: [{ ...blockedMilestone, blocker: { ...blockedMilestone.blocker,
    resolvedOn: "2026-11-14" } }] }), /Invalid milestone blocker/);
  assert.throws(() => managedProject({ ...project, milestones: [{ ...completed, completedAt: "2026-11-31" }] }), /Invalid project milestone/);
  const view = { ...project, schemaVersion: 2, id: "project", tenantId: "tenant", published: true, lifetimeSeconds: 0,
    milestones: [completed, { ...blockedMilestone, id: "private", visible: false }] } as unknown as ProjectView;
  const report = publicProject(view, 0);
  assert.equal(report.milestones?.length, 1);
  assert.deepEqual(report.milestones?.[0].blocker, {
    message: "Waiting for approval", blockedOn: "2026-11-05", resolvedOn: "2026-11-14",
  });
  assert.equal(report.milestones?.[0].completedAt, "2026-11-15");
  assert.doesNotMatch(JSON.stringify(report), /Private/);
});
