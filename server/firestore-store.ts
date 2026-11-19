import { Timestamp } from "firebase-admin/firestore";
import { timeTotalsWrite } from "./time-totals";
import { corporateMembership } from "./request-identity";
import { readWorkspace, readStaffPage } from "./staff-read";
import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import {
  checkedAllocationSeconds,
  demo,
  type ReportingState,
  type DeliveryProject,
  type ReportingScope,
} from "../src/reporting/model";
import { approvedMember, canAccessProject } from "./authorization";
import {
  safeId,
  type TenantStore,
  type TenantRecord,
  type TransactionPlan,
  type Membership,
} from "./contracts";
export const key = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");
const empty = (tenant: ReportingState["tenant"]): ReportingState => ({
  ...demo(),
  tenant,
  agreements: [],
  departments: [],
  budgets: [],
  projects: [],
  raw: [],
  allocations: [],
  links: [],
  team: [],
  assignments: [],
  milestones: [],
  blockers: [],
  publications: [],
  audits: [],
});
const bounded = async (tx: Transaction, q: FirebaseFirestore.Query) => {
  const result = await tx.get(q.limit(101));
  if (result.size > 100) throw Error("Reporting capacity exceeded");
  return result.docs;
};
/** All histories are separate documents. Generic mutations load only targeted metadata, never source records or growing history. */
export class FirestoreTenantStore implements TenantStore {
  constructor(readonly db: Firestore, private readonly expectedSchemaVersion?: number) {}
  async base(tx: Transaction, tenantId: string, subject: string) {
    safeId(tenantId);
    const root = this.db.doc(`tenants/${tenantId}`);
    const staff = corporateMembership(tenantId, subject);
    const [tenant, membership] = staff ? [await tx.get(root), undefined] : await tx.getAll(
      root, root.collection("memberships").doc(key(subject)));
    if (!tenant.exists || (!staff && !membership?.exists)) throw Error("Forbidden");
    const d = tenant.data()!;
    if (this.expectedSchemaVersion !== undefined && d.schemaVersion !== this.expectedSchemaVersion)
      throw Error("Migration required");
    if (!Number.isSafeInteger(d.revision) || d.revision < 1)
      throw Error("Invalid persisted revision");
    const record: TenantRecord = {
      revision: d.revision,
      state: empty({ id: tenantId, name: d.name }),
      memberships: staff ? [] : [membership!.data() as Membership],
      audits: [],
      checkpoints: [],
    };
    approvedMember(record, tenantId, subject);
    return { root, record };
  }
  async transaction<T>(
    tenantId: string,
    work: (record: TenantRecord) => T | Promise<T>,
    plan?: TransactionPlan,
  ): Promise<T> {
    if (!plan) throw Error("Firestore transaction plan required");
    return this.db.runTransaction(
      async (tx) => {
        const { root, record } = await this.base(tx, tenantId, plan.subject);
        const member = approvedMember(record, tenantId, plan.subject);
        const idem = plan.idempotency;
        const idemRef = idem
          ? root.collection("idempotency").doc(idem.id)
          : undefined;
        if (!plan.projectId && !idem)
          throw Error("Invalid missing idempotency key");
        if (idemRef) {
          if (
            member.role === "client" ||
            (member.role !== "administrator" &&
              (member.projectIds !== "all-authorized-agreements" ||
                !member.agreementIds.includes(plan.agreementId!)))
          )
            throw Error("Forbidden");
          const prior = await tx.get(idemRef);
          if (prior.exists) {
            if (prior.data()!.payloadHash !== idem!.payloadHash)
              throw Error("Idempotency conflict");
            return prior.data()!.result as T;
          }
        }
        let target: DeliveryProject | undefined;
        if (plan.projectId) {
          safeId(plan.projectId);
          const doc = await tx.get(
            root.collection("projects").doc(plan.projectId),
          );
          if (!doc.exists) throw Error("Forbidden");
          target = doc.data() as DeliveryProject;
          record.state.projects = [target];
        }
        const agreementId = target?.agreementId ?? plan.agreementId;
        const departmentId = target?.departmentId ?? plan.departmentId;
        if (!agreementId || !departmentId)
          throw Error("Invalid transaction scope");
        safeId(agreementId);
        safeId(departmentId);
        const [agreement, department] = await tx.getAll(
          root.collection("agreements").doc(agreementId),
          root.collection("departments").doc(departmentId),
        );
        if (!agreement.exists || !department.exists)
          throw Error("Invalid agreement or department");
        record.state.agreements = [{ ...agreement.data(), caps: [] } as any];
        record.state.departments = [department.data() as any];
        const budgets = await bounded(
          tx,
          root
            .collection("departmentBudgets")
            .where("agreementId", "==", agreementId)
            .where("departmentId", "==", departmentId),
        );
        if (!budgets.length) throw Error("Invalid department budget");
        record.state.budgets = budgets.map((d) => d.data() as any);
        const caps = await bounded(
          tx,
          root
            .collection("agreementCapRevisions")
            .where("agreementId", "==", agreementId),
        );
        record.state.agreements[0].caps = caps.map((d) => d.data() as any);
        const old = structuredClone(record);
        const result = await work(record);
        if (JSON.stringify(old) === JSON.stringify(record)) return result;
        // Interactive API must never mutate source, allocations, memberships, checkpoints or existing audits.
        const protectedState = (r: TenantRecord) => ({
          ...r,
          state: { ...r.state, projects: [] },
          revision: 0,
          audits: [],
        });
        if (
          JSON.stringify(protectedState(old)) !==
            JSON.stringify(protectedState(record)) ||
          record.revision !== old.revision + 1 ||
          record.audits.length !== 1
        )
          throw Error("Unsupported persistent mutation");
        for (const p of record.state.projects) {
          if (
            JSON.stringify(old.state.projects.find((x) => x.id === p.id)) ===
            JSON.stringify(p)
          )
            continue;
          const viewRef = root.collection("projectViews").doc(p.id); // preserve lifetime separately by merge; hours are not editable here
          tx.set(root.collection("projects").doc(p.id), p);
          tx.set(
            viewRef,
            {
              id: p.id,
              name: p.name,
              agreementId: p.agreementId,
              departmentId: p.departmentId,
              progress: p.progress,
              plan: p.plan,
              published: p.published,
              ...(!old.state.projects.some((x) => x.id === p.id)
                ? { lifetimeSeconds: 0 }
                : {}),
            },
            { merge: true },
          );
        }
        if (idemRef)
          tx.create(idemRef, {
            payloadHash: idem!.payloadHash,
            result,
            actor: plan.subject,
            operation: "create-project",
            createdAt: Timestamp.fromMillis(idem!.now),
            expiresAt: Timestamp.fromMillis(idem!.now + 30 * 86400000),
          });
        const audit = record.audits[0];
        tx.create(root.collection("audits").doc(audit.id), audit);
        tx.update(root, { revision: record.revision });
        return result;
      },
      { maxAttempts: 3 },
    );
  }
  async workspace(tenantId: string, subject: string) {
    return readWorkspace(this, tenantId, subject);
  }
  async staffPage(
    tenantId: string,
    subject: string,
    resource: "projects" | "sources" | "history" | "audits",
    query: import("../src/api/types").PageQuery,
  ) {
    return readStaffPage(this, tenantId, subject, resource, query);
  }
  async readPublished(
    tenantId: string,
    subject: string,
    scope: ReportingScope,
  ) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.month))
      throw Error("Invalid reporting month");
    return this.db.runTransaction(
      async (tx) => {
        const { root, record } = await this.base(tx, tenantId, subject);
        const m = approvedMember(record, tenantId, subject);
        if (
          scope.agreementId &&
          m.role !== "administrator" &&
          !m.agreementIds.includes(scope.agreementId)
        )
          throw Error("Forbidden");
        const viewDocs = await bounded(
          tx,
          scope.agreementId
            ? root
                .collection("projectViews")
                .where("agreementId", "==", scope.agreementId)
            : root.collection("projectViews").where("published", "==", true),
        );
        const visible = viewDocs
          .map((d) => d.data())
          .filter((p) => p.published === true && canAccessProject(m, p as any));
        const agreements = (await bounded(tx, root.collection("agreements")))
          .map((d) => d.data())
          .filter(
            (a) =>
              (!scope.agreementId || scope.agreementId === a.id) &&
              (m.role === "administrator" || m.agreementIds.includes(a.id)),
          );
        const periods = visible.length
          ? await tx.getAll(
              ...visible.map((p) =>
                root.collection("projectPeriods").doc(key(scope.month, p.id)),
              ),
            )
          : [];
        const counts = new Map(
          periods
            .filter((d) => d.exists)
            .map((d) => [d.data()!.projectId, d.data()!.seconds]),
        );
        const projects = visible.map((p) => {
          const seconds = counts.get(p.id) ?? 0;
          if (
            !Number.isSafeInteger(seconds) ||
            seconds < 0 ||
            !Number.isSafeInteger(p.lifetimeSeconds) ||
            p.lifetimeSeconds < seconds
          )
            throw Error("Invalid reporting summary");
          return {
            id: p.id,
            name: p.name,
            agreementId: p.agreementId,
            departmentId: p.departmentId,
            progress: p.progress,
            plan: { basis: p.plan.basis, minutes: p.plan.minutes },
            seconds,
            lifetimeSeconds: p.lifetimeSeconds,
          };
        });
        const caps = (
          await bounded(
            tx,
            root
              .collection("agreementCapRevisions")
              .where("month", "==", scope.month),
          )
        ).map((d) => d.data());
        const budgets = (
          await bounded(
            tx,
            root
              .collection("departmentBudgets")
              .where("month", "==", scope.month),
          )
        ).map((d) => d.data());
        const departments = (
          await bounded(tx, root.collection("departments"))
        ).map((d) => d.data());
        const result = agreements.map((a) => {
          const capMinutes =
            caps
              .filter((c) => c.agreementId === a.id)
              .sort((x, y) => y.revision - x.revision)[0]?.minutes ?? 0;
          const ds = budgets
            .filter((b) => b.agreementId === a.id)
            .map((b) => ({
              id: b.departmentId,
              agreementId: a.id,
              name:
                departments.find((d) => d.id === b.departmentId)?.name ?? "",
              minutes: b.minutes,
              seconds: projects
                .filter(
                  (p) =>
                    p.agreementId === a.id && p.departmentId === b.departmentId,
                )
                .reduce((n, p) => n + p.seconds, 0),
            }));
          return {
            id: a.id,
            name: a.name,
            capMinutes,
            reserveMinutes: capMinutes - ds.reduce((n, d) => n + d.minutes, 0),
            seconds: projects
              .filter((p) => p.agreementId === a.id)
              .reduce((n, p) => n + p.seconds, 0),
            departments: ds,
          };
        });
        return {
          revision: record.revision,
          month: scope.month,
          tenant: record.state.tenant,
          agreements: result,
          projects,
          totalSeconds: projects.reduce((n, p) => n + p.seconds, 0),
          departments: result.flatMap((a) => a.departments),
        };
      },
      { maxAttempts: 3 },
    );
  }
  async allocateReporting(
    tenantId: string,
    subject: string,
    sourceId: string,
    expectedRevision: number,
    portions: import("../src/reporting/model").Allocation[],
    now: number,
  ) {
    safeId(sourceId);
    if (
      !Array.isArray(portions) ||
      portions.length > 10 ||
      portions.some(
        (p) =>
          !p ||
          typeof p.description !== "string" ||
          p.description.length > 1000 ||
          Object.keys(p).some(
            (k) => !["projectId", "seconds", "description"].includes(k),
          ),
      )
    )
      throw Error("Invalid allocation");
    if (new Set(portions.map((p) => p.projectId)).size !== portions.length)
      throw Error("Invalid duplicate allocation project");
    portions.forEach((p) => safeId(p.projectId));
    return this.db.runTransaction(
      async (tx) => {
        const { root, record } = await this.base(tx, tenantId, subject);
        const m = approvedMember(record, tenantId, subject);
        if (m.role === "client") throw Error("Forbidden");
        if (record.revision !== expectedRevision)
          throw Error("Revision conflict");
        const rawRef = root.collection("rawTime").doc(sourceId);
        const headRef = root.collection("allocationHeads").doc(sourceId);
        const [source, headDoc] = await tx.getAll(rawRef, headRef);
        if (!source.exists) throw Error("Forbidden");
        if (this.expectedSchemaVersion === 2) {
          const envelope = source.data()!;
          if (envelope.schemaVersion !== 2) throw Error("Forbidden");
          if (envelope.deleted === true) throw Error("Source conflict");
          if (envelope.record?.id !== sourceId || typeof envelope.record?.revision !== "string" || !envelope.record.revision || !/^\d{4}-\d{2}-\d{2}$/.test(envelope.record.date) || new Date(envelope.record.date).toISOString().slice(0, 10) !== envelope.record.date) throw Error("Invalid source");
          const scoped = await tx.get(root.collection("projects").doc(safeId(envelope.scopeProjectId)));
          if (!scoped.exists || scoped.data()!.schemaVersion !== 2 || scoped.data()!.tenantId !== tenantId) throw Error("Forbidden");
        }
        const raw = source.data()!.record;
        if (
          raw.tenantId !== tenantId ||
          !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(raw.date)
        )
          throw Error("Invalid source");
        checkedAllocationSeconds(portions, raw.seconds);
        const head = headDoc.data() ?? {
          revision: 0,
          portions: [],
          appliedPortions: [],
        };
        if (m.role !== "administrator" && !headDoc.exists)
          throw Error("Forbidden");
        if (
          head.sourceRevision !== undefined &&
          head.sourceRevision !== raw.revision
        )
          throw Error("Source conflict");
        const previous = head.appliedPortions ?? head.portions;
        if (m.role !== "administrator" && !previous.length)
          throw Error("Forbidden");
        if (previous.length > 10) throw Error("Reporting capacity exceeded");
        const ids = [
          ...new Set<string>(
            [...previous, ...portions].map((p) => p.projectId),
          ),
        ];
        const ps = ids.length
          ? await tx.getAll(
              ...ids.map((id) => root.collection("projects").doc(id)),
            )
          : [];
        if (!Array.isArray(head.portions) || head.portions.length > 10)
          throw Error("Reporting capacity exceeded");
        const extraIntended = [
          ...new Set<string>(head.portions.map((p: any) => p.projectId)),
        ].filter((id) => !ids.includes(id));
        if (m.role !== "administrator" && extraIntended.length) {
          const intended = await tx.getAll(
            ...extraIntended.map((id) =>
              root.collection("projects").doc(safeId(id)),
            ),
          );
          if (
            intended.some(
              (d) => !d.exists || !canAccessProject(m, d.data() as any),
            )
          )
            throw Error("Forbidden");
        }
        if (ps.some((d) => !d.exists || !canAccessProject(m, d.data() as any)))
          throw Error("Forbidden");
        if (this.expectedSchemaVersion === 2 && ps.some(d => d.data()!.schemaVersion !== 2 || d.data()!.tenantId !== tenantId || d.data()!.id !== d.id)) throw Error("Forbidden");
        if (
          JSON.stringify(head.portions) === JSON.stringify(portions) &&
          JSON.stringify(previous) === JSON.stringify(portions)
        )
          return { revision: record.revision, changed: false };
        const month = raw.date.slice(0, 7);
        const views = ids.length
          ? await tx.getAll(
              ...ids.map((id) => root.collection("projectViews").doc(id)),
            )
          : [];
        const periods = ids.length
          ? await tx.getAll(
              ...ids.map((id) =>
                root.collection("projectPeriods").doc(key(month, id)),
              ),
            )
          : [];
        const writeTimeTotals = source.data()!.source === "quickbooks-time"
          ? await timeTotalsWrite(tx, root, [{ project: safeId(source.data()!.scopeProjectId), month, recorded: 0, allocated: portions.reduce((n, p) => n + p.seconds, 0) - previous.reduce((n: number, p: { seconds: number }) => n + p.seconds, 0) }])
          : undefined;
        writeTimeTotals?.();
        const revision = head.revision + 1;
        tx.create(
          root
            .collection("allocationRevisions")
            .doc(key(sourceId, String(revision))),
          {
            sourceId,
            revision,
            portions,
            actor: subject,
            at: new Date(now).toISOString(),
          },
        );
        tx.set(headRef, {
          revision,
          portions,
          appliedPortions: portions,
          sourceRevision: raw.revision,
        });
        ids.forEach((id, i) => {
          if (!views[i].exists) throw Error("Invalid reporting summary");
          if (this.expectedSchemaVersion === 2 && (views[i].data()!.tenantId !== tenantId || views[i].data()!.id !== id || views[i].data()!.schemaVersion !== 2 || (periods[i].exists && (periods[i].data()!.projectId !== id || periods[i].data()!.month !== month)))) throw Error("Invalid reporting summary");
          const delta =
            portions
              .filter((p) => p.projectId === id)
              .reduce((n, p) => n + p.seconds, 0) -
            previous
              .filter((p: any) => p.projectId === id)
              .reduce((n: number, p: any) => n + p.seconds, 0);
          const lifetime = views[i].data()!.lifetimeSeconds + delta;
          const seconds = (periods[i].data()?.seconds ?? 0) + delta;
          if (
            !Number.isSafeInteger(lifetime) ||
            lifetime < 0 ||
            !Number.isSafeInteger(seconds) ||
            seconds < 0
          )
            throw Error("Invalid reporting summary");
          tx.update(views[i].ref, { lifetimeSeconds: lifetime });
          tx.set(root.collection("projectPeriods").doc(key(month, id)), {
            projectId: id,
            month,
            seconds,
          });
        });
        const nextRevision = record.revision + 1;
        const auditId = crypto.randomUUID();
        tx.create(root.collection("audits").doc(auditId), {
          id: auditId,
          tenantId,
          actor: subject,
          action: "allocation-changed",
          entityId: sourceId,
          at: new Date(now).toISOString(),
          revision: nextRevision,
        });
        tx.update(root, { revision: nextRevision });
        return { revision: nextRevision, changed: true };
      },
      { maxAttempts: 3 },
    );
  }
}
