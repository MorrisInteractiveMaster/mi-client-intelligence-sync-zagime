import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { assertOperatorDatabase } from "./database-target";
import { safeId } from "./contracts";
import { key } from "./firestore-store";
import { isDeepStrictEqual } from "node:util";
/** Offline operator only. No staff enrollment, Auth creation, claim changes or HTTP route. */
export async function provisionClient(
  db: Firestore,
  auth: Auth,
  value: unknown,
  apply = false,
) {
  assertOperatorDatabase(db);
  const input = value as {
    approved?: boolean;
    tenantId?: string;
    uid?: string;
    agreementIds?: string[];
  };
  if (
    input?.approved !== true ||
    !input.tenantId?.startsWith("synthetic-") ||
    !input.uid ||
    !Array.isArray(input.agreementIds) ||
    input.agreementIds.length < 1 ||
    input.agreementIds.length > 25 ||
    Object.keys(input).some(
      (k) => !["approved", "tenantId", "uid", "agreementIds"].includes(k),
    )
  )
    throw Error("Invalid client approval");
  const tenant = safeId(input.tenantId),
    user = await auth.getUser(input.uid);
  if (
    user.disabled ||
    !user.emailVerified ||
    !user.providerData.some((p) => p.providerId === "google.com")
  )
    throw Error("Unapproved client identity");
  const member = {
    tenantId: tenant,
    subject: user.uid,
    approved: true,
    enabled: true,
    role: "client",
    agreementIds: [...new Set(input.agreementIds.map(safeId))].sort(),
    projectIds: "all-authorized-agreements",
  };
  return db.runTransaction(
    async (tx) => {
      const root = db.doc(`tenants/${tenant}`),
        ref = root.collection("memberships").doc(key(user.uid));
      const [t, prior, ...agreements] = await tx.getAll(
        root,
        ref,
        ...member.agreementIds.map((id) =>
          root.collection("agreements").doc(id),
        ),
      );
      if (
        !t.exists ||
        t.data()!.synthetic !== true ||
        agreements.some((a) => !a.exists || a.data()!.tenantId !== tenant)
      )
        throw Error("Invalid synthetic client scope");
      if (prior.exists) {
        if (!isDeepStrictEqual(prior.data(), member))
          throw Error(
            "Existing membership requires independent revocation/review",
          );
        return { dryRun: !apply, changed: false };
      }
      if (apply) {
        const revision = t.data()!.revision + 1;
        const id = crypto.randomUUID();
        if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
        tx.create(ref, member);
        tx.create(root.collection("audits").doc(id), {
          id,
          action: "synthetic-client-provisioned",
          actor: "approved-operator",
          entityId: key(user.uid),
          tenantId: tenant,
          at: new Date().toISOString(),
          revision,
        });
        tx.update(root, { revision });
      }
      return { dryRun: !apply, changed: apply };
    },
    { maxAttempts: 3 },
  );
}
