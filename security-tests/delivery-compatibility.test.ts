import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import type { ReportingBackend } from "../server/backend";
import { sourceRecordId } from "../server/contracts";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { apiServer } from "../server/http";
import { portfolioRef } from "../server/portfolio";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { timeMapping, timeRun } from "../server/time-catalog";
import { TimeClient } from "../server/time-client";
import { TimeSync } from "../server/time-sync";
import { timeTotalsWrite } from "../server/time-totals";
import { clientDelivery } from "../src/api/client-delivery";
import { deliveryDefaults, type Delivery } from "../src/projects/delivery";
import { projectView, type ManagedProject, type Project, type ProjectReport } from "../src/projects/model";
import { newPortfolio } from "../src/projects/portfolio";
import type { TimeStatus } from "../src/projects/time";

test("legacy and new delivery projects share approved department and budget reporting without changing Time anchors", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-delivery-compatibility";
  const root = runtime.db.collection("tenants").doc(tenant);
  const now = Date.parse("2026-11-24T17:00:00Z");
  const at = new Date(now).toISOString();
  const month = "2026-11";
  const account = "9917";
  const customerParentId = "46";
  const catalog = key("quickbooks-time-customer", account, customerParentId);
  const parent = "legacy-engagement";
  const department = "legacy-hr-node";
  const nested = "legacy-hr-project";
  const optedOut = "legacy-excluded-project";
  const movedAnchor = "time-" + key(account, "7103");
  const selfMappedAnchor = "time-" + key(account, "7104");
  const orders = [
    { jobcodeId: "7101", scopeProjectId: parent, projectId: parent, seconds: 12_600 },
    { jobcodeId: "7102", scopeProjectId: parent, projectId: nested, seconds: 7_200 },
    { jobcodeId: "7103", scopeProjectId: movedAnchor, projectId: parent, seconds: 5_400, reviewedAttribution: true },
    { jobcodeId: "7104", scopeProjectId: selfMappedAnchor, projectId: selfMappedAnchor, seconds: 7_200, reviewedAttribution: true },
  ].map((order, index) => ({ ...order, externalId: String(8100 + index), sourceId: sourceRecordId("quickbooks-time", account, String(8100 + index)) }));
  const manager = "approved-manager";
  function settings(input: Partial<Delivery>): Delivery {
    return { ...deliveryDefaults, ...input };
  }

  const projectInput = (name: string, delivery?: Delivery): ManagedProject => ({
    name, delivery, status: "active", progress: 0, description: "", internalNotes: "Private fixture note",
    plan: { basis: "monthly", targetSeconds: 0 },
  });
  const store = new ProjectStore(runtime.db, "time-owner");
  const backend = new ProjectBackend(store, {
    async verify(token) {
      const subject = token.slice(7);
      return {
        subject, issuer: "fixture", audience: "fixture", expiresAt: now + 60_000, revoked: false, disabled: false,
        ...(subject === "time-owner" && { corporatePolicy: true, staffTenantId: tenant }),
      };
    },
  }, { issuer: "fixture", audience: "fixture", now: () => now });
  const time = new TimeSync(store, {
    tenant, account, customerParentId, admin: "time-owner", clientUrl: "https://example.invalid", userId: "5", from: "2026-10-01",
  }, new TimeClient(async () => { throw Error("A mapping review must not contact the provider"); }), () => now);
  const server = apiServer(undefined as unknown as ReportingBackend, { projects: backend, time });
  try {
    const fixtureProject = (id: string, delivery?: Delivery): Project => ({
      ...projectInput(id, delivery), schemaVersion: 2, id, tenantId: tenant, source: null, published: id !== movedAnchor,
      createdAt: at, updatedAt: at, createdBy: "fixture", updatedBy: "fixture",
    });
    const projects = [
      fixtureProject(parent, settings({ kind: "engagement", monthlyCap: 28_800, lifetimeCap: 43_200, publishSummary: true })),
      fixtureProject(department, settings({ structure: 2, kind: "service-area", parentId: parent, areaId: "hr", monthlyCap: 14_400, publishSummary: true })),
      fixtureProject(nested, settings({ structure: 2, parentId: department, areaId: "hr" })),
      fixtureProject(optedOut, settings({ structure: 2, parentId: parent, countAgainstParentCap: false })),
      fixtureProject(movedAnchor),
      fixtureProject(selfMappedAnchor, settings({ kind: "engagement" })),
    ];
    const member = root.collection("memberships").doc(key("client"));
    const memberRecord = {
      schemaVersion: 2, tenantId: tenant, subject: "client", role: "client", approved: true, enabled: true,
      projectIds: projects.map(project => project.id),
    };
    const sources = orders.map(order => root.collection("rawTime").doc(order.sourceId));
    const mappings = orders.map(order => timeMapping(root, account, order.jobcodeId));
    const checkpoints = orders.map(order => root.collection("syncCheckpoints").doc(key("quickbooks-time", account, order.jobcodeId)));
    await runtime.db.runTransaction(async tx => {
      const seedTotals = await timeTotalsWrite(tx, root, orders.map(order => ({
        project: order.scopeProjectId, month, recorded: order.seconds, allocated: 0,
      })));
      seedTotals();
      tx.set(root, { name: "Synthetic legacy transition", schemaVersion: 2, revision: 1, synthetic: true });
      tx.set(member, memberRecord);
      tx.set(portfolioRef(root), { portfolio: {
        ...newPortfolio(),
        directory: [{
          id: manager, name: "Approved manager", role: "Project manager", visible: true, active: true,
          responsibility: "", internalContact: "", publicContact: "", areaId: "", projectIds: [], order: 0,
        }],
      } });
      tx.set(timeRun(root, catalog), { customerBound: true, lastSuccess: at });
      for (const project of projects) {
        // Imported anchor projects may predate saved delivery settings.
        const { delivery, ...record } = project;
        tx.set(root.collection("projects").doc(project.id), delivery ? { ...record, delivery } : record);
        tx.set(root.collection("projectViews").doc(project.id), projectView(project, 0));
      }
      orders.forEach(({ jobcodeId, scopeProjectId, projectId, seconds, reviewedAttribution, sourceId, externalId }, i) => {
        tx.set(mappings[i], {
          account, jobcodeId, catalog, scopeProjectId, projectId,
          ...(reviewedAttribution && { reviewedAttribution }),
          sourceJob: { id: jobcodeId, parentId: customerParentId, name: "Synthetic Work Order " + jobcodeId, active: true, missing: false },
        });
        tx.set(checkpoints[i], { lastSuccess: at, through: at, failed: false });
        const envelope = {
          schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: account, externalId, scopeProjectId, deleted: false, modifiedAt: at,
          record: {
            id: sourceId, tenantId: tenant, sourceWorkOrderId: jobcodeId, sourcePersonId: "fixture-staff-profile",
            date: month + "-18", description: "Private source notes", seconds, revision: "verified-source-1",
          },
        };
        tx.set(sources[i], envelope);
        tx.set(sources[i].collection("versions").doc("verified-source-1"), envelope);
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v2/tenants/${tenant}/`;
    async function request<T>(path: string, subject: string, method = "GET", body?: unknown, status = 200, idempotency?: string) {
      const response = await fetch(endpoint + path, {
        method,
        headers: { authorization: "Bearer " + subject, ...(body !== undefined && { "content-type": "application/json" }),
          ...(idempotency && { "idempotency-key": idempotency }) },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
      const result = await response.json();
      assert.equal(response.status, status, JSON.stringify(result));
      return result as T;
    }
    const report = () => request<ProjectReport>("report?month=" + month, "client");
    const revision = async () => (await root.get()).get("revision") as number;
    const allocate = async (order: typeof orders[number], projectId: string, seconds: number) =>
      request("allocations/" + order.sourceId, "time-owner", "PATCH", {
        expectedRevision: await revision(), portions: [{ projectId, seconds, description: "Fixture allocation" }],
      });
    const originals = () => Promise.all([...sources, ...sources.map(source => source.collection("versions").doc("verified-source-1")),
      ...mappings, ...checkpoints].map(async ref => (await ref.get()).data()));
    const immutableBefore = await originals();

    // Even a mapping explicitly reviewed to its own original anchor is already locked.
    const useReviewedAnchor = { targetKind: "engagement", previousProjectId: selfMappedAnchor, recordedSeconds: 7_200, allocatedSeconds: 0 };
    await request("time/mapping", "time-owner", "POST", { jobcodeId: "7104", projectId: parent, review: useReviewedAnchor }, 409);
    const replay = await request<{ changed: boolean }>("time/mapping", "time-owner", "POST", {
      jobcodeId: "7104", projectId: selfMappedAnchor, review: useReviewedAnchor,
    });
    assert.equal(replay.changed, false);
    await request("time/mapping", "time-owner", "POST", { jobcodeId: "7102", projectId: parent, review: {
      targetKind: "engagement", previousProjectId: nested, recordedSeconds: 7_200, allocatedSeconds: 0,
    } }, 409);
    const registry = await request<TimeStatus>("time?month=" + month, "time-owner");
    assert.equal(registry.recordedSeconds, 32_400);
    assert.equal(registry.mappings.find(mapping => mapping.jobcodeId === "7102")?.mappingState, "linked");
    assert.equal(registry.mappings.find(mapping => mapping.jobcodeId === "7104")?.canReview, false);

    await allocate(orders[0], nested, 3_600);
    await allocate(orders[1], optedOut, 1_800);
    const before = await report();
    assert.equal(before.totalSeconds, 32_400);
    assert.equal(before.hierarchy?.[parent]?.kind, "engagement");
    assert.equal(before.hierarchy?.[parent]?.monthlyCapUsed, 23_400);
    assert.equal(before.hierarchy?.[parent]?.lifetimeCapUsed, 23_400);
    assert.equal(before.hierarchy?.[department]?.monthlyCapUsed, 3_600);
    assert.equal(clientDelivery(before).parentRows.find(row => row.id === parent)?.seconds, 25_200);
    assert.equal(before.projects.find(project => project.id === parent)?.workOrderEffort?.recordedSeconds, 25_200);
    assert.equal(before.projects.find(project => project.id === nested)?.workOrderEffort, undefined);
    assert.equal(before.projects.find(project => project.id === selfMappedAnchor)?.workOrderEffort?.remainingSeconds, 7_200);

    const delivery = settings({ structure: 3, parentId: parent, areaId: "hr", managerIds: [manager] });
    const created = await request<{ id: string }>("projects", "time-owner", "POST",
      projectInput("New approved HR delivery", delivery), 201, now + "-" + randomUUID());
    await member.update({ projectIds: [...memberRecord.projectIds, created.id] });
    await allocate(orders[2], created.id, 2_700);
    const draft = await report();
    assert.equal(draft.totalSeconds, 29_700);
    assert.equal(draft.hierarchy?.[created.id], undefined);
    assert.equal(draft.portfolio?.placements.some(item => item.id === created.id), false);
    assert.equal(draft.hierarchy?.[parent]?.monthlyCapUsed, 20_700);
    const allocationHistory = async () => (await root.collection("allocationRevisions").get()).docs.map(doc => [doc.id, doc.data()]);
    const beforePublication = await allocationHistory();
    const monthlyTotal = root.collection("timeMonthlyTotals").doc(month);
    assert.deepEqual((await monthlyTotal.get()).data(), { recorded: 32_400, allocated: 8_100 });

    await request("projects/" + created.id + "/publication", "time-owner", "PATCH", {
      expectedRevision: await revision(), published: true,
    });
    const published = await report();
    assert.equal(published.totalSeconds, before.totalSeconds);
    assert.equal(published.hierarchy?.[parent]?.monthlyCapUsed, 23_400);
    assert.equal(published.hierarchy?.[department]?.monthlyCapUsed, 3_600);
    assert.equal(published.hierarchy?.[created.id]?.parentId, parent);
    assert.equal(published.portfolio?.placements.find(item => item.id === created.id)?.areaId, "hr");
    const overview = clientDelivery(published);
    assert.equal(overview.parentRows.find(row => row.id === parent)?.counts.all, 3);
    assert.equal(overview.parentRows.find(row => row.id === parent)?.seconds, 25_200);
    assert.equal(overview.departmentRows.find(row => row.id === "hr")?.counts.all, 2);
    assert.equal(overview.departmentRows.find(row => row.id === "hr")?.seconds, 6_300);
    assert.equal(published.projects.some(project => project.id === movedAnchor), false);
    assert.doesNotMatch(JSON.stringify(published), /Private source notes|fixture-staff-profile|Private fixture note/);

    await root.collection("memberships").doc(key("delivery-only")).set({
      ...memberRecord, subject: "delivery-only", projectIds: [created.id],
    });
    const limited = await request<ProjectReport>("report?month=" + month, "delivery-only");
    assert.equal(limited.totalSeconds, 2_700);
    assert.equal(limited.hierarchy?.[created.id]?.parentId, undefined);
    assert.equal(limited.portfolio?.placements.find(item => item.id === created.id)?.areaId, "hr");
    assert.equal(clientDelivery(limited).parentRows.length, 0);

    assert.deepEqual(await originals(), immutableBefore);
    assert.deepEqual((await monthlyTotal.get()).data(), { recorded: 32_400, allocated: 8_100 });
    assert.deepEqual(await allocationHistory(), beforePublication);
    assert.deepEqual((await root.collection("projects").doc(parent).get()).get("delivery"), projects[0].delivery);
    assert.deepEqual((await root.collection("projects").doc(nested).get()).get("delivery"), projects[2].delivery);
  } finally {
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
    await runtime.close();
  }
});
