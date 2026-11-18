import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { firebaseRuntime } from "../server/firebase";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectStore, ProjectBackend } from "../server/project-workspace";
import { TimeClient } from "../server/time-client";
import { TimeSync } from "../server/time-sync";
import { sourceRecordId, type VerifiedIdentity } from "../server/contracts";
import { apiServer } from "../server/http";
import type { ReportingBackend } from "../server/backend";
import { key } from "../server/firestore-store";

test("named emulator Time mapping, sync, replay, summary reversal and private reporting", async () => {
  const runtime = firebaseRuntime(
    "emulator",
    "demo-mi-security",
    "mi-client-staging",
  );
  const tenant = "synthetic-time-integration",
    projectId = "synthetic-planning";
  await seedProjectSynthetic(runtime.db, tenant, true);
  const root = runtime.db.doc(`tenants/${tenant}`);
  const original = (
    await root.collection("projects").doc(projectId).get()
  ).data();
  const actor = "time-operator",
    buyer = "time-client";
  await root
    .collection("memberships")
    .doc(key(buyer))
    .set({
      tenantId: tenant,
      subject: buyer,
      role: "client",
      schemaVersion: 2,
      approved: true,
      enabled: true,
      projectIds: [projectId],
    });
  let now = Date.parse("2026-11-02T01:00:00Z");
  const principal = (subject: string): VerifiedIdentity => ({
    subject,
    issuer: "test",
    audience: "test",
    expiresAt: Date.now() + 180000,
    disabled: false,
    revoked: false,
    corporatePolicy: true,
    ...(subject !== buyer ? { staffTenantId: tenant } : {}),
  });
  let calls = 0,
    phase = "initial";
  const api = new TimeClient(
    async () => "fixture",
    async (input) => {
      calls++;
      const url = new URL(String(input));
      const endpoint = url.pathname.split("/").at(-1)!;
      if (endpoint === "current_user")
        return Response.json({
          results: {
            users: {
              7: { id: 7, client_url: "fixture-company", active: true },
            },
          },
        });
      if (endpoint === "jobcodes")
        return Response.json({
          results: {
            jobcodes: url.searchParams.has("parent_ids")
              ? {}
              : { 42: { id: 42, type: "regular", has_children: false } },
          },
          more: false,
        });
      assert.equal(url.searchParams.get("jobcode_ids"), "42");
      const deletion = endpoint === "timesheets_deleted";
      if (deletion && phase === "transport")
        return new Response("private", { status: 500 });
      const timestamp =
        phase === "corrected" || phase === "partial"
          ? "2026-11-02T01:01:00Z"
          : phase === "deleted"
            ? "2026-11-02T01:04:00Z"
            : "2026-11-02T00:58:30Z";
      const active = (phase === "deleted") === deletion;
      const row = {
        id: 501,
        jobcode_id: phase === "scope" ? 43 : 42,
        type: "manual",
        duration: phase === "corrected" || phase === "partial" ? 900 : 1800,
        date:
          phase === "corrected" || phase === "partial"
            ? "2026-10-31"
            : "2026-11-01",
        last_modified: timestamp,
        user_id: 18,
        notes: "private notes",
      };
      const rows = active
        ? {
            501: row,
            ...(phase === "partial" ? { 502: { ...row, id: 502 } } : {}),
          }
        : {};
      return Response.json({ results: { [endpoint]: rows }, more: false });
    },
    async () => {},
  );
  const store = new ProjectStore(runtime.db);
  const sync = new TimeSync(
    store,
    {
      tenant,
      admin: actor,
      account: "99",
      userId: "7",
      clientUrl: "fixture-company",
      jobcodes: ["42"],
      from: "2026-11-01",
    },
    api,
    () => now,
  );
  const backend = new ProjectBackend(
    store,
    {
      async verify(header) {
        return principal(header.slice(7));
      },
    },
    { issuer: "test", audience: "test", now: Date.now },
  );
  const server = apiServer(undefined as unknown as ReportingBackend, {
    projects: backend,
    time: sync,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v2/tenants/${tenant}/`;
  const req = (path: string, body?: unknown, subject = actor) =>
    fetch(base + path, {
      headers: {
        Authorization: "Bearer " + subject,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body
        ? {
            method: path.startsWith("allocations") ? "PATCH" : "POST",
            body: JSON.stringify(body),
          }
        : {}),
    });
  const data = async (r: Response, expected = 200) => {
    const b = await r.json();
    assert.equal(r.status, expected, JSON.stringify(b));
    return b;
  };
  const id = sourceRecordId("quickbooks-time", "99", "501");
  const raw = root.collection("rawTime").doc(id);
  const checkpoint = root
    .collection("syncCheckpoints")
    .doc(key("quickbooks-time", "99", "42"));
  const head = root.collection("allocationHeads").doc(id);
  const view = root.collection("projectViews").doc(projectId);
  try {
    assert.equal((await data(await req("time"))).state, "unmapped");
    await data(await req("time/sync", { jobcodeId: "42" }), 403);
    await data(await req("time/mapping", { jobcodeId: "43", projectId }), 403);
    await data(
      await req(
        "time/mapping",
        { jobcodeId: "42", projectId },
        "staff-without-connector-role",
      ),
      403,
    );
    await data(await req("time", undefined, buyer), 403);
    assert.equal(calls, 0);
    await data(await req("time/mapping", { jobcodeId: "42", projectId }));
    await data(
      await req("time/mapping", {
        jobcodeId: "42",
        projectId: "synthetic-delivery",
      }),
      409,
    );
    phase = "scope";
    await data(await req("time/sync", { jobcodeId: "42" }), 503);
    assert.equal((await raw.get()).exists, false);
    assert.equal((await checkpoint.get()).data()!.through, undefined);
    phase = "transport";
    await data(await req("time/sync", { jobcodeId: "42" }), 503);
    assert.equal((await raw.get()).exists, false);
    phase = "initial";
    assert.equal(
      (await data(await req("time/sync", { jobcodeId: "42" }))).changed,
      1,
    );
    const first = (await raw.get()).data()!;
    assert.equal(first.approval, "unknown");
    assert.ok(!JSON.stringify(first).includes("private notes"));
    await data(
      await req(`allocations/${id}`, {
        expectedRevision: (await root.get()).data()!.revision,
        portions: [{ projectId, seconds: 1800, description: "Manual split" }],
      }),
    );
    assert.equal((await view.get()).data()!.lifetimeSeconds, 1800);
    assert.equal(
      (await data(await req("time?month=2026-11"))).recordedSeconds,
      1800,
    );
    assert.equal(
      (await data(await req("time?month=2026-11"))).unallocatedSeconds,
      0,
    );
    now += 30_000;
    assert.equal(
      (await data(await req("time/sync", { jobcodeId: "42" }))).changed,
      0,
    );
    assert.equal((await raw.collection("versions").get()).size, 1);
    phase = "partial";
    now += 150_000;
    const priorWatermark = (await checkpoint.get()).data()!.through;
    const other = root
      .collection("rawTime")
      .doc(sourceRecordId("quickbooks-time", "99", "502"));
    await other.set({ source: "synthetic" });
    await data(await req("time/sync", { jobcodeId: "42" }), 503);
    assert.equal((await checkpoint.get()).data()!.through, priorWatermark);
    assert.equal((await raw.collection("versions").get()).size, 2);
    await other.delete(); // emulator-only repair of fixture collision
    phase = "corrected";
    assert.equal(
      (await data(await req("time/sync", { jobcodeId: "42" }))).changed,
      0,
    );
    assert.equal((await view.get()).data()!.lifetimeSeconds, 0);
    assert.equal(
      (
        await root
          .collection("projectPeriods")
          .doc(key("2026-11", projectId))
          .get()
      ).data()!.seconds,
      0,
    );
    assert.equal((await head.get()).data()!.needsReview, true);
    assert.equal(
      (await data(await req("time?month=2026-11"))).recordedSeconds,
      0,
    );
    assert.equal(
      (await data(await req("time?month=2026-10"))).unallocatedSeconds,
      900,
    );
    assert.equal((await head.get()).data()!.portions[0].seconds, 1800);
    await data(
      await req(`allocations/${id}`, {
        expectedRevision: (await root.get()).data()!.revision,
        portions: [{ projectId, seconds: 900, description: "Reviewed split" }],
      }),
    );
    assert.equal(
      (
        await root
          .collection("projectPeriods")
          .doc(key("2026-10", projectId))
          .get()
      ).data()!.seconds,
      900,
    );
    phase = "deleted";
    now += 180_000;
    await data(await req("time/sync", { jobcodeId: "42" }));
    assert.equal((await raw.get()).data()!.deleted, true);
    assert.equal((await raw.collection("versions").get()).size, 3);
    assert.equal((await view.get()).data()!.lifetimeSeconds, 0);
    assert.equal(
      (
        await root
          .collection("allocationRevisions")
          .where("sourceId", "==", id)
          .get()
      ).size,
      2,
    );
    assert.deepEqual(
      (await root.collection("projects").doc(projectId).get()).data(),
      original,
    );
    assert.deepEqual(
      (await data(await req("report?month=2026-11", undefined, buyer)))
        .projects,
      [],
    );
    await data(await req("sources?month=2026-11", undefined, buyer), 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});
