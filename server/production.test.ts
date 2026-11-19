import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Auth } from "firebase-admin/auth";
import {
  assertDatabaseMetadata,
  assertOperatorDatabase,
  COMPANY_PROJECT,
  databaseTarget,
  EXPECTED_STAGING_UID,
  PRODUCTION_DATABASE,
  PRODUCTION_SERVICE_ACCOUNT,
  rememberVerifiedDatabase,
} from "./database-target";
import { verifyDatabase } from "./database-verification";
import { FirebaseIdentityVerifier } from "./firebase";
import type { ProjectStore } from "./project-workspace";
import { configureTime } from "./time-config";
import { verifyTimeCredential } from "./time-credential";

const uid = "730633c6-d785-47fd-99ad-f51da712b619";
const env = {
  BACKEND_MODE: "production",
  ENABLE_PRODUCTION: "true",
  ENABLE_LIVE_FIREBASE: "true",
  FIRESTORE_RULES_VERIFIED: "true",
  PRODUCTION_IAM_VERIFIED: "true",
  PRODUCTION_FIREBASE_PROJECT_ID: COMPANY_PROJECT,
  FIRESTORE_DATABASE_ID: PRODUCTION_DATABASE,
  PRODUCTION_DATABASE_UID: uid,
  PRODUCTION_SERVICE_ACCOUNT_EMAIL: PRODUCTION_SERVICE_ACCOUNT,
  MORRIS_DASHBOARD_TENANT_ID: "zagime-unit-fixture",
};
const target = () => databaseTarget("production", COMPANY_PROJECT, undefined, env);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("production requires explicit isolated configuration and named metadata", async () => {
  const route = target();
  for (const name of Object.keys(env)) {
    const incomplete = { ...env, [name]: undefined };
    assert.throws(() => databaseTarget("production", COMPANY_PROJECT, undefined, incomplete), name);
  }
  for (const [name, value] of Object.entries({
    STAGING_DATABASE_UID: EXPECTED_STAGING_UID,
    ENABLE_SYNTHETIC_STAGING: "true",
    STAGING_PREVIEW_ONLY: "true",
    FIRESTORE_DATABASE_ID: "(default)",
    PRODUCTION_DATABASE_UID: EXPECTED_STAGING_UID,
    MORRIS_DASHBOARD_TENANT_ID: "synthetic-zagime",
    PRODUCTION_SERVICE_ACCOUNT_EMAIL: "mi-client-staging-api@" + COMPANY_PROJECT + ".iam.gserviceaccount.com",
    GOOGLE_APPLICATION_CREDENTIALS: "credentials.json",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  }))
    assert.throws(() => databaseTarget("production", COMPANY_PROJECT, undefined, { ...env, [name]: value }), name);
  assert.throws(() => databaseTarget("production", COMPANY_PROJECT, "mi-client-staging", env));
  assert.throws(() => databaseTarget("staging", COMPANY_PROJECT, PRODUCTION_DATABASE, env));
  const metadata = {
    name: route.resource,
    uid,
    locationId: "northamerica-northeast1",
    databaseEdition: "STANDARD",
    type: "FIRESTORE_NATIVE",
  };
  let calls = 0;
  await verifyDatabase(route, { getAccessToken: async () => ({ access_token: "offline-fixture", expires_in: 3600 }) }, async (url, options) => {
    calls++;
    assert.equal(url, "https://firestore.northamerica-northeast1.rep.googleapis.com/v1/" + route.resource);
    assert.equal(options?.method, "GET");
    return Response.json(metadata);
  });
  assert.equal(calls, 1);
  for (const invalid of [{ uid: EXPECTED_STAGING_UID }, { name: route.resource.replace(PRODUCTION_DATABASE, "(default)") }, { locationId: "us-central1" }])
    assert.throws(() => assertDatabaseMetadata(route, { ...metadata, ...invalid }), /Production database verification failed/);
  const handle = { databaseId: PRODUCTION_DATABASE };
  rememberVerifiedDatabase(handle, route);
  assert.throws(() => assertOperatorDatabase(handle), /named staging/);
});

test("production clients need a verified Google account; provider claims alone cannot grant corporate access", async () => {
  const token = {
    uid: "test-user", iss: "issuer", aud: COMPANY_PROJECT, exp: 2147483647,
    email_verified: true,
    firebase: { sign_in_provider: "google.com", identities: { "google.com": ["provider-fixture"] } },
  };
  const verifier = new FirebaseIdentityVerifier({
    verifyIdToken: async (_: string, checkRevoked: boolean) => {
      assert.equal(checkRevoked, true);
      return token;
    },
  } as unknown as Auth, undefined, true);
  const result = await verifier.verify("Bearer offline-fixture");
  assert.equal(result.staffTenantId, undefined);
  assert.equal(result.googleSubject, "provider-fixture");
  token.email_verified = false;
  await assert.rejects(verifier.verify("Bearer offline-fixture"), /Unauthenticated/);
  token.email_verified = true;
  token.firebase.identities["google.com"] = [];
  await assert.rejects(verifier.verify("Bearer offline-fixture"), /Unauthenticated/);
  for (const provider of ["password", "custom", "microsoft.com"]) {
    token.firebase.sign_in_provider = provider;
    await assert.rejects(verifier.verify("Bearer offline-fixture"), /Unauthenticated/);
  }
});

test("production Time defaults disconnected and requires its own approved binding", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, env);
    for (const key of ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "GOOGLE_APPLICATION_CREDENTIALS"]) delete process.env[key];
    const handle = { databaseId: PRODUCTION_DATABASE };
    rememberVerifiedDatabase(handle, target());
    const store = { db: handle } as ProjectStore;
    assert.doesNotThrow(() => configureTime(store, "production", {}));
    assert.throws(() => configureTime(store, "production", { ...env, ENABLE_QUICKBOOKS_TIME: "true" }), /independent approval/);
    assert.throws(() => configureTime(store, "production", { ...env, ENABLE_QUICKBOOKS_TIME: "true",
      PRODUCTION_TIME_APPROVED: "true", QUICKBOOKS_TIME_SECRET_ID: "stage-secret" }), /environment mismatch/);
  } finally {
    process.env = saved;
  }
  const approval = {
    environment: "production", databaseUid: uid, modifiedFrom: "2026-01-01",
    companyId: "103", userId: "204", customerParentId: "305",
    clientUrl: "fixture", tenant: env.MORRIS_DASHBOARD_TENANT_ID,
    expiresAt: "2030-01-01T00:00:00.000Z", accessToken: "offline-fixture",
  };
  const bytes = Buffer.from(JSON.stringify(approval));
  const binding = {
    account: approval.companyId, userId: approval.userId, clientUrl: approval.clientUrl,
    tenant: approval.tenant, customerParentId: approval.customerParentId,
    secret: "mi-client-prod-time", version: "1", sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const approved = { ...binding, production: { databaseUid: uid, modifiedFrom: approval.modifiedFrom } };
  assert.equal(verifyTimeCredential(bytes, approved, 0), approval.accessToken);
  assert.throws(() => verifyTimeCredential(bytes, binding, 0), /binding failed/);
  for (const modified of [{ ...approved, customerParentId: "306" }, { ...approved, userId: "205" },
    { ...approved, production: { ...approved.production, databaseUid: EXPECTED_STAGING_UID } },
    { ...approved, production: { ...approved.production, modifiedFrom: "2025-01-01" } }])
    assert.throws(() => verifyTimeCredential(bytes, modified, 0), /binding failed/);
});

test("production rules configuration selects one named database and scheduler targets only the production job", () => {
  assert.deepEqual(json("firebase.production.json").firestore, [
    { database: PRODUCTION_DATABASE, rules: "firestore.rules", indexes: "firestore.indexes.json" },
  ]);
  assert.deepEqual(json("deployment/production-auth-role.json").includedPermissions, ["firebaseauth.users.get"]);
  assert.deepEqual(json("deployment/production-data-role.json").includedPermissions, json("deployment/staging-data-role.json").includedPermissions);
  const schedule = json("deployment/production-time-scheduler.example.json");
  assert.equal(schedule.schedule, "0 6 * * *");
  assert.equal(schedule.timeZone, "America/Regina");
  assert.equal(schedule.httpTarget.httpMethod, "POST");
  assert.equal(schedule.httpTarget.uri, "https://run.googleapis.com/v2/projects/" + COMPANY_PROJECT + "/locations/northamerica-northeast1/jobs/mi-client-prod-time-sync:run");
  assert.ok(schedule.httpTarget.oauthToken);
});

test("production image profile rejects synthetic, incomplete and emulator builds", () => {
  const cwd = mkdtempSync(join(tmpdir(), "mi-image-profile-"));
  const script = resolve("deployment/build-dashboard-profile.mjs");
  const build = {
    VITE_DASHBOARD_DEPLOYMENT: "production",
    VITE_SECURE_TENANT_ID: env.MORRIS_DASHBOARD_TENANT_ID,
    VITE_MORRIS_ENTRA_TENANT_ID: uid,
    VITE_FIREBASE_API_KEY: "public-fixture-key-for-testing",
    VITE_FIREBASE_APP_ID: "1:12345:web:abc",
    VITE_FIREBASE_AUTH_DOMAIN: "auth.example.com",
  };
  try {
    mkdirSync(join(cwd, "dist-server"));
    for (const override of [
      { VITE_AUTH_EMULATOR: "true" },
      { VITE_FIREBASE_APP_ID: "" },
      { VITE_SECURE_TENANT_ID: "synthetic-zagime" },
    ])
      assert.equal(spawnSync(process.execPath, [script], { cwd, env: { ...build, ...override } }).status, 1);
    assert.equal(spawnSync(process.execPath, [script], { cwd, env: build }).status, 0);
    assert.deepEqual(json(join(cwd, "dist-server", "dashboard-profile.json")),
      { mode: "production", tenant: env.MORRIS_DASHBOARD_TENANT_ID, entraTenant: uid });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
