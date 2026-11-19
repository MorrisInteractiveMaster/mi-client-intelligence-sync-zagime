import type { Firestore } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { assertProjectDatabase, assertProductionTenant } from "./database-target";
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
  if (assertProjectDatabase(db).mode === "production") throw Error("Synthetic operations are forbidden in production");
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

/** Creates only the tenant marker and an audit in the empty production database. */
export async function initializeProductionTenant(db: Firestore, tenant: string, apply = false) {
  const target = assertProjectDatabase(db);
  if (target.mode !== "production") throw Error("Verified production runtime required");
  assertProductionTenant(target, tenant);
  const root = db.doc(`tenants/${safeId(tenant)}`);
  if ((await root.listCollections()).length) throw Error("Production tenant must be empty");
  return db.runTransaction(async (tx) => {
    if ((await tx.get(root)).exists) throw Error("Production tenant already exists");
    if (apply) {
      tx.create(root, {
        name: "Zagimē Anishinabēk Nation", schemaVersion: 2, revision: 1,
        environment: "production", synthetic: false,
      });
      tx.create(root.collection("audits").doc("production-initialized"), {
        id: "production-initialized", tenantId: tenant, actor: "approved-operator",
        action: "production-initialized", entityId: tenant, at: new Date().toISOString(), revision: 1,
      });
    }
    return { dryRun: !apply, documents: 2, fixtures: 0 };
  });
}

/** Explicit approved client only; does not enroll staff, create users or modify Auth. */
export async function provisionProjectClient(
  db: Firestore,
  auth: Auth,
  value: unknown,
  apply = false,
) {
  const target = assertProjectDatabase(db);
  const production = target.mode === "production";
  const p = value as {
    approved: boolean;
    tenantId: string;
    uid: string;
    projectIds: string[];
    databaseUid?: string;
    action?: "grant" | "revoke";
  };
  const revoke = production && p?.action === "revoke";
  if (
    !p ||
    p.approved !== true ||
    typeof p.tenantId !== "string" ||
    (production ? p.tenantId !== target.tenantId || p.databaseUid !== target.uid ||
      !["grant", "revoke"].includes(p.action ?? "") : !p.tenantId.startsWith("synthetic-")) ||
    typeof p.uid !== "string" || !p.uid || p.uid.length > 128 ||
    !Array.isArray(p.projectIds) ||
    (revoke ? p.projectIds.length !== 0 : p.projectIds.length < 1) ||
    p.projectIds.length > 100 ||
    Object.keys(p).some(
      (k) => !["approved", "tenantId", "uid", "projectIds"].includes(k) &&
        !(production && ["databaseUid", "action"].includes(k)),
    )
  )
    throw Error("Invalid client approval");
  const tenant = safeId(p.tenantId),
    ids = [...new Set(p.projectIds.map(safeId))].sort(),
    user = revoke ? undefined : await auth.getUser(p.uid);
  const google = user?.providerData.find((p) => p.providerId === "google.com");
  if (user && (user.disabled || !user.emailVerified || !google || (production && !google.uid)))
    throw Error("Unapproved client identity");
  const membership = {
    schemaVersion: 2,
    tenantId: tenant,
    subject: p.uid,
    role: "client",
    approved: true,
    enabled: true,
    projectIds: ids,
    ...(production && google ? { googleSubject: google.uid } : {}),
  };
  return db.runTransaction(
    async (tx) => {
      const root = db.doc(`tenants/${tenant}`),
        ref = root.collection("memberships").doc(key(p.uid));
      const [t, prior, ...projects] = await tx.getAll(
        root,
        ref,
        ...ids.map((id) => root.collection("projects").doc(id)),
      );
      if (
        !t.exists ||
        t.data()!.schemaVersion !== 2 ||
        (production ? t.data()!.environment !== "production" || t.data()!.synthetic !== false : t.data()!.synthetic !== true) ||
        projects.some(
          (d) =>
            !d.exists ||
            d.data()!.tenantId !== tenant ||
            d.data()!.schemaVersion !== 2,
        )
      )
        throw Error("Invalid client scope");
      if (revoke) {
        const current = prior.data();
        if (!prior.exists || current?.enabled === false) return { dryRun: !apply, changed: false };
        if (current?.role !== "client" || current.subject !== p.uid || current.tenantId !== tenant || current.schemaVersion !== 2)
          throw Error("Invalid client membership");
      } else if (prior.exists) {
        const current = prior.data()!;
        if (isDeepStrictEqual(current, membership)) return { dryRun: !apply, changed: false };
        if (!production || current.enabled !== false ||
            !isDeepStrictEqual({ ...current, enabled: true, projectIds: ids }, membership))
          throw Error(
            "Existing membership requires independent revocation/review",
          );
      }
      if (apply) {
        const revision = t.data()!.revision + 1,
          id = randomUUID();
        if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
        if (revoke) tx.update(ref, { enabled: false });
        else if (prior.exists) tx.update(ref, { enabled: true, projectIds: ids });
        else tx.create(ref, membership);
        tx.create(root.collection("audits").doc(id), {
          id,
          tenantId: tenant,
          action: revoke ? "project-client-revoked" : "project-client-provisioned",
          actor: "approved-operator",
          entityId: key(p.uid),
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
  assertProjectDatabase(db);
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
