import {
  assertOperatorDatabase,
  STAGING_DATABASE,
  COMPANY_PROJECT,
  EXPECTED_STAGING_UID,
} from "./database-target";
import { provisionClient } from "./client-provisioning";
import {
  seedProjectSynthetic,
  provisionProjectClient,
  inspectProjectMigration,
} from "./project-operator";
import { seedSynthetic } from "./synthetic-seed";
import { readFile } from "node:fs/promises";
import { bootstrapAdministrator, pruneIdempotency } from "./bootstrap";
import { firebaseRuntime } from "./firebase";
import { configureTime } from "./time-config";
import { ProjectStore } from "./project-workspace";
// Explicit operator process. No public HTTP bootstrap, user creation or provider configuration.
const [operation, fileOrTenant, ...flags] = process.argv.slice(2);
const timeOperation =
  operation === "verify-time-customer" || operation === "sync-time-customer";
if (
  (!timeOperation &&
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
  flags.some((f) => f !== "--apply")
)
  throw Error(
    "Use bootstrap-admin APPROVAL_FILE [--apply] or prune-idempotency TENANT [--apply]",
  );
const mode = process.env.BACKEND_MODE;
if (mode !== "emulator" && mode !== "staging")
  throw Error(
    "Operator tool is limited to demo emulator or approved named synthetic staging; production is blocked",
  );
if (
  timeOperation &&
  (mode !== "staging" ||
    process.env.CLOUD_RUN_JOB !== "mi-client-time-sync" ||
    process.env.CLOUD_RUN_TASK_COUNT !== "1" ||
    process.env.STAGING_PREVIEW_ONLY === "true" ||
    process.env.ENABLE_QUICKBOOKS_TIME !== "true" ||
    process.env.STAGING_FIREBASE_PROJECT_ID !== COMPANY_PROJECT ||
    process.env.STAGING_DATABASE_UID !== EXPECTED_STAGING_UID ||
    fileOrTenant !== process.env.MORRIS_DASHBOARD_TENANT_ID ||
    (operation === "sync-time-customer" && flags.length))
)
  throw Error("Approved named Time job configuration required");
if (process.env.FIRESTORE_DATABASE_ID !== STAGING_DATABASE)
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
    : (process.env.STAGING_FIREBASE_PROJECT_ID ?? ""),
);
try {
  await runtime.verify();
  assertOperatorDatabase(runtime.db);
  const result = timeOperation
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
    const result = await sync.daily(fileOrTenant);
    if (result.failed) process.exitCode = 1;
    return result;
  } catch {
    throw Error(
      "Time customer job did not complete. Check the approved configuration and job status.",
    );
  }
}
