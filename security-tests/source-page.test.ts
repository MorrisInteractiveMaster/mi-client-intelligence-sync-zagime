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
    await timeDetailsRef(src(30), revision).set(details);
    const filtered = await sources({ search: "shoreline", limit: "1" });
    assert.equal(filtered.sourceSummary?.matched, 2);
    await timeDetailsRef(src(31), revision).set(details);
    assert.equal((await request(`sources?month=${period}&search=shoreline&limit=1&cursor=${filtered.nextCursor}`)).status, 409);
    assert.equal((await request(`sources?month=${period}`, "client")).status, 403);
    const report = await request(`report?month=${period}`, "client");
    assert.equal(report.status, 200);
    assert.doesNotMatch(await report.text(), /Taylor Canoe|shoreline survey|Staff-only private line/);
  } finally {
    server.close();
    await once(server, "close");
    await runtime.close();
  }
});
