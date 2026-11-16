import { initializeApp, type App, deleteApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { IdentityVerifier } from "./contracts";
export interface FirebaseRuntime {
  app: App;
  auth: Auth;
  db: Firestore;
  close: () => Promise<void>;
}
export function firebaseRuntime(
  mode: "emulator" | "production" | "staging",
  projectId: string,
): FirebaseRuntime {
  if (mode === "emulator") {
    if (
      projectId !== "demo-mi-security" ||
      process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9099" ||
      process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8080"
    )
      throw Error("Local demo emulator required");
  } else if (
    (mode === "production"
      ? projectId !== "morris-client-dash-zagime"
      : !/^[a-z][a-z0-9-]{5,29}$/.test(projectId) ||
        projectId === "morris-client-dash-zagime" ||
        projectId !== process.env.STAGING_FIREBASE_PROJECT_ID ||
        process.env.ENABLE_SYNTHETIC_STAGING !== "true") ||
    process.env.ENABLE_LIVE_FIREBASE !== "true" ||
    process.env.FIRESTORE_RULES_VERIFIED !== "true" ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  )
    throw Error("Live Firebase is disabled or unsafe");
  const app = initializeApp({ projectId }, `mi-${mode}-${crypto.randomUUID()}`);
  const auth = getAuth(app);
  const db = getFirestore(app, "(default)");
  if (mode !== "emulator")
    db.settings({
      host: "firestore.northamerica-northeast1.rep.googleapis.com",
    });
  return {
    app,
    auth,
    db,
    close: async () => {
      await db.terminate();
      await deleteApp(app);
    },
  };
}
/** Production SDK verifies Google's signature, issuer/audience/expiry and revocation/account state. Emulator acceptance is isolated by runtime guard. */
export class FirebaseIdentityVerifier implements IdentityVerifier {
  constructor(private readonly auth: Auth) {}
  async verify(authorization: string) {
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization))
      throw Error("Unauthenticated");
    try {
      const t = await this.auth.verifyIdToken(authorization.slice(7), true);
      if (t.firebase?.tenant)
        throw Error("Auth multi-tenancy is not configured");
      return {
        subject: t.uid,
        issuer: t.iss,
        audience: t.aud,
        expiresAt: t.exp * 1000,
        disabled: false,
        revoked: false,
      };
    } catch {
      throw Error("Unauthenticated");
    }
  }
}
