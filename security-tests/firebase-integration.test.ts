import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  firebaseRuntime,
  FirebaseIdentityVerifier,
  type FirebaseRuntime,
} from "../server/firebase";
import { FirestoreTenantStore, key } from "../server/firestore-store";
import { ReportingBackend } from "../server/backend";
import { apiServer, RequestLimit } from "../server/http";
import { demo, allocate, project } from "../src/reporting/model";
import type { Membership } from "../server/contracts";
let runtime: FirebaseRuntime,
  backend: ReportingBackend,
  base: string,
  server: ReturnType<typeof apiServer>;
const tokens: Record<string, string> = {};
async function login(name: string) {
  const r = await fetch(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `${name}@example.com`,
        password: "synthetic-emulator-only-password",
        returnSecureToken: true,
      }),
    },
  );
  const b = (await r.json()) as any;
  if (!r.ok) throw Error("Synthetic sign-in failed");
  return b.idToken as string;
}
async function seed() {
  let s = demo();
  s.tenant = { id: "m4-a", name: "Synthetic tenant A" };
  s.agreements[0].tenantId = "m4-a";
  s.raw.forEach((r) => (r.tenantId = "m4-a"));
  s.raw.push({
    ...s.raw[0],
    id: "september",
    date: "2026-09-12",
    seconds: 7200,
  });
  s = allocate(
    s,
    "raw-demo",
    [
      { projectId: "delivery-0", seconds: 18000, description: "five" },
      { projectId: "delivery-1", seconds: 10800, description: "three" },
    ],
    "synthetic",
  );
  s = allocate(
    s,
    "september",
    [{ projectId: "delivery-0", seconds: 7200, description: "historical" }],
    "synthetic",
  );
  const root = runtime.db.doc("tenants/m4-a");
  const batch = runtime.db.batch();
  batch.set(root, { name: s.tenant.name, revision: 1 });
  for (const a of s.agreements) {
    const { caps, ...meta } = a;
    batch.set(root.collection("agreements").doc(a.id), meta);
    for (const c of caps)
      batch.set(
        root
          .collection("agreementCapRevisions")
          .doc(key(a.id, c.month, String(c.revision))),
        { ...c, agreementId: a.id },
      );
  }
  for (const d of s.departments)
    batch.set(root.collection("departments").doc(d.id), d);
  for (const b of s.budgets)
    batch.set(
      root
        .collection("departmentBudgets")
        .doc(key(b.agreementId, b.departmentId, b.month)),
      b,
    );
  const lifetime = project(s);
  for (const p of s.projects) {
    batch.set(root.collection("projects").doc(p.id), p);
    batch.set(root.collection("projectViews").doc(p.id), {
      ...lifetime.projects.find((x) => x.id === p.id)!,
      published: p.published,
    });
    for (const month of ["2026-09", "2026-10"])
      batch.set(root.collection("projectPeriods").doc(key(month, p.id)), {
        projectId: p.id,
        month,
        seconds: project(s, { month }).projects.find((x) => x.id === p.id)!
          .seconds,
      });
  }
  for (const r of s.raw)
    batch.set(root.collection("rawTime").doc(r.id), {
      source: "synthetic",
      record: r,
    });
  for (const a of s.allocations)
    batch.set(
      root
        .collection("allocationRevisions")
        .doc(key(a.sourceId, String(a.revision))),
      a,
    );
  for (const a of s.allocations)
    batch.set(root.collection("allocationHeads").doc(a.sourceId), {
      revision: a.revision,
      portions: a.portions,
      appliedPortions: a.portions,
    });
  for (const [subject, role, enabled] of [
    ["admin", "administrator", true],
    ["editor", "editor", true],
    ["client", "client", true],
    ["disabled", "client", true],
    ["revoked", "client", true],
    ["unapproved", "client", true],
  ] as const) {
    const m: Membership = {
      tenantId: "m4-a",
      subject,
      role,
      enabled,
      approved: subject !== "unapproved",
      agreementIds: ["agreement-demo"],
      projectIds:
        role === "editor" ? ["delivery-0"] : "all-authorized-agreements",
    };
    batch.set(root.collection("memberships").doc(key(subject)), m);
  }
  await batch.commit();
  await runtime.db
    .doc("tenants/other")
    .set({ name: "Other private tenant", revision: 1 });
}
before(async () => {
  runtime = firebaseRuntime("emulator", "demo-mi-security");
  for (const uid of [
    "admin",
    "editor",
    "client",
    "disabled",
    "revoked",
    "unapproved",
  ]) {
    await runtime.auth.createUser({
      uid,
      email: `${uid}@example.com`,
      password: "synthetic-emulator-only-password",
      emailVerified: true,
    });
    tokens[uid] = await login(uid);
  }
  await seed();
  backend = new ReportingBackend(
    new FirestoreTenantStore(runtime.db),
    new FirebaseIdentityVerifier(runtime.auth),
    {
      issuer: "https://securetoken.google.com/demo-mi-security",
      audience: "demo-mi-security",
      now: Date.now,
    },
  );
  server = apiServer(backend, {
    allowedOrigin: "http://approved.test",
    limit: new RequestLimit(500),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await runtime?.close();
});
async function request(
  path: string,
  who = "admin",
  method = "GET",
  body?: unknown,
  extra: Record<string, string> = {},
) {
  return fetch(base + path, {
    method,
    headers: {
      Authorization: `Bearer ${tokens[who] ?? who}`,
      ...(method === "POST" ? { "Idempotency-Key": `${Date.now()}-${crypto.randomUUID()}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test("real Auth emulator identity + Firestore server transaction enforces membership and tenant", async () => {
  assert.equal(
    (await fetch(base + "/api/tenants/m4-a/report?month=2026-10")).status,
    401,
  );
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "forged")).status,
    401,
  );
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "unapproved"))
      .status,
    403,
  );
  assert.equal(
    (await request("/api/tenants/other/report?month=2026-10", "client")).status,
    403,
  );
  const r = await request("/api/tenants/m4-a/report?month=2026-10", "client");
  assert.equal(r.status, 200);
  const v = (await r.json()) as any;
  assert.equal(v.totalSeconds, 28800);
  assert.equal(
    v.projects.find((p: any) => p.id === "delivery-0").lifetimeSeconds,
    25200,
  );
  assert.equal(v.revision, 1);
  assert.ok(!JSON.stringify(v).includes("internalNotes"));
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-09", "client")).status,
    200,
  );
});
test("client writes and editor escalation/scope are denied through HTTP", async () => {
  const payload = {
    agreementId: "agreement-demo",
    departmentId: "health",
    name: "Private create",
    plan: { basis: "fixed", minutes: 60 },
  };
  assert.equal(
    (await request("/api/tenants/m4-a/projects", "client", "POST", payload))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/projects/delivery-0",
        "editor",
        "PATCH",
        { expectedRevision: 1, patch: { role: "administrator" } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/projects/delivery-1",
        "editor",
        "PATCH",
        { expectedRevision: 1, patch: { progress: 20 } },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/projects/delivery-0/publication",
        "editor",
        "PATCH",
        { expectedRevision: 1, published: false },
      )
    ).status,
    403,
  );
});
test("private creation, administrator publication, atomic audit and immutable raw/history", async () => {
  const rawBefore = (
    await runtime.db.collection("tenants/m4-a/rawTime").get()
  ).docs.map((d) => d.data());
  const historyBefore = (
    await runtime.db.collection("tenants/m4-a/allocationRevisions").get()
  ).docs.map((d) => d.data());
  let r = await request("/api/tenants/m4-a/projects", "admin", "POST", {
    agreementId: "agreement-demo",
    departmentId: "health",
    name: "Persistent private project",
    plan: { basis: "fixed", minutes: 120 },
  });
  assert.equal(r.status, 201);
  const p = (await r.json()) as any;
  assert.equal(p.published, false);
  let report = (await (
    await request("/api/tenants/m4-a/report?month=2026-10", "client")
  ).json()) as any;
  assert.ok(!report.projects.some((x: any) => x.id === p.id));
  assert.equal(report.revision, 2);
  r = await request(
    `/api/tenants/m4-a/projects/${p.id}/publication`,
    "admin",
    "PATCH",
    { expectedRevision: 2, published: true },
  );
  assert.equal(r.status, 200);
  report = (await (
    await request("/api/tenants/m4-a/report?month=2026-10", "client")
  ).json()) as any;
  assert.ok(report.projects.some((x: any) => x.id === p.id));
  const audits = await runtime.db.collection("tenants/m4-a/audits").get();
  assert.equal(audits.size, 2);
  assert.ok(audits.docs.every((d) => d.data().actor === "admin"));
  assert.deepEqual(
    (await runtime.db.collection("tenants/m4-a/rawTime").get()).docs.map((d) =>
      d.data(),
    ),
    rawBefore,
  );
  assert.deepEqual(
    (
      await runtime.db.collection("tenants/m4-a/allocationRevisions").get()
    ).docs.map((d) => d.data()),
    historyBefore,
  );
});
test("concurrent Firestore updates enforce revision once; no-op/invalid writes do not append audits", async () => {
  const before = (await runtime.db.collection("tenants/m4-a/audits").get())
    .size;
  const rs = await Promise.all([
    request("/api/tenants/m4-a/projects/delivery-0", "editor", "PATCH", {
      expectedRevision: 3,
      patch: { progress: 10 },
    }),
    request("/api/tenants/m4-a/projects/delivery-0", "editor", "PATCH", {
      expectedRevision: 3,
      patch: { progress: 20 },
    }),
  ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (await runtime.db.collection("tenants/m4-a/audits").get()).size,
    before + 1,
  );
  const p = (
    await runtime.db.doc("tenants/m4-a/projects/delivery-0").get()
  ).data()!;
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/projects/delivery-0",
        "editor",
        "PATCH",
        { expectedRevision: 4, patch: { progress: p.progress } },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/projects/delivery-0",
        "editor",
        "PATCH",
        { expectedRevision: 4, patch: { progress: 999 } },
      )
    ).status,
    400,
  );
  assert.equal(
    (await runtime.db.collection("tenants/m4-a/audits").get()).size,
    before + 1,
  );
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "client")).status,
    200,
  );
});
test("disabled and revoked Firebase users are refused even with prior ID tokens", async () => {
  await runtime.auth.updateUser("disabled", { disabled: true });
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "disabled"))
      .status,
    401,
  );
  await new Promise((r) => setTimeout(r, 1100));
  await runtime.auth.revokeRefreshTokens("revoked");
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "revoked")).status,
    401,
  );
  await runtime.auth.updateUser("disabled", { disabled: false });
  tokens.disabled = await login("disabled");
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "disabled"))
      .status,
    200,
  );
});
test("HTTP input limits, origin checks and controlled errors do not reveal backend details", async () => {
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=bad", "client")).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/report?month=2026-10",
        "client",
        "GET",
        undefined,
        { Origin: "http://untrusted.test" },
      )
    ).status,
    403,
  );
  const large = await request("/api/tenants/m4-a/projects", "admin", "POST", {
    name: "x".repeat(20000),
  });
  assert.equal(large.status, 413);
  const invalid = await request("/api/tenants/m4-a/projects", "admin", "POST", {
    role: "administrator",
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: "invalid_request" });
});
test("secure allocations keep immutable source/history and update monthly/lifetime summaries atomically", async () => {
  let report = (await (
    await request("/api/tenants/m4-a/report?month=2026-10", "admin")
  ).json()) as any;
  const revision = report.revision;
  const raw = (
    await runtime.db.doc("tenants/m4-a/rawTime/raw-demo").get()
  ).data();
  const prior = (
    await runtime.db.collection("tenants/m4-a/allocationRevisions").get()
  ).size;
  const beforeAudits = (
    await runtime.db.collection("tenants/m4-a/audits").get()
  ).size;
  const payload = {
    expectedRevision: revision,
    portions: [
      {
        projectId: "delivery-0",
        seconds: 14400,
        description: "Morris allocation",
      },
      { projectId: "delivery-1", seconds: 10800, description: "" },
    ],
  };
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/allocations/raw-demo",
        "client",
        "PATCH",
        payload,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/allocations/raw-demo",
        "admin",
        "PATCH",
        {
          ...payload,
          portions: [
            { projectId: "delivery-0", seconds: 40000, description: "" },
          ],
        },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/allocations/raw-demo",
        "admin",
        "PATCH",
        payload,
      )
    ).status,
    200,
  );
  report = (await (
    await request("/api/tenants/m4-a/report?month=2026-10", "client")
  ).json()) as any;
  assert.equal(report.totalSeconds, 25200);
  assert.equal(
    report.projects.find((p: any) => p.id === "delivery-0").lifetimeSeconds,
    21600,
  );
  const sep = (await (
    await request("/api/tenants/m4-a/report?month=2026-09", "client")
  ).json()) as any;
  assert.equal(sep.totalSeconds, 7200);
  assert.deepEqual(
    (await runtime.db.doc("tenants/m4-a/rawTime/raw-demo").get()).data(),
    raw,
  );
  assert.equal(
    (await runtime.db.collection("tenants/m4-a/allocationRevisions").get())
      .size,
    prior + 1,
  );
  assert.equal(
    (await runtime.db.collection("tenants/m4-a/audits").get()).size,
    beforeAudits + 1,
  );
  assert.equal(
    (
      await request(
        "/api/tenants/m4-a/allocations/raw-demo",
        "admin",
        "PATCH",
        { ...payload, expectedRevision: report.revision },
      )
    ).status,
    200,
  );
  assert.equal(
    (await runtime.db.collection("tenants/m4-a/audits").get()).size,
    beforeAudits + 1,
  );
});
test("persisted summary failure rolls back allocation/audit and recovers after trusted repair", async () => {
  const root = runtime.db.doc("tenants/m4-a");
  const before = root.collection("projectViews").doc("delivery-0");
  const saved = (await before.get()).data()!;
  const revision = (await root.get()).data()!.revision;
  const auditCount = (await root.collection("audits").get()).size;
  const historyCount = (await root.collection("allocationRevisions").get())
    .size;
  await before.update({ lifetimeSeconds: -1 });
  const bad = await request(
    "/api/tenants/m4-a/allocations/raw-demo",
    "admin",
    "PATCH",
    {
      expectedRevision: revision,
      portions: [
        {
          projectId: "delivery-0",
          seconds: 14400,
          description: "changed description",
        },
        { projectId: "delivery-1", seconds: 10800, description: "" },
      ],
    },
  );
  assert.ok(bad.status >= 400);
  assert.equal((await root.get()).data()!.revision, revision);
  assert.equal((await root.collection("audits").get()).size, auditCount);
  assert.equal(
    (await root.collection("allocationRevisions").get()).size,
    historyCount,
  );
  await before.set(saved);
  assert.equal(
    (await request("/api/tenants/m4-a/report?month=2026-10", "client")).status,
    200,
  );
});
