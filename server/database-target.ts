import { STAGING_SERVICE_ACCOUNT } from "./attached-identity";
import type { Firestore } from "firebase-admin/firestore";
export const COMPANY_PROJECT = "morris-client-dash-zagime";
export const STAGING_DATABASE = "mi-client-staging";
export const PRODUCTION_DATABASE = "mi-client-production";
export const PRODUCTION_SERVICE_ACCOUNT = "mi-client-production-api@morris-client-dash-zagime.iam.gserviceaccount.com";
export const PRODUCTION_SERVICE = "mi-client-prod-dashboard";
export const PRODUCTION_OPERATOR = "mi-client-prod-operator";
export const PRODUCTION_TIME_JOB = "mi-client-prod-time-sync";
export const validProductionTenant = (id: string) =>
  /^[a-z][a-z0-9-]{1,100}$/.test(id) && !id.startsWith("synthetic-");
export const REGION = "northamerica-northeast1";
export const EXPECTED_STAGING_UID = "6d09ea71-f495-44a5-94a6-732ed1c47d88";
export type RuntimeMode = "emulator" | "production" | "staging";
export interface DatabaseTarget {
  mode: RuntimeMode;
  projectId: string;
  databaseId: string;
  resource: string;
  uid?: string;
  serviceAccountEmail?: string;
  tenantId?: string;
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
        env.ENABLE_PRODUCTION === "true" ||
        !/^[a-z][a-z0-9-]{5,29}$/.test(projectId) ||
        projectId !== env.STAGING_FIREBASE_PROJECT_ID ||
        env.ENABLE_SYNTHETIC_STAGING !== "true" ||
        databaseId !== STAGING_DATABASE ||
        env.STAGING_IAM_VERIFIED !== "true" ||
        (projectId === COMPANY_PROJECT
          ? env.STAGING_SERVICE_ACCOUNT_EMAIL !== STAGING_SERVICE_ACCOUNT
          : !/^[a-z][a-z0-9-]{5,29}@[a-z][a-z0-9-]{5,29}\.iam\.gserviceaccount\.com$/.test(
              env.STAGING_SERVICE_ACCOUNT_EMAIL ?? "",
            ) ||
            !env.STAGING_SERVICE_ACCOUNT_EMAIL!.endsWith(
              "@" + projectId + ".iam.gserviceaccount.com",
            )) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          env.STAGING_DATABASE_UID ?? "",
        )
      )
        throw Error("Explicit verified named staging configuration required");
    } else {
      if (
        env.BACKEND_MODE !== "production" ||
        projectId !== COMPANY_PROJECT ||
        projectId !== env.PRODUCTION_FIREBASE_PROJECT_ID ||
        databaseId !== PRODUCTION_DATABASE ||
        env.FIRESTORE_DATABASE_ID !== PRODUCTION_DATABASE ||
        env.ENABLE_PRODUCTION !== "true" ||
        env.PRODUCTION_IAM_VERIFIED !== "true" ||
        env.PRODUCTION_SERVICE_ACCOUNT_EMAIL !== PRODUCTION_SERVICE_ACCOUNT ||
        env.PRODUCTION_DATABASE_UID === EXPECTED_STAGING_UID ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(env.PRODUCTION_DATABASE_UID ?? "") ||
        !validProductionTenant(env.MORRIS_DASHBOARD_TENANT_ID ?? "") ||
        env.STAGING_PREVIEW_ONLY === "true" ||
        env.ENABLE_SYNTHETIC_STAGING === "true" ||
        env.SERVE_STAGING_FRONTEND === "true" ||
        env.STAGING_FIREBASE_PROJECT_ID ||
        env.STAGING_DATABASE_UID ||
        env.STAGING_IAM_VERIFIED ||
        env.STAGING_SERVICE_ACCOUNT_EMAIL
      )
        throw Error("Unintended production access refused");
    }
  }
  return {
    mode,
    projectId,
    databaseId: databaseId!,
    resource: `projects/${projectId}/databases/${databaseId}`,
    ...(mode === "staging"
      ? {
          uid: env.STAGING_DATABASE_UID,
          serviceAccountEmail: env.STAGING_SERVICE_ACCOUNT_EMAIL,
        }
      : mode === "production"
        ? {
            uid: env.PRODUCTION_DATABASE_UID,
            serviceAccountEmail: PRODUCTION_SERVICE_ACCOUNT,
            tenantId: env.MORRIS_DASHBOARD_TENANT_ID,
          }
        : {}),
  };
}
/** No metadata mismatch, missing database, permission error or timeout can cause fallback. */
export function assertDatabaseMetadata(target: DatabaseTarget, value: unknown) {
  const d = value as Record<string, unknown> | null;
  if (
    !isNamedLiveTarget(target) ||
    !d ||
    d.name !== target.resource ||
    d.uid !== target.uid ||
    d.locationId !== REGION ||
    d.type !== "FIRESTORE_NATIVE" ||
    d.databaseEdition !== "STANDARD"
  )
    throw Error(target.mode === "production" ? "Production database verification failed" : "Staging database verification failed");
}
export function isNamedLiveTarget(target: DatabaseTarget) {
  return ((target.mode === "staging" && target.databaseId === STAGING_DATABASE) ||
          (target.mode === "production" && target.databaseId === PRODUCTION_DATABASE &&
           target.projectId === COMPANY_PROJECT && target.serviceAccountEmail === PRODUCTION_SERVICE_ACCOUNT)) &&
    Boolean(target.uid) && target.resource === `projects/${target.projectId}/databases/${target.databaseId}`;
}

export const assertStagingMetadata = assertDatabaseMetadata;
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
  return target;
}
/** Project workflows use an explicitly verified database. Legacy maintenance stays in staging. */
export function assertProjectDatabase(db: Pick<Firestore, "databaseId">) {
  if (db.databaseId === PRODUCTION_DATABASE) {
    const target = verifiedDatabases.get(db);
    if (target?.mode !== "production" || process.env.BACKEND_MODE !== "production")
      throw Error("Verified production runtime required");
    const configured = databaseTarget("production", COMPANY_PROJECT, db.databaseId);
    if (target.uid !== configured.uid || target.tenantId !== configured.tenantId ||
        target.serviceAccountEmail !== configured.serviceAccountEmail || !isNamedLiveTarget(target))
      throw Error("Production target changed");
    return target;
  }
  const target = assertOperatorDatabase(db);
  if (!((target.mode === "emulator" && target.projectId === "demo-mi-security") || (target.mode === "staging" && target.projectId === COMPANY_PROJECT && target.uid === EXPECTED_STAGING_UID))) throw Error("Invalid project database target");
  return target;
}

/** Validate tenant binding before accessing a path, then validate its persisted environment. */
export function assertProductionTenant(target: DatabaseTarget, tenant: string, meta?: Record<string, unknown>) {
  if (target.mode === "production" &&
      (tenant !== target.tenantId || (meta && (meta.environment !== "production" || meta.synthetic !== false))))
    throw Error("Forbidden");
}
