import { assertOperatorDatabase, STAGING_DATABASE } from "./database-target";
import { seedSynthetic } from "./synthetic-seed";
import { readFile } from "node:fs/promises";
import { bootstrapAdministrator, pruneIdempotency } from "./bootstrap";
import { firebaseRuntime } from "./firebase";
// Explicit operator process. No public HTTP bootstrap, user creation or provider configuration.
const [operation, fileOrTenant, ...flags] = process.argv.slice(2);
if (
  !["bootstrap-admin", "prune-idempotency", "seed-synthetic"].includes(
    operation,
  ) ||
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
if (process.env.FIRESTORE_DATABASE_ID !== STAGING_DATABASE)
  throw Error(
    "Operator requires explicit named staging database configuration",
  );
const runtime = firebaseRuntime(
  mode,
  mode === "emulator"
    ? "demo-mi-security"
    : (process.env.STAGING_FIREBASE_PROJECT_ID ?? ""),
);
try {
  await runtime.verify();
  assertOperatorDatabase(runtime.db);
  const result =
    operation === "seed-synthetic"
      ? await seedSynthetic(runtime.db, fileOrTenant, flags.includes("--apply"))
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
