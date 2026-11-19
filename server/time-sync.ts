import { randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import type { VerifiedIdentity } from "./contracts";
import { safeId, sourceRecordId } from "./contracts";
import { key } from "./firestore-store";
import type { ProjectStore } from "./project-workspace";
import {
  timeProjectTotal,
  timeTotalsWrite,
  type TimeTotals,
} from "./time-totals";
import type { TimeProjectMetadata, TimeStatus } from "../src/projects/time";
import { type TimeClient, type TimeRow, timeId, workDate } from "./time-client";

export interface TimeConnection {
  tenant: string;
  account: string;
  admin: string;
  clientUrl: string;
  userId: string;
  jobcodes: string[];
  from: string;
}
const day = 86400000;
const workBudgetMs = 150_000;
const leaseMs = 240_000;
const singleAttempt = { maxAttempts: 1 };

function workSignal(disconnected?: AbortSignal) {
  const deadline = AbortSignal.timeout(workBudgetMs);
  return disconnected ? AbortSignal.any([disconnected, deadline]) : deadline;
}
type Mapping = {
  jobcodeId: string;
  projectId: string;
  account: string;
  sourceProject?: TimeProjectMetadata;
  verifiedSourceProjectId?: string;
};
type Run = { run: string; expires: number; through?: string };
type Portion = { projectId: string; seconds: number };

export class TimeSync {
  constructor(
    private store: ProjectStore,
    private connection?: TimeConnection,
    private client?: TimeClient,
    private now = Date.now,
  ) {}
  private allowed(tenant: string, who: VerifiedIdentity) {
    return (
      this.connection?.tenant === tenant &&
      this.connection.admin === who.subject &&
      Boolean(this.client)
    );
  }
  private mapping(root: DocumentReference, job: string) {
    return root
      .collection("timeMappings")
      .doc(key(this.connection!.account, timeId(job)));
  }
  private checkpoint(root: DocumentReference, job: string) {
    return root
      .collection("syncCheckpoints")
      .doc(key("quickbooks-time", this.connection!.account, timeId(job)));
  }
  async status(
    tenant: string,
    who: VerifiedIdentity,
    month?: string,
    project?: string,
  ): Promise<TimeStatus> {
    return this.store.db.runTransaction(async (tx) => {
      const { root, staff } = await this.store.access(tx, tenant, who);
      if (!staff) throw Error("Forbidden");
      if (!this.connection || !this.client || this.connection.tenant !== tenant)
        return { state: "disconnected", canManage: false, mappings: [] };
      if (project) {
        const p = (
          await tx.get(root.collection("projects").doc(safeId(project)))
        ).data();
        if (p?.tenantId !== tenant || p.schemaVersion !== 2 || p.id !== project)
          throw Error("Forbidden");
      }
      const ids = this.connection.jobcodes;
      const mappings = await tx.getAll(
        ...ids.map((job) => this.mapping(root, job)),
      );
      const states = await tx.getAll(
        ...ids.map((job) => this.checkpoint(root, job)),
      );
      const totals = month
        ? ((
            await tx.get(
              project
                ? timeProjectTotal(root, project, month)
                : root.collection("timeMonthlyTotals").doc(month),
            )
          ).data() as TimeTotals | undefined)
        : undefined;
      const lifetime = project
        ? ((
            await tx.get(timeProjectTotal(root, project, "lifetime"))
          ).data() as TimeTotals | undefined)
        : undefined;
      const rows = mappings.flatMap((m, i) => {
        if (!m.exists || (project && m.data()!.projectId !== project))
          return [];
        const s = states[i].data();
        return [
          {
            jobcodeId: ids[i],
            projectId: m.data()!.projectId as string,
            ...(s?.lastSuccess
              ? { lastSuccess: s.lastSuccess, through: s.through }
              : {}),
            failed: s?.failed === true,
            ...(m.data()!.sourceProject
              ? { sourceProject: m.data()!.sourceProject as TimeProjectMetadata }
              : {}),
          },
        ];
      });
      return {
        state: rows.length ? "configured" : "unmapped",
        canManage: this.allowed(tenant, who),
        mappings: rows,
        ...(project
          ? { lifetimeRecordedSeconds: lifetime?.recorded ?? 0 }
          : {}),
        ...(month
          ? {
              month,
              recordedSeconds: totals?.recorded ?? 0,
              unallocatedSeconds:
                (totals?.recorded ?? 0) - (totals?.allocated ?? 0),
            }
          : {}),
      };
    });
  }
  async approve(
    tenant: string,
    who: VerifiedIdentity,
    job: string,
    project: string,
    disconnected?: AbortSignal,
  ) {
    const signal = workSignal(disconnected);
    if (
      !this.allowed(tenant, who) ||
      !this.connection!.jobcodes.includes(timeId(job))
    )
      throw Error("Forbidden");
    safeId(project);
    const check = async (tx: Transaction) => {
      const { root, staff, meta } = await this.store.access(tx, tenant, who);
      if (!staff) throw Error("Forbidden");
      const [target, previous] = await tx.getAll(
        root.collection("projects").doc(project),
        this.mapping(root, job),
      );
      if (
        !target.exists ||
        target.data()!.tenantId !== tenant ||
        target.data()!.schemaVersion !== 2
      )
        throw Error("Forbidden");
      if (previous.exists && (previous.data()!.projectId !== project ||
          previous.data()!.account !== this.connection!.account ||
          previous.data()!.jobcodeId !== job))
        throw Error("Time mapping conflict");
      return { root, revision: meta.revision as number, previous };
    };
    const first = await this.store.db.runTransaction(check, singleAttempt);
    if (first.previous.exists) return { changed: false };
    const client = await this.client!.session(signal);
    await client.verifyActor(
      this.connection!.clientUrl,
      this.connection!.userId,
      this.connection!.account,
    );
    await client.verifyJobcode(job);
    const sourceProject = await client.projectMetadata(job);
    return this.store.db.runTransaction(async (tx) => {
      const { root, revision, previous } = await check(tx);
      if (previous.exists) return { changed: false };
      signal.throwIfAborted();
      tx.create(previous.ref, {
        jobcodeId: job,
        projectId: project,
        account: this.connection!.account,
        approvedBy: who.subject,
        sourceProject,
        ...(sourceProject.state === "verified"
          ? { verifiedSourceProjectId: sourceProject.id }
          : {}),
      });
      this.audit(
        tx,
        root,
        who.subject,
        project,
        "time-mapping-approved",
        revision,
      );
      return { changed: true };
    }, singleAttempt);
  }
  private audit(
    tx: Transaction,
    root: DocumentReference,
    actor: string,
    entityId: string,
    action: string,
    revision: number,
  ) {
    if (!Number.isSafeInteger(revision + 1)) throw Error("Invalid revision");
    const id = randomUUID();
    tx.create(root.collection("audits").doc(id), {
      id,
      tenantId: root.id,
      actor,
      entityId,
      action,
      revision: revision + 1,
      at: new Date(this.now()).toISOString(),
    });
    tx.update(root, { revision: revision + 1 });
  }
  async sync(tenant: string, who: VerifiedIdentity, job: string, disconnected?: AbortSignal) {
    const signal = workSignal(disconnected);
    if (
      !this.allowed(tenant, who) ||
      !this.connection!.jobcodes.includes(timeId(job))
    )
      throw Error("Forbidden");
    const run = randomUUID();
    const { root, mapping, checkpoint, since, before, previous } =
      await this.store.db.runTransaction(async (tx) => {
        const { root, staff } = await this.store.access(tx, tenant, who);
        if (!staff) throw Error("Forbidden");
        const checkpoint = this.checkpoint(root, job);
        const [mapped, state] = await tx.getAll(
          this.mapping(root, job),
          checkpoint,
        );
        if (!mapped.exists) throw Error("Forbidden");
        const mapping = mapped.data() as Mapping;
        if (
          mapping.account !== this.connection!.account ||
          mapping.jobcodeId !== job
        )
          throw Error("Time scope mismatch");
        const lease = state.data() as Run | undefined;
        if (lease?.expires && lease.expires > this.now())
          throw Error("Time sync busy");
        const floor = Date.parse(workDate(this.connection!.from));
        const watermark = lease?.through ? Date.parse(lease.through) : floor;
        if (!Number.isFinite(watermark) || watermark < floor)
          throw Error("Invalid Time checkpoint");
        const upper = Math.min(
          Math.floor((this.now() - 60000) / 1000) * 1000,
          watermark + 7 * day,
        );
        if (upper <= watermark) throw Error("Time sync busy");
        const since = new Date(
          Math.max(floor, watermark - 60000),
        ).toISOString();
        const before = new Date(upper).toISOString();
        signal.throwIfAborted();
        tx.set(
          checkpoint,
          { run, expires: this.now() + leaseMs },
          { merge: true },
        );
        return {
          root,
          mapping,
          checkpoint,
          since,
          before,
          previous: lease?.through,
        };
      }, singleAttempt);
    const finish = (sourceProject?: TimeProjectMetadata) =>
      this.store.db.runTransaction(async (tx) => {
        if (sourceProject) {
          const { staff } = await this.store.access(tx, tenant, who);
          if (!staff) throw Error("Forbidden");
        }
        const state = (await tx.get(checkpoint)).data();
        if (state?.run !== run || state.through !== previous)
          throw Error("Time sync busy");
        if (sourceProject) {
          signal.throwIfAborted();
          if (state.expires <= this.now()) throw Error("Time sync busy");
          if (JSON.stringify(mapping.sourceProject) !== JSON.stringify(sourceProject))
            tx.update(this.mapping(root, job), {
              sourceProject,
              ...(sourceProject.state === "verified"
                ? { verifiedSourceProjectId: sourceProject.id }
                : {}),
            });
        }
        tx.update(checkpoint, {
          run: null,
          expires: 0,
          failed: !sourceProject,
          ...(sourceProject
            ? {
                through: before,
                lastSuccess: new Date(this.now()).toISOString(),
              }
            : {}),
        });
      }, singleAttempt);
    try {
      const client = await this.client!.session(signal);
      await client.verifyActor(
        this.connection!.clientUrl,
        this.connection!.userId,
        this.connection!.account,
      );
      await client.verifyJobcode(job);
      const sourceProject = await client.projectMetadata(job);
      if (
        sourceProject.state === "verified" &&
        mapping.verifiedSourceProjectId &&
        sourceProject.id !== mapping.verifiedSourceProjectId
      )
        throw Error("Time project scope mismatch");
      const rows = [
        ...(await client.read(job, since, before, false)),
        ...(await client.read(job, since, before, true)),
      ];
      const unique = new Map<string, TimeRow>();
      for (const row of rows) {
        const id = key(row.id, row.modifiedAt, String(row.deleted));
        const prior = unique.get(id);
        if (prior && key(JSON.stringify(prior)) !== key(JSON.stringify(row)))
          throw Error("Time revision conflict");
        unique.set(id, row);
      }
      const ordered = [...unique.values()].sort(
        (a, b) =>
          a.modifiedAt.localeCompare(b.modifiedAt) ||
          Number(a.deleted) - Number(b.deleted),
      );
      let changed = 0;
      for (const row of ordered)
        changed += Number(
          await this.apply(root, checkpoint, run, mapping, row, who, signal),
        );
      await finish(sourceProject);
      return { changed, through: before };
    } catch {
      await finish().catch(() => {});
      throw Error("Time synchronization failed");
    }
  }
  private async apply(
    root: DocumentReference,
    checkpoint: DocumentReference,
    run: string,
    mapping: Mapping,
    row: TimeRow,
    who: VerifiedIdentity,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const id = sourceRecordId("quickbooks-time", mapping.account, row.id);
    const source = root.collection("rawTime").doc(id);
    const head = root.collection("allocationHeads").doc(id);
    const revision = key(
      row.modifiedAt,
      row.date,
      String(row.seconds),
      row.jobcodeId,
      String(row.deleted),
    );
    return this.store.db.runTransaction(async (tx) => {
      const { staff, meta } = await this.store.access(tx, root.id, who);
      if (!staff) throw Error("Forbidden");
      const [lock, prior, allocation, target] = await tx.getAll(
        checkpoint,
        source,
        head,
        root.collection("projects").doc(mapping.projectId),
      );
      if (lock.data()?.run !== run || lock.data()!.expires <= this.now())
        throw Error("Time sync busy");
      if (
        !target.exists ||
        target.data()!.tenantId !== root.id ||
        target.data()!.schemaVersion !== 2
      )
        throw Error("Time scope mismatch");
      const old = prior.data();
      if (
        old &&
        (old.source !== "quickbooks-time" ||
          old.sourceCompanyId !== mapping.account ||
          old.record.tenantId !== root.id)
      )
        throw Error("Time source conflict");
      if (
        old &&
        (old.record.revision === revision ||
          old.modifiedAt > row.modifiedAt ||
          (old.deleted && old.modifiedAt === row.modifiedAt))
      )
        return false;
      if (old && old.modifiedAt === row.modifiedAt && !row.deleted)
        throw Error("Time revision conflict");
      const held = allocation.data();
      if (held && (!old || held.sourceRevision !== old.record.revision))
        throw Error("Time allocation conflict");
      const material =
        old &&
        (old.record.date !== row.date ||
          old.record.seconds !== row.seconds ||
          old.record.sourceWorkOrderId !== row.jobcodeId ||
          row.deleted);
      const applied = held
        ? ((held.appliedPortions ?? held.portions) as Portion[])
        : [];
      const writeTotals = await timeTotalsWrite(tx, root, [
        ...(old && !old.deleted
          ? [
              {
                project: safeId(old.scopeProjectId),
                month: old.record.date.slice(0, 7),
                recorded: -old.record.seconds,
                allocated: material
                  ? -applied.reduce((sum, p) => sum + p.seconds, 0)
                  : 0,
              },
            ]
          : []),
        ...(!row.deleted
          ? [
              {
                project: mapping.projectId,
                month: row.date.slice(0, 7),
                recorded: row.seconds,
                allocated: 0,
              },
            ]
          : []),
      ]);
      if (held && material)
        await this.reverse(tx, root, old.record.date.slice(0, 7), applied);
      signal.throwIfAborted();
      if (lock.data()!.expires <= this.now()) throw Error("Time sync busy");
      const envelope = {
        schemaVersion: 2,
        source: "quickbooks-time",
        sourceCompanyId: mapping.account,
        externalId: row.id,
        scopeProjectId: mapping.projectId,
        modifiedAt: row.modifiedAt,
        deleted: row.deleted,
        approval: "unknown",
        record: {
          id,
          tenantId: root.id,
          sourceWorkOrderId: row.jobcodeId,
          sourcePersonId: "",
          date: row.date,
          seconds: row.seconds,
          description: "QuickBooks Time",
          revision,
        },
      };
      tx.create(source.collection("versions").doc(revision), envelope);
      writeTotals();
      tx.set(source, envelope);
      if (held)
        tx.update(head, {
          sourceRevision: revision,
          ...(material
            ? { appliedPortions: [], needsReview: held.portions.length > 0 }
            : {}),
        });
      this.audit(
        tx,
        root,
        who.subject,
        id,
        row.deleted ? "time-deleted" : old ? "time-corrected" : "time-imported",
        meta.revision,
      );
      return true;
    }, singleAttempt);
  }
  private async reverse(
    tx: Transaction,
    root: DocumentReference,
    month: string,
    portions: Portion[],
  ) {
    if (
      !Array.isArray(portions) ||
      portions.length > 10 ||
      new Set(portions.map((p) => p.projectId)).size !== portions.length
    )
      throw Error("Invalid reporting summary");
    if (!portions.length) return;
    const views = await tx.getAll(
      ...portions.map((p) =>
        root.collection("projectViews").doc(safeId(p.projectId)),
      ),
    );
    const periods = await tx.getAll(
      ...portions.map((p) =>
        root.collection("projectPeriods").doc(key(month, p.projectId)),
      ),
    );
    for (const [i, p] of portions.entries()) {
      const view = views[i].data(),
        period = periods[i].data();
      if (
        view?.tenantId !== root.id ||
        view.id !== p.projectId ||
        period?.projectId !== p.projectId ||
        period.month !== month ||
        ![p.seconds, view.lifetimeSeconds, period.seconds].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        ) ||
        view.lifetimeSeconds < p.seconds ||
        period.seconds < p.seconds
      )
        throw Error("Invalid reporting summary");
      tx.update(views[i].ref, {
        lifetimeSeconds: view.lifetimeSeconds - p.seconds,
      });
      tx.update(periods[i].ref, { seconds: period.seconds - p.seconds });
    }
  }
}
