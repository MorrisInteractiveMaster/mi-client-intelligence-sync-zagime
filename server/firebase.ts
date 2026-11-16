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
  let verified = mode !== "staging";
  let verification: Promise<void> | undefined;
  const database = () => {
    if (!verified) throw Error("Verify named staging database before access");
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
      return (verification ??= verifyDatabase(
        target,
        app.options.credential ?? applicationDefault(),
      ).then(() => {
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
