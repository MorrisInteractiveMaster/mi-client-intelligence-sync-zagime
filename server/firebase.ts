import { verifyAttachedIdentity } from "./attached-identity";
import {
  databaseTarget,
  rememberVerifiedDatabase,
  type DatabaseTarget,
} from "./database-target";
import { verifyDatabase } from "./database-verification";
import {
  initializeApp,
  type App,
  deleteApp,
  applicationDefault,
} from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { IdentityVerifier } from "./contracts";
import { MorrisStaffVerifier } from "./morris-staff";
import { requestIdentity } from "./request-identity";
export interface FirebaseRuntime {
  app: App;
  auth: Auth;
  readonly db: Firestore;
  readonly target: DatabaseTarget;
  verify: () => Promise<void>;
  close: () => Promise<void>;
}
export function firebaseRuntime(
  mode: "emulator" | "production" | "staging",
  projectId: string,
  databaseId?: string,
): FirebaseRuntime {
  const target = Object.freeze(databaseTarget(mode, projectId, databaseId));
  const app = initializeApp({ projectId }, `mi-${mode}-${crypto.randomUUID()}`);
  const auth = getAuth(app);
  let db: Firestore | undefined;
  let verified = mode === "emulator";
  let verification: Promise<void> | undefined;
  const database = () => {
    if (!verified) throw Error(`Verify named ${mode} database before access`);
    if (!db) {
      db = getFirestore(app, target.databaseId);
      if (mode !== "emulator")
        db.settings({
          host: "firestore.northamerica-northeast1.rep.googleapis.com",
        });
      rememberVerifiedDatabase(db, target);
    }
    return db;
  };
  return {
    app,
    auth,
    target,
    get db() {
      return database();
    },
    verify: () => {
      if (verified) return Promise.resolve();
      return (verification ??= verifyAttachedIdentity(
        target.serviceAccountEmail!,
      )
        .then(() =>
          verifyDatabase(
            target,
            app.options.credential ?? applicationDefault(),
          ),
        )
        .then(() => {
          verified = true;
        }));
    },
    close: async () => {
      if (db) await db.terminate();
      await deleteApp(app);
    },
  };
}
/** Production SDK verifies Google's signature, issuer/audience/expiry and revocation/account state. Emulator acceptance is isolated by runtime guard. */
export class FirebaseIdentityVerifier implements IdentityVerifier {
  constructor(
    private readonly auth: Auth,
    private readonly staff?: MorrisStaffVerifier,
    private readonly production = false,
  ) {}
  async verify(authorization: string) {
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization))
      throw Error("Unauthenticated");
    try {
      const t = await this.auth.verifyIdToken(authorization.slice(7), true);
      if (t.firebase?.tenant)
        throw Error("Auth multi-tenancy is not configured");
      let staffTenantId: string | undefined;
      let googleSubject: string | undefined;
      if (
        this.production && t.firebase?.sign_in_provider !== "microsoft.com" &&
        (t.firebase?.sign_in_provider !== "google.com" || t.email_verified !== true)
      )
        throw Error("Unapproved production sign-in provider");
      if (this.production && t.firebase?.sign_in_provider === "google.com") {
        const ids = t.firebase.identities?.["google.com"];
        if (ids?.length !== 1 || typeof ids[0] !== "string" || !ids[0]) throw Error();
        googleSubject = ids[0];
      }
      if (this.staff && t.firebase?.sign_in_provider === "microsoft.com") {
        const user = await this.auth.getUser(t.uid);
        const oid = user.providerData.find(p => p.providerId === "microsoft.com")?.uid;
        if (user.disabled || !oid || !t.firebase.identities?.["microsoft.com"]?.includes(oid)) throw Error();
        staffTenantId = await this.staff.verify(oid, requestIdentity.getStore()?.proof);
      }
      if (this.production && t.firebase?.sign_in_provider === "microsoft.com" && !staffTenantId)
        throw Error("Unapproved production staff identity");
      return {
        subject: t.uid,
        issuer: t.iss,
        audience: t.aud,
        expiresAt: t.exp * 1000,
        disabled: false,
        revoked: false,
        ...(this.staff ? { corporatePolicy: true } : {}),
        ...(staffTenantId ? { staffTenantId } : {}),
        ...(googleSubject ? { googleSubject } : {}),
      };
    } catch {
      throw Error("Unauthenticated");
    }
  }
}
