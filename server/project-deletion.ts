import { randomUUID } from "node:crypto";
import type { ProjectStore } from "./project-workspace";
import { safeId, type VerifiedIdentity } from "./contracts";
import { draftRef } from "./project-drafts";
import { readPortfolio } from "./portfolio";
import type { Project, ProjectDeletionReview } from "../src/projects/model";

export async function reviewProjectDeletion(
  store: ProjectStore, tenant: string, identity: VerifiedIdentity, id: string,
  confirmation?: { expectedRevision: number; name: string },
): Promise<ProjectDeletionReview> {
  return store.db.runTransaction(async tx => {
    const { root, meta, platformAdmin } = await store.access(tx, tenant, identity);
    if (!platformAdmin) throw Error("Forbidden");
    const project = root.collection("projects").doc(safeId(id));
    const view = root.collection("projectViews").doc(id);
    const draft = draftRef(root, id);
    const [record, visibility, revisionDraft] = await tx.getAll(project, view, draft);
    const data = record.data() as Project | undefined;
    if (data?.schemaVersion !== 2 || data.tenantId !== tenant || data.id !== id) throw Error("Forbidden");
    if (confirmation && (confirmation.expectedRevision !== meta.revision || confirmation.name !== data.name))
      throw Error("Revision conflict");
    if (visibility.get("tenantId") !== tenant || visibility.get("schemaVersion") !== 2 || visibility.get("id") !== id)
      throw Error("Invalid reporting summary");
    const has = async (collection: string, field: string, value: string, op: "==" | "array-contains" = "==") =>
      !(await tx.get(root.collection(collection).where(field, op, value).limit(1))).empty;
    const [children, mapped, anchored, source, history, automatic, members, audit, portfolio] = await Promise.all([
      has("projects", "delivery.parentId", id),
      has("timeMappings", "projectId", id),
      has("timeMappings", "scopeProjectId", id),
      has("rawTime", "scopeProjectId", id),
      has("projectPeriods", "projectId", id),
      has("automaticTimeAllocations", "projectId", id),
      has("memberships", "projectIds", id, "array-contains"),
      tx.get(root.collection("audits").where("entityId", "==", id).limit(501)),
      readPortfolio(tx, root),
    ]);
    // Older unpublishes did not retain a dedicated flag. Treat any older
    // publication action, including a withdrawal, as protected history.
    const publicationActions = new Set(["publication-changed", "project-created-and-published",
      "project-edited-and-published", "project-draft-published"]);
    const published = data.published || visibility.get("published") === true;
    const blockers: string[] = [];
    if (published || revisionDraft.exists || audit.size > 500 || audit.docs.some(doc => publicationActions.has(doc.get("action"))))
      blockers.push("Published content or publication history");
    if (children) blockers.push("Child projects");
    if (mapped || anchored || data.delivery?.workOrderIds?.length) blockers.push("QuickBooks Time mappings");
    if (source || data.source) blockers.push("Imported source records");
    if (automatic) blockers.push("Automatically classified time");
    if (history || visibility.get("lifetimeSeconds") !== 0) blockers.push("Manual allocations, splits or reporting history");
    if (members) blockers.push("Client access assignments");
    if (portfolio.placements.some(item => item.id === id) || portfolio.directory.some(item => item.projectIds.includes(id)))
      blockers.push("Portfolio placements or directory assignments");
    const result: ProjectDeletionReview = {
      revision: meta.revision, name: data.name, kind: data.delivery?.kind ?? "project", published, blockers,
      milestones: data.milestones?.length ?? 0, activeBlocker: data.delivery?.blocker?.active === true,
      parent: data.delivery?.parentId ?? null,
      department: portfolio.areas.find(item => item.id === data.delivery?.areaId)?.name ?? null,
    };
    if (result.parent) {
      const parent = await tx.get(root.collection("projects").doc(safeId(result.parent)));
      if (parent.get("tenantId") === tenant) result.parent = parent.get("name");
    }
    if (!confirmation || blockers.length) return result;
    tx.delete(project);
    tx.delete(view);
    tx.update(root, { revision: meta.revision + 1 });
    const event = randomUUID();
    tx.create(root.collection("audits").doc(event), {
      id: event, tenantId: tenant, entityId: id, actor: identity.subject,
      action: "project-permanently-deleted", at: new Date().toISOString(), revision: meta.revision + 1,
    });
    return { ...result, revision: meta.revision + 1, deleted: true };
  });
}
