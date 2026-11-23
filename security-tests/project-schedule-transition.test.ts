import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { VerifiedIdentity } from "../server/contracts";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { portfolioRef } from "../server/portfolio";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectStore } from "../server/project-workspace";
import { clientDelivery, forProjectFilter } from "../src/api/client-delivery";
import { deliveryDate, type Delivery } from "../src/projects/delivery";
import { projectView, type ManagedProject, type Project } from "../src/projects/model";
import { newPortfolio } from "../src/projects/portfolio";

test("approved schedule status crosses Regina midnight without projecting private dates or mutating projects", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-regina-schedule";
  const root = runtime.db.collection("tenants").doc(tenant);
  const store = new ProjectStore(runtime.db, "owner");
  const before = Date.parse("2026-11-24T05:59:59Z");
  const boundary = Date.parse("2026-11-24T06:00:00Z");
  const dates = { start: "2026-11-24", deadline: "2026-12-19" };
  const identity = (subject: string): VerifiedIdentity => ({
    subject, issuer: "fixture", audience: "fixture", expiresAt: boundary + 60000,
    disabled: false, revoked: false, ...(subject === "owner" && { corporatePolicy: true, staffTenantId: tenant }),
  });
  const owner = identity("owner");
  const client = identity("client");
  const parentId = "synthetic-planning";
  const legacyId = "synthetic-delivery";
  const projectRef = (id: string) => root.collection("projects").doc(id);
  try {
    await seedProjectSynthetic(runtime.db, tenant, true);
    const portfolio = newPortfolio();
    portfolio.directory.push({
      id: "manager", name: "Fixture manager", role: "", responsibility: "", internalContact: "", publicContact: "",
      areaId: "hr", projectIds: [], order: 0, active: true, visible: true,
    });
    const parent: Project = {
      ...(await projectRef(parentId).get()).data() as Project,
      published: true, delivery: { kind: "engagement", structure: 2, type: "hourly", managerIds: [], teamIds: [] },
    };
    const legacy: Project = {
      ...(await projectRef(legacyId).get()).data() as Project,
      published: true, delivery: { ...dates, kind: "project", type: "hourly", managerIds: [], teamIds: [], publishSummary: false },
    };
    const setup = runtime.db.batch();
    setup.set(portfolioRef(root), { portfolio });
    for (const project of [parent, legacy]) {
      setup.set(projectRef(project.id), project);
      setup.set(root.collection("projectViews").doc(project.id), projectView(project, 0));
    }
    await setup.commit();

    const schedule: Delivery = {
      ...dates, kind: "project", structure: 3, parentId, areaId: "hr", type: "hourly",
      managerIds: ["manager"], teamIds: [], monthlyCap: 7200, publishStartStatus: true, publishSummary: false,
    };
    const body: ManagedProject = {
      name: "Scheduled delivery", description: "", internalNotes: "",
      status: "planned", progress: 0, plan: { basis: "fixed", targetSeconds: 0 }, delivery: schedule,
    };
    const create = (data: ManagedProject, publish: boolean) =>
      store.save(tenant, owner, data, { idempotency: before + "-" + randomUUID(), publishOnCreate: publish }, before);
    const approved = await create(body, true);
    const unpublished = await create({ ...body, name: "Unpublished delivery" }, false);
    await root.collection("memberships").doc(key(client.subject)).set({
      schemaVersion: 2, tenantId: tenant, subject: client.subject, role: "client", approved: true, enabled: true,
      projectIds: [parentId, legacyId, approved.id, unpublished.id],
    });
    await store.save(tenant, owner, {
      ...body, delivery: { ...schedule, start: "2026-12-01", publishSummary: true },
    }, { id: approved.id, expectedRevision: unpublished.revision }, before);

    const saved = (await projectRef(approved.id).get()).data()!;
    for (const [instant, phase] of [[before, "upcoming"], [boundary, "current"]] as const) {
      const report = await store.report(tenant, client, "2026-11", undefined, instant);
      assert.equal(report.hierarchy?.[approved.id].schedulePhase, phase);
      assert.equal(report.hierarchy?.[approved.id].start, undefined);
      assert.equal(report.hierarchy?.[approved.id].deadline, undefined);
      assert.equal(report.hierarchy?.[approved.id].monthlyCap, undefined);
      assert.equal(report.hierarchy?.[legacyId].schedulePhase, undefined);
      assert.equal(report.hierarchy?.[unpublished.id], undefined);
      assert.doesNotMatch(JSON.stringify(report), /2026-11-24|2026-12-19|2026-12-01|publishStartStatus|Unpublished delivery/);
      const overview = clientDelivery(report, deliveryDate(new Date(instant)));
      const expected = { all: 1, active: Number(phase === "current"), upcoming: Number(phase === "upcoming"), completed: 0, blocked: 0, near: 0 };
      assert.deepEqual(overview.parentRows.find(parent => parent.id === parentId)?.counts, expected);
      assert.deepEqual(overview.departmentRows.find(area => area.id === "hr")?.counts, expected);
      assert.equal(forProjectFilter(overview.projects.find(item => item.project.id === legacyId)!, "planned", 0), true);
    }
    const draft = await store.report(tenant, owner, "2026-11", { mode: "draft" }, boundary);
    assert.equal(draft.hierarchy?.[approved.id].start, "2026-12-01");
    assert.equal(draft.hierarchy?.[approved.id].monthlyCap, 7200);
    assert.deepEqual((await projectRef(approved.id).get()).data(), saved);
  } finally {
    await runtime.close();
  }
});
