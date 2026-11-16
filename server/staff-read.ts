import {
  FieldPath,
  type Transaction,
  type DocumentReference,
} from "firebase-admin/firestore";
import type { FirestoreTenantStore } from "./firestore-store";
import { key } from "./firestore-store";
import { approvedMember, canAccessProject } from "./authorization";
import { safeId, type Membership } from "./contracts";
import type { Allocation, DeliveryProject } from "../src/reporting/model";
import type { Workspace, PageQuery, StaffPage } from "../src/api/types";
const checkMonth = (v: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v))
    throw Error("Invalid reporting month");
};
async function allowedPortions(
  tx: Transaction,
  root: DocumentReference,
  m: Membership,
  portions: Allocation[],
) {
  if (!Array.isArray(portions) || portions.length > 10)
    throw Error("Reporting capacity exceeded");
  if (m.role === "administrator") return true;
  if (!portions.length) return false;
  const docs = await tx.getAll(
    ...portions.map((p) =>
      root.collection("projects").doc(safeId(p.projectId)),
    ),
  );
  return docs.every(
    (d) => d.exists && canAccessProject(m, d.data() as DeliveryProject),
  );
}
export async function readWorkspace(
  store: FirestoreTenantStore,
  tenant: string,
  subject: string,
): Promise<Workspace> {
  return store.db.runTransaction(
    async (tx) => {
      const { root, record } = await store.base(tx, tenant, subject);
      const m = approvedMember(record, tenant, subject);
      const result: Workspace = {
        role: m.role,
        canCreate:
          m.role === "administrator" ||
          (m.role === "editor" && m.projectIds === "all-authorized-agreements"),
        revision: record.revision,
        tenant: record.state.tenant,
        agreements: [],
        departments: [],
      };
      if (m.role === "client") return result;
      // Lightweight hierarchy is intentionally a bounded bootstrap, not a growing tenant snapshot.
      const as = await tx.get(root.collection("agreements").limit(101));
      if (as.size > 100) throw Error("Reporting capacity exceeded");
      const bs = await tx.get(root.collection("departmentBudgets").limit(101));
      if (bs.size > 100) throw Error("Reporting capacity exceeded");
      result.agreements = as.docs
        .map((d) => ({ id: d.id, name: d.data().name as string }))
        .filter(
          (a) => m.role === "administrator" || m.agreementIds.includes(a.id),
        );
      const ids = [
        ...new Set<string>(
          bs.docs
            .filter((d) =>
              result.agreements.some((a) => a.id === d.data().agreementId),
            )
            .map((d) => d.data().departmentId),
        ),
      ];
      const ds = ids.length
        ? await tx.getAll(
            ...ids.map((id) => root.collection("departments").doc(safeId(id))),
          )
        : [];
      result.departments = bs.docs
        .filter((d) =>
          result.agreements.some((a) => a.id === d.data().agreementId),
        )
        .map((d) => ({
          agreementId: d.data().agreementId as string,
          id: d.data().departmentId as string,
          name:
            (ds.find((x) => x.id === d.data().departmentId)?.data()
              ?.name as string) ?? "",
        }))
        .filter(
          (v, i, a) =>
            a.findIndex(
              (x) => x.id === v.id && x.agreementId === v.agreementId,
            ) === i,
        );
      return result;
    },
    { maxAttempts: 3 },
  );
}
/** Each page scans at most limit+1 records. Empty authorized pages may still have a continuation. */
export async function readStaffPage(
  store: FirestoreTenantStore,
  tenant: string,
  subject: string,
  resource: "projects" | "sources" | "history",
  q: PageQuery,
): Promise<StaffPage> {
  checkMonth(q.month);
  if (!Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 25)
    throw Error("Invalid page size");
  if (q.cursor) safeId(q.cursor);
  if (q.agreementId) safeId(q.agreementId);
  return store.db.runTransaction(
    async (tx) => {
      const { root, record } = await store.base(tx, tenant, subject);
      const m = approvedMember(record, tenant, subject);
      if (
        m.role === "client" ||
        (q.agreementId &&
          m.role !== "administrator" &&
          !m.agreementIds.includes(q.agreementId))
      )
        throw Error("Forbidden");
      const result: StaffPage = { revision: record.revision };
      if (resource === "history") {
        safeId(q.sourceId!);
        const [source, head] = await tx.getAll(
          root.collection("rawTime").doc(q.sourceId!),
          root.collection("allocationHeads").doc(q.sourceId!),
        );
        if (
          !source.exists ||
          source.data()!.record.tenantId !== tenant ||
          !(await allowedPortions(
            tx,
            root,
            m,
            head.data()?.appliedPortions ?? [],
          ))
        )
          throw Error("Forbidden");
        if (
          (head.data()?.portions?.length ?? 0) &&
          !(await allowedPortions(tx, root, m, head.data()!.portions))
        )
          throw Error("Forbidden");
        const top = head.data()?.revision ?? 0;
        const from = q.cursor ? Number(q.cursor) : top;
        if (!Number.isSafeInteger(from) || from < 0 || from > top)
          throw Error("Invalid history cursor");
        const revisions = Array.from(
          { length: Math.min(from, q.limit) },
          (_, i) => from - i,
        );
        const docs = revisions.length
          ? await tx.getAll(
              ...revisions.map((n) =>
                root
                  .collection("allocationRevisions")
                  .doc(key(q.sourceId!, String(n))),
              ),
            )
          : [];
        result.history = [];
        for (const d of docs)
          if (
            d.exists &&
            (await allowedPortions(tx, root, m, d.data()!.portions))
          )
            result.history.push({
              revision: d.data()!.revision,
              at: d.data()!.at,
              portions: d.data()!.portions,
              ...(d.data()!.actor ? { actor: d.data()!.actor } : {}),
            });
        if (from > q.limit) result.nextCursor = String(from - q.limit);
        return result;
      }
      let query: FirebaseFirestore.Query = root.collection(
        resource === "projects" ? "projects" : "rawTime",
      );
      if (resource === "projects" && q.agreementId)
        query = query.where("agreementId", "==", q.agreementId);
      query = query.orderBy(FieldPath.documentId()).limit(q.limit + 1);
      if (q.cursor) query = query.startAfter(q.cursor);
      const snapshot = await tx.get(query);
      const docs = snapshot.docs.slice(0, q.limit);
      if (snapshot.size > q.limit) result.nextCursor = docs.at(-1)!.id;
      if (resource === "projects") {
        const visible = docs.filter((d) =>
          canAccessProject(m, d.data() as DeliveryProject),
        );
        const views = visible.length
          ? await tx.getAll(
              ...visible.map((d) => root.collection("projectViews").doc(d.id)),
            )
          : [];
        const periods = visible.length
          ? await tx.getAll(
              ...visible.map((d) =>
                root.collection("projectPeriods").doc(key(q.month, d.id)),
              ),
            )
          : [];
        result.projects = visible.map((d, i) => {
          const p = d.data();
          const seconds = periods[i].data()?.seconds ?? 0;
          const lifetimeSeconds = views[i].data()?.lifetimeSeconds;
          if (
            !Number.isSafeInteger(seconds) ||
            seconds < 0 ||
            !Number.isSafeInteger(lifetimeSeconds) ||
            lifetimeSeconds < seconds
          )
            throw Error("Invalid reporting summary");
          return {
            id: d.id,
            agreementId: p.agreementId,
            departmentId: p.departmentId,
            name: p.name,
            plan: p.plan,
            progress: p.progress,
            published: p.published,
            seconds,
            lifetimeSeconds,
            ...(p.workOrderReference !== undefined
              ? { workOrderReference: p.workOrderReference }
              : {}),
          };
        });
      } else {
        result.sources = [];
        for (const d of docs) {
          const raw = d.data().record;
          if (raw.tenantId !== tenant || raw.date.slice(0, 7) !== q.month)
            continue;
          const h = (
            await tx.get(root.collection("allocationHeads").doc(d.id))
          ).data();
          const portions = h?.portions ?? [];
          if (
            !Array.isArray(portions) ||
            portions.length > 10 ||
            (h?.appliedPortions?.length ?? 0) > 10
          )
            throw Error("Reporting capacity exceeded");
          // Check both intended and currently applied targets; never disclose a partial multi-project entry.
          if (
            !(await allowedPortions(tx, root, m, h?.appliedPortions ?? [])) ||
            (portions.length && !(await allowedPortions(tx, root, m, portions)))
          )
            continue;
          const allocated = portions.reduce(
            (n: number, p: Allocation) => n + p.seconds,
            0,
          );
          const conflict =
            !Number.isSafeInteger(allocated) ||
            allocated > raw.seconds ||
            portions.some((p: Allocation) => p.seconds < 0) ||
            (h?.sourceRevision !== undefined &&
              h.sourceRevision !== raw.revision) ||
            JSON.stringify(portions) !==
              JSON.stringify(h?.appliedPortions ?? portions);
          result.sources.push({
            id: d.id,
            date: raw.date,
            seconds: raw.seconds,
            description: raw.description,
            sourceWorkOrderId: raw.sourceWorkOrderId,
            sourceRevision: raw.revision,
            allocationRevision: h?.revision ?? 0,
            portions,
            unallocatedSeconds: Math.max(0, raw.seconds - allocated),
            conflict,
          });
        }
      }
      return result;
    },
    { maxAttempts: 3 },
  );
}
