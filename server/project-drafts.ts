import { createHash } from "node:crypto";
import type { DocumentReference, DocumentSnapshot } from "firebase-admin/firestore";
import { managedProject, type ManagedProject, type Project } from "../src/projects/model";

export function draftRef(root: DocumentReference, projectId: string) {
  return root.collection("projectDrafts").doc(projectId);
}

export interface ProjectDraftDocument {
  tenantId: string;
  projectId: string;
  revision: number;
  state: "draft" | "published" | "discarded";
  actor: string;
  updatedAt: string;
}

export type SavedProjectDraft = ProjectDraftDocument & {
  state: "draft";
  base: string;
  content: ManagedProject;
};

export function approvedContent(project: Project) {
  const { name, status, progress, description, internalNotes, plan, workOrderReference, updates, milestones, delivery } = project;
  return managedProject({ name, status, progress, description, internalNotes, plan, workOrderReference,
    updates: updates ?? [], milestones: milestones ?? [], delivery });
}

export function overlayProject(project: Project, changes: ManagedProject): Project {
  const { workOrderReference: _, ...rest } = project;
  return { ...rest, ...changes };
}

export function contentFingerprint(project: Project) {
  return createHash("sha256").update(JSON.stringify(approvedContent(project))).digest("hex");
}

export function readProjectDraft(snapshot: DocumentSnapshot | undefined, tenantId: string): SavedProjectDraft | undefined {
  const stored = snapshot?.data();
  if (!stored) return;
  if (stored.tenantId !== tenantId || stored.projectId !== snapshot!.id ||
      !Number.isSafeInteger(stored.revision) || stored.revision < 1 ||
      typeof stored.updatedAt !== "string" || typeof stored.actor !== "string" ||
      !["draft", "published", "discarded"].includes(stored.state))
    throw Error("Invalid reporting summary");
  if (stored.state !== "draft") return;
  if (typeof stored.base !== "string" || !/^[0-9a-f]{64}$/.test(stored.base))
    throw Error("Invalid reporting summary");
  return {
    tenantId,
    projectId: snapshot!.id,
    revision: stored.revision,
    actor: stored.actor,
    updatedAt: stored.updatedAt,
    state: "draft",
    base: stored.base,
    content: managedProject(stored.content),
  };
}

export function draftMetadata(draft: SavedProjectDraft) {
  return { revision: draft.revision, updatedAt: draft.updatedAt };
}
