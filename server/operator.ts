import {
  assertOperatorDatabase,
  assertProjectDatabase,
  PRODUCTION_OPERATOR,
  PRODUCTION_TIME_JOB,
  STAGING_DATABASE,
  COMPANY_PROJECT,
  EXPECTED_STAGING_UID,
} from "./database-target";
import { provisionClient } from "./client-provisioning";
import {
  initializeProductionTenant,
  seedProjectSynthetic,
  provisionProjectClient,
  inspectProjectMigration,
} from "./project-operator";
import { seedSynthetic } from "./synthetic-seed";
import { createHash } from "node:crypto";
import { regionalSecret } from "./regional-secret";
import { readFile } from "node:fs/promises";
import { bootstrapAdministrator, pruneIdempotency } from "./bootstrap";
import { firebaseRuntime } from "./firebase";
import { configureTime } from "./time-config";
import { ProjectStore } from "./project-workspace";
// Explicit operator process. No public HTTP bootstrap, user creation or provider configuration.
const [operation, fileOrTenant, ...flags] = process.argv.slice(2);
const productionOperation = operation === "initialize-production" || operation === "provision-production-client";
const enrichmentOperation = operation === "enrich-time-details";
const timeOperation =
  enrichmentOperation || operation === "verify-time-customer" || operation === "sync-time-customer";
const enrichmentOptions = enrichmentOperation ? parseEnrichmentFlags(flags) : undefined;
if (
  (!timeOperation && !productionOperation &&
    ![
      "bootstrap-admin",
      "bootstrap-client",
      "prune-idempotency",
      "seed-synthetic",
      "seed-project-synthetic",
      "bootstrap-project-client",
      "inspect-project-migration",
    ].includes(operation)) ||
  !fileOrTenant ||
  (!enrichmentOperation && flags.some((f) => f !== "--apply"))
)
  throw Error(
    "Use bootstrap-admin APPROVAL_FILE [--apply] or prune-idempotency TENANT [--apply]",
  );
const mode = process.env.BACKEND_MODE;
if (mode !== "emulator" && mode !== "staging" && mode !== "production")
  throw Error(
    "Operator requires an explicit environment",
  );
if ([PRODUCTION_OPERATOR, PRODUCTION_TIME_JOB].some(job => job === process.env.CLOUD_RUN_JOB) && mode !== "production")
  throw Error("Production job requires production mode");
if (productionOperation || (mode === "production" && !timeOperation)) {
  if (!productionOperation || mode !== "production" ||
      process.env.CLOUD_RUN_JOB !== PRODUCTION_OPERATOR ||
      process.env.CLOUD_RUN_TASK_COUNT !== "1" ||
      fileOrTenant !== process.env.MORRIS_DASHBOARD_TENANT_ID)
    throw Error("Approved production operator job required");
}
if (
  timeOperation &&
  ((mode !== "staging" && mode !== "production") ||
    process.env.CLOUD_RUN_JOB !== (mode === "production" ? PRODUCTION_TIME_JOB : "mi-client-time-sync") ||
    process.env.CLOUD_RUN_TASK_COUNT !== "1" ||
    process.env.STAGING_PREVIEW_ONLY === "true" ||
    process.env.ENABLE_QUICKBOOKS_TIME !== "true" ||
    (mode === "staging" && (process.env.STAGING_FIREBASE_PROJECT_ID !== COMPANY_PROJECT ||
    process.env.STAGING_DATABASE_UID !== EXPECTED_STAGING_UID)) ||
    (mode === "production" && process.env.PRODUCTION_TIME_APPROVED !== "true") ||
    fileOrTenant !== process.env.MORRIS_DASHBOARD_TENANT_ID ||
    (operation === "sync-time-customer" && flags.length))
)
  throw Error("Approved named Time job configuration required");
if (mode !== "production" && process.env.FIRESTORE_DATABASE_ID !== STAGING_DATABASE)
  throw Error(
    "Operator requires explicit named staging database configuration",
  );
if (
  [
    "seed-project-synthetic",
    "bootstrap-project-client",
    "inspect-project-migration",
  ].includes(operation) &&
  mode === "staging" &&
  (process.env.STAGING_FIREBASE_PROJECT_ID !== COMPANY_PROJECT ||
    process.env.STAGING_DATABASE_UID !== EXPECTED_STAGING_UID)
)
  throw Error("Explicit company staging identity required");
const runtime = firebaseRuntime(
  mode,
  mode === "emulator"
    ? "demo-mi-security"
    : ((mode === "production" ? process.env.PRODUCTION_FIREBASE_PROJECT_ID : process.env.STAGING_FIREBASE_PROJECT_ID) ?? ""),
);
try {
  await runtime.verify();
  if (mode === "production") assertProjectDatabase(runtime.db);
  else assertOperatorDatabase(runtime.db);
  const result = productionOperation
    ? await runProductionOperation(runtime)
    : timeOperation
    ? await runTimeOperation(new ProjectStore(runtime.db))
    : operation === "inspect-project-migration"
      ? flags.length
        ? (() => {
            throw Error("Migration inspection is read-only");
          })()
        : await inspectProjectMigration(runtime.db, fileOrTenant)
      : operation === "seed-project-synthetic"
        ? await seedProjectSynthetic(
            runtime.db,
            fileOrTenant,
            flags.includes("--apply"),
          )
        : operation === "bootstrap-project-client"
          ? await provisionProjectClient(
              runtime.db,
              runtime.auth,
              JSON.parse(await readFile(fileOrTenant, "utf8")),
              flags.includes("--apply"),
            )
          : operation === "bootstrap-client"
            ? await provisionClient(
                runtime.db,
                runtime.auth,
                JSON.parse(await readFile(fileOrTenant, "utf8")),
                flags.includes("--apply"),
              )
            : operation === "seed-synthetic"
              ? await seedSynthetic(
                  runtime.db,
                  fileOrTenant,
                  flags.includes("--apply"),
                )
              : operation === "bootstrap-admin"
                ? await bootstrapAdministrator(
                    runtime.db,
                    runtime.auth,
                    JSON.parse(await readFile(fileOrTenant, "utf8")),
                    flags.includes("--apply"),
                  )
                : await pruneIdempotency(
                    runtime.db,
                    fileOrTenant,
                    flags.includes("--apply"),
                  );
  console.log(JSON.stringify(result)); // No UID, provider identity, token or approval contents in output.
} finally {
  await runtime.close();
}

async function runTimeOperation(store: ProjectStore) {
  try {
    const sync = configureTime(store, mode!, process.env);
    if (operation === "verify-time-customer")
      return await sync.verifyCustomer(fileOrTenant, flags.includes("--apply"));
    if (enrichmentOptions)
      return await sync.enrichDetails(fileOrTenant, enrichmentOptions);
    const result = await sync.daily(fileOrTenant);
    if (result.failed) process.exitCode = 1;
    return result;
  } catch {
    throw Error(
      "Time customer job did not complete. Check the approved configuration and job status.",
    );
  }
}

function parseEnrichmentFlags(flags: string[]) {
  const months = flags.filter(flag => /^--month=\d{4}-(0[1-9]|1[0-2])$/.test(flag));
  const cursors = flags.filter(flag => /^--after=[a-zA-Z0-9_-]{1,400}$/.test(flag));
  const apply = flags.filter(flag => flag === "--apply");
  if (months.length !== 1 || cursors.length > 1 || apply.length > 1 ||
      flags.length !== months.length + cursors.length + apply.length)
    throw Error("Use enrich-time-details TENANT --month=YYYY-MM [--after=CURSOR] [--apply]");
  return { month: months[0].slice(8), after: cursors[0]?.slice(8), apply: apply.length === 1 };
}

async function runProductionOperation(runtime: ReturnType<typeof firebaseRuntime>) {
  const apply = flags.includes("--apply");
  if (operation === "initialize-production")
    return initializeProductionTenant(runtime.db, fileOrTenant, apply);
  const { PRODUCTION_CLIENT_APPROVAL_SECRET_ID: secret = "",
    PRODUCTION_CLIENT_APPROVAL_SECRET_VERSION: version = "",
    PRODUCTION_CLIENT_APPROVAL_SHA256: digest = "" } = process.env;
  if (!/^mi-client-prod-client-approval-[a-z0-9-]+$/.test(secret) || !/^[a-f0-9]{64}$/.test(digest))
    throw Error("Approved production client secret required");
  let bytes: Buffer | undefined;
  try {
    bytes = await regionalSecret(secret, version)(AbortSignal.timeout(15000));
    if (createHash("sha256").update(bytes).digest("hex") !== digest) throw Error();
    return await provisionProjectClient(runtime.db, runtime.auth, JSON.parse(bytes.toString("utf8")), apply);
  } catch {
    throw Error("Production client approval could not be applied");
  } finally {
    bytes?.fill(0);
  }
}
