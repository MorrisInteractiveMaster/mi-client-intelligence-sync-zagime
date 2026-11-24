import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { ReportingBackend } from "../server/backend";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { apiServer } from "../server/http";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { timeDetailsRef } from "../server/time-details";
import type { ProjectPage } from "../src/projects/model";

test("Time search, choices, counts and cursor cover a complete period without exposing source records to clients", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-time-search";
  const root = runtime.db.doc("tenants/" + tenant);
  const period = "2026-12";
  const modifiedAt = "2026-12-15T12:00:00Z";
  const revision = "imported-1";
  const src = (i: number) => root.collection("rawTime").doc("search-row-" + String(i).padStart(2, "0"));
  const details = { provider: "quickbooks-time", sourceRevision: revision, sourceModifiedAt: modifiedAt, observedAt: modifiedAt,
    retrievedVia: "exact-id-lookup", personId: "929", consultantName: "Taylor Canoe", notes: "Restoration shoreline survey" };
  await seedProjectSynthetic(runtime.db, tenant, true);
  const batch = runtime.db.batch();
  for (let i = 0; i < 33; i++) batch.set(src(i), {
    schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "fixtures", scopeProjectId: "synthetic-planning", modifiedAt, deleted: i === 3,
    record: { id: src(i).id, tenantId: tenant, sourceWorkOrderId: i === 32 ? "999" : "111", sourcePersonId: "",
      date: period + (i >= 29 ? "-28" : "-04"), seconds: 1800, revision, description: "QuickBooks Time" },
  });
  const head = (i: number) => root.collection("allocationHeads").doc(src(i).id);
  const part = (seconds: number) => [{ projectId: "synthetic-delivery", seconds, description: "" }];
  batch.set(head(0), { revision: 1, sourceRevision: revision, portions: part(1800) });
  batch.set(head(1), { revision: 1, sourceRevision: revision, portions: part(900), annotations: { areaId: "hr", reportingDescription: "Review screening", internalNote: "Staff-only private line" } });
  batch.set(head(2), { revision: 2, sourceRevision: revision, portions: part(1800), appliedPortions: [], needsReview: true });
  batch.set(root.collection("timeMappings").doc(key("fixtures", "999")), { sourceJob: { name: "Field project" } });
  batch.set(timeDetailsRef(src(31), revision), { ...details, sourceModifiedAt: "2026-12-14T12:00:00Z", notes: "Stale imported text" });
  batch.set(timeDetailsRef(src(32), revision), details);
  const prior = root.collection("rawTime").doc("older-search-row");
  batch.set(prior, { schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "fixtures",
    scopeProjectId: "synthetic-planning", modifiedAt, deleted: false,
    record: { id: prior.id, tenantId: tenant, sourceWorkOrderId: "999", sourcePersonId: "",
      date: "2025-11-06", seconds: 18000, revision, description: "QuickBooks Time" },
  });
  batch.set(timeDetailsRef(prior, revision), details);
  const other = runtime.db.doc("tenants/other-private-company/rawTime/remote-row");
  batch.set(other, { schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "fixtures",
    scopeProjectId: "synthetic-planning", modifiedAt, deleted: false,
    record: { id: other.id, tenantId: "other-private-company", sourceWorkOrderId: "999", sourcePersonId: "929",
      date: "2025-11-06", seconds: 36000, revision, description: "Confidential other tenant" },
  });
  batch.set(root.collection("memberships").doc(key("client")), { schemaVersion: 2, subject: "client", tenantId: tenant, role: "client", approved: true, enabled: true, projectIds: ["synthetic-delivery"] });
  await batch.commit();
  const now = Date.now();
  const server = apiServer(undefined as unknown as ReportingBackend, {
    projects: new ProjectBackend(new ProjectStore(runtime.db), { async verify(token) {
      const subject = token.slice(7);
      return { subject, issuer: "fixture", audience: "fixture", expiresAt: now + 60_000, revoked: false, disabled: false,
        ...(subject === "staff" ? { corporatePolicy: true, staffTenantId: tenant } : {}) };
    } }, { issuer: "fixture", audience: "fixture", now: () => now }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const api = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v2/tenants/${tenant}/`;
  const request = (endpoint: string, subject = "staff") => fetch(api + endpoint, { headers: { authorization: "Bearer " + subject } });
  async function sources(filters: Record<string, string> = {}) {
    const response = await request("sources?" + new URLSearchParams({ month: period, ...filters }));
    assert.equal(response.status, 200, await response.clone().text());
    return response.json() as Promise<ProjectPage>;
  }
  try {
    const first = await sources();
    assert.equal(first.sources?.length, 25);
    assert.equal(first.sourceSummary?.monthTotal, 33);
    assert.equal(first.sourceSummary?.matched, 33);
    assert.deepEqual(first.sourceSummary?.counts, { total: 33, allocated: 1, partial: 1, unallocated: 29, review: 1, deleted: 1, remaining: 31 });
    assert.ok(first.sourceSummary?.consultants.some(item => item.id === "929" && item.label === "Taylor Canoe"));
    assert.ok(first.sourceSummary?.workOrders.some(item => item.id === "999" && item.label === "Field project"));
    assert.equal(first.sources?.[4].description, "");
    const second = await sources({ cursor: first.nextCursor! });
    assert.equal(second.sources?.length, 8);
    assert.equal(second.nextCursor, undefined);
    assert.equal(new Set([...first.sources!, ...second.sources!].map(row => row.id)).size, 33);
    const matchingFilters: Record<string, string>[] = [
      { search: "SHORELINE survey" }, { consultant: "929" }, { workOrder: "999", from: "2026-12-25" },
    ];
    for (const filters of matchingFilters) {
      const filtered = await sources(filters);
      assert.deepEqual(filtered.sources?.map(row => row.id), [src(32).id]);
      assert.equal(filtered.sources?.[0].description, details.notes);
      assert.equal(filtered.sourceSummary?.matched, 1);
    }
    assert.equal((await sources({ search: "Stale imported text" })).sourceSummary?.matched, 0);
    assert.equal((await sources({ area: "hr", project: "synthetic-delivery" })).sourceSummary?.matched, 1);
    assert.equal((await sources({ status: "review" })).sources?.[0].id, src(2).id);
    assert.equal((await sources({ status: "queue" })).sourceSummary?.matched, 31);
    assert.equal((await request(`sources?month=${period}&status=review&cursor=${first.nextCursor}`)).status, 409);
    assert.equal((await request(`sources?month=${period}&from=2026-11-25`)).status, 400);
    assert.equal((await request(`sources?month=${period}&consultant=929&consultant=999`)).status, 400);
    const whole = await sources({ period: "all", order: "newest", group: "quarter" });
    assert.equal(whole.sources?.[0].id, src(32).id);
    assert.equal(whole.sourceSummary?.monthTotal, 35);
    assert.equal(whole.sourceSummary?.hours.recordedSeconds, 82800);
    assert.equal(whole.sourceSummary?.hours.allocatedSeconds, 2700);
    assert.equal(whole.sourceSummary?.hours.unallocatedSeconds, 80100);
    assert.deepEqual(whole.sourceSummary?.hours.byPeriod.map(row => [row.label, row.recordedSeconds]), [["2025 Q4", 18000], ["2026 Q4", 64800]]);
    assert.ok(whole.sourceSummary?.hours.byConsultant.some(row => row.id === "929" && row.label === "Taylor Canoe" && row.recordedSeconds === 19800));
    const older = await sources({ period: "range", start: "2025-01-01", end: "2025-12-31", consultant: "929", workOrder: "999" });
    assert.deepEqual(older.sources?.map(row => row.id), [prior.id]);
    assert.equal(older.sourceSummary?.hours.byWorkOrder[0].recordedSeconds, 18000);
    assert.equal(older.sources?.[0].description, details.notes);
    assert.equal((await sources({ period: "all", entry: other.id })).sourceSummary?.matched, 0);
    assert.equal((await sources({ period: "all", entry: prior.id })).sources?.[0].id, prior.id);
    assert.equal((await request(`sources?month=${period}&period=all&entry=${prior.id}`, "client")).status, 403);
    assert.equal((await request(`sources?month=${period}&period=range&start=2026-12-30&end=2026-12-29`)).status, 400);
    await timeDetailsRef(src(30), revision).set(details);
    const filtered = await sources({ search: "shoreline", limit: "1" });
    assert.equal(filtered.sourceSummary?.matched, 2);
    await timeDetailsRef(src(31), revision).set(details);
    assert.equal((await request(`sources?month=${period}&search=shoreline&limit=1&cursor=${filtered.nextCursor}`)).status, 409);
    assert.equal((await request(`sources?month=${period}`, "client")).status, 403);
    const exported = await sources({ period: "all", limit: "500", download: "csv" });
    assert.equal(exported.sources?.length, exported.sourceSummary?.matched);
    assert.equal(exported.sources?.length, 35);
    assert.equal(exported.nextCursor, undefined);
    assert.equal((await request("sources?month=" + period + "&limit=500&download=csv", "client")).status, 403);
    assert.equal((await request("sources?month=" + period + "&limit=501&download=csv")).status, 400);
    assert.equal((await request("sources?month=" + period + "&limit=500")).status, 400);
    const report = await request(`report?month=${period}`, "client");
    assert.equal(report.status, 200);
    assert.doesNotMatch(await report.text(), /Taylor Canoe|shoreline survey|Staff-only private line/);

    const sortMonth = "2026-11";
    const sortBatch = runtime.db.batch();
    for (let index = 0; index < 52; index++) {
      const ref = root.collection("rawTime").doc("ordered-" + String(index).padStart(2, "0"));
      sortBatch.set(ref, { schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "fixtures",
        scopeProjectId: "synthetic-planning", modifiedAt, deleted: index % 17 === 0,
        record: { id: ref.id, tenantId: tenant, sourceWorkOrderId: index % 2 ? "111" : "999",
          date: sortMonth + "-" + String(index % 25 + 1).padStart(2,"0"),
          seconds: (52 - index) * 173, revision, description: index % 5 ? "Task " + index : "QuickBooks Time" } });
      if (index % 4) sortBatch.set(timeDetailsRef(ref, revision), { ...details, consultantName: "Consultant " + index % 7 });
      if (index % 3 === 0) sortBatch.set(root.collection("allocationHeads").doc(ref.id),
        { revision: 1, sourceRevision: revision, portions: [{ ...part(90)[0], projectId: index % 2 ? "synthetic-delivery" : "synthetic-planning" }],
          annotations: { reportingDescription: "Report " + index, internalNote: "" } });
    }
    await sortBatch.commit();
    const all = (await sources({ month: sortMonth, limit: "500", download: "csv", sort: "recorded", direction: "asc" })).sources!;
    assert.equal(all.length, 52);
    assert.deepEqual(all.map(row => row.seconds), Array.from({length: 52}, (_, index) => (index + 1) * 173));
    const sortedPage = await sources({ month: sortMonth, sort: "recorded", direction: "asc" });
    const nextSortedPage = await sources({ month: sortMonth, sort: "recorded", direction: "asc", cursor: sortedPage.nextCursor! });
    const lastSortedPage = await sources({ month: sortMonth, sort: "recorded", direction: "asc", cursor: nextSortedPage.nextCursor! });
    assert.deepEqual([...sortedPage.sources!, ...nextSortedPage.sources!, ...lastSortedPage.sources!].map(row => row.id), all.map(row => row.id));
    assert.equal((await request(`sources?month=${sortMonth}&sort=recorded&direction=desc&cursor=${sortedPage.nextCursor}`)).status, 409);
    for (const field of ["date", "consultant", "notes", "workOrder", "recorded", "reporting", "assignment", "status"]) {
      const [asc, desc] = await Promise.all(["asc", "desc"].map(direction => sources({ month: sortMonth, limit: "2", sort: field, direction })));
      assert.notDeepEqual(asc.sources?.map(row => row.id), desc.sources?.map(row => row.id), field);
    }
    assert.equal((await request(`sources?month=${sortMonth}&sort=internalNote&direction=asc`)).status, 400);
  } finally {
    server.close();
    await once(server, "close");
    await runtime.close();
  }
});
