import test from "node:test";
import assert from "node:assert/strict";
import {
  databaseTarget,
  assertStagingMetadata,
  assertOperatorDatabase,
  COMPANY_PROJECT,
  STAGING_DATABASE,
} from "./database-target";
import { verifyDatabase } from "./database-verification";
import { firebaseRuntime } from "./firebase";
const uid = "11111111-1111-4111-8111-111111111111";
const env: NodeJS.ProcessEnv = {
  STAGING_SERVICE_ACCOUNT_EMAIL:
    "mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com",
  BACKEND_MODE: "staging",
  STAGING_FIREBASE_PROJECT_ID: COMPANY_PROJECT,
  FIRESTORE_DATABASE_ID: STAGING_DATABASE,
  STAGING_DATABASE_UID: uid,
  STAGING_IAM_VERIFIED: "true",
  ENABLE_LIVE_FIREBASE: "true",
  ENABLE_SYNTHETIC_STAGING: "true",
  FIRESTORE_RULES_VERIFIED: "true",
};
const target = () =>
  databaseTarget("staging", COMPANY_PROJECT, STAGING_DATABASE, env);
const metadata = () => ({
  name: target().resource,
  uid,
  locationId: "northamerica-northeast1",
  type: "FIRESTORE_NATIVE",
  databaseEdition: "STANDARD",
});
test("same-project staging requires explicit named database and every guard; no default or typo fallback", () => {
  assert.equal(target().databaseId, STAGING_DATABASE);
  assert.throws(() =>
    databaseTarget("staging", COMPANY_PROJECT, STAGING_DATABASE, {
      ...env,
      STAGING_SERVICE_ACCOUNT_EMAIL:
        "unapproved@morris-client-dash-zagime.iam.gserviceaccount.com",
    }),
  );
  for (const id of ["(default)", "", "mi-client-stagin", "other"])
    assert.throws(() => databaseTarget("staging", COMPANY_PROJECT, id, env));
  for (const k of Object.keys(env).filter((k) => k !== "BACKEND_MODE")) {
    const e = { ...env };
    delete e[k];
    assert.throws(
      () =>
        databaseTarget("staging", COMPANY_PROJECT, e.FIRESTORE_DATABASE_ID, e),
      k,
    );
  }
  for (const k of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIRESTORE_EMULATOR_HOST",
  ])
    assert.throws(() =>
      databaseTarget("staging", COMPANY_PROJECT, STAGING_DATABASE, {
        ...env,
        [k]: "unapproved",
      }),
    );
  assert.throws(() =>
    databaseTarget("staging", "wrong-project", STAGING_DATABASE, env),
  );
  assert.throws(() =>
    databaseTarget("production", COMPANY_PROJECT, "(default)", env),
  );
  const prod = {
    ENABLE_LIVE_FIREBASE: "true",
    FIRESTORE_RULES_VERIFIED: "true",
  };
  assert.equal(
    databaseTarget("production", COMPANY_PROJECT, undefined, prod).databaseId,
    "(default)",
  );
  assert.throws(() =>
    databaseTarget("production", COMPANY_PROJECT, STAGING_DATABASE, prod),
  );
});
test("metadata validation pins resource, UID, region, Standard and Native mode", () => {
  assert.doesNotThrow(() => assertStagingMetadata(target(), metadata()));
  for (const [k, v] of Object.entries({
    name: `projects/${COMPANY_PROJECT}/databases/(default)`,
    uid: "22222222-2222-4222-8222-222222222222",
    locationId: "us-central1",
    type: "DATASTORE_MODE",
    databaseEdition: "ENTERPRISE",
  }))
    assert.throws(() =>
      assertStagingMetadata(target(), { ...metadata(), [k]: v }),
    );
  for (const k of Object.keys(metadata())) {
    const m: any = metadata();
    delete m[k];
    assert.throws(() => assertStagingMetadata(target(), m));
  }
});
test("metadata HTTP verification is read-only, regional, bounded and rejects permission/missing/transport failures", async () => {
  let calls = 0;
  const cred = {
    getAccessToken: async () => ({
      access_token: "offline-fixture-token",
      expires_in: 3600,
    }),
  };
  await verifyDatabase(target(), cred, async (input, init) => {
    calls++;
    assert.equal(
      input,
      `https://firestore.northamerica-northeast1.rep.googleapis.com/v1/projects/${COMPANY_PROJECT}/databases/mi-client-staging`,
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    return Response.json(metadata());
  });
  assert.equal(calls, 1);
  for (const status of [403, 404, 500])
    await assert.rejects(
      () =>
        verifyDatabase(
          target(),
          cred,
          async () => new Response("private detail", { status }),
        ),
      /^Error: Staging database verification failed$/,
    );
  await assert.rejects(
    () =>
      verifyDatabase(target(), cred, async () => {
        throw Error("private transport detail");
      }),
    /^Error: Staging database verification failed$/,
  );
});
test("runtime withholds database until metadata verification; SDK selects named database and failures stay closed", async () => {
  const saved = { ...process.env },
    fetchOriginal = globalThis.fetch;
  let runtime: ReturnType<typeof firebaseRuntime> | undefined;
  try {
    for (const k of [
      "GOOGLE_APPLICATION_CREDENTIALS",
      "FIREBASE_AUTH_EMULATOR_HOST",
      "FIRESTORE_EMULATOR_HOST",
    ])
      delete process.env[k];
    Object.assign(process.env, env);

    let calls = 0;
    globalThis.fetch = async (input) => {
      calls++;
      if (String(input).startsWith("http://metadata.google.internal/"))
        return new Response(env.STAGING_SERVICE_ACCOUNT_EMAIL!, {
          headers: { "Metadata-Flavor": "Google" },
        });
      return Response.json(metadata());
    };
    runtime = firebaseRuntime("staging", COMPANY_PROJECT);
    runtime.app.options.credential!.getAccessToken = async () => ({
      access_token: "offline-fixture-token",
      expires_in: 3600,
    });
    assert.throws(() => runtime!.db, /Verify named staging/);
    await Promise.all([runtime.verify(), runtime.verify()]);
    assert.equal(calls, 2);
    assert.equal(runtime.db.databaseId, STAGING_DATABASE);
    assert.doesNotThrow(() => assertOperatorDatabase(runtime!.db));
    await runtime.close();
    runtime = undefined;
    globalThis.fetch = async (input) =>
      String(input).startsWith("http://metadata.google.internal/")
        ? new Response(env.STAGING_SERVICE_ACCOUNT_EMAIL!, {
            headers: { "Metadata-Flavor": "Google" },
          })
        : new Response("missing", { status: 404 });
    runtime = firebaseRuntime("staging", COMPANY_PROJECT);
    runtime.app.options.credential!.getAccessToken = async () => ({
      access_token: "offline-fixture-token",
      expires_in: 3600,
    });
    await assert.rejects(() => runtime!.verify());
    assert.throws(() => runtime!.db, /Verify named staging/);
    await assert.rejects(() => runtime!.verify());
    await runtime.close();
    runtime = undefined;
    let tokenCalls = 0;
    globalThis.fetch = async () =>
      new Response("wrong@morris-client-dash-zagime.iam.gserviceaccount.com", {
        headers: { "Metadata-Flavor": "Google" },
      });
    runtime = firebaseRuntime("staging", COMPANY_PROJECT);
    runtime.app.options.credential!.getAccessToken = async () => {
      tokenCalls++;
      throw Error("must not acquire credentials");
    };
    await assert.rejects(
      () => runtime!.verify(),
      /Attached staging identity verification failed/,
    );
    assert.equal(tokenCalls, 0);
    assert.throws(() => runtime!.db, /Verify named staging/);
  } finally {
    await runtime?.close();
    globalThis.fetch = fetchOriginal;
    for (const k of Object.keys(process.env))
      if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
test("operator functions reject default and unverified handles before any RPC", async () => {
  const { seedSynthetic } = await import("./synthetic-seed");
  const { bootstrapAdministrator, pruneIdempotency } = await import(
    "./bootstrap"
  );
  const db = {
    databaseId: "(default)",
    runTransaction: () => {
      throw Error("must not run");
    },
  } as any;
  await assert.rejects(
    () => seedSynthetic(db, "synthetic-safety", true),
    /named staging/,
  );
  await assert.rejects(
    () => pruneIdempotency(db, "synthetic-safety", true),
    /named staging/,
  );
  await assert.rejects(
    () => bootstrapAdministrator(db, {} as any, {} as any, true),
    /named staging/,
  );
  assert.throws(
    () => assertOperatorDatabase({ databaseId: STAGING_DATABASE }),
    /Verified staging runtime/,
  );
});
