import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  DocumentReference,
  Firestore,
  Transaction,
} from "firebase-admin/firestore";
import { key } from "./firestore-store";
import { safeId } from "./contracts";
import { projectView, type Project } from "../src/projects/model";
import { timeCatalogLimit, type TimeJobcode } from "./time-client";
import type { TimeProjectMetadata } from "../src/projects/time";

export type CatalogJob = TimeJobcode & { metadata: TimeProjectMetadata };
export type TimeMappingRecord = {
  account: string;
  jobcodeId: string;
  projectId: string;
  scopeProjectId?: string;
  catalog?: string;
  sourceJob?: TimeJobcode & { missing: boolean };
  sourceProject?: TimeProjectMetadata;
  verifiedSourceProjectId?: string;
};

export const timeSystemActor = "system:quickbooks-time";

export function timeMappings(root: DocumentReference, catalog: string) {
  return root
    .collection("timeMappings")
    .where("catalog", "==", catalog)
    .limit(timeCatalogLimit + 1);
}

export function timeMapping(
  root: DocumentReference,
  account: string,
  job: string,
) {
  return root.collection("timeMappings").doc(key(account, job));
}

export function timeRun(root: DocumentReference, catalog: string) {
  return root.collection("timeRuns").doc(catalog);
}

export async function timeTenantRevision(
  tx: Transaction,
  root: DocumentReference,
) {
  const meta = (await tx.get(root)).data();
  if (
    meta?.schemaVersion !== 2 ||
    !Number.isSafeInteger(meta.revision) ||
    meta.revision < 1
  )
    throw Error("Invalid Time tenant");
  return meta.revision as number;
}

export function timeAudit(
  tx: Transaction,
  root: DocumentReference,
  actor: string,
  entityId: string,
  action: string,
  revision: number,
  at: string,
) {
  if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
  const ref = root.collection("audits").doc(randomUUID());
  tx.create(ref, {
    id: ref.id,
    tenantId: root.id,
    actor,
    entityId,
    action,
    revision,
    at,
  });
}

export async function reconcileTimeCatalog(
  db: Firestore,
  root: DocumentReference,
  account: string,
  catalog: string,
  jobs: CatalogJob[],
  run: string,
  now: () => number,
  signal: AbortSignal,
) {
  return db.runTransaction(async (tx) => {
    const revisionBefore = await timeTenantRevision(tx, root);
    const lease = (await tx.get(timeRun(root, catalog))).data();
    if (lease?.run !== run || lease.expires <= now())
      throw Error("Time sync busy");
    const known = await tx.get(timeMappings(root, catalog));
    const refs = jobs.map((job) => timeMapping(root, account, job.id));
    const snapshots = refs.length ? await tx.getAll(...refs) : [];
    const ids = new Set([
      ...known.docs.map((d) => d.id),
      ...refs.map((ref) => ref.id),
    ]);
    if (ids.size > timeCatalogLimit)
      throw Error("Time catalog capacity exceeded");
    const existing = snapshots.map(
      (d) => d.data() as TimeMappingRecord | undefined,
    );
    const legacy = [
      ...new Set(
        existing.flatMap((m) => (m && !m.catalog ? [safeId(m.projectId)] : [])),
      ),
    ];
    const legacyProjects = legacy.length
      ? await tx.getAll(
          ...legacy.map((id) => root.collection("projects").doc(id)),
        )
      : [];
    if (
      legacyProjects.some(
        (p) =>
          p.data()?.tenantId !== root.id ||
          p.data()?.schemaVersion !== 2 ||
          p.data()?.id !== p.id,
      )
    )
      throw Error("Time mapping conflict");
    signal.throwIfAborted();
    const at = new Date(now()).toISOString();
    let revision = revisionBefore;
    let registered = 0;
    const audited = (entity: string, action: string) =>
      timeAudit(tx, root, timeSystemActor, entity, action, ++revision, at);
    for (const [i, { metadata, ...job }] of jobs.entries()) {
      const old = existing[i];
      if (
        old &&
        (old.account !== account ||
          old.jobcodeId !== job.id ||
          (old.catalog && old.catalog !== catalog) ||
          (metadata.state === "verified" &&
            old.verifiedSourceProjectId &&
            metadata.id !== old.verifiedSourceProjectId))
      )
        throw Error("Time mapping conflict");
      const projectId = old?.projectId ?? "time-" + key(account, job.id);
      const mapping: TimeMappingRecord = {
        account,
        catalog,
        jobcodeId: job.id,
        projectId,
        scopeProjectId: old?.scopeProjectId ?? projectId,
        sourceJob: { ...job, missing: false },
        sourceProject: metadata,
        ...(metadata.state === "verified"
          ? { verifiedSourceProjectId: metadata.id }
          : old?.verifiedSourceProjectId
            ? { verifiedSourceProjectId: old.verifiedSourceProjectId }
            : {}),
      };
      if (!old) {
        const p: Project = {
          schemaVersion: 2,
          id: projectId,
          tenantId: root.id,
          source: null,
          name: job.name,
          status: "planned",
          progress: 0,
          description: "",
          internalNotes: "",
          plan: { basis: "fixed", targetSeconds: 0 },
          published: false,
          createdAt: at,
          updatedAt: at,
          createdBy: timeSystemActor,
          updatedBy: timeSystemActor,
        };
        tx.create(root.collection("projects").doc(projectId), p);
        tx.create(
          root.collection("projectViews").doc(projectId),
          projectView(p, 0),
        );
        registered++;
      }
      const prior = old && {
        account: old.account,
        catalog: old.catalog,
        jobcodeId: old.jobcodeId,
        projectId: old.projectId,
        scopeProjectId: old.scopeProjectId,
        sourceJob: old.sourceJob,
        sourceProject: old.sourceProject,
        ...(old.verifiedSourceProjectId
          ? { verifiedSourceProjectId: old.verifiedSourceProjectId }
          : {}),
      };
      if (!isDeepStrictEqual(prior, mapping)) {
        tx.set(refs[i], mapping, { merge: true });
        audited(
          projectId,
          old ? "time-work-order-updated" : "time-work-order-discovered",
        );
      }
    }
    const current = new Set(refs.map((ref) => ref.id));
    for (const entry of known.docs) {
      const old = entry.data() as TimeMappingRecord;
      if (!current.has(entry.id) && old.sourceJob?.missing === false) {
        tx.update(entry.ref, { "sourceJob.missing": true });
        audited(old.projectId, "time-work-order-missing");
      }
    }
    if (revision !== revisionBefore) tx.update(root, { revision });
    return registered;
  });
}
