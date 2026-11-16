import { createHash, randomUUID } from "node:crypto";
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { safeId, type Membership } from "./contracts";
import { key } from "./firestore-store";
export interface BootstrapApproval {
  approved: true;
  uid: string;
  tenantId: string;
  role: "administrator";
  providerId: "google.com" | "microsoft.com";
  providerUid: string;
  approvalReference: string;
}
/** Operator-only, never routed through HTTP. Default is a read-only dry run. */
export async function bootstrapAdministrator(
  db: Firestore,
  auth: Auth,
  approval: BootstrapApproval,
  apply = false,
) {
  if (
    !approval ||
    Object.keys(approval).some(
      (k) =>
        ![
          "approved",
          "uid",
          "tenantId",
          "role",
          "providerId",
          "providerUid",
          "approvalReference",
        ].includes(k),
    ) ||
    approval.approved !== true ||
    approval.role !== "administrator" ||
    !["google.com", "microsoft.com"].includes(approval.providerId) ||
    typeof approval.uid !== "string" ||
    !approval.uid ||
    approval.uid.length > 128 ||
    typeof approval.providerUid !== "string" ||
    !approval.providerUid ||
    approval.providerUid.length > 256 ||
    typeof approval.approvalReference !== "string" ||
    !approval.approvalReference ||
    approval.approvalReference.length > 200
  )
    throw Error("Invalid bootstrap approval");
  safeId(approval.tenantId);
  const user = await auth.getUser(approval.uid); // Unknown users are never created by this tool.
  if (
    user.disabled ||
    !user.emailVerified ||
    !user.providerData.some(
      (p) =>
        p.providerId === approval.providerId && p.uid === approval.providerUid,
    )
  )
    throw Error("Unapproved provider identity");
  const approvalHash = createHash("sha256")
    .update(
      JSON.stringify([
        approval.uid,
        approval.tenantId,
        approval.role,
        approval.providerId,
        approval.providerUid,
        approval.approvalReference,
      ]),
    )
    .digest("hex");
  return db.runTransaction(
    async (tx) => {
      const root = db.doc(`tenants/${approval.tenantId}`);
      const marker = root.collection("bootstrap").doc("firstAdministrator");
      const membership = root.collection("memberships").doc(key(approval.uid));
      const [tenant, prior, existing] = await tx.getAll(
        root,
        marker,
        membership,
      );
      if (!tenant.exists || !Number.isSafeInteger(tenant.data()!.revision))
        throw Error("Existing tenant required");
      if (prior.exists) {
        if (
          prior.data()!.approvalHash !== approvalHash ||
          !existing.exists ||
          existing.data()!.enabled !== true ||
          existing.data()!.approved !== true ||
          existing.data()!.role !== "administrator"
        )
          throw Error("Bootstrap locked; use reviewed recovery");
        return { changed: false, dryRun: !apply };
      }
      const administrators = await tx.get(
        root
          .collection("memberships")
          .where("role", "==", "administrator")
          .limit(1),
      );
      if (!administrators.empty || existing.exists)
        throw Error(
          "Bootstrap requires no existing administrator or target membership",
        );
      if (!apply) return { changed: true, dryRun: true };
      const revision = tenant.data()!.revision + 1,
        id = randomUUID(),
        at = new Date().toISOString();
      const m: Membership = {
        tenantId: approval.tenantId,
        subject: user.uid,
        approved: true,
        enabled: true,
        role: "administrator",
        agreementIds: [],
        projectIds: "all-authorized-agreements",
      };
      tx.create(membership, m);
      tx.create(marker, {
        approvalHash,
        approvalReference: approval.approvalReference,
        at,
      });
      tx.create(root.collection("audits").doc(id), {
        id,
        tenantId: approval.tenantId,
        actor: "operator-bootstrap",
        action: "first-administrator-approved",
        entityId: key(user.uid),
        approvalReference: approval.approvalReference,
        revision,
        at,
      });
      tx.update(root, { revision });
      return { changed: true, dryRun: false };
    },
    { maxAttempts: 3 },
  );
}
/** Bounded operator lifecycle: never deletes immutable business audits/history. No scheduler or TTL is enabled. */
export async function pruneIdempotency(
  db: Firestore,
  tenantId: string,
  apply = false,
  now = Date.now(),
) {
  safeId(tenantId);
  return db.runTransaction(
    async (tx) => {
      const root = db.doc(`tenants/${tenantId}`),
        tenant = await tx.get(root);
      if (!tenant.exists) throw Error("Existing tenant required");
      const docs = await tx.get(
        root
          .collection("idempotency")
          .where("expiresAt", "<=", new Date(now))
          .limit(100),
      );
      if (apply && docs.size) {
        for (const d of docs.docs) tx.delete(d.ref);
        const id = randomUUID(),
          revision = tenant.data()!.revision + 1;
        tx.create(root.collection("audits").doc(id), {
          id,
          tenantId,
          actor: "operator-maintenance",
          action: "idempotency-retention-pruned",
          entityId: "idempotency",
          count: docs.size,
          at: new Date(now).toISOString(),
          revision,
        });
        tx.update(root, { revision });
      }
      return {
        count: docs.size,
        dryRun: !apply,
        morePossible: docs.size === 100,
      };
    },
    { maxAttempts: 3 },
  );
}
