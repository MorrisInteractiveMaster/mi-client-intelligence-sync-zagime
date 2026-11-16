import type { Firestore } from "firebase-admin/firestore";
export const COMPANY_PROJECT = "morris-client-dash-zagime";
export const STAGING_DATABASE = "mi-client-staging";
export const REGION = "northamerica-northeast1";
export type RuntimeMode = "emulator" | "production" | "staging";
export interface DatabaseTarget {
  mode: RuntimeMode;
  projectId: string;
  databaseId: string;
  resource: string;
  uid?: string;
}
export function databaseTarget(
  mode: RuntimeMode,
  projectId: string,
  databaseId: string | undefined = undefined,
  env: NodeJS.ProcessEnv = process.env,
): DatabaseTarget {
  databaseId ??= env.FIRESTORE_DATABASE_ID;
  if (!["emulator", "production", "staging"].includes(mode))
    throw Error("Invalid backend mode");
  if (mode === "emulator") {
    if (
      projectId !== "demo-mi-security" ||
      env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
      env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080" ||
      (databaseId !== undefined &&
        !["(default)", STAGING_DATABASE].includes(databaseId))
    )
      throw Error("Local demo emulator required");
    databaseId ??= "(default)"; // Legacy emulator regressions only; operators require the explicit named database.
  } else {
    if (
      env.ENABLE_LIVE_FIREBASE !== "true" ||
      env.FIRESTORE_RULES_VERIFIED !== "true" ||
      env.FIREBASE_AUTH_EMULATOR_HOST ||
      env.FIRESTORE_EMULATOR_HOST ||
      env.GOOGLE_APPLICATION_CREDENTIALS
    )
      throw Error("Live Firebase is disabled or unsafe");
    if (mode === "staging") {
      if (
        !/^[a-z][a-z0-9-]{5,29}$/.test(projectId) ||
        projectId !== env.STAGING_FIREBASE_PROJECT_ID ||
        env.ENABLE_SYNTHETIC_STAGING !== "true" ||
        databaseId !== STAGING_DATABASE ||
        env.STAGING_IAM_VERIFIED !== "true" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          env.STAGING_DATABASE_UID ?? "",
        )
      )
        throw Error("Explicit verified named staging configuration required");
    } else {
      if (
        projectId !== COMPANY_PROJECT ||
        (databaseId !== undefined && databaseId !== "(default)") ||
        env.ENABLE_SYNTHETIC_STAGING === "true" ||
        env.STAGING_FIREBASE_PROJECT_ID ||
        env.STAGING_DATABASE_UID ||
        env.STAGING_IAM_VERIFIED
      )
        throw Error("Unintended production access refused");
      databaseId = "(default)";
    }
  }
  return {
    mode,
    projectId,
    databaseId: databaseId!,
    resource: `projects/${projectId}/databases/${databaseId}`,
    ...(mode === "staging" ? { uid: env.STAGING_DATABASE_UID } : {}),
  };
}
/** No metadata mismatch, missing database, permission error or timeout can cause fallback. */
export function assertStagingMetadata(target: DatabaseTarget, value: unknown) {
  const d = value as Record<string, unknown> | null;
  if (
    target.mode !== "staging" ||
    target.databaseId !== STAGING_DATABASE ||
    !d ||
    d.name !== target.resource ||
    d.uid !== target.uid ||
    d.locationId !== REGION ||
    d.type !== "FIRESTORE_NATIVE" ||
    d.databaseEdition !== "STANDARD"
  )
    throw Error("Staging database verification failed");
}
const verifiedDatabases = new WeakMap<object, DatabaseTarget>();
/** Called only after runtime verification and explicit SDK database selection. */
export function rememberVerifiedDatabase(
  db: Pick<Firestore, "databaseId">,
  target: DatabaseTarget,
) {
  if (db.databaseId !== target.databaseId)
    throw Error("Database selection mismatch");
  verifiedDatabases.set(db, Object.freeze({ ...target }));
}
/** Defense in depth for every exported maintenance function, including direct invocation outside the CLI. */
export function assertOperatorDatabase(db: Pick<Firestore, "databaseId">) {
  if (db.databaseId !== STAGING_DATABASE)
    throw Error("Operator requires named staging database");
  const target = verifiedDatabases.get(db);
  if (!target || !["staging", "emulator"].includes(target.mode))
    throw Error("Verified staging runtime required");
  if (target.mode === "emulator" && target.projectId === "demo-mi-security") {
    if (
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
      process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    )
      throw Error("Local demo emulator required");
  } else {
    const t = databaseTarget("staging", target.projectId, db.databaseId);
    if (
      process.env.BACKEND_MODE !== "staging" ||
      t.databaseId !== STAGING_DATABASE
    )
      throw Error("Operator staging mode required");
  }
}
