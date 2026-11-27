import { firebaseRuntime, FirebaseIdentityVerifier } from "./firebase";
import { FirestoreTenantStore } from "./firestore-store";
import { ReportingBackend } from "./backend";
import { apiServer } from "./http";
import { MorrisStaffVerifier, staffConfiguration } from "./morris-staff";
import { ProjectBackend, ProjectStore } from "./project-workspace";
import { configureTime } from "./time-config";
import { QboInvoices } from "./qbo-invoices";
import { qboConfig, QboInvoicesProvider } from "./qbo-invoices-provider";
import { readFile } from "node:fs/promises";
import {
  STAGING_DATABASE, COMPANY_PROJECT, EXPECTED_STAGING_UID,
  PRODUCTION_SERVICE, databaseTarget,
} from "./database-target";
// Invoked explicitly; importing backend modules never connects to Firebase.
const mode = process.env.BACKEND_MODE;
if (mode !== "emulator" && mode !== "staging" && mode !== "production")
  throw Error("Set explicit production, staging or demo emulator mode");
if (process.env.K_SERVICE === PRODUCTION_SERVICE && mode !== "production")
  throw Error("Production service requires production mode");
// Explicit inactive preview: no SDK initialization, credentials or database access.
if (process.env.STAGING_PREVIEW_ONLY === "true") {
  if (mode !== "staging") throw Error("Preview is staging only");
  const preview = apiServer(undefined as unknown as ReportingBackend, {
    frontend: "dist", previewOnly: true, allowedOrigin: process.env.ALLOWED_ORIGIN,
  });
  preview.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
  await new Promise<void>(resolve => process.on("SIGTERM", () => preview.close(() => resolve())));
  process.exit(0);
}
if (mode !== "production" && process.env.FIRESTORE_DATABASE_ID !== STAGING_DATABASE)
  throw Error("Explicit named project-workspace database required");
const projectId =
  mode === "emulator"
    ? "demo-mi-security"
    : ((mode === "production" ? process.env.PRODUCTION_FIREBASE_PROJECT_ID : process.env.STAGING_FIREBASE_PROJECT_ID) ?? "");
if (mode === "staging" && (projectId !== COMPANY_PROJECT || process.env.STAGING_DATABASE_UID !== EXPECTED_STAGING_UID)) throw Error("Explicit company staging identity required");
if (mode === "production") databaseTarget(mode, projectId);
const staff = mode === "emulator" ? undefined : new MorrisStaffVerifier(staffConfiguration(process.env));
if (mode === "production") {
  if (process.env.K_SERVICE !== PRODUCTION_SERVICE ||
      !/^https:\/\/[a-z0-9.-]+$/.test(process.env.ALLOWED_ORIGIN ?? "") ||
      process.env.SERVE_STAGING_FRONTEND === "true")
    throw Error("Explicit production service and HTTPS origin required");
  const profile = JSON.parse(await readFile(new URL("./dashboard-profile.json", import.meta.url), "utf8"));
  if (profile.mode !== "production" || profile.tenant !== staff!.config.tenantId ||
      profile.entraTenant !== staff!.config.entraTenantId)
    throw Error("Production frontend profile mismatch");
}
const runtime = firebaseRuntime(mode, projectId);
try {
  await runtime.verify();
} catch {
  await runtime.close();
  throw Error("Backend database verification failed; service not started");
}
const identity = new FirebaseIdentityVerifier(runtime.auth, staff, mode === "production");
const backend = new ReportingBackend(
  new FirestoreTenantStore(runtime.db),
  identity,
  {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    now: Date.now,
  },
);
const projectStore = new ProjectStore(runtime.db, process.env.MORRIS_PLATFORM_ADMIN_UID);
const serveFrontend = mode === "production" ||
  (mode === "staging" && process.env.SERVE_STAGING_FRONTEND === "true");
let invoiceProvider: QboInvoicesProvider | undefined;
try {
  const config = qboConfig(process.env, mode);
  if (config) invoiceProvider = new QboInvoicesProvider(config);
} catch {
  console.error("QBO Invoice integration disabled: review its runtime configuration.");
}
const server = apiServer(backend, {
  invoices: new QboInvoices(projectStore, invoiceProvider),
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  projects: new ProjectBackend(projectStore, identity, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId, now: Date.now }),
  time: configureTime(projectStore, mode, process.env),
  ...(serveFrontend ? { frontend: "dist" } : {}),
});
// Header/body receipt only. QuickBooks Time processing uses its own budget.
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT ?? 8081),
  mode === "emulator" ? "127.0.0.1" : "0.0.0.0",
);
process.on("SIGTERM", () => {
  server.close(() => void runtime.close());
});
