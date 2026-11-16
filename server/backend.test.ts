import test from "node:test";
import assert from "node:assert/strict";
import { demo, type DeliveryProject } from "../src/reporting/model";
import { ReportingBackend } from "./backend";
import { MemoryTenantStore } from "./memory-store";
import {
  denyAllVerifier,
  tenantPath,
  type VerifiedIdentity,
  type TenantRecord,
} from "./contracts";
import { disabledAccounting, disabledTime } from "./integrations";
const now = Date.parse("2026-11-16T12:00:00Z");
function setup(identity: Partial<VerifiedIdentity> = {}) {
  const state = demo();
  state.tenant.id = "tenant-a";
  state.agreements[0].tenantId = "tenant-a";
  state.raw.forEach((r) => (r.tenantId = "tenant-a"));
  const record: TenantRecord = {
    revision: 1,
    state,
    memberships: [
      {
        tenantId: "tenant-a",
        subject: "admin",
        approved: true,
        enabled: true,
        role: "administrator",
        agreementIds: [],
        projectIds: [],
      },
      {
        tenantId: "tenant-a",
        subject: "editor",
        approved: true,
        enabled: true,
        role: "editor",
        agreementIds: ["agreement-demo"],
        projectIds: ["delivery-0"],
      },
      {
        tenantId: "tenant-a",
        subject: "client",
        approved: true,
        enabled: true,
        role: "client",
        agreementIds: ["agreement-demo"],
        projectIds: "all-authorized-agreements",
      },
      {
        tenantId: "tenant-a",
        subject: "disabled",
        approved: true,
        enabled: false,
        role: "administrator",
        agreementIds: [],
        projectIds: [],
      },
      {
        tenantId: "tenant-a",
        subject: "unapproved",
        approved: false,
        enabled: true,
        role: "administrator",
        agreementIds: [],
        projectIds: [],
      },
    ],
    audits: [],
    checkpoints: [],
  };
  const other = structuredClone(record);
  other.state.tenant.id = "tenant-b";
  other.state.agreements[0].tenantId = "tenant-b";
  other.state.raw.forEach((r) => (r.tenantId = "tenant-b"));
  other.memberships = [];
  const store = new MemoryTenantStore({
    "tenant-a": record,
    "tenant-b": other,
  });
  const verifier = {
    async verify(token: string) {
      if (token === "Bearer forged") throw Error("Invalid signature");
      return {
        subject: token.slice(7),
        issuer: "synthetic-issuer",
        audience: "synthetic-api",
        expiresAt: now + 60000,
        disabled: false,
        revoked: false,
        ...identity,
      };
    },
  };
  const policy = {
    issuer: "synthetic-issuer",
    audience: "synthetic-api",
    now: () => now,
  };
  return {
    store,
    backend: new ReportingBackend(store, verifier, policy),
    policy,
  };
}
const input = {
  agreementId: "agreement-demo",
  departmentId: "health",
  name: "Synthetic secure project",
  plan: { basis: "fixed" as const, minutes: 120 },
};
test("unauthenticated, forged and unconfigured verification deny backend access", async () => {
  const { backend, store, policy } = setup();
  await assert.rejects(() =>
    backend.readPublished("", "tenant-a", { month: "2026-10" }),
  );
  await assert.rejects(() =>
    backend.readPublished("Bearer forged", "tenant-a", { month: "2026-10" }),
  );
  await assert.rejects(() =>
    new ReportingBackend(store, denyAllVerifier, policy).readPublished(
      "Bearer admin",
      "tenant-a",
      { month: "2026-10" },
    ),
  );
  assert.equal(store.writes, 0);
});
test("tenant isolation, unapproved and disabled memberships deny", async () => {
  const { backend, store } = setup();
  for (const subject of ["unapproved", "disabled", "unknown"])
    await assert.rejects(() =>
      backend.readPublished("Bearer " + subject, "tenant-a", {
        month: "2026-10",
      }),
    );
  await assert.rejects(() =>
    backend.readPublished("Bearer admin", "tenant-b", { month: "2026-10" }),
  );
  await assert.rejects(() =>
    backend.readPublished("Bearer admin", "../tenant-a", { month: "2026-10" }),
  );
  assert.equal(store.writes, 0);
});
for (const bad of [
  { issuer: "wrong" },
  { audience: "wrong" },
  { expiresAt: now },
  { expiresAt: NaN },
  { revoked: true },
  { disabled: true },
])
  test("verified identity policy rejects " + JSON.stringify(bad), async () => {
    const { backend, store } = setup(bad);
    await assert.rejects(() =>
      backend.readPublished("Bearer admin", "tenant-a", { month: "2026-10" }),
    );
    assert.equal(store.writes, 0);
  });
test("client read sees published data only and all client writes deny", async () => {
  const { backend, store } = setup();
  const created = await backend.createProject(
    "Bearer admin",
    "tenant-a",
    input,
  );
  assert.equal(created.published, false);
  const view = await backend.readPublished("Bearer client", "tenant-a", {
    month: "2026-10",
  });
  assert.ok(!view.projects.some((p) => p.id === created.id));
  for (const text of [
    "rawTime",
    "sourcePersonId",
    "internalNotes",
    "memberships",
  ])
    assert.ok(!JSON.stringify(view).includes(text));
  const writes = store.writes;
  await assert.rejects(() =>
    backend.createProject("Bearer client", "tenant-a", input),
  );
  await assert.rejects(() =>
    backend.editProject("Bearer client", "tenant-a", "delivery-0", 2, {
      progress: 50,
    }),
  );
  await assert.rejects(() =>
    backend.publishProject("Bearer client", "tenant-a", "delivery-0", 2, true),
  );
  assert.equal(store.writes, writes);
});
test("editor is project-scoped and cannot change roles, source, identity or publication fields", async () => {
  const { backend, store } = setup();
  await backend.editProject("Bearer editor", "tenant-a", "delivery-0", 1, {
    progress: 25,
  });
  assert.equal(store.snapshot("tenant-a").state.projects[0].progress, 25);
  for (const patch of [
    { role: "administrator" },
    { published: true },
    { id: "hijack" },
    { raw: [] },
    { agreementId: "other" },
    { internalNotes: "secret" },
  ])
    await assert.rejects(() =>
      backend.editProject("Bearer editor", "tenant-a", "delivery-0", 2, patch),
    );
  await assert.rejects(() =>
    backend.editProject("Bearer editor", "tenant-a", "delivery-1", 2, {
      progress: 50,
    }),
  );
  await assert.rejects(() =>
    backend.publishProject("Bearer editor", "tenant-a", "delivery-0", 2, false),
  );
  assert.equal(store.writes, 1);
});
test("privileged updates atomically audit verified actor and preserve source data", async () => {
  const { backend, store } = setup();
  const raw = store.snapshot("tenant-a").state.raw;
  await backend.editProject("Bearer admin", "tenant-a", "delivery-0", 1, {
    name: "Reviewed",
    progress: 40,
  });
  const record = store.snapshot("tenant-a");
  assert.equal(record.audits.length, 1);
  assert.equal(record.audits[0].actor, "admin");
  assert.deepEqual(record.state.raw, raw);
  await assert.rejects(() =>
    backend.editProject("Bearer admin", "tenant-a", "delivery-0", 2, {
      progress: 101,
    }),
  );
  assert.equal(store.snapshot("tenant-a").audits.length, 1);
});
test("no-op edits/read produce no persistence or audits; conflicts do not publish writes", async () => {
  const { backend, store } = setup();
  await backend.readPublished("Bearer admin", "tenant-a", { month: "2026-10" });
  await backend.editProject("Bearer admin", "tenant-a", "delivery-0", 1, {
    progress: 0,
  });
  assert.equal(store.writes, 0);
  const results = await Promise.allSettled([
    backend.editProject("Bearer admin", "tenant-a", "delivery-0", 1, {
      progress: 1,
    }),
    backend.editProject("Bearer admin", "tenant-a", "delivery-0", 1, {
      progress: 2,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(store.writes, 1);
  assert.equal(store.snapshot("tenant-a").audits.length, 1);
});
test("new persisted projects are always private; explicit administrator publication is audited", async () => {
  const { backend, store } = setup();
  await assert.rejects(() =>
    backend.createProject("Bearer admin", "tenant-a", {
      ...input,
      published: true,
    } as typeof input),
  );
  const p = await backend.createProject("Bearer admin", "tenant-a", input);
  assert.equal(p.published, false);
  await backend.publishProject("Bearer admin", "tenant-a", p.id, 2, true);
  assert.ok(
    (
      await backend.readPublished("Bearer client", "tenant-a", {
        month: "2026-10",
      })
    ).projects.some((x) => x.id === p.id),
  );
  assert.equal(
    store.snapshot("tenant-a").audits[1].action,
    "publication-changed",
  );
});
test("scoped paths reject traversal and integration adapters never call network", async () => {
  assert.equal(
    tenantPath("tenant-a", "rawTime", "source-1"),
    "tenants/tenant-a/rawTime/source-1",
  );
  assert.throws(() => tenantPath("tenant-a", "rawTime", "../x"));
  await assert.rejects(() => disabledAccounting.readCustomers());
  await assert.rejects(() => disabledTime.readTimesheets());
});
import { sourceRecordId } from "./contracts";
test("external source IDs are namespaced by product and company", () => {
  const a = sourceRecordId("qbo-accounting", "company-one", "123");
  assert.notEqual(a, sourceRecordId("quickbooks-time", "company-one", "123"));
  assert.notEqual(a, sourceRecordId("qbo-accounting", "company-two", "123"));
  assert.equal(a, sourceRecordId("qbo-accounting", "company-one", "123"));
});
test("client agreement scope hides unauthorized agreement metadata, not just project rows", async () => {
  const { backend, store } = setup();
  await store.transaction("tenant-a", (r) => {
    r.state.agreements.push({
      ...structuredClone(r.state.agreements[0]),
      id: "restricted-agreement",
      name: "PRIVATE AGREEMENT",
    });
  });
  const view = await backend.readPublished("Bearer client", "tenant-a", {
    month: "2026-10",
  });
  assert.ok(!JSON.stringify(view).includes("PRIVATE AGREEMENT"));
  await assert.rejects(() =>
    backend.readPublished("Bearer client", "tenant-a", {
      month: "2026-10",
      agreementId: "restricted-agreement",
    }),
  );
});
test("membership revocation is rechecked for subsequent requests", async () => {
  const { backend, store } = setup();
  await backend.readPublished("Bearer client", "tenant-a", {
    month: "2026-10",
  });
  await store.transaction("tenant-a", (r) => {
    r.memberships.find((m) => m.subject === "client")!.enabled = false;
  });
  await assert.rejects(() =>
    backend.readPublished("Bearer client", "tenant-a", { month: "2026-10" }),
  );
});
