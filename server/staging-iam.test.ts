import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertIamEvidence,
  STAGING_PERMISSIONS,
  probeDatabaseReads,
  type IamCheck,
} from "./staging-iam";
import {
  databaseTarget,
  COMPANY_PROJECT,
  STAGING_DATABASE,
} from "./database-target";
const rows = (): IamCheck[] =>
  [STAGING_DATABASE, "(default)"].flatMap((databaseId) =>
    [...STAGING_PERMISSIONS, "datastore.entities.delete"].map((permission) => ({
      databaseId,
      permission,
      state:
        databaseId === STAGING_DATABASE &&
        permission !== "datastore.entities.delete"
          ? "GRANTED"
          : "NOT_GRANTED",
    })),
  );
test("retired Troubleshooter matrices never become effective IAM proof, even with complete positive/negative fixtures", () => {
  assert.throws(() => assertIamEvidence(rows()), /UNSUPPORTED \/ INCONCLUSIVE/);
  for (const permission of [
    ...STAGING_PERMISSIONS,
    "datastore.entities.delete",
  ]) {
    for (const state of ["GRANTED", "UNKNOWN", "UNKNOWN_INFO_DENIED", ""]) {
      const r = rows();
      r.find(
        (x) => x.databaseId === "(default)" && x.permission === permission,
      )!.state = state;
      assert.throws(() => assertIamEvidence(r));
    }
  }
  assert.throws(() => assertIamEvidence(rows().slice(1)));
  const duplicate = rows();
  duplicate[0] = duplicate[1];
  assert.throws(() => assertIamEvidence(duplicate));
  const cleanup = rows();
  cleanup.find(
    (x) =>
      x.databaseId === STAGING_DATABASE &&
      x.permission === "datastore.entities.delete",
  )!.state = "GRANTED";
  assert.throws(() => assertIamEvidence(cleanup));
  assert.throws(
    () => assertIamEvidence(cleanup, true),
    /UNSUPPORTED \/ INCONCLUSIVE/,
  );
});
test("reviewed IAM artifacts grant only required runtime operations with exact named database equality", () => {
  const role = JSON.parse(
    readFileSync("deployment/staging-data-role.json", "utf8"),
  );
  const binding = JSON.parse(
    readFileSync("deployment/staging-data-binding.example.json", "utf8"),
  );
  assert.deepEqual(role.includedPermissions, [...STAGING_PERMISSIONS]);
  assert.equal(
    binding.condition.expression,
    'resource.name == "projects/morris-client-dash-zagime/databases/mi-client-staging"',
  );
  assert.ok(!role.includedPermissions.includes("datastore.entities.delete"));
  assert.ok(
    !role.includedPermissions.some((p: string) =>
      /firebaseauth|setIamPolicy|databases.create|databases.update/.test(p),
    ),
  );
});
test("read-only helper transport contract uses offline fixtures; it is not live IAM evidence", async () => {
  const target = databaseTarget("staging", COMPANY_PROJECT, STAGING_DATABASE, {
    STAGING_FIREBASE_PROJECT_ID: COMPANY_PROJECT,
    STAGING_SERVICE_ACCOUNT_EMAIL:
      "mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com",
    STAGING_DATABASE_UID: "11111111-1111-4111-8111-111111111111",
    STAGING_IAM_VERIFIED: "true",
    ENABLE_LIVE_FIREBASE: "true",
    ENABLE_SYNTHETIC_STAGING: "true",
    FIRESTORE_RULES_VERIFIED: "true",
  });
  const cred = {
    getAccessToken: async () => ({
      access_token: "offline-fixture-token",
      expires_in: 3600,
    }),
  };
  let calls = 0;
  const result = await probeDatabaseReads(target, cred, async (input, init) => {
    calls++;
    assert.equal(init?.method, "GET");
    assert.ok(!init?.body);
    assert.ok(String(input).includes("/documents/staging-iam-probe-"));
    if (String(input).includes("/databases/(default)/"))
      return Response.json(
        { error: { status: "PERMISSION_DENIED" } },
        { status: 403 },
      );
    return String(input).endsWith("/nonexistent")
      ? new Response("", { status: 404 })
      : Response.json({});
  });
  assert.equal(calls, 4);
  assert.equal(result.writes, 0);
  for (const status of [200, 404, 500])
    await assert.rejects(() =>
      probeDatabaseReads(target, cred, async (input) =>
        String(input).includes("/databases/(default)/")
          ? new Response("", { status })
          : String(input).endsWith("/nonexistent")
            ? new Response("", { status: 404 })
            : Response.json({}),
      ),
    );
});
