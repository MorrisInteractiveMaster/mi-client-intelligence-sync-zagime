import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  FieldPath,
  Timestamp,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";
import { assertProjectDatabase, assertProductionTenant } from "./database-target";
import {
  type VerifiedIdentity,
  type IdentityVerifier,
  type IdentityPolicy,
  safeId,
} from "./contracts";
import { requestIdentity, rememberIdentity } from "./request-identity";
import { creationKey } from "./idempotency";
import { FirestoreTenantStore, key } from "./firestore-store";
import {
  approvedProjectContent,
  managedProject,
  projectView,
  publicProject,
  type Project,
  type ProjectWorkspace,
  type ProjectReport,
  type ProjectPage,
} from "../src/projects/model";
import type { PageQuery } from "../src/api/types";
import type { Allocation } from "../src/reporting/model";

/** Project operations require a verified named database and its tenant binding. */
export class ProjectStore {
  constructor(readonly db: Firestore) {
    assertProjectDatabase(db);
  }
  async access(tx: Transaction, tenant: string, who: VerifiedIdentity) {
    const target = assertProjectDatabase(this.db);
    assertProductionTenant(target, tenant);
    const root = this.db.doc(`tenants/${safeId(tenant)}`);
    const staff = who.corporatePolicy === true && who.staffTenantId === tenant;
    const [t, member] = staff
      ? [await tx.get(root), undefined]
      : await tx.getAll(
          root,
          root.collection("memberships").doc(key(who.subject)),
        );
    if (!t.exists) throw Error("Forbidden");
    const meta = t.data()!;
    assertProductionTenant(target, tenant, meta);
    if (meta.schemaVersion !== 2) throw Error("Migration required");
    if (
      !Number.isSafeInteger(meta.revision) ||
      meta.revision < 1 ||
      typeof meta.name !== "string"
    )
      throw Error("Invalid tenant");
    const m = member?.data();
    if (
      !staff &&
      (!m ||
        m.schemaVersion !== 2 ||
        m.tenantId !== tenant ||
        m.subject !== who.subject ||
        (target.mode === "production" && (!who.googleSubject || m.googleSubject !== who.googleSubject)) ||
        m.role !== "client" ||
        m.approved !== true ||
        m.enabled !== true ||
        !Array.isArray(m.projectIds) ||
        m.projectIds.length > 100 ||
        m.projectIds.some(
          (id: unknown) =>
            typeof id !== "string" || !/^[-a-zA-Z0-9_]{1,128}$/.test(id),
        ))
    )
      throw Error("Forbidden");
    return {
      root,
      meta,
      staff,
      projectIds: staff
        ? ([] as string[])
        : [...new Set<string>(m!.projectIds)].sort(),
    };
  }
  async workspace(
    tenant: string,
    who: VerifiedIdentity,
  ): Promise<ProjectWorkspace> {
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      return {
        tenant: { id: tenant, name: a.meta.name },
        role: a.staff ? "staff" : "client",
        revision: a.staff ? a.meta.revision : 0,
        ...(a.staff
          ? {
              integrations: {
                accounting: "disabled" as const,
                time: "disabled" as const,
              },
            }
          : {}),
      };
    });
  }
  async save(
    tenant: string,
    who: VerifiedIdentity,
    input: unknown,
    options: {
      id?: string;
      expectedRevision?: number;
      idempotency?: string;
      published?: boolean;
    },
    now: number,
  ) {
    const managed =
      options.published === undefined ? managedProject(input) : undefined;
    const idem = !options.id
      ? creationKey(options.idempotency ?? "", who.subject, now, managed)
      : undefined;
    return this.db.runTransaction(
      async (tx) => {
        const a = await this.access(tx, tenant, who);
        if (!a.staff) throw Error("Forbidden");
        const idemRef = idem
          ? a.root.collection("idempotency").doc(key("project-v2", idem.id))
          : undefined;
        if (idemRef) {
          const previous = await tx.get(idemRef);
          if (previous.exists) {
            if (previous.data()!.payloadHash !== idem!.payloadHash)
              throw Error("Idempotency conflict");
            return previous.data()!.result as {
              id: string;
              revision: number;
              changed: boolean;
            };
          }
        }
        const id = options.id ? safeId(options.id) : randomUUID();
        const ref = a.root.collection("projects").doc(id);
        const prior = options.id ? await tx.get(ref) : undefined;
        if (
          options.id &&
          (!prior?.exists ||
            prior.data()!.schemaVersion !== 2 ||
            prior.data()!.tenantId !== tenant ||
            prior.data()!.id !== options.id)
        )
          throw Error("Forbidden");
        if (options.id && options.expectedRevision !== a.meta.revision)
          throw Error("Revision conflict");
        const old = prior?.data() as Project | undefined;
        if (
          old &&
          options.published !== undefined &&
          typeof options.published !== "boolean"
        )
          throw Error("Invalid publication");
        if (
          old &&
          (managed
            ? isDeepStrictEqual(
                managedProject({
                  name: old.name,
                  status: old.status,
                  progress: old.progress,
                  description: old.description,
                  internalNotes: old.internalNotes,
                  ...(old.workOrderReference === undefined
                    ? {}
                    : { workOrderReference: old.workOrderReference }),
                  plan: old.plan,
                  ...(managed.updates === undefined ? {} : { updates: old.updates ?? [] }),
                  ...(managed.milestones === undefined ? {} : { milestones: old.milestones ?? [] }),
                }),
                managed,
              )
            : old.published === options.published)
        )
          return { id, revision: a.meta.revision, changed: false };
        const at = new Date(now).toISOString();
        const p: Project = old
          ? {
              ...old,
              ...(managed ?? { published: options.published! }),
              updatedAt: at,
              updatedBy: who.subject,
            }
          : {
              schemaVersion: 2,
              id,
              tenantId: tenant,
              source: null,
              ...managed!,
              published: false,
              createdAt: at,
              updatedAt: at,
              createdBy: who.subject,
              updatedBy: who.subject,
            };
        const viewRef = a.root.collection("projectViews").doc(id);
        if (managed && managed.workOrderReference === undefined)
          delete p.workOrderReference;
        const view = old ? await tx.get(viewRef) : undefined;
        if (
          old &&
          (!view?.exists ||
            view.data()!.tenantId !== tenant ||
            view.data()!.id !== id ||
            view.data()!.schemaVersion !== 2)
        )
          throw Error("Invalid reporting summary");
        const revision = a.meta.revision + 1;
        if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
        tx.set(ref, p);
        tx.set(viewRef, {
          ...projectView(p, view?.data()?.lifetimeSeconds ?? 0),
          ...approvedProjectContent(p),
        });
        const auditId = randomUUID();
        tx.create(a.root.collection("audits").doc(auditId), {
          id: auditId,
          tenantId: tenant,
          actor: who.subject,
          action: old
            ? managed
              ? "project-edited"
              : "publication-changed"
            : "project-created",
          entityId: id,
          at,
          revision,
        });
        tx.update(a.root, { revision });
        const result = { id, revision, changed: true };
        if (idemRef)
          tx.create(idemRef, {
            actor: who.subject,
            operation: "create-project-v2",
            payloadHash: idem!.payloadHash,
            result,
            createdAt: Timestamp.fromMillis(now),
            expiresAt: Timestamp.fromMillis(now + 30 * 86400000),
          });
        return result;
      },
      { maxAttempts: 3 },
    );
  }
  async detail(tenant: string, who: VerifiedIdentity, id: string) {
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      const p = await tx.get(a.root.collection("projects").doc(safeId(id)));
      if (
        !p.exists ||
        p.data()!.schemaVersion !== 2 ||
        p.data()!.tenantId !== tenant ||
        p.data()!.id !== id
      )
        throw Error("Forbidden");
      return { revision: a.meta.revision, project: p.data() as Project };
    });
  }
  async report(
    tenant: string,
    who: VerifiedIdentity,
    month: string,
  ): Promise<ProjectReport> {
    checkMonth(month);
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      if (a.staff) throw Error("Invalid staff report; use project pages");
      const views = a.projectIds.length
        ? await tx.getAll(
            ...a.projectIds.map((id) =>
              a.root.collection("projectViews").doc(id),
            ),
          )
        : [];
      const visible = views.filter(
        (v) =>
          v.exists &&
          v.data()!.schemaVersion === 2 &&
          v.data()!.published === true,
      );
      if (
        visible.some(
          (v) => v.data()!.tenantId !== tenant || v.data()!.id !== v.id,
        )
      )
        throw Error("Forbidden");
      const periods = visible.length
        ? await tx.getAll(
            ...visible.map((v) =>
              a.root.collection("projectPeriods").doc(key(month, v.id)),
            ),
          )
        : [];
      const projects = visible.map((v, i) =>
        publicProject(v.data() as any, periodSeconds(periods[i], v.id, month)),
      );
      const totalSeconds = projects.reduce((n, p) => n + p.seconds, 0);
      if (!Number.isSafeInteger(totalSeconds))
        throw Error("Invalid reporting summary");
      return {
        tenant: { id: tenant, name: a.meta.name },
        month,
        totalSeconds,
        projects,
      };
    });
  }
  async page(
    tenant: string,
    who: VerifiedIdentity,
    resource: "projects" | "sources" | "history" | "audits",
    query: PageQuery,
  ): Promise<ProjectPage> {
    checkMonth(query.month);
    if (
      query.search !== undefined &&
      (resource !== "projects" || query.search.length > 120)
    )
      throw Error("Invalid project search");
    const search = query.search?.trim().normalize("NFKC").toLowerCase() ?? "";
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 25)
      throw Error("Invalid page limit");
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      const context = key(
        tenant,
        who.subject,
        resource,
        query.month,
        query.sourceId ?? "",
        search,
        String(a.meta.revision),
      );
      let after: string | undefined;
      let position: number | string | undefined;
      if (query.cursor) {
        try {
          const c = JSON.parse(
            Buffer.from(query.cursor, "base64url").toString(),
          );
          if (c.context !== context) throw Error();
          after = safeId(c.after);
          if (resource === "history" || resource === "audits") {
            if (!Number.isSafeInteger(c.position) || c.position < 1)
              throw Error();
            position = c.position;
          }
          if (resource === "sources") {
            if (
              typeof c.position !== "string" ||
              !c.position.startsWith(query.month + "-")
            )
              throw Error();
            position = c.position;
          }
        } catch {
          throw Error("Revision conflict");
        }
      }
      const collection =
        resource === "sources"
          ? "rawTime"
          : resource === "history"
            ? "allocationRevisions"
            : resource;
      let q: FirebaseFirestore.Query = a.root.collection(collection);
      if (resource === "projects" || resource === "sources")
        q = q.where("schemaVersion", "==", 2);
      if (resource === "sources")
        q = q
          .where("record.date", ">=", query.month + "-01")
          .where("record.date", "<=", query.month + "-31")
          .orderBy("record.date");
      if (resource === "history")
        q = q.where("sourceId", "==", safeId(query.sourceId!));
      if (resource === "history" || resource === "audits")
        q = q.orderBy("revision", "desc");
      q = q.orderBy(
        FieldPath.documentId(),
        resource === "history" || resource === "audits" ? "desc" : "asc",
      );
      if (after)
        q =
          position === undefined
            ? q.startAfter(after)
            : q.startAfter(position, after);
      const snapshot = await tx.get(q.limit(query.limit + 1));
      const scanned = snapshot.docs.slice(0, query.limit);
      const docs = search
        ? scanned.filter((d) => {
            const p = d.data();
            return [d.id, p.name, p.workOrderReference].some(
              (field) =>
                typeof field === "string" &&
                field.normalize("NFKC").toLowerCase().includes(search),
            );
          })
        : scanned;
      const out: ProjectPage = {
        revision: a.meta.revision,
        ...(snapshot.size > query.limit
          ? {
              nextCursor: Buffer.from(
                JSON.stringify({
                  context,
                  after: scanned.at(-1)!.id,
                  ...(["history", "audits"].includes(resource)
                    ? { position: docs.at(-1)!.data().revision }
                    : resource === "sources"
                      ? { position: docs.at(-1)!.data().record.date }
                      : {}),
                }),
              ).toString("base64url"),
            }
          : {}),
      };
      if (resource === "projects") {
        const views = docs.length
          ? await tx.getAll(
              ...docs.map((d) => a.root.collection("projectViews").doc(d.id)),
            )
          : [];
        const periods = docs.length
          ? await tx.getAll(
              ...docs.map((d) =>
                a.root.collection("projectPeriods").doc(key(query.month, d.id)),
              ),
            )
          : [];
        out.projects = docs.map((d, i) => {
          if (d.data().tenantId !== tenant || d.data().id !== d.id)
            throw Error("Forbidden");
          if (
            !views[i].exists ||
            views[i].data()!.tenantId !== tenant ||
            views[i].data()!.id !== d.id ||
            views[i].data()!.schemaVersion !== 2
          )
            throw Error("Invalid reporting summary");
          return {
            ...projectView(
              d.data() as Project,
              views[i].data()!.lifetimeSeconds,
            ),
            seconds: periodSeconds(periods[i], d.id, query.month),
            ...(d.data().workOrderReference ? { workOrderReference: String(d.data().workOrderReference) } : {}),
          };
        });
      } else if (resource === "sources") {
        const heads = docs.length
          ? await tx.getAll(
              ...docs.map((d) =>
                a.root.collection("allocationHeads").doc(d.id),
              ),
            )
          : [];
        const scoped = docs.length
          ? await tx.getAll(
              ...docs.map((d) =>
                a.root
                  .collection("projects")
                  .doc(safeId(d.data().scopeProjectId)),
              ),
            )
          : [];
        out.sources = docs.map((d, i) => {
          const r = d.data().record,
            h = heads[i].data();
          if (
            r.tenantId !== tenant ||
            !scoped[i].exists ||
            scoped[i].data()!.tenantId !== tenant ||
            scoped[i].data()!.schemaVersion !== 2 ||
            !Number.isSafeInteger(r.seconds) ||
            r.seconds < 0
          )
            throw Error("Invalid scoped source");
          const portions: Allocation[] = h?.portions ?? [],
            applied: Allocation[] = h?.appliedPortions ?? portions;
          return {
            id: d.id,
            date: r.date,
            seconds: r.seconds,
            description: r.description,
            sourceWorkOrderId: r.sourceWorkOrderId,
            sourceRevision: r.revision,
            approval: ["pending", "submitted", "approved", "rejected"].includes(
              d.data().approval,
            )
              ? d.data().approval
              : "unknown",
            allocationRevision: h?.revision ?? 0,
            ...(d.data().source === "quickbooks-time"
              ? {
                  provider: "quickbooks-time" as const,
                  modifiedAt: d.data().modifiedAt as string,
                  deleted: d.data().deleted === true,
                  needsReview: h?.needsReview === true,
                }
              : {}),
            portions,
            unallocatedSeconds:
              d.data().deleted === true
                ? 0
                : Math.max(
                    0,
                    r.seconds - applied.reduce((n, p) => n + p.seconds, 0),
                  ),
            conflict:
              d.data().deleted === true ||
              (h?.sourceRevision !== undefined &&
                h.sourceRevision !== r.revision),
          };
        });
      } else if (resource === "history")
        out.history = docs.map((d) => {
          const r = d.data();
          return {
            revision: r.revision,
            at: r.at,
            actor: r.actor,
            portions: r.portions,
          };
        });
      else
        out.audits = docs.map((d) => {
          const r = d.data();
          return {
            id: d.id,
            action: r.action,
            entityId: r.entityId,
            actor: r.actor,
            at: r.at,
            revision: r.revision,
          };
        });
      return out;
    });
  }
}
export function checkMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Error("Invalid month");
}
function periodSeconds(
  snapshot: FirebaseFirestore.DocumentSnapshot,
  projectId: string,
  month: string,
) {
  if (!snapshot.exists) return 0;
  const p = snapshot.data()!;
  if (
    p.projectId !== projectId ||
    p.month !== month ||
    !Number.isSafeInteger(p.seconds) ||
    p.seconds < 0
  )
    throw Error("Invalid reporting summary");
  return p.seconds as number;
}
/** Existing signature/provider/revocation verification is reused, never browser role flags. */
export class ProjectBackend {
  constructor(
    readonly store: ProjectStore,
    private verifier: IdentityVerifier,
    private policy: IdentityPolicy,
  ) {}
  async identity(authorization: string) {
    if (!/^Bearer [^\s]{1,8192}$/.test(authorization))
      throw Error("Unauthenticated");
    const who = await this.verifier.verify(authorization);
    if (
      !who.subject ||
      who.issuer !== this.policy.issuer ||
      who.audience !== this.policy.audience ||
      who.disabled !== false ||
      who.revoked !== false ||
      !Number.isFinite(who.expiresAt) ||
      who.expiresAt <= this.policy.now()
    )
      throw Error("Unauthenticated");
    rememberIdentity(who);
    return who;
  }
  async workspace(token: string, tenant: string) {
    return this.store.workspace(tenant, await this.identity(token));
  }
  async report(token: string, tenant: string, month: string) {
    return this.store.report(tenant, await this.identity(token), month);
  }
  async page(
    token: string,
    tenant: string,
    resource: "projects" | "sources" | "history" | "audits",
    query: PageQuery,
  ) {
    return this.store.page(tenant, await this.identity(token), resource, query);
  }
  async detail(token: string, tenant: string, id: string) {
    return this.store.detail(tenant, await this.identity(token), id);
  }
  async save(
    token: string,
    tenant: string,
    input: unknown,
    options: Parameters<ProjectStore["save"]>[3],
  ) {
    return this.store.save(
      tenant,
      await this.identity(token),
      input,
      options,
      this.policy.now(),
    );
  }
  async allocate(
    token: string,
    tenant: string,
    sourceId: string,
    expectedRevision: number,
    portions: Allocation[],
  ) {
    assertProjectDatabase(this.store.db);
    const who = await this.identity(token);
    if (
      !who.corporatePolicy ||
      who.staffTenantId !== tenant ||
      requestIdentity.getStore()?.identity !== who
    )
      throw Error("Forbidden");
    return new FirestoreTenantStore(this.store.db, 2).allocateReporting(
      tenant,
      who.subject,
      sourceId,
      expectedRevision,
      portions,
      this.policy.now(),
    );
  }
}
