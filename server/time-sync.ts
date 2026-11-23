import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
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
import { readPortfolio } from "./portfolio";
import type { Project } from "../src/projects/model";
import type { TimeMappingReview, TimeProjectMetadata, TimeStatus } from "../src/projects/time";
import { timeDetailsRef, type StoredTimeDetails } from "./time-details";
import { enrichTimeDetails, inventoryTimeDetails, timeSourceRevision } from "./time-enrichment";
import {
  type TimeClient,
  type TimeJobcode,
  type TimeRow,
  TimePageCapacityError,
  timeCatalogLimit,
  timeId,
  workDate,
} from "./time-client";
import {
  reconcileTimeCatalog,
  timeAudit,
  timeMapping,
  timeMappings,
  timeRun,
  timeSystemActor,
  timeTenantRevision,
  type CatalogJob,
  type TimeMappingRecord,
} from "./time-catalog";

export interface TimeConnection {
  tenant: string;
  account: string;
  admin: string;
  clientUrl: string;
  userId: string;
  from: string;
}
type TimeScope = TimeConnection &
  (
    | { customerParentId: string; onClock?: boolean; jobcodes?: never }
    | { customerParentId?: never; onClock?: never; jobcodes: string[] }
  );
const day = 86400000;
const workBudgetMs = 150_000;
const leaseMs = 240_000;
const dailyBudgetMs = 25 * 60_000;
const customerName = "Zagimē Anishinabēk Nation";
const reginaDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Regina",
  dateStyle: "short",
});
const singleAttempt = { maxAttempts: 1 };

function workSignal(disconnected?: AbortSignal) {
  const deadline = AbortSignal.timeout(workBudgetMs);
  return disconnected ? AbortSignal.any([disconnected, deadline]) : deadline;
}
type ActiveMapping = {
  jobcodeId: string;
  projectId: string;
  account: string;
  sourceProject?: TimeProjectMetadata;
  verifiedSourceProjectId?: string;
};
type Run = { run: string; expires: number; through?: string };
type VerifiedJob = {
  client: TimeClient;
  job: CatalogJob;
  descendants: Set<string>;
};
type Portion = { projectId: string; seconds: number };

export class TimeSync {
  constructor(
    private store: ProjectStore,
    private connection?: TimeScope,
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
    return timeMapping(root, this.connection!.account, timeId(job));
  }
  private catalogKey() {
    return key(
      "quickbooks-time-customer",
      this.connection!.account,
      this.connection!.customerParentId!,
    );
  }
  private checkpoint(root: DocumentReference, job: string) {
    return root
      .collection("syncCheckpoints")
      .doc(key("quickbooks-time", this.connection!.account, timeId(job)));
  }
  /** A successful customer-wide run timestamp. Call only for an authorized report. */
  async reportFreshness(tenant: string): Promise<string | undefined> {
    if (this.connection?.tenant !== tenant || !this.connection.customerParentId) return;
    const root = this.store.db.collection("tenants").doc(tenant);
    const run = (await timeRun(root, this.catalogKey()).get()).data();
    const at = run?.lastSuccess;
    if (run?.customerBound === true && typeof at === "string" && Number.isFinite(Date.parse(at)))
      return new Date(at).toISOString();
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
      const { customerParentId, jobcodes } = this.connection;
      const allMappings = customerParentId
        ? (await tx.get(timeMappings(root, this.catalogKey()))).docs
        : await tx.getAll(...jobcodes!.map((job) => this.mapping(root, job)));
      if (allMappings.length > timeCatalogLimit)
        throw Error("Time catalog capacity exceeded");
      const mappings = allMappings.flatMap((m) => {
        const value = m.data() as TimeMappingRecord | undefined;
        if (!value || (project && value.projectId !== project)) return [];
        if (
          value.account !== this.connection!.account ||
          m.id !== this.mapping(root, value.jobcodeId).id
        )
          throw Error("Time scope mismatch");
        return [value];
      });
      const states = mappings.length
        ? await tx.getAll(
            ...mappings.map((m) => this.checkpoint(root, m.jobcodeId)),
          )
        : [];
      const anchors = [
        ...new Set(
          mappings.map((m) => safeId(m.scopeProjectId ?? m.projectId)),
        ),
      ];
      const perPeriod = new Map<string, Map<string, TimeTotals>>();
      const readTotals = async (period: string) => {
        const refs = anchors.map((id) => timeProjectTotal(root, id, period));
        if (!refs.length) return { recorded: 0, allocated: 0 };
        const byAnchor = new Map<string, TimeTotals>();
        perPeriod.set(period, byAnchor);
        return (await tx.getAll(...refs)).reduce(
          (sum, row, i) => {
            const value = row.data() as TimeTotals | undefined;
            byAnchor.set(anchors[i], value ?? { recorded: 0, allocated: 0 });
            return {
              recorded: sum.recorded + (value?.recorded ?? 0),
              allocated: sum.allocated + (value?.allocated ?? 0),
            };
          },
          { recorded: 0, allocated: 0 },
        );
      };
      const totals = month
        ? customerParentId || project
          ? await readTotals(month)
          : ((
              await tx.get(root.collection("timeMonthlyTotals").doc(month))
            ).data() as TimeTotals | undefined)
        : undefined;
      const lifetime =
        customerParentId || project ? await readTotals("lifetime") : undefined;
      const daily = customerParentId
        ? (await tx.get(timeRun(root, this.catalogKey()))).data()
        : undefined;
      const timers = (
        customerParentId && this.connection.onClock ? daily?.running : undefined
      ) as Awaited<ReturnType<TimeClient["running"]>> | undefined;
      const running =
        timers &&
        mappings.reduce(
          (sum, m) => {
            const value = timers.jobs[m.jobcodeId];
            return {
              count: sum.count + (value?.count ?? 0),
              seconds: sum.seconds + (value?.seconds ?? 0),
            };
          },
          { count: 0, seconds: 0 },
        );
      const rows = mappings.map((m, i) => {
        const s = states[i].data();
        const anchor = m.scopeProjectId;
        const rowMonth =
          anchor &&
          month &&
          m.sourceJob &&
          anchor === "time-" + key(m.account, m.jobcodeId)
            ? perPeriod.get(month)?.get(anchor)
            : undefined;
        return {
          ...(rowMonth
            ? {
                recordedSeconds: rowMonth.recorded,
                allocatedSeconds: rowMonth.allocated,
                unallocatedSeconds: rowMonth.recorded - rowMonth.allocated,
                lifetimeRecordedSeconds:
                  perPeriod.get("lifetime")?.get(anchor!)?.recorded ?? 0,
                lifetimeAllocatedSeconds: perPeriod.get("lifetime")?.get(anchor!)?.allocated ?? 0,
              }
            : {}),
          jobcodeId: m.jobcodeId,
          projectId: m.projectId,
          ...(m.sourceJob
            ? {
                sourceName: m.sourceJob.name,
                sourceState: m.sourceJob.missing
                  ? ("missing" as const)
                  : m.sourceJob.active
                    ? ("active" as const)
                    : ("inactive" as const),
                canRelink:
                  m.scopeProjectId === "time-" + key(m.account, m.jobcodeId) &&
                  !m.sourceJob.missing,
                canReview: daily?.customerBound === true && m.sourceJob.active && !m.sourceJob.missing &&
                  m.scopeProjectId === "time-" + key(m.account, m.jobcodeId) &&
                  m.projectId === m.scopeProjectId && m.reviewedAttribution !== true,
                mappingState:
                  m.projectId === "time-" + key(m.account, m.jobcodeId) && !m.reviewedAttribution
                    ? ("registered" as const)
                    : ("linked" as const),
              }
            : {}),
          ...(s?.lastSuccess
            ? { lastSuccess: s.lastSuccess, through: s.through }
            : {}),
          failed: s?.failed === true,
          ...(m.sourceProject ? { sourceProject: m.sourceProject } : {}),
        };
      });
      return {
        state: rows.length ? "configured" : "unmapped",
        canManage: this.allowed(tenant, who),
        mappings: rows,
        ...(customerParentId
          ? {
              customerScoped: true,
              customerVerified: daily?.customerBound === true,
              ...(daily?.customerBound === true ? { verifiedCustomerId: customerParentId } : {}),
              ...(daily?.errorStage
                ? {
                    errorStage: daily.errorStage as
                      | "discovery"
                      | "entries"
                      | "timers",
                  }
                : {}),
              ...(daily?.lastSuccess
                ? { lastDailySuccess: daily.lastSuccess as string }
                : {}),
              ...(daily?.status
                ? {
                    dailyState: (daily.status === "running" &&
                    daily.expires <= this.now()
                      ? "failed"
                      : daily.status) as "running" | "failed" | "complete",
                  }
                : {}),
              ...(daily?.runningFailed ? { runningFailed: true } : {}),
              ...(timers && running
                ? { running: { ...running, observedAt: timers.observedAt } }
                : {}),
            }
          : {}),
        ...(lifetime
          ? {
              lifetimeRecordedSeconds: lifetime?.recorded ?? 0,
              lifetimeUnallocatedSeconds:
                (lifetime?.recorded ?? 0) - (lifetime?.allocated ?? 0),
            }
          : {}),
        ...(month
          ? {
              month,
              recordedSeconds: totals?.recorded ?? 0,
              allocatedSeconds: totals?.allocated ?? 0,
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
    if (!this.allowed(tenant, who)) throw Error("Forbidden");
    timeId(job);
    safeId(project);
    if (this.connection!.customerParentId)
      return this.link(tenant, who, job, project);
    if (!this.connection!.jobcodes!.includes(job)) throw Error("Forbidden");
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
      if (
        previous.exists &&
        (previous.data()!.projectId !== project ||
          previous.data()!.account !== this.connection!.account ||
          previous.data()!.jobcodeId !== job)
      )
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
  requiresMappingReview() {
    return Boolean(this.connection?.customerParentId);
  }
  async confirmMapping(tenant: string, who: VerifiedIdentity, job: string, project: string, review: TimeMappingReview) {
    if (!this.allowed(tenant, who) || !this.connection?.customerParentId) throw Error("Forbidden");
    return this.link(tenant, who, timeId(job), safeId(project), review);
  }
  private async link(
    tenant: string,
    who: VerifiedIdentity,
    job: string,
    project: string,
    review?: TimeMappingReview,
  ) {
    return this.store.db.runTransaction(
      async (tx) => {
        const { root, staff, meta } = await this.store.access(tx, tenant, who);
        if (!staff) throw Error("Forbidden");
        const [target, entry] = await tx.getAll(
          root.collection("projects").doc(project),
          this.mapping(root, job),
        );
        const p = target.data() as Project | undefined;
        const m = entry.data() as TimeMappingRecord | undefined;
        if (
          p?.tenantId !== tenant ||
          p.schemaVersion !== 2 ||
          p.id !== project ||
          !m ||
          m.catalog !== this.catalogKey() ||
          m.jobcodeId !== job ||
          m.account !== this.connection!.account ||
          m.sourceJob?.missing !== false
        )
          throw Error("Forbidden");
        if (review) {
          const anchor = "time-" + key(m.account, job);
          if (m.reviewedAttribution === true) {
            if (m.projectId === project) return { changed: false };
            throw Error("Time mapping conflict");
          }
          if (m.projectId !== review.previousProjectId || m.projectId !== anchor ||
              m.scopeProjectId !== anchor || !m.sourceJob?.active) throw Error("Time mapping conflict");
          if (!p.delivery || p.delivery.kind !== review.targetKind ||
              p.status === "cancelled" || p.status === "closed") throw Error("Invalid Time mapping target");
          if (p.delivery.kind === "engagement" && p.delivery.parentId) throw Error("Invalid Time mapping target");
          if (p.delivery.kind === "project") {
            const { parentId, areaId } = p.delivery;
            if (!parentId || !areaId || parentId === p.id) throw Error("Invalid Time mapping target");
            if (review.parentId !== parentId || review.areaId !== areaId) throw Error("Time mapping conflict");
            const [parent, portfolio] = await Promise.all([
              tx.get(root.collection("projects").doc(safeId(parentId))),
              readPortfolio(tx, root),
            ]);
            const record = parent.data() as Project | undefined;
            if (record?.tenantId !== tenant || record.schemaVersion !== 2 || record.id !== parentId ||
                record.delivery?.kind !== "engagement" || record.delivery.parentId ||
                !portfolio.areas.some(area => area.id === areaId)) throw Error("Invalid Time mapping target");
          }
          const [binding, totals, checkpoint] = await tx.getAll(
            timeRun(root, this.catalogKey()), timeProjectTotal(root, anchor, "lifetime"), this.checkpoint(root, job),
          );
          if (binding.get("customerBound") !== true) throw Error("Forbidden");
          if (checkpoint.get("failed") === true || (totals.get("recorded") ?? 0) !== review.recordedSeconds ||
              (totals.get("allocated") ?? 0) !== review.allocatedSeconds) throw Error("Time mapping conflict");
        } else if (m.projectId === project) return { changed: false };
        // Adoption keeps legacy totals intact, including when old jobcodes share an anchor.
        if (m.scopeProjectId !== "time-" + key(m.account, job))
          throw Error("Time mapping conflict");
        tx.update(entry.ref, { projectId: project, ...(review ? { reviewedAttribution: true } : {}) });
        this.audit(
          tx,
          root,
          who.subject,
          project,
          review ? "time-work-order-mapping-reviewed" : "time-work-order-linked",
          meta.revision,
        );
        return { changed: true };
      },
      { maxAttempts: 3 },
    );
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
    timeAudit(
      tx,
      root,
      actor,
      entityId,
      action,
      revision + 1,
      new Date(this.now()).toISOString(),
    );
    tx.update(root, { revision: revision + 1 });
  }
  async sync(
    tenant: string,
    who: VerifiedIdentity,
    job: string,
    disconnected?: AbortSignal,
  ) {
    if (!this.allowed(tenant, who)) throw Error("Forbidden");
    timeId(job);
    if (this.connection!.jobcodes && !this.connection!.jobcodes.includes(job))
      throw Error("Forbidden");
    return this.syncJob(tenant, who, job, workSignal(disconnected));
  }
  private async authorize(
    tx: Transaction,
    root: DocumentReference,
    who?: VerifiedIdentity,
  ) {
    if (!who) return timeTenantRevision(tx, root);
    const { staff, meta } = await this.store.access(tx, root.id, who);
    if (!staff) throw Error("Forbidden");
    return meta.revision as number;
  }
  private async provider(signal: AbortSignal) {
    const { clientUrl, userId, account } = this.connection!;
    const client = await this.client!.session(signal);
    await client.verifyActor(clientUrl, userId, account);
    return client;
  }
  private async metadata(client: TimeClient, job: TimeJobcode) {
    const metadata = await client.projectMetadata(job.id);
    if (
      metadata.state === "verified" &&
      metadata.parentJobcodeId !== job.parentId
    )
      throw Error("Time project parent mismatch");
    return metadata;
  }
  private descendants(jobs: TimeJobcode[], job: string) {
    const matching = new Set<string>([job]);
    // customerTree returns parents before children.
    for (const child of jobs)
      if (child.parentId && matching.has(child.parentId))
        matching.add(child.id);
    matching.delete(job);
    return matching;
  }
  private customer(tenant: string) {
    if (
      this.connection?.tenant !== tenant ||
      !this.connection.customerParentId ||
      !this.client
    )
      throw Error("Time customer sync is not enabled");
    return {
      root: this.store.db.doc(`tenants/${safeId(tenant)}`),
      account: this.connection.account,
      parent: this.connection.customerParentId,
      catalog: this.catalogKey(),
    };
  }
  // Operator-only setup. No API route accepts an enrollment command or customer ID.
  async verifyCustomer(tenant: string, apply = false) {
    const { root, parent, catalog } = this.customer(tenant);
    await this.store.db.runTransaction((tx) => timeTenantRevision(tx, root));
    const signal = workSignal();
    const client = await this.provider(signal);
    const tree = await client.customerTree(parent);
    if (tree.root.name.normalize("NFC") !== customerName)
      throw Error("Time customer name does not match the approved setup");
    let verifiedProjects = 0;
    for (const job of tree.jobs)
      if ((await this.metadata(client, job)).state === "verified")
        verifiedProjects++;
    if (apply) {
      const ref = timeRun(root, catalog);
      await this.store.db.runTransaction(async (tx) => {
        const revision = await timeTenantRevision(tx, root);
        const existing = (await tx.get(ref)).data();
        if (existing?.customerBound === true) return;
        signal.throwIfAborted();
        tx.set(
          ref,
          { customerBound: true, boundAt: new Date(this.now()).toISOString() },
          { merge: true },
        );
        this.audit(
          tx,
          root,
          timeSystemActor,
          catalog,
          "time-customer-bound",
          revision,
        );
      });
    }
    return {
      verified: true,
      applied: apply,
      workOrders: tree.jobs.length,
      verifiedProjects,
    };
  }
  async inventoryDetails(tenant: string, after?: string) {
    return inventoryTimeDetails(this.customer(tenant), after);
  }
  async enrichDetails(tenant: string, options: { month: string; after?: string; apply?: boolean }) {
    const scope = this.customer(tenant);
    await this.store.db.runTransaction(async (tx) => {
      await timeTenantRevision(tx, scope.root);
      const setup = (await tx.get(timeRun(scope.root, scope.catalog))).data();
      if (setup?.customerBound !== true) throw Error("Time customer setup required");
      if ((setup.expires ?? 0) > this.now()) throw Error("Time sync busy");
    });
    const signal = workSignal();
    const client = await this.provider(signal);
    const tree = await client.customerTree(scope.parent);
    if (tree.root.name.normalize("NFC") !== customerName)
      throw Error("Time customer name does not match the approved setup");
    const jobs = new Map(tree.jobs.map((job) => [job.id, this.descendants(tree.jobs, job.id)]));
    return enrichTimeDetails(scope, client, jobs, options, signal, this.now);
  }
  // Invocation is authorized by Cloud Run Jobs IAM and the verified named runtime.
  async daily(tenant: string) {
    const { root, account, parent, catalog } = this.customer(tenant);
    const ref = timeRun(root, catalog);
    const run = randomUUID();
    const started = this.now();
    const syncDay = reginaDay.format(started);
    const signal = AbortSignal.timeout(dailyBudgetMs);
    const acquired = await this.store.db.runTransaction(async (tx) => {
      await timeTenantRevision(tx, root);
      const previous = (await tx.get(ref)).data();
      if (previous?.customerBound !== true)
        throw Error("Time customer setup required");
      if ((previous.expires ?? 0) > this.now()) throw Error("Time sync busy");
      if (previous.completedDay === syncDay) return false;
      tx.update(ref, {
        run,
        expires: started + dailyBudgetMs + 2 * 60_000,
        status: "running",
        lastAttempt: new Date(started).toISOString(),
      });
      return true;
    }, singleAttempt);
    if (!acquired)
      return { skipped: true, changed: 0, registered: 0, failed: 0 };
    let changed = 0,
      registered = 0,
      failed = 0;
    let stage: "discovery" | "entries" | "timers" = "discovery";
    let running: Awaited<ReturnType<TimeClient["running"]>> | undefined;
    let runningFailed = false;
    try {
      const client = await this.provider(signal);
      const { jobs } = await client.customerTree(parent);
      const verified: CatalogJob[] = [];
      for (const job of jobs)
        verified.push({ ...job, metadata: await this.metadata(client, job) });
      registered = await reconcileTimeCatalog(
        this.store.db,
        root,
        account,
        catalog,
        verified,
        run,
        this.now,
        signal,
      );
      stage = "entries";
      const queue = [...verified];
      const cutoff = new Date(
        Math.floor((started - 60_000) / 1000) * 1000,
      ).toISOString();
      while (queue.length) {
        if (signal.aborted) {
          failed += queue.length;
          break;
        }
        const job = queue.shift()!;
        try {
          const checkpoint = (await this.checkpoint(root, job.id).get()).data();
          if (checkpoint?.through && checkpoint.through >= cutoff) continue;
          const slice = workSignal(signal);
          const result = await this.syncJob(tenant, undefined, job.id, slice, {
            client: await client.session(slice),
            job,
            descendants: this.descendants(verified, job.id),
          });
          changed += result.changed;
          if (result.through < cutoff) queue.push(job);
        } catch {
          failed++;
        }
      }
      if (this.connection!.onClock && !signal.aborted) {
        if (!failed) stage = "timers";
        try {
          const observed = this.now();
          running = await client.running(
            parent,
            new Set(jobs.map((job) => job.id)),
            new Date(Date.parse(this.connection!.from)).toISOString(),
            observed,
          );
        } catch {
          runningFailed = true;
          if (!failed) failed++;
        }
      }
    } catch {
      failed++;
    }
    const at = new Date(this.now()).toISOString();
    await this.store.db.runTransaction(async (tx) => {
      const state = (await tx.get(ref)).data();
      if (state?.run !== run || state.expires <= this.now())
        throw Error("Time sync busy");
      tx.update(ref, {
        run: null,
        expires: 0,
        status: failed ? "failed" : "complete",
        errorStage: failed ? stage : null,
        failedCount: failed,
        ...(failed ? {} : { lastSuccess: at, completedDay: syncDay }),
        runningFailed,
        ...(running ? { running } : {}),
      });
    }, singleAttempt);
    return { skipped: false, changed, registered, failed };
  }
  private async syncJob(
    tenant: string,
    who: VerifiedIdentity | undefined,
    job: string,
    signal: AbortSignal,
    verified?: VerifiedJob,
  ) {
    const run = randomUUID();
    const { root, mapping, checkpoint, since, before, previous } =
      await this.store.db.runTransaction(async (tx) => {
        const root = this.store.db.doc(`tenants/${safeId(tenant)}`);
        await this.authorize(tx, root, who);
        if (
          this.connection!.customerParentId &&
          (await tx.get(timeRun(root, this.catalogKey()))).data()
            ?.customerBound !== true
        )
          throw Error("Time customer setup required");
        const checkpoint = this.checkpoint(root, job);
        const [mapped, state] = await tx.getAll(
          this.mapping(root, job),
          checkpoint,
        );
        if (!mapped.exists) throw Error("Forbidden");
        const entry = mapped.data() as TimeMappingRecord;
        if (
          this.connection!.customerParentId &&
          (entry.catalog !== this.catalogKey() ||
            entry.sourceJob?.missing !== false)
        )
          throw Error("Forbidden");
        const mapping = {
          ...entry,
          projectId: safeId(entry.scopeProjectId ?? entry.projectId),
        } as ActiveMapping;
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
    let completedThrough = before;
    const finish = (sourceProject?: TimeProjectMetadata) =>
      this.store.db.runTransaction(async (tx) => {
        if (sourceProject) {
          await this.authorize(tx, root, who);
        }
        const state = (await tx.get(checkpoint)).data();
        if (state?.run !== run || state.through !== previous)
          throw Error("Time sync busy");
        if (sourceProject) {
          signal.throwIfAborted();
          if (state.expires <= this.now()) throw Error("Time sync busy");
          if (!isDeepStrictEqual(mapping.sourceProject, sourceProject))
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
                through: completedThrough,
                lastSuccess: new Date(this.now()).toISOString(),
              }
            : {}),
        });
      }, singleAttempt);
    try {
      const client = verified?.client ?? (await this.provider(signal));
      let descendants = verified?.descendants;
      if (this.connection!.customerParentId) {
        if (!verified) {
          const tree = await client.customerTree(
            this.connection!.customerParentId,
          );
          const exact = tree.jobs.find((candidate) => candidate.id === job);
          if (!exact) throw Error("Time catalog scope mismatch");
          verified = {
            client,
            job: { ...exact, metadata: await this.metadata(client, exact) },
            descendants: this.descendants(tree.jobs, job),
          };
          descendants = verified.descendants;
        }
        const exact = await client.customerJobcode(job);
        if (exact.parentId !== verified.job.parentId)
          throw Error("Time catalog scope mismatch");
      } else {
        await client.verifyJobcode(job);
      }
      const sourceProject =
        verified?.job.metadata ?? (await client.projectMetadata(job));
      if (
        sourceProject.state === "verified" &&
        mapping.verifiedSourceProjectId &&
        sourceProject.id !== mapping.verifiedSourceProjectId
      )
        throw Error("Time project scope mismatch");
      let rows: TimeRow[];
      for (;;) {
        try {
          rows = [
            ...(await client.read(
              job,
              since,
              completedThrough,
              false,
              descendants,
              this.connection!.customerParentId ? mapping.account : undefined,
            )),
            ...(await client.read(
              job,
              since,
              completedThrough,
              true,
              descendants,
            )),
          ];
          break;
        } catch (error) {
          const low = Date.parse(previous ?? since),
            high = Date.parse(completedThrough);
          if (
            !(error instanceof TimePageCapacityError) ||
            high - low <= 120_000
          )
            throw error;
          completedThrough = new Date(
            Math.floor((low + (high - low) / 2) / 1000) * 1000,
          ).toISOString();
        }
      }
      const unique = new Map<string, TimeRow>();
      for (const row of rows) {
        const id = key(row.id, row.modifiedAt, String(row.deleted));
        const prior = unique.get(id);
        if (prior) {
          if (timeSourceRevision(prior) !== timeSourceRevision(row))
            throw Error("Time revision conflict");
          continue;
        }
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
      return { changed, through: completedThrough };
    } catch {
      await finish().catch(() => {});
      throw Error("Time synchronization failed");
    }
  }
  private async apply(
    root: DocumentReference,
    checkpoint: DocumentReference,
    run: string,
    mapping: ActiveMapping,
    row: TimeRow,
    who: VerifiedIdentity | undefined,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const id = sourceRecordId("quickbooks-time", mapping.account, row.id);
    const source = root.collection("rawTime").doc(id);
    const head = root.collection("allocationHeads").doc(id);
    const revision = timeSourceRevision(row);
    return this.store.db.runTransaction(async (tx) => {
      const revisionBefore = await this.authorize(tx, root, who);
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
      if (this.connection!.customerParentId) {
        const scoped = (
          await tx.get(this.mapping(root, row.jobcodeId))
        ).data() as TimeMappingRecord | undefined;
        if (
          scoped?.catalog !== this.catalogKey() ||
          scoped?.sourceJob?.missing !== false ||
          scoped.scopeProjectId !== mapping.projectId
        )
          throw Error("Time catalog scope mismatch");
      }
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
        this.connection!.customerParentId &&
        old.record.sourceWorkOrderId !== row.jobcodeId
      ) {
        const previousJob = (
          await tx.get(this.mapping(root, old.record.sourceWorkOrderId))
        ).data();
        if (
          previousJob?.catalog !== this.catalogKey() ||
          previousJob.scopeProjectId !== old.scopeProjectId
        )
          throw Error("Time source conflict");
      }
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
      if (!row.deleted && row.details) {
        const details: StoredTimeDetails = {
          provider: "quickbooks-time",
          sourceRevision: revision,
          sourceModifiedAt: row.modifiedAt,
          observedAt: new Date(this.now()).toISOString(),
          retrievedVia: "scoped-sync",
          ...row.details,
        };
        tx.create(timeDetailsRef(source, revision), details);
      }
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
        who?.subject ?? timeSystemActor,
        id,
        row.deleted ? "time-deleted" : old ? "time-corrected" : "time-imported",
        revisionBefore,
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
