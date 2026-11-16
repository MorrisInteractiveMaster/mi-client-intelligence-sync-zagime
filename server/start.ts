import { firebaseRuntime, FirebaseIdentityVerifier } from "./firebase";
import { FirestoreTenantStore } from "./firestore-store";
import { ReportingBackend } from "./backend";
import { apiServer } from "./http";
// Invoked explicitly; importing backend modules never connects to Firebase.
const mode = process.env.BACKEND_MODE;
if (mode !== "emulator" && mode !== "production")
  throw Error(
    "Set BACKEND_MODE explicitly; live access is disabled by default",
  );
const projectId =
  mode === "emulator" ? "demo-mi-security" : "morris-client-dash-zagime";
const runtime = firebaseRuntime(mode, projectId);
const backend = new ReportingBackend(
  new FirestoreTenantStore(runtime.db),
  new FirebaseIdentityVerifier(runtime.auth),
  {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    now: Date.now,
  },
);
const server = apiServer(backend, {
  allowedOrigin: process.env.ALLOWED_ORIGIN,
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
