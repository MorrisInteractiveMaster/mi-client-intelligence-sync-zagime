import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectReport } from "../projects/model";
import { clientDelivery } from "./client-delivery";
import { completionBand, explorerResults, milestoneState } from "./project-explorer";

const date = "2026-11-24";
function fixture(count: number) {
  const parent = { id: "parent", schemaVersion: 2 as const, name: "Board engagement", status: "active" as const,
    progress: 0, description: "", plan: { basis: "fixed" as const, targetSeconds: 0 }, seconds: 0, lifetimeSeconds: 0 };
  const projects = Array.from({ length: count }, (_, i) => ({ ...parent, id: "p" + i, name: "Project " + (i + 1),
    status: i % 2 ? "completed" as const : "active" as const }));
  const report: ProjectReport = {
    month: "2026-11", tenant: { id: "synthetic", name: "Synthetic" }, totalSeconds: 0, projects: [parent, ...projects],
    hierarchy: {
      parent: { kind: "engagement" }, ...Object.fromEntries(projects.map((row, i) => [row.id, { parentId: "parent", kind: "project",
        completion: i % 2 ? 100 : undefined, completedOn: i % 2 ? date : undefined }])),
    },
    portfolio: {
      areas: [{ id: "hr", name: "HR", description: "", visible: true, order: 0 }, { id: "finance", name: "Finance", description: "", visible: true, order: 1 }],
      placements: projects.map((row, i) => ({ id: row.id, areaId: i % 2 ? "finance" : "hr", engagementId: "", start: "", target: "", archived: false })),
      engagements: [], directory: [], narrative: "", action: "", history: [],
    },
  };
  return clientDelivery(report, date);
}

test("6, 100 and 300 approved deliveries paginate with zero effort and exclude the parent engagement", () => {
  for (const count of [6, 100, 300]) {
    const delivery = fixture(count);
    const result = explorerResults(delivery.projects, new URLSearchParams("explorer-size=50&explorer-page=900"), date);
    assert.equal(result.matches.length, count);
    assert.equal(result.pages, Math.ceil(count / 50));
    assert.equal(result.page, result.pages);
    assert.equal(result.visible.at(-1)?.project.name, "Project " + count);
    assert.equal(delivery.departmentRows.reduce((sum, item) => sum + item.counts.all, 0), count);
    assert.equal(delivery.departmentRows.every(item => item.seconds === 0), true);
  }
});

test("project explorer applies combined department, parent, status, completion and verified-month filters", () => {
  const { projects } = fixture(300);
  const params = new URLSearchParams("q=board+engagement&explorer-department=finance&explorer-parent=parent&status=completed&explorer-completion=complete&explorer-completed-month=2026-11&explorer-size=10&project-sort=completion");
  assert.equal(explorerResults(projects, params, date).matches.length, 150);
  params.set("explorer-deadline", "overdue");
  assert.equal(explorerResults(projects, params, date).matches.length, 0);
  assert.deepEqual([undefined,0,25,26,50,51,75,76,99,100].map(completionBand),
    ["unassessed","low","low","quarter","quarter","half","half","near","near","complete"]);
  assert.equal(milestoneState({ id: "m", title: "Fixture", completed: false, date: "2026-11-14" }, date), "overdue");
});
