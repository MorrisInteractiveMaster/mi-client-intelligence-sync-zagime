import { seedSynthetic } from "../server/synthetic-seed";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { m5Fixture } from "./m5-fixture";
import { key } from "../server/firestore-store";
import { bootstrapAdministrator, pruneIdempotency } from "../server/bootstrap";
import { Timestamp } from "firebase-admin/firestore";
let f: Awaited<ReturnType<typeof m5Fixture>>;
const tokens: Record<string, string> = {};
before(async () => {
  f = await m5Fixture();
  for (const uid of [
    "m5-admin",
    "m5-editor",
    "m5-narrow",
    "m5-client",
    "m5-unknown",
  ])
    tokens[uid] = await f.token(uid);
});
after(async () => {
  await f?.close();
});
const path = "/api/tenants/m5-lab/";
async function req(
  resource: string,
  who = "m5-admin",
  method = "GET",
  body?: unknown,
  keyValue?: string,
) {
  return fetch(f.base + path + resource, {
    method,
    headers: {
      Authorization: "Bearer " + tokens[who],
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(keyValue ? { "Idempotency-Key": keyValue } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
const payload = {
  agreementId: "agreement-demo",
  departmentId: "health",
  name: "Synthetic private delivery",
  plan: { basis: "fixed", minutes: 120 },
};
const newKey = () => `${Date.now()}-${crypto.randomUUID()}`;
const rev = async () => (await f.root.get()).data()!.revision as number;
test("staff bootstrap and bounded pages enforce membership, tenant, roles, and privacy", async () => {
  assert.equal((await req("workspace", "m5-unknown")).status, 403);
  const ws = (await (await req("workspace", "m5-editor")).json()) as any;
  assert.equal(ws.role, "editor");
  assert.equal(ws.canCreate, true);
  assert.equal(
    ((await (await req("workspace", "m5-narrow")).json()) as any).canCreate,
    false,
  );
  const client = (await (await req("workspace", "m5-client")).json()) as any;
  assert.deepEqual(client.agreements, []);
  assert.deepEqual(client.departments, []);
  for (const r of [
    "projects?month=2026-10",
    "sources?month=2026-10",
    "sources/raw-demo/history?month=2026-10",
  ])
    assert.equal((await req(r, "m5-client")).status, 403);
  assert.equal(
    (
      await fetch(f.base + "/api/tenants/not-assigned/workspace", {
        headers: { Authorization: "Bearer " + tokens["m5-editor"] },
      })
    ).status,
    403,
  );
  assert.equal((await req("projects?month=2026-10&limit=26")).status, 400);
  assert.equal(
    (await req("projects?month=2026-10&cursor=bad%2Fcursor")).status,
    400,
  );
  let cursor = "",
    ids: string[] = [];
  do {
    const p = (await (
      await req(
        "projects?month=2026-10&limit=2" + (cursor ? "&cursor=" + cursor : ""),
      )
    ).json()) as any;
    ids.push(...p.projects.map((p: any) => p.id));
    cursor = p.nextCursor ?? "";
  } while (cursor);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, (await f.root.collection("projects").get()).size);
  const narrow = (await (
    await req("sources?month=2026-10", "m5-narrow")
  ).json()) as any;
  assert.ok(narrow.sources.some((s: any) => s.id === "raw-demo"));
  assert.ok(!narrow.sources.some((s: any) => s.id === "unallocated"));
  const report = (await (
    await req("report?month=2026-10", "m5-client")
  ).json()) as any;
  assert.ok(
    !/sourcePerson|rawTime|internalNotes|allocation|workOrderReference/.test(
      JSON.stringify(report),
    ),
  );
});
test("concurrent idempotent creates return one private project, one audit, same result and reject conflicting reuse", async () => {
  const k = newKey(),
    beforeRevision = await rev(),
    beforeAudits = (await f.root.collection("audits").get()).size;
  assert.equal(
    (await req("projects", "m5-admin", "POST", payload)).status,
    400,
  );
  const results = await Promise.all([
    req("projects", "m5-editor", "POST", payload, k),
    req("projects", "m5-editor", "POST", payload, k),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  const a = (await results[0].json()) as any,
    b = (await results[1].json()) as any;
  assert.deepEqual(a, b);
  assert.equal(a.published, false);
  assert.equal(await rev(), beforeRevision + 1);
  assert.equal(
    (await f.root.collection("audits").get()).size,
    beforeAudits + 1,
  );
  assert.equal(
    (
      await req(
        "projects",
        "m5-editor",
        "POST",
        { ...payload, name: "Conflicting reuse" },
        k,
      )
    ).status,
    409,
  );
  assert.equal(
    (await req("projects", "m5-narrow", "POST", payload, newKey())).status,
    403,
  );
  assert.equal(
    (await req("projects", "m5-client", "POST", payload, newKey())).status,
    403,
  );
  assert.equal(
    (
      await req(
        "projects",
        "m5-editor",
        "POST",
        payload,
        `${Date.now() - 2 * 86400000}-${crypto.randomUUID()}`,
      )
    ).status,
    400,
  );
  await f.root
    .collection("memberships")
    .doc(key("m5-editor"))
    .update({ enabled: false });
  assert.equal(
    (await req("projects", "m5-editor", "POST", payload, k)).status,
    403,
  );
  await f.root
    .collection("memberships")
    .doc(key("m5-editor"))
    .update({ enabled: true });
  assert.deepEqual(
    await (await req("projects", "m5-editor", "POST", payload, k)).json(),
    a,
  );
  const record = (await f.root.collection("idempotency").get()).docs[0].data();
  assert.equal(record.actor, "m5-editor");
  assert.equal(record.operation, "create-project");
});
test("project plans/work-order references, scope, publication, no-ops and concurrent revision edits", async () => {
  const edit = {
    name: "Secure planned delivery",
    progress: 35,
    plan: { basis: "monthly", minutes: 420 },
    workOrderReference: "SYNTHETIC-REFERENCE",
  };
  const n = await rev();
  assert.equal(
    (
      await req("projects/delivery-0", "m5-narrow", "PATCH", {
        expectedRevision: n,
        patch: edit,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req("projects/delivery-1", "m5-narrow", "PATCH", {
        expectedRevision: await rev(),
        patch: { name: "Denied" },
      })
    ).status,
    403,
  );
  const noOp = await rev(),
    audits = (await f.root.collection("audits").get()).size;
  assert.equal(
    (
      await req("projects/delivery-0", "m5-narrow", "PATCH", {
        expectedRevision: noOp,
        patch: edit,
      })
    ).status,
    200,
  );
  assert.equal(await rev(), noOp);
  assert.equal((await f.root.collection("audits").get()).size, audits);
  assert.equal(
    (
      await req("projects/delivery-0/publication", "m5-editor", "PATCH", {
        expectedRevision: await rev(),
        published: false,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await req("projects/delivery-0/publication", "m5-admin", "PATCH", {
        expectedRevision: await rev(),
        published: false,
      })
    ).status,
    200,
  );
  let report = (await (
    await req("report?month=2026-10", "m5-client")
  ).json()) as any;
  assert.ok(!report.projects.some((p: any) => p.id === "delivery-0"));
  assert.equal(
    (
      await req("projects/delivery-0/publication", "m5-admin", "PATCH", {
        expectedRevision: await rev(),
        published: true,
      })
    ).status,
    200,
  );
  report = (await (
    await req("report?month=2026-10", "m5-client")
  ).json()) as any;
  assert.equal(
    report.projects.find((p: any) => p.id === "delivery-0").plan.minutes,
    420,
  );
  assert.ok(!JSON.stringify(report).includes("SYNTHETIC-REFERENCE"));
  const version = await rev(),
    rs = await Promise.all([
      req("projects/delivery-0", "m5-editor", "PATCH", {
        expectedRevision: version,
        patch: { progress: 41 },
      }),
      req("projects/delivery-0", "m5-editor", "PATCH", {
        expectedRevision: version,
        patch: { progress: 42 },
      }),
    ]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    (
      await req("projects/delivery-0", "m5-editor", "PATCH", {
        expectedRevision: await rev(),
        patch: { published: true, role: "administrator" },
      })
    ).status,
    403,
  );
});
test("split allocation reconciliation preserves source and historical monthly/lifetime counters with atomic audits", async () => {
  const raw = (await f.root.collection("rawTime").doc("raw-demo").get()).data(),
    v = await rev();
  const portions = [
    { projectId: "delivery-0", seconds: 14400, description: "four" },
    { projectId: "delivery-1", seconds: 7200, description: "two" },
  ];
  const a = (await f.root.collection("audits").get()).size;
  assert.equal(
    (
      await req("allocations/raw-demo", "m5-editor", "PATCH", {
        expectedRevision: v,
        portions,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    (await f.root.collection("rawTime").doc("raw-demo").get()).data(),
    raw,
  );
  assert.equal((await f.root.collection("audits").get()).size, a + 1);
  const page = (await (await req("projects?month=2026-10")).json()) as any;
  assert.equal(
    page.projects.find((p: any) => p.id === "delivery-0").seconds,
    14400,
  );
  assert.equal(
    page.projects.find((p: any) => p.id === "delivery-0").lifetimeSeconds,
    18000,
  );
  const old = (await (await req("projects?month=2026-09")).json()) as any;
  assert.equal(
    old.projects.find((p: any) => p.id === "delivery-0").seconds,
    3600,
  );
  const src = (await (await req("sources?month=2026-10")).json()) as any;
  assert.equal(
    src.sources.find((r: any) => r.id === "raw-demo").unallocatedSeconds,
    7200,
  );
  const history = (await (
    await req("sources/raw-demo/history?month=2026-10&limit=1")
  ).json()) as any;
  assert.equal(history.history.length, 1);
  assert.equal(history.history[0].actor, "m5-editor");
  assert.ok(history.nextCursor);
  const prev = (await (
    await req(
      "sources/raw-demo/history?month=2026-10&limit=1&cursor=" +
        history.nextCursor,
    )
  ).json()) as any;
  assert.ok(prev.history[0].revision < history.history[0].revision);
  assert.equal(
    (await req("sources/raw-demo/history?month=2026-10", "m5-narrow")).status,
    403,
  );
  assert.equal(
    (
      await req("allocations/raw-demo", "m5-narrow", "PATCH", {
        expectedRevision: await rev(),
        portions,
      })
    ).status,
    403,
  );
  const noOp = await rev();
  assert.equal(
    (
      await req("allocations/raw-demo", "m5-editor", "PATCH", {
        expectedRevision: noOp,
        portions,
      })
    ).status,
    200,
  );
  assert.equal(await rev(), noOp);
  await f.root
    .collection("allocationHeads")
    .doc("raw-demo")
    .update({ sourceRevision: "unreconciled-source-change" });
  const conflict = (await (await req("sources?month=2026-10")).json()) as any;
  assert.equal(
    conflict.sources.find((r: any) => r.id === "raw-demo").conflict,
    true,
  );
  assert.equal(
    (
      await req("allocations/raw-demo", "m5-admin", "PATCH", {
        expectedRevision: await rev(),
        portions: [],
      })
    ).status,
    409,
  );
  assert.equal(await rev(), noOp);
  await f.root
    .collection("allocationHeads")
    .doc("raw-demo")
    .update({ sourceRevision: raw!.record.revision });
  assert.equal((await req("sources?month=2026-10")).status, 200);
});
test("membership disable/revoke and Firebase disabled/revoked users block staff reads and retries", async () => {
  const member = f.root.collection("memberships").doc(key("m5-narrow"));
  for (const field of ["enabled", "approved"]) {
    await member.update({ [field]: false });
    assert.equal((await req("workspace", "m5-narrow")).status, 403);
    assert.equal((await req("sources?month=2026-10", "m5-narrow")).status, 403);
    await member.update({ [field]: true });
  }
  await f.runtime.auth.updateUser("m5-narrow", { disabled: true });
  assert.equal((await req("projects?month=2026-10", "m5-narrow")).status, 401);
  await f.runtime.auth.updateUser("m5-narrow", { disabled: false });
  await new Promise((r) => setTimeout(r, 1100));
  await f.runtime.auth.revokeRefreshTokens("m5-narrow");
  assert.equal((await req("workspace", "m5-narrow")).status, 401);
  tokens["m5-narrow"] = await f.token("m5-narrow");
  assert.equal((await req("workspace", "m5-narrow")).status, 200);
});
test("first-admin provisioning is provider-verified, dry-run, auditable, race-safe and permanently locked after revocation", async () => {
  const root = f.runtime.db.doc("tenants/bootstrap-lab");
  await root.set({ name: "Synthetic bootstrap tenant", revision: 1 });
  const approval = {
    approved: true as const,
    uid: "m5-first",
    tenantId: "bootstrap-lab",
    role: "administrator" as const,
    providerId: "google.com" as const,
    providerUid: "synthetic-provider-first",
    approvalReference: "SYNTHETIC-REVIEW-ONLY",
  };
  await assert.rejects(() =>
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, {
      ...approval,
      approved: false as any,
    }),
  );
  await assert.rejects(() =>
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, {
      ...approval,
      uid: "unknown-uid",
    }),
  );
  await assert.rejects(() =>
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, {
      ...approval,
      providerUid: "wrong-identity",
    }),
  );
  assert.deepEqual(
    await bootstrapAdministrator(f.runtime.db, f.runtime.auth, approval),
    { changed: true, dryRun: true },
  );
  assert.equal((await root.collection("memberships").get()).size, 0);
  const results = await Promise.all([
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, approval, true),
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, approval, true),
  ]);
  assert.equal(results.filter((r) => r.changed).length, 1);
  assert.equal((await root.collection("audits").get()).size, 1);
  await root
    .collection("memberships")
    .doc(key("m5-first"))
    .update({ enabled: false });
  await assert.rejects(() =>
    bootstrapAdministrator(f.runtime.db, f.runtime.auth, approval, true),
  );
  await assert.rejects(() =>
    bootstrapAdministrator(
      f.runtime.db,
      f.runtime.auth,
      { ...approval, role: "editor" as any },
      true,
    ),
  );
});
test("idempotency cleanup is bounded, dry-run, audited and retains original business audits", async () => {
  const ref = f.root.collection("idempotency").doc("expired-synthetic");
  await ref.set({ expiresAt: Timestamp.fromMillis(1) });
  const before = (await f.root.collection("audits").get()).size;
  assert.equal((await pruneIdempotency(f.runtime.db, "m5-lab")).count, 1);
  assert.ok((await ref.get()).exists);
  assert.equal((await pruneIdempotency(f.runtime.db, "m5-lab", true)).count, 1);
  assert.ok(!(await ref.get()).exists);
  assert.equal((await f.root.collection("audits").get()).size, before + 1);
  const r = await rev();
  assert.equal((await pruneIdempotency(f.runtime.db, "m5-lab", true)).count, 0);
  assert.equal(await rev(), r);
});

test("synthetic initializer dry-runs, never adds users, creates private projects and refuses overwrite", async () => {
  await assert.rejects(() => seedSynthetic(f.runtime.db, "real-tenant", true));
  const result = await seedSynthetic(f.runtime.db, "synthetic-seed-check");
  assert.equal(result.dryRun, true);
  assert.ok(
    !(await f.runtime.db.doc("tenants/synthetic-seed-check").get()).exists,
  );
  assert.equal(
    (await seedSynthetic(f.runtime.db, "synthetic-seed-check", true))
      .usersCreated,
    0,
  );
  const ps = await f.runtime.db
    .collection("tenants/synthetic-seed-check/projects")
    .get();
  assert.ok(ps.size > 0);
  assert.ok(ps.docs.every((d) => d.data().published === false));
  await assert.rejects(() =>
    seedSynthetic(f.runtime.db, "synthetic-seed-check", true),
  );
});

test("editor cannot overwrite an unauthorized intended allocation during reconciliation", async () => {
  const head = f.root.collection("allocationHeads").doc("september"),
    old = (await head.get()).data()!;
  await head.update({
    portions: [
      {
        projectId: "delivery-1",
        seconds: 3600,
        description: "Synthetic pending other-project allocation",
      },
    ],
  });
  const before = await rev(),
    audits = (await f.root.collection("audits").get()).size;
  assert.equal(
    (
      await req("allocations/september", "m5-narrow", "PATCH", {
        expectedRevision: before,
        portions: old.appliedPortions,
      })
    ).status,
    403,
  );
  assert.equal(
    (await req("sources/september/history?month=2026-09", "m5-narrow")).status,
    403,
  );
  assert.equal(await rev(), before);
  assert.equal((await f.root.collection("audits").get()).size, audits);
  await head.set(old);
});
