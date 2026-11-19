import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { VerifiedIdentity } from "../server/contracts";
import {
  COMPANY_PROJECT, databaseTarget, PRODUCTION_DATABASE, PRODUCTION_SERVICE_ACCOUNT, rememberVerifiedDatabase,
} from "../server/database-target";
import { initializeProductionTenant, provisionProjectClient, seedProjectSynthetic } from "../server/project-operator";
import { ProjectStore } from "../server/project-workspace";
import { configureTime } from "../server/time-config";

test("isolated production policy on local named Firestore: no fixtures, scoped clients, explicit publication and revocation", async () => {
  const saved = { ...process.env };
  assert.equal(saved.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8080");
  const tenant = "zagime-local-" + randomUUID();
  const databaseUid = randomUUID();
  const app = initializeApp({
    projectId: "demo-mi-security",
  }, tenant);
  const db = getFirestore(app, PRODUCTION_DATABASE);
  // Loopback is explicit. No production runtime override is available.
  db.settings({ host: "127.0.0.1:8080", ssl: false });
  try {
    delete process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    Object.assign(process.env, {
      BACKEND_MODE: "production",
      FIRESTORE_DATABASE_ID: PRODUCTION_DATABASE,
      PRODUCTION_DATABASE_UID: databaseUid,
      PRODUCTION_FIREBASE_PROJECT_ID: COMPANY_PROJECT,
      PRODUCTION_SERVICE_ACCOUNT_EMAIL: PRODUCTION_SERVICE_ACCOUNT,
      PRODUCTION_IAM_VERIFIED: "true",
      ENABLE_PRODUCTION: "true",
      ENABLE_LIVE_FIREBASE: "true",
      FIRESTORE_RULES_VERIFIED: "true",
      MORRIS_DASHBOARD_TENANT_ID: tenant,
    });
    rememberVerifiedDatabase(db, databaseTarget("production", COMPANY_PROJECT));
    const store = new ProjectStore(db);
    const base: VerifiedIdentity = { subject: "local-staff", issuer: "fixture", audience: "fixture", expiresAt: Date.now() + 360000, disabled: false, revoked: false };
    const staff = { ...base, corporatePolicy: true, staffTenantId: tenant };
    const client = { ...base, subject: "local-client", googleSubject: "google-fixture" };
    const root = db.doc("tenants/" + tenant);
    assert.equal((await initializeProductionTenant(db, tenant, false)).fixtures, 0);
    assert.equal((await root.get()).exists, false);
    await assert.rejects(seedProjectSynthetic(db, "synthetic-test", true));
    await initializeProductionTenant(db, tenant, true);
    assert.deepEqual((await root.listCollections()).map(c => c.id), ["audits"]);
    await assert.rejects(initializeProductionTenant(db, tenant, true));
    await assert.rejects(store.workspace("another-tenant", staff), /Forbidden/);
    await assert.rejects(store.workspace(tenant, client), /Forbidden/);
    const input = {
      name: "Local production policy fixture", status: "active", progress: 20,
      description: "Approved progress description", internalNotes: "staff-only fixture",
      plan: { basis: "fixed", targetSeconds: 7200 },
    };
    const now = Date.now();
    const created = await store.save(tenant, staff, input, { idempotency: now + "-" + randomUUID() }, now);
    const other = await store.save(tenant, staff, { ...input, name: "Other project" }, { idempotency: now + "-" + randomUUID() }, now);
    const auth = { getUser: async () => ({ emailVerified: true, disabled: false, providerData: [{ providerId: "google.com", uid: client.googleSubject }] }) } as unknown as Auth;
    const approval = { approved: true, tenantId: tenant, databaseUid, action: "grant", uid: client.subject, projectIds: [created.id] };
    await assert.rejects(provisionProjectClient(db, auth, { ...approval, databaseUid: randomUUID() }, true));
    await provisionProjectClient(db, auth, approval, true);
    await assert.rejects(store.workspace(tenant, { ...client, googleSubject: "different-provider-id" }), /Forbidden/);
    await assert.rejects(store.save(tenant, client, input, { idempotency: now + "-" + randomUUID() }, now), /Forbidden/);
    assert.deepEqual((await store.report(tenant, client, "2026-11")).projects, []);
    async function publish(id: string) {
      await store.save(tenant, staff, undefined, { id, published: true, expectedRevision: (await store.workspace(tenant, staff)).revision }, Date.now());
    }
    await publish(created.id);
    await publish(other.id);
    const reopened = new ProjectStore(db);
    const published = (await reopened.report(tenant, client, "2026-11")).projects;
    assert.deepEqual(published.map(p => p.id), [created.id]);
    assert.doesNotMatch(JSON.stringify(published), /staff-only fixture|internalNotes|sourceIdentity/);
    assert.equal((await reopened.detail(tenant, staff, created.id)).project.internalNotes, input.internalNotes);
    const time = configureTime(reopened, "production", {});
    assert.deepEqual(await time.status(tenant, staff), { state: "disconnected", canManage: false, mappings: [] });
    await assert.rejects(time.status(tenant, client), /Forbidden/);
    await assert.rejects(reopened.page(tenant, client, "sources", { month: "2026-11", limit: 10 }), /Forbidden/);
    await provisionProjectClient(db, auth, { ...approval, action: "revoke", projectIds: [] }, true);
    await assert.rejects(reopened.report(tenant, client, "2026-11"), /Forbidden/);
    await provisionProjectClient(db, auth, { ...approval, projectIds: [other.id] }, true);
    assert.deepEqual((await reopened.report(tenant, client, "2026-11")).projects.map(p => p.id), [other.id]);
    const audits = await root.collection("audits").get();
    assert.ok(audits.docs.some(doc => doc.data().action === "project-client-revoked"));
  } finally {
    process.env = saved;
    await db.terminate();
    await deleteApp(app);
  }
});
