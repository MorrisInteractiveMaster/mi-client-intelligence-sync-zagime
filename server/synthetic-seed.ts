import { assertOperatorDatabase } from "./database-target";
import type { Firestore } from "firebase-admin/firestore";
import { demo } from "../src/reporting/model";
import { key } from "./firestore-store";
import { safeId } from "./contracts";
/** Operator-only synthetic seed. Caller must enforce emulator/approved isolated staging runtime. No Auth writes. */
export async function seedSynthetic(
  db: Firestore,
  tenantId: string,
  apply = false,
) {
  assertOperatorDatabase(db);
  safeId(tenantId);
  if (!tenantId.startsWith("synthetic-"))
    throw Error("Synthetic tenant prefix required");
  const root = db.doc(`tenants/${tenantId}`),
    s = demo();
  const entries: { path: string; value: FirebaseFirestore.DocumentData }[] = [];
  for (const { caps, ...a } of s.agreements) {
    entries.push({ path: `agreements/${a.id}`, value: { ...a, tenantId } });
    for (const c of caps)
      entries.push({
        path: `agreementCapRevisions/${key(a.id, c.month, String(c.revision))}`,
        value: { ...c, agreementId: a.id },
      });
  }
  for (const d of s.departments)
    entries.push({ path: `departments/${d.id}`, value: d });
  for (const b of s.budgets)
    entries.push({
      path: `departmentBudgets/${key(b.agreementId, b.departmentId, b.month)}`,
      value: b,
    });
  for (const p of s.projects) {
    const clean = {
      ...p,
      published: false,
      internalNotes: "",
      trainingSessions: [],
    };
    entries.push(
      { path: `projects/${p.id}`, value: clean },
      {
        path: `projectViews/${p.id}`,
        value: {
          id: p.id,
          name: p.name,
          agreementId: p.agreementId,
          departmentId: p.departmentId,
          plan: p.plan,
          progress: p.progress,
          published: false,
          lifetimeSeconds: 0,
        },
      },
    );
  }
  for (const r of s.raw)
    entries.push({
      path: `rawTime/${r.id}`,
      value: {
        source: "synthetic",
        record: {
          ...r,
          tenantId,
          sourcePersonId: "synthetic-person",
          sourceWorkOrderId: "synthetic-work-order",
          description: "Synthetic staging hours only",
        },
      },
    });
  return db.runTransaction(
    async (tx) => {
      if ((await tx.get(root)).exists)
        throw Error("Refusing to overwrite an existing tenant");
      if (apply) {
        tx.create(root, {
          name: "Synthetic Morris staging",
          revision: 1,
          synthetic: true,
        });
        for (const e of entries)
          tx.create(db.doc(`${root.path}/${e.path}`), e.value);
        tx.create(root.collection("audits").doc("synthetic-initialization"), {
          id: "synthetic-initialization",
          tenantId,
          actor: "operator-seed",
          action: "synthetic-initialized",
          entityId: tenantId,
          revision: 1,
          at: new Date().toISOString(),
        });
      }
      return { dryRun: !apply, documents: entries.length + 2, usersCreated: 0 };
    },
    { maxAttempts: 3 },
  );
}
