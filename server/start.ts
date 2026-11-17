import { firebaseRuntime, FirebaseIdentityVerifier } from "./firebase";
import { FirestoreTenantStore } from "./firestore-store";
import { ReportingBackend } from "./backend";
import { apiServer } from "./http";
import { MorrisStaffVerifier, staffConfiguration } from "./morris-staff";
// Invoked explicitly; importing backend modules never connects to Firebase.
const mode = process.env.BACKEND_MODE;
if (mode !== "emulator" && mode !== "production" && mode !== "staging")
  throw Error(
    "Set BACKEND_MODE explicitly; live access is disabled by default",
  );
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
const projectId =
  mode === "emulator"
    ? "demo-mi-security"
    : mode === "staging"
      ? (process.env.STAGING_FIREBASE_PROJECT_ID ?? "")
      : "morris-client-dash-zagime";
const staff = mode === "staging" ? new MorrisStaffVerifier(staffConfiguration(process.env)) : undefined;
const runtime = firebaseRuntime(mode, projectId);
try {
  await runtime.verify();
} catch {
  await runtime.close();
  throw Error("Backend database verification failed; service not started");
}
const backend = new ReportingBackend(
  new FirestoreTenantStore(runtime.db),
  new FirebaseIdentityVerifier(runtime.auth, staff),
  {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    now: Date.now,
  },
);
const server = apiServer(backend, {
  allowedOrigin: process.env.ALLOWED_ORIGIN,
  ...(process.env.SERVE_STAGING_FRONTEND === "true" && mode === "staging" ? { frontend: "dist" } : {}),
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT ?? 8081),
  mode === "emulator" ? "127.0.0.1" : "0.0.0.0",
);
process.on("SIGTERM", () => {
  server.close(() => void runtime.close());
});
