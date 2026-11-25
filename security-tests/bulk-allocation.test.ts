import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { apiServer } from "../server/http";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { seedProjectSynthetic } from "../server/project-operator";
import { timeTotalsWrite } from "../server/time-totals";
import type { ReportingBackend } from "../server/backend";
import type { BulkAllocationEntry, BulkAllocationResponse } from "../src/projects/bulk-allocation";
import { MAX_BULK_ALLOCATION_ENTRIES } from "../src/projects/bulk-allocation";

test("bulk Time allocation reports every outcome, authenticates staff and replays without duplicate seconds", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-time-bulk";
  const projectId = "synthetic-delivery";
  const scopeProject = "synthetic-planning";
  const root = runtime.db.doc("tenants/" + tenant);
  const month = "2026-11";
  await seedProjectSynthetic(runtime.db, tenant, true);
  const entries = [
    { id: "first", seconds: 3607, revision: "source-1" },
    { id: "correction", seconds: 1729, revision: "source-2" },
    { id: "partially-allocated", seconds: 1111, revision: "source-1" },
    { id: "deleted", seconds: 37, revision: "source-2", deleted: true },
    { id: "last", seconds: 1212, revision: "source-1" },
    { id: "concurrent", seconds: 987, revision: "source-1" },
  ];
  await runtime.db.runTransaction(async tx => {
    const seedTotals = await timeTotalsWrite(tx, root, [{
      project: scopeProject,
      month,
      recorded: entries.filter(row => !row.deleted).reduce((n, row) => n + row.seconds, 0),
      allocated: 0,
    }]);
    seedTotals();
    for (const row of entries) {
      const source = root.collection("rawTime").doc(row.id);
      const envelope = {
        source: "quickbooks-time", schemaVersion: 2, scopeProjectId: scopeProject, deleted: !!row.deleted,
        record: { ...row, tenantId: tenant, sourceWorkOrderId: "fixture-work-order", date: month + "-09", description: "Private source content" },
      };
      tx.set(source, envelope);
      tx.set(source.collection("versions").doc(row.revision), envelope);
    }
  });
  const now = Date.now();
  const server = apiServer(undefined as unknown as ReportingBackend, {
    projects: new ProjectBackend(new ProjectStore(runtime.db), {
      async verify(token) {
        const subject = token.slice(7);
        return {
          subject, issuer: "fixture", audience: "fixture", expiresAt: now + 300000, disabled: false, revoked: false,
          ...(subject === "staff" ? { corporatePolicy: true, staffTenantId: tenant } :
            subject === "other-staff" ? { corporatePolicy: true, staffTenantId: "synthetic-other" } : {}),
        };
      },
    }, { issuer: "fixture", audience: "fixture", now: () => now }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/v2/tenants/${tenant}/allocations/`;
  const post = (body: unknown, idempotency: string, subject = "staff") =>
    fetch(endpoint + "bulk", {
      method: "POST",
      headers: { Authorization: "Bearer " + subject, "Content-Type": "application/json", "Idempotency-Key": idempotency },
      body: JSON.stringify(body),
    });
  const batchKey = () => now + "-" + randomUUID();
  const runBulk = async (rows: BulkAllocationEntry[], idempotency: string, target = projectId) => {
    const response = await post({ projectId: target, entries: rows }, idempotency);
    const body: BulkAllocationResponse = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body.outcomes;
  };
  const row = (sourceId: string, allocationRevision = 0, sourceRevision = "source-1"): BulkAllocationEntry => ({
    sourceId, expectedSourceRevision: sourceRevision, expectedAllocationRevision: allocationRevision,
  });
  const projectView = root.collection("projectViews").doc(projectId);
  const monthTotals = root.collection("timeMonthlyTotals").doc(month);
  const getSources = async () => Promise.all(entries.map(async item => {
    const ref = root.collection("rawTime").doc(item.id);
    return [(await ref.get()).data(), (await ref.collection("versions").doc(item.revision).get()).data()];
  }));
  const annotations = { reportingDescription: "Updated reporting description", internalNote: "Protected annotation" };
  const manual = async (sourceId: string, seconds: number) => {
    const expectedRevision = (await root.get()).data()!.revision;
    const response = await fetch(endpoint + sourceId, {
      method: "PATCH", headers: { Authorization: "Bearer staff", "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedRevision, expectedSourceRevision: "source-1", annotations,
        portions: seconds ? [{ projectId, seconds, description: "" }] : [],
      }),
    });
    assert.equal(response.status, 200, await response.text());
  };
  try {
    const originalSources = await getSources();
    const recorded = (await monthTotals.get()).data()!.recorded;
    await manual("first", 0);
    await manual("partially-allocated", 301);
    const selection = [row("first", 1), row("correction"), row("partially-allocated"), row("deleted"), row("missing"), row("last")];
    for (const subject of ["client", "other-staff"]) {
      const response = await post({ projectId, entries: selection }, batchKey(), subject);
      assert.equal(response.status, 403);
      await response.json();
    }
    const malformed = await post({ projectId, entries: [row("first", 1), { ...row("last"), seconds: 20000 }] }, batchKey());
    assert.equal(malformed.status, 400);
    await malformed.json();
    assert.equal((await projectView.get()).data()!.lifetimeSeconds, 301);

    const idempotency = batchKey();
    const result = await runBulk(selection, idempotency);
    assert.deepEqual(result.map(entry => entry.sourceId), selection.map(entry => entry.sourceId));
    assert.deepEqual(result.map(entry => entry.status), [
      "saved", "source_changed", "allocation_changed", "not_eligible", "unavailable", "saved",
    ]);
    assert.equal((await projectView.get()).data()!.lifetimeSeconds, 301 + 3607 + 1212);
    assert.deepEqual((await root.collection("allocationHeads").doc("first").get()).data()?.annotations, annotations);
    const revisionAfterBatch = (await root.get()).data()!.revision;
    assert.deepEqual((await runBulk(selection, idempotency)).map(entry => entry.status), [
      "already_saved", "source_changed", "allocation_changed", "not_eligible", "unavailable", "already_saved",
    ]);
    assert.deepEqual(await runBulk([row("first", 1)], idempotency), [{ sourceId: "first", status: "already_saved" }]);
    assert.equal((await runBulk([row("first", 1)], idempotency, scopeProject))[0].status, "request_changed");
    assert.equal((await root.get()).data()!.revision, revisionAfterBatch);
    assert.equal((await root.collection("allocationRevisions").where("sourceId", "==", "first").get()).size, 2);
    assert.equal((await runBulk([row("partially-allocated", 1)], batchKey()))[0].status, "not_eligible");
    assert.equal((await runBulk([row("correction", 0, "source-2")], batchKey()))[0].status, "saved");

    const concurrentRequest = [row("concurrent")];
    const raceKey = batchKey();
    const race = await Promise.all([runBulk(concurrentRequest, raceKey), runBulk(concurrentRequest, raceKey)]);
    assert.deepEqual(race.flat().map(entry => entry.status).sort(), ["already_saved", "saved"]);
    const expectedAllocated = 301 + 3607 + 1212 + 1729 + 987;
    assert.equal((await projectView.get()).data()!.lifetimeSeconds, expectedAllocated);
    assert.equal((await root.collection("projectPeriods").doc(key(month, projectId)).get()).data()!.seconds, expectedAllocated);
    assert.deepEqual((await monthTotals.get()).data(), { recorded, allocated: expectedAllocated });
    assert.deepEqual(await getSources(), originalSources);

    const historySelection = Array.from({ length: 137 }, (_, index) => row("history-" + index));
    const expectedHistory = historySelection.reduce((sum, _, index) => sum + index + 1, 0);
    await runtime.db.runTransaction(async tx => {
      const totals = await timeTotalsWrite(tx, root, [{ project: scopeProject, month, recorded: expectedHistory, allocated: 0 }]);
      totals();
      for (const [index, entry] of historySelection.entries()) {
        tx.create(root.collection("rawTime").doc(entry.sourceId), { schemaVersion: 2, source: "quickbooks-time", scopeProjectId: scopeProject,
          deleted: false, record: { id: entry.sourceId, tenantId: tenant, sourceWorkOrderId: "fixture-work-order",
            revision: entry.expectedSourceRevision, date: month + "-19", seconds: index + 1 } });
      }
    });
    const historyKey = batchKey();
    const firstChunk = historySelection.slice(0, MAX_BULK_ALLOCATION_ENTRIES);
    assert.ok((await runBulk(firstChunk, historyKey)).every(item => item.status === "saved"));
    // The first response can go missing. Racing a replay against the next
    // bounded group must retain the fixed selection and count each second once.
    const resumed = await Promise.all([
      runBulk(firstChunk, historyKey),
      runBulk(historySelection.slice(MAX_BULK_ALLOCATION_ENTRIES, MAX_BULK_ALLOCATION_ENTRIES * 2), historyKey),
    ]);
    assert.ok(resumed[0].every(item => item.status === "already_saved"));
    assert.ok(resumed[1].every(item => item.status === "saved"));
    for (let offset = MAX_BULK_ALLOCATION_ENTRIES * 2; offset < historySelection.length; offset += MAX_BULK_ALLOCATION_ENTRIES) {
      assert.ok((await runBulk(historySelection.slice(offset, offset + MAX_BULK_ALLOCATION_ENTRIES), historyKey)).every(item => item.status === "saved"));
    }
    assert.equal((await projectView.get()).get("lifetimeSeconds"), expectedAllocated + expectedHistory);
    assert.deepEqual((await monthTotals.get()).data(), { recorded: recorded + expectedHistory, allocated: expectedAllocated + expectedHistory });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await runtime.close();
  }
});
