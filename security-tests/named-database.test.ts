import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { firebaseRuntime, FirebaseIdentityVerifier } from "../server/firebase";
import { FirestoreTenantStore, key } from "../server/firestore-store";
import { ReportingBackend } from "../server/backend";
import { apiServer } from "../server/http";
import { seedSynthetic } from "../server/synthetic-seed";
import { bootstrapAdministrator, pruneIdempotency } from "../server/bootstrap";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  getDoc,
  setDoc,
  doc,
  terminate,
} from "firebase/firestore";
let stage: ReturnType<typeof firebaseRuntime>,
  legacy: ReturnType<typeof firebaseRuntime>,
  server: ReturnType<typeof apiServer>,
  base: string;
const tenant = "synthetic-database-boundary",
  password = "synthetic-emulator-only-password",
  tokens: Record<string, string> = {};
const approval = {
  approved: true as const,
  uid: "named-stage-admin",
  tenantId: tenant,
  role: "administrator" as const,
  providerId: "google.com" as const,
  providerUid: "synthetic-stage-provider",
  approvalReference: "SYNTHETIC-NAMED-DB-REVIEW",
};
before(async () => {
  stage = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  legacy = firebaseRuntime("emulator", "demo-mi-security", "(default)");
  assert.equal(stage.db.databaseId, "mi-client-staging");
  await seedSynthetic(stage.db, tenant, true);
  for (const uid of [
    "named-stage-admin",
    "named-default-only",
    "named-client",
  ]) {
    await stage.auth.createUser({
      uid,
      email: `${uid}@example.com`,
      password,
      emailVerified: true,
    });
    const r = await fetch(
      "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${uid}@example.com`,
          password,
          returnSecureToken: true,
        }),
      },
    );
    assert.equal(r.status, 200);
    tokens[uid] = ((await r.json()) as any).idToken;
  }
  await stage.auth.updateUser(approval.uid, {
    providerToLink: {
      providerId: approval.providerId,
      uid: approval.providerUid,
    },
  });
  const root = legacy.db.doc(`tenants/${tenant}`);
  await root.set({ name: "Synthetic default sentinel", revision: 41 });
  for (const subject of ["named-default-only", "named-client"])
    await root
      .collection("memberships")
      .doc(key(subject))
      .set({
        tenantId: tenant,
        subject,
        approved: true,
        enabled: true,
        role: "administrator",
        agreementIds: [],
        projectIds: "all-authorized-agreements",
      });
  await stage.db
    .doc(`tenants/${tenant}/memberships/${key("named-client")}`)
    .set({
      tenantId: tenant,
      subject: "named-client",
      approved: true,
      enabled: true,
      role: "client",
      agreementIds: ["agreement-demo"],
      projectIds: "all-authorized-agreements",
    });
  server = apiServer(
    new ReportingBackend(
      new FirestoreTenantStore(stage.db),
      new FirebaseIdentityVerifier(stage.auth),
      {
        issuer: "https://securetoken.google.com/demo-mi-security",
        audience: "demo-mi-security",
        now: Date.now,
      },
    ),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as any).port}/api/tenants/${tenant}/`;
});
after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  await stage?.close();
  await legacy?.close();
});
const request = (path: string, uid: string, method = "GET", body?: unknown) =>
  fetch(base + path, {
    method,
    headers: {
      Authorization: "Bearer " + tokens[uid],
      ...(body
        ? {
            "Content-Type": "application/json",
            "Idempotency-Key": `${Date.now()}-${crypto.randomUUID()}`,
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
test("shared Firebase identity never grants default-database membership to staging", async () => {
  assert.equal(
    (await stage.auth.getUser("named-default-only")).uid,
    "named-default-only",
  );
  assert.equal((await request("workspace", "named-default-only")).status, 403);
  const w = (await (await request("workspace", "named-client")).json()) as any;
  assert.equal(w.role, "client");
  assert.equal(
    (await request("sources?month=2026-10", "named-client")).status,
    403,
  );
});
test("bootstrap, creation, publication, allocation and maintenance stay in named staging; default sentinel unchanged", async () => {
  const root = legacy.db.doc(`tenants/${tenant}`),
    before = (await root.get()).data(),
    members = (await root.collection("memberships").get()).docs.map((d) =>
      d.data(),
    );
  await bootstrapAdministrator(stage.db, stage.auth, approval, true);
  assert.equal((await request("workspace", approval.uid)).status, 200);
  const r = await request("projects", approval.uid, "POST", {
    agreementId: "agreement-demo",
    departmentId: "health",
    name: "Named database synthetic delivery",
    plan: { basis: "fixed", minutes: 60 },
  });
  assert.equal(r.status, 201);
  const created = (await r.json()) as any;
  assert.equal(created.published, false);
  assert.ok(
    (await stage.db.doc(`tenants/${tenant}/projects/${created.id}`).get())
      .exists,
  );
  assert.ok(!(await root.collection("projects").doc(created.id).get()).exists);
  const revision = async () =>
    (await stage.db.doc(`tenants/${tenant}`).get()).data()!.revision;
  assert.equal(
    (
      await request(
        `projects/${created.id}/publication`,
        approval.uid,
        "PATCH",
        { expectedRevision: await revision(), published: true },
      )
    ).status,
    200,
  );
  const source = stage.db.doc(`tenants/${tenant}/rawTime/raw-demo`),
    raw = (await source.get()).data();
  assert.equal(
    (
      await request("allocations/raw-demo", approval.uid, "PATCH", {
        expectedRevision: await revision(),
        portions: [
          {
            projectId: created.id,
            seconds: 3600,
            description: "Synthetic one-hour split",
          },
        ],
      })
    ).status,
    200,
  );
  assert.deepEqual((await source.get()).data(), raw);
  const report = (await (
    await request("report?month=2026-10", "named-client")
  ).json()) as any;
  assert.equal(
    report.projects.find((p: any) => p.id === created.id).seconds,
    3600,
  );
  await pruneIdempotency(stage.db, tenant, true);
  await assert.rejects(
    () => seedSynthetic(legacy.db, "synthetic-forbidden", true),
    /named staging/,
  );
  await assert.rejects(
    () => bootstrapAdministrator(legacy.db, legacy.auth, approval, true),
    /named staging/,
  );
  await assert.rejects(
    () => pruneIdempotency(legacy.db, tenant, true),
    /named staging/,
  );
  assert.deepEqual((await root.get()).data(), before);
  assert.deepEqual(
    (await root.collection("memberships").get()).docs.map((d) => d.data()),
    members,
  );
  assert.equal((await root.collection("audits").get()).size, 0);
  assert.equal((await root.collection("rawTime").get()).size, 0);
});
test("browser rules deny production, staging and default database access even with a shared administrator identity", async () => {
  const app = initializeApp(
    { projectId: "demo-mi-security", apiKey: "synthetic-key" },
    "named-database-browser-test",
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getFirestore(app, "mi-client-staging"),
    defaultDb = getFirestore(app, "(default)"),
    productionDb = getFirestore(app, "mi-client-production");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFirestoreEmulator(defaultDb, "127.0.0.1", 8080);
  connectFirestoreEmulator(productionDb, "127.0.0.1", 8080);
  const denied = (e: any) => e.code === "permission-denied";
  try {
    await assert.rejects(() => getDoc(doc(db, `tenants/${tenant}`)), denied);
    for (const uid of ["named-stage-admin", "named-client"]) {
      await signInWithEmailAndPassword(auth, `${uid}@example.com`, password);
      await assert.rejects(() => getDoc(doc(db, `tenants/${tenant}`)), denied);
      await assert.rejects(
        () => setDoc(doc(db, `tenants/${tenant}`), { role: "administrator" }),
        denied,
      );
      await assert.rejects(
        () => getDoc(doc(defaultDb, `tenants/${tenant}`)),
        denied,
      );
      await assert.rejects(() => getDoc(doc(productionDb, `tenants/${tenant}`)), denied);
      await assert.rejects(() => setDoc(doc(productionDb, `tenants/${tenant}`), { role: "administrator" }), denied);
      await signOut(auth);
    }
  } finally {
    await terminate(db);
    await terminate(defaultDb);
    await terminate(productionDb);
    await deleteApp(app);
  }
});
