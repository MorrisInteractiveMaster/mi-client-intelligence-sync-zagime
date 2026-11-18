import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertOperatorDatabase } from "./database-target";
import { safeId } from "./contracts";
import { key } from "./firestore-store";
import {
  managedProject,
  projectView,
  type Project,
} from "../src/projects/model";

export async function seedProjectSynthetic(
  db: Firestore,
  tenant: string,
  apply = false,
) {
  assertOperatorDatabase(db);
  safeId(tenant);
  if (!tenant.startsWith("synthetic-"))
    throw Error("Synthetic tenant prefix required");
  const root = db.doc(`tenants/${tenant}`),
    at = new Date().toISOString();
  const projects: Project[] = ["synthetic-planning", "synthetic-delivery"].map(
    (id, i) => ({
      schemaVersion: 2,
      id,
      tenantId: tenant,
      source: null,
      ...managedProject({
        name: i ? "Synthetic delivery project" : "Synthetic planning project",
        status: "planned",
        progress: 0,
        description: "Synthetic information only",
        internalNotes: "Synthetic internal note",
        plan: { basis: "fixed", targetSeconds: 36000 },
      }),
      published: false,
      createdAt: at,
      updatedAt: at,
      createdBy: "approved-operator",
      updatedBy: "approved-operator",
    }),
  );
  return db.runTransaction(
    async (tx) => {
      if ((await tx.get(root)).exists)
        throw Error("Refusing to overwrite an existing tenant");
      if (apply) {
        tx.create(root, {
          name: "Synthetic project workspace",
          schemaVersion: 2,
          revision: 1,
          synthetic: true,
        });
        for (const p of projects) {
          tx.create(root.collection("projects").doc(p.id), p);
          tx.create(
            root.collection("projectViews").doc(p.id),
            projectView(p, 0),
          );
        }
        tx.create(root.collection("rawTime").doc("synthetic-time"), {
          schemaVersion: 2,
          source: "synthetic",
          scopeProjectId: projects[0].id,
          deleted: false,
          approval: "unknown",
          record: {
            id: "synthetic-time",
            tenantId: tenant,
            sourcePersonId: "synthetic-person",
            sourceWorkOrderId: "synthetic-job",
            date: "2026-11-13",
            seconds: 7200,
            description: "Synthetic source hours",
            revision: "synthetic-1",
          },
        });
        tx.create(
          root.collection("audits").doc("project-synthetic-initialization"),
          {
            id: "project-synthetic-initialization",
            tenantId: tenant,
            actor: "approved-operator",
            action: "project-synthetic-initialized",
            entityId: tenant,
            at,
            revision: 1,
          },
        );
      }
      return { dryRun: !apply, documents: 7, usersCreated: 0 };
    },
    { maxAttempts: 3 },
  );
}

/** Explicit approved client only; does not enroll staff, create users or modify Auth. */
export async function provisionProjectClient(
  db: Firestore,
  auth: Auth,
  value: unknown,
  apply = false,
) {
  assertOperatorDatabase(db);
  const p = value as {
    approved: boolean;
    tenantId: string;
    uid: string;
    projectIds: string[];
  };
  if (
    !p ||
    p.approved !== true ||
    typeof p.tenantId !== "string" ||
    !p.tenantId.startsWith("synthetic-") ||
    typeof p.uid !== "string" ||
    !Array.isArray(p.projectIds) ||
    p.projectIds.length < 1 ||
    p.projectIds.length > 100 ||
    Object.keys(p).some(
      (k) => !["approved", "tenantId", "uid", "projectIds"].includes(k),
    )
  )
    throw Error("Invalid client approval");
  const tenant = safeId(p.tenantId),
    ids = [...new Set(p.projectIds.map(safeId))].sort(),
    user = await auth.getUser(p.uid);
  if (
    user.disabled ||
    !user.emailVerified ||
    !user.providerData.some((p) => p.providerId === "google.com")
  )
    throw Error("Unapproved client identity");
  const membership = {
    schemaVersion: 2,
    tenantId: tenant,
    subject: user.uid,
    role: "client",
    approved: true,
    enabled: true,
    projectIds: ids,
  };
  return db.runTransaction(
    async (tx) => {
      const root = db.doc(`tenants/${tenant}`),
        ref = root.collection("memberships").doc(key(user.uid));
      const [t, prior, ...projects] = await tx.getAll(
        root,
        ref,
        ...ids.map((id) => root.collection("projects").doc(id)),
      );
      if (
        !t.exists ||
        t.data()!.schemaVersion !== 2 ||
        t.data()!.synthetic !== true ||
        projects.some(
          (d) =>
            !d.exists ||
            d.data()!.tenantId !== tenant ||
            d.data()!.schemaVersion !== 2,
        )
      )
        throw Error("Invalid synthetic client scope");
      if (prior.exists) {
        if (!isDeepStrictEqual(prior.data(), membership))
          throw Error(
            "Existing membership requires independent revocation/review",
          );
        return { dryRun: !apply, changed: false };
      }
      if (apply) {
        const revision = t.data()!.revision + 1,
          id = randomUUID();
        if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
        tx.create(ref, membership);
        tx.create(root.collection("audits").doc(id), {
          id,
          tenantId: tenant,
          action: "project-client-provisioned",
          actor: "approved-operator",
          entityId: key(user.uid),
          revision,
          at: new Date().toISOString(),
        });
        tx.update(root, { revision });
      }
      return { dryRun: !apply, changed: apply };
    },
    { maxAttempts: 3 },
  );
}

/** Bounded, read-only migration inventory. No apply switch; never rewrites history. */
export async function inspectProjectMigration(db: Firestore, tenant: string) {
  assertOperatorDatabase(db);
  safeId(tenant);
  if (!tenant.startsWith("synthetic-"))
    throw Error("Synthetic tenant prefix required");
  return db.runTransaction(async (tx) => {
    const root = db.doc(`tenants/${tenant}`),
      t = await tx.get(root);
    if (!t.exists) throw Error("Invalid missing tenant");
    const names = [
      "projects",
      "rawTime",
      "allocationHeads",
      "projectPeriods",
      "memberships",
    ];
    const snapshots = await Promise.all(
      names.map((n) => tx.get(root.collection(n).limit(101))),
    );
    if (snapshots.some((s) => s.size > 100))
      throw Error("Migration capacity exceeded; review bounded paging");
    const counts = Object.fromEntries(
      names.map((n, i) => [n, snapshots[i].size]),
    );
    const evidence = snapshots.map((s) => s.docs.map((d) => [d.id, d.data()]));
    return {
      dryRun: true,
      schemaVersion: t.data()!.schemaVersion ?? 1,
      counts,
      manifestHash: createHash("sha256")
        .update(JSON.stringify([t.data(), evidence]))
        .digest("hex"),
      requiresApprovedMigration: t.data()!.schemaVersion !== 2,
      blockers:
        t.data()!.schemaVersion === 2
          ? []
          : [
              "Legacy project/source mapping and client-scope review required",
              "No automatic rewrite or deletion is implemented",
            ],
    };
  });
}
