import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { firebaseRuntime, FirebaseIdentityVerifier } from "../server/firebase";
import { FirestoreTenantStore, key } from "../server/firestore-store";
import { ReportingBackend } from "../server/backend";
import { apiServer, RequestLimit } from "../server/http";
import { seedSynthetic } from "../server/synthetic-seed";
import { provisionClient } from "../server/client-provisioning";
import {
  staffTestFixture,
  employeeOid,
} from "../server/testing/morris-staff-fixture";
test("M8 real HTTP/Auth/Firestore journey: automatic staff, persistence across sessions, allocation, publication, audit and denial/revocation", async () => {
  const runtime = firebaseRuntime(
    "emulator",
    "demo-mi-security",
    "mi-client-staging",
  );
  const tenant = "synthetic-m8",
    root = runtime.db.doc(`tenants/${tenant}`);
  await seedSynthetic(runtime.db, tenant, true);
  const proof = await staffTestFixture(tenant);
  let microsoftToken = await proof.token();
  const password = "synthetic-local-only-pass";
  for (const uid of ["m8-client", "m8-legacy", "m8-unknown"])
    await runtime.auth.createUser({
      uid,
      email: uid + "@example.com",
      password,
      emailVerified: true,
    });
  await runtime.auth.createUser({
    uid: "m8-email-spoof",
    email: "synthetic-untrusted@morrisinteractive.ca",
    password,
    emailVerified: true,
  });
  await runtime.auth.setCustomUserClaims("m8-unknown", {
    administrator: true,
    staffTenantId: tenant,
    corporatePolicy: true,
  });
  for (const [uid, role] of [
    ["m8-client", "client"],
    ["m8-legacy", "editor"],
  ])
    await root
      .collection("memberships")
      .doc(key(uid))
      .set({
        tenantId: tenant,
        subject: uid,
        role,
        approved: true,
        enabled: true,
        agreementIds: ["agreement-demo"],
        projectIds: "all-authorized-agreements",
      });
  const server = apiServer(
    new ReportingBackend(
      new FirestoreTenantStore(runtime.db),
      new FirebaseIdentityVerifier(runtime.auth, proof.verifier),
      {
        issuer: "https://securetoken.google.com/demo-mi-security",
        audience: "demo-mi-security",
        now: Date.now,
      },
    ),
    { limit: new RequestLimit(10000) },
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/tenants/${tenant}/`;
  const authRequest = async (route: string, payload: any) => {
    const r = await fetch(
      `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${route}?key=synthetic`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const b = (await r.json()) as any;
    assert.equal(r.status, 200, JSON.stringify(b));
    return b;
  };
  const signStaff = () =>
    authRequest("signInWithIdp", {
      requestUri: "http://localhost",
      returnSecureToken: true,
      postBody: new URLSearchParams({
        providerId: "microsoft.com",
        id_token: microsoftToken,
      }).toString(),
    });
  const token = async (uid: string) =>
    (
      await authRequest("signInWithPassword", {
        email: uid + "@example.com",
        password,
        returnSecureToken: true,
      })
    ).idToken;
  let staff: any;
  try {
    staff = await signStaff();
    const clients = await token("m8-client"),
      legacy = await token("m8-legacy"),
      unknown = await token("m8-unknown");
    const spoof = (
      await authRequest("signInWithPassword", {
        email: "synthetic-untrusted@morrisinteractive.ca",
        password,
        returnSecureToken: true,
      })
    ).idToken;
    const request = (
      path: string,
      method = "GET",
      body?: any,
      who = staff.idToken,
      idempotency?: string,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + who,
          ...(who === staff.idToken
            ? {
                "X-Morris-Microsoft-Identity": microsoftToken,
                "X-Morris-Microsoft-Access": "synthetic-delegated-proof",
              }
            : {}),
          ...(body ? { "content-type": "application/json" } : {}),
          ...(idempotency ? { "Idempotency-Key": idempotency } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal(
      (await request("workspace", "GET", undefined, "")).status,
      401,
    );
    assert.equal(
      (await request("workspace", "GET", undefined, legacy)).status,
      403,
    );
    assert.equal(
      (await request("workspace", "GET", undefined, unknown)).status,
      403,
    );
    assert.equal(
      (await request("workspace", "GET", undefined, spoof)).status,
      403,
    );
    const workspace = (await (await request("workspace")).json()) as any;
    assert.equal(workspace.corporateStaff, true);
    assert.equal(workspace.canCreate, true);
    assert.equal(
      (await root.collection("memberships").doc(key(staff.localId)).get())
        .exists,
      false,
    );
    const payload = {
      agreementId: "agreement-demo",
      departmentId: "health",
      name: "M8 synthetic delivery",
      plan: { basis: "fixed", minutes: 120 },
    };
    const createKey = Date.now() + "-" + crypto.randomUUID();
    const created = await request(
      "projects",
      "POST",
      payload,
      undefined,
      createKey,
    );
    assert.equal(created.status, 201);
    const project = (await created.json()) as any;
    assert.equal(project.published, false);
    const replay = await request(
      "projects",
      "POST",
      payload,
      undefined,
      createKey,
    );
    assert.equal(((await replay.json()) as any).id, project.id);
    assert.equal(
      (
        (await request("report?month=2026-10", "GET", undefined, clients).then(
          (r) => r.json(),
        )) as any
      ).projects.some((p: any) => p.id === project.id),
      false,
    );
    const revision = async () => (await root.get()).data()!.revision;
    const edit = {
      expectedRevision: await revision(),
      patch: {
        name: "M8 saved across sessions",
        progress: 25,
        plan: { basis: "fixed", minutes: 180 },
      },
    };
    const concurrent = await Promise.all([
      request("projects/" + project.id, "PATCH", edit),
      request("projects/" + project.id, "PATCH", edit),
    ]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
    // A new authenticated session reads persisted data, independent of React/localStorage.
    const firstStaffUid = staff.localId;
    const secondOid = "44444444-4444-4444-8444-444444444444";
    microsoftToken = await proof.token({ oid: secondOid });
    proof.setUser({
      ...proof.user(),
      id: secondOid,
      userPrincipalName: "synthetic-second@morrisinteractive.ca",
    });
    staff = await signStaff();
    assert.notEqual(staff.localId, firstStaffUid);
    assert.equal(
      (await root.collection("memberships").doc(key(staff.localId)).get())
        .exists,
      false,
    );
    const persisted = (await (
      await request("projects?month=2026-10&limit=25")
    ).json()) as any;
    assert.equal(
      persisted.projects.find((p: any) => p.id === project.id).name,
      "M8 saved across sessions",
    );
    const source = (
      await root.collection("rawTime").doc("raw-demo").get()
    ).data()!;
    const before = JSON.stringify(source);
    assert.equal(
      (
        await request("allocations/raw-demo", "PATCH", {
          expectedRevision: await revision(),
          portions: [
            {
              projectId: project.id,
              seconds: 1800,
              description: "Synthetic split",
            },
            {
              projectId: "delivery-0",
              seconds: 900,
              description: "Synthetic split",
            },
          ],
        })
      ).status,
      200,
    );
    assert.equal(
      JSON.stringify(
        (await root.collection("rawTime").doc("raw-demo").get()).data(),
      ),
      before,
    );
    assert.equal(
      (
        await request(`projects/${project.id}/publication`, "PATCH", {
          expectedRevision: await revision(),
          published: true,
        })
      ).status,
      200,
    );
    const report = (await (
      await request("report?month=2026-10", "GET", undefined, clients)
    ).json()) as any;
    assert.equal(
      report.projects.find((p: any) => p.id === project.id).seconds,
      1800,
    );
    assert.equal(
      report.projects.find((p: any) => p.id === project.id).lifetimeSeconds,
      1800,
    );
    for (const path of [
      "sources?month=2026-10&limit=20",
      "audits?month=2026-10&limit=20",
      "sources/raw-demo/history?month=2026-10&limit=20",
    ])
      assert.equal(
        (await request(path, "GET", undefined, clients)).status,
        403,
      );
    assert.equal(
      (
        await request(
          `projects/${project.id}/publication`,
          "PATCH",
          { expectedRevision: await revision(), published: false },
          clients,
        )
      ).status,
      403,
    );
    assert.equal((await request("audits?month=2026-10&limit=25")).status, 200);
    assert.equal(
      (await request("sources/raw-demo/history?month=2026-10&limit=25")).status,
      200,
    );
    assert.equal(
      (
        await fetch(base.replace(tenant, "other-tenant") + "workspace", {
          headers: {
            Authorization: "Bearer " + staff.idToken,
            "X-Morris-Microsoft-Identity": microsoftToken,
            "X-Morris-Microsoft-Access": "synthetic-delegated-proof",
          },
        })
      ).status,
      403,
    );
    proof.setUser({ ...proof.user(), accountEnabled: false });
    assert.equal((await request("workspace")).status, 401);
    proof.setUser({ ...proof.user(), accountEnabled: true });
    assert.equal((await request("workspace")).status, 200);
    await root
      .collection("memberships")
      .doc(key("m8-client"))
      .update({ enabled: false });
    assert.equal(
      (await request("workspace", "GET", undefined, clients)).status,
      403,
    );
    await runtime.auth.updateUser(staff.localId, { disabled: true });
    assert.equal((await request("workspace")).status, 401);
    assert.ok(proof.calls() > 10);
    assert.equal((await root.collection("memberships").get()).size, 2);
    const clientTenant = "synthetic-m8-client-operator";
    await seedSynthetic(runtime.db, clientTenant, true);
    await runtime.auth.updateUser("m8-client", {
      providerToLink: {
        providerId: "google.com",
        uid: "synthetic-google-client",
      },
    });
    const approval = {
      approved: true,
      tenantId: clientTenant,
      uid: "m8-client",
      agreementIds: ["agreement-demo"],
    };
    assert.equal(
      (await provisionClient(runtime.db, runtime.auth, approval)).dryRun,
      true,
    );
    assert.equal(
      (await provisionClient(runtime.db, runtime.auth, approval, true)).changed,
      true,
    );
    assert.equal(
      (await provisionClient(runtime.db, runtime.auth, approval, true)).changed,
      false,
    );
    await assert.rejects(
      provisionClient(
        runtime.db,
        runtime.auth,
        { ...approval, role: "administrator" },
        true,
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.close();
  }
});
