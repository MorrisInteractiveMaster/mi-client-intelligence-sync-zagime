import { readSourcePage } from "./source-page";
import { readWorkOrderEffort, timeProjectTotal, type TimeTotals } from "./time-totals";
import { portfolioLimits, previousReportingMonth, type PortfolioSection, type PortfolioTotals, type WordPressProfile } from "../src/projects/portfolio";
import { portfolioRef, publishedPortfolio, readPortfolio, savePortfolioRecord } from "./portfolio";
import { mergeDirectory, wordpressProfiles } from "./wordpress-team";
import { employeeMappingChange, employeeMappingsPage, saveEmployeeMapping } from "./employee-mapping";
import { approvedContent, contentFingerprint, draftMetadata, draftRef, overlayProject, readProjectDraft, type ProjectDraftDocument } from "./project-drafts";
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
import { allocateTimeBatch } from "./bulk-allocation";
import {
  approvedProjectContent,
  managedProject,
  projectView,
  publicProject,
  type Project,
  type ProjectWorkspace,
  type ProjectReport,
  type ProjectPage,
  type ProjectView,
  type StaffProjectDetail,
} from "../src/projects/model";
import type { AllocationAnnotations, PageQuery } from "../src/api/types";
import type { Allocation } from "../src/reporting/model";
import { portalSettings, type PlatformControl, type PortalSettings } from "../src/projects/control";
import { capRollup, checkDeliveryStructure, deliveryDate, MAX_DELIVERY_PROJECTS, measureDelivery, type Delivery } from "../src/projects/delivery";

/** Project operations require a verified named database and its tenant binding. */
export class ProjectStore {
  constructor(readonly db: Firestore, readonly platformAdminUid?: string) {
    assertProjectDatabase(db);
    if (platformAdminUid !== undefined && !/^[-a-zA-Z0-9_]{1,128}$/.test(platformAdminUid))
      throw Error("Invalid platform administrator configuration");
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
      platformAdmin: staff && this.platformAdminUid === who.subject,
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
        tenant: { id: tenant, name: portalSettings(a.meta.portalSettings).clientLabel || a.meta.name },
        role: a.staff ? "staff" : "client",
        revision: a.staff ? a.meta.revision : 0,
        ...(a.platformAdmin ? { platformAdmin: true as const } : {}),
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
  async control(tenant: string, who: VerifiedIdentity, update?: { expectedRevision: number; settings: PortalSettings }, now = Date.now()): Promise<PlatformControl> {
    return this.db.runTransaction(async tx => {
      const access = await this.access(tx, tenant, who);
      if (!access.platformAdmin) throw Error("Forbidden");
      const current = portalSettings(access.meta.portalSettings);
      if (!update) return { settings: current, revision: access.meta.revision };
      if (update.expectedRevision !== access.meta.revision) throw Error("Revision conflict");
      const settings = portalSettings(update.settings);
      if (isDeepStrictEqual(settings, current)) return { settings, revision: access.meta.revision };
      const revision = access.meta.revision + 1, id = randomUUID();
      if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
      tx.update(access.root, { portalSettings: settings, revision });
      tx.create(access.root.collection("audits").doc(id), {
        id, tenantId: tenant, actor: who.subject, action: "portal-settings-changed", entityId: tenant,
        at: new Date(now).toISOString(), revision,
      });
      return { settings, revision };
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
      draftAction?: "publish" | "discard";
    },
    now: number,
  ) {
    if (options.published !== undefined && typeof options.published !== "boolean") throw Error("Invalid publication");
    const requested = options.published === undefined && !options.draftAction ? managedProject(input) : undefined;
    const idem = !options.id
      ? creationKey(options.idempotency ?? "", who.subject, now, requested)
      : undefined;
    return this.db.runTransaction(
      async (tx) => {
        const a = await this.access(tx, tenant, who);
        if (!a.staff) throw Error("Forbidden");
        if ((options.published !== undefined || options.draftAction === "publish") &&
          portalSettings(a.meta.portalSettings).ownerPublishes && !a.platformAdmin) throw Error("Platform publication approval required");
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
        const pendingRef = draftRef(a.root, id);
        const pending = old?.published ? readProjectDraft(await tx.get(pendingRef), tenant) : undefined;
        if (options.draftAction && (!old?.published || !pending)) throw Error("Revision conflict");
        if (options.published === false && pending) throw Error("Project draft pending");
        const base = old?.published && (requested || options.draftAction === "publish") ? contentFingerprint(old) : undefined;
        if (base && pending && pending.base !== base) throw Error("Revision conflict");
        const editBase = old && pending ? overlayProject(old, pending.content) : old;
        const managed = old && requested
          ? approvedContent(overlayProject(editBase!, requested))
          : (options.draftAction === "publish" ? pending!.content : requested);
        if (old && !options.draftAction && (managed
          ? isDeepStrictEqual(approvedContent(editBase!), managed)
          : old.published === options.published))
          return { id, revision: a.meta.revision, changed: false,
            ...(pending && { draft: draftMetadata(pending) }) };
        if (managed?.delivery || managed?.milestones?.some(m => m.ownerId)) {
          const portfolio = await readPortfolio(tx, a.root);
          const delivery = managed.delivery;
          const people = new Set(portfolio.directory.map(person => person.id));
          if ([...(delivery?.managerIds ?? []), ...(delivery?.teamIds ?? []),
            ...(delivery?.training?.facilitatorIds ?? []), ...(managed.milestones ?? []).flatMap(m => m.ownerId ? [m.ownerId] : [])].some(person => !people.has(person)) ||
            (delivery?.areaId && !portfolio.areas.some(area => area.id === delivery.areaId)) ||
            (delivery?.groupId && !portfolio.engagements.some(group => group.id === delivery.groupId))) throw Error("Invalid delivery references");
          if (old?.delivery?.structure === 2 && delivery?.structure !== 2) throw Error("Invalid project hierarchy");
          if (!old || delivery?.kind !== old.delivery?.kind || delivery?.structure !== old.delivery?.structure ||
            delivery?.parentId !== old.delivery?.parentId || delivery?.areaId !== old.delivery?.areaId) {
            const nodes = await tx.get(a.root.collection("projects").where("schemaVersion", "==", 2).limit(MAX_DELIVERY_PROJECTS + 1));
            if (nodes.size + (old ? 0 : 1) > MAX_DELIVERY_PROJECTS) throw Error("Invalid hierarchy capacity");
            const graph = new Map(nodes.docs.map(node => {
              const row = node.data() as Project;
              if (row.tenantId !== tenant || row.id !== node.id) throw Error("Forbidden");
              return [node.id, row.delivery] as const;
            }));
            if (delivery?.parentId !== old?.delivery?.parentId && delivery?.structure !== 2)
              throw Error("Invalid project hierarchy");
            graph.set(id, delivery);
            checkDeliveryStructure(graph);
          }
          const jobs = delivery?.workOrderIds;
          if (jobs?.length && !isDeepStrictEqual(jobs, old?.delivery?.workOrderIds)) {
            const verified = await tx.get(a.root.collection("timeMappings").where("jobcodeId", "in", jobs).limit(100));
            if (jobs.some(job => !verified.docs.some(doc => doc.data().jobcodeId === job && doc.data().sourceJob?.missing !== true)))
              throw Error("Invalid work order selection");
          }
        }
        const at = new Date(now).toISOString();
        const revision = a.meta.revision + 1;
        if (!Number.isSafeInteger(revision)) throw Error("Invalid revision");
        const audit = (action: string) => {
          const auditId = randomUUID();
          tx.create(a.root.collection("audits").doc(auditId), {
            id: auditId, tenantId: tenant, actor: who.subject, action, entityId: id, at, revision,
          });
          tx.update(a.root, { revision });
        };
        const draftRecord: Omit<ProjectDraftDocument, "state"> =
          { tenantId: tenant, projectId: id, revision, actor: who.subject, updatedAt: at };
        if (old?.published && requested) {
          tx.set(pendingRef, { ...draftRecord, state: "draft", base: base!, content: managed! });
          audit("project-draft-saved");
          return { id, revision, changed: true, draft: { revision, updatedAt: at } };
        }
        if (options.draftAction === "discard") {
          tx.set(pendingRef, { ...draftRecord, state: "discarded" });
          audit("project-draft-discarded");
          return { id, revision, changed: true };
        }
        const p: Project = old
          ? {
              ...(managed ? overlayProject(old, managed) : { ...old, published: options.published! }),
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
        const view = old ? await tx.get(viewRef) : undefined;
        if (
          old &&
          (!view?.exists ||
            view.data()!.tenantId !== tenant ||
            view.data()!.id !== id ||
            view.data()!.schemaVersion !== 2)
        )
          throw Error("Invalid reporting summary");
        tx.set(ref, p);
        tx.set(viewRef, {
          ...projectView(p, view?.data()?.lifetimeSeconds ?? 0),
          ...approvedProjectContent(p, false),
        });
        if (options.draftAction === "publish") tx.set(pendingRef, { ...draftRecord, state: "published" });
        audit(options.draftAction === "publish" ? "project-draft-published"
          : old ? managed ? "project-edited" : "publication-changed" : "project-created");
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
  async portfolio(tenant: string, who: VerifiedIdentity, change?: {
    section: PortfolioSection; record: unknown; expectedRevision: number; now: number;
  }, month?: string) {
    if (month !== undefined) checkMonth(month);
    return this.db.runTransaction(async tx => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      if (change)
        return savePortfolioRecord(tx, { root: a.root, staff: a.staff, meta: { revision: a.meta.revision } },
          change.section, change.record, change.expectedRevision, who.subject, change.now);
      const portfolio = await readPortfolio(tx, a.root);
      const totals = new Map<string, PortfolioTotals>();
      if (month && portfolio.placements.length) {
        const rows = portfolio.placements;
        const [views, periods] = await Promise.all([
          tx.getAll(...rows.map(p => a.root.collection("projectViews").doc(p.id))),
          tx.getAll(...rows.map(p => a.root.collection("projectPeriods").doc(key(month, p.id)))),
        ]);
        rows.forEach((p, i) => {
          const v = views[i].data();
          if (v?.tenantId !== tenant || v?.id !== p.id || v?.schemaVersion !== 2)
            throw Error("Invalid reporting summary");
          const k = key(p.engagementId, p.areaId);
          const row = totals.get(k) ?? { engagementId: p.engagementId, areaId: p.areaId, projects: 0, monthlyPlanSeconds: 0, lifetimePlanSeconds: 0, allocatedSeconds: 0 };
          row.projects++;
          row.allocatedSeconds += periodSeconds(periods[i], p.id, month);
          if (v.plan?.basis === "monthly") row.monthlyPlanSeconds += v.plan.targetSeconds;
          else if (v.plan?.basis === "fixed") row.lifetimePlanSeconds += v.plan.targetSeconds;
          if (![row.allocatedSeconds, row.monthlyPlanSeconds, row.lifetimePlanSeconds].every(Number.isSafeInteger))
            throw Error("Invalid reporting summary");
          totals.set(k, row);
        });
      }
      return { revision: a.meta.revision, portfolio, totals: [...totals.values()] };
    });
  }
  async detail(tenant: string, who: VerifiedIdentity, id: string): Promise<StaffProjectDetail> {
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
      const project = p.data() as Project;
      const draft = project.published ? readProjectDraft(await tx.get(draftRef(a.root, p.id)), tenant) : undefined;
      return { revision: a.meta.revision, project: draft ? overlayProject(project, draft.content) : project,
        ...(draft && { draft: draftMetadata(draft) }) };
    });
  }
  async report(
    tenant: string,
    who: VerifiedIdentity,
    month: string,
    preview?: { mode: "published" | "draft"; scope?: string },
  ): Promise<ProjectReport> {
    checkMonth(month);
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      if (a.staff !== Boolean(preview)) throw Error("Forbidden");
      let projectIds = a.projectIds;
      if (preview?.mode === "published") {
        const collection = a.root.collection("memberships");
        const docs = preview.scope ? [await tx.get(collection.doc(safeId(preview.scope)))] :
          (await tx.get(collection.where("role", "==", "client").limit(251))).docs;
        if (docs.length > 250) throw Error("Invalid preview scope");
        const members = docs.map(doc => doc.data()).filter(member =>
          member?.schemaVersion === 2 && member.tenantId === tenant && member.role === "client" && member.enabled === true && member.approved === true &&
          (assertProjectDatabase(this.db).mode !== "production" || Boolean(member.googleSubject && typeof member.googleSubject === "string")) &&
          Array.isArray(member.projectIds) && member.projectIds.length <= 100);
        if (preview.scope && !members.length) throw Error("Forbidden");
        const grants = members.map(member => new Set<string>(member!.projectIds.map((id: string) => safeId(id))));
        projectIds = [...(grants[0] ?? [])].filter(id => grants.every(grant => grant.has(id))).sort();
      }
      const views = preview?.mode === "draft"
        ? (await tx.get(a.root.collection("projectViews").where("schemaVersion", "==", 2).limit(MAX_DELIVERY_PROJECTS + 1))).docs
        : projectIds.length
        ? await tx.getAll(
            ...projectIds.map((id) =>
              a.root.collection("projectViews").doc(id),
            ),
          )
        : [];
      if (views.length > MAX_DELIVERY_PROJECTS) throw Error("Invalid hierarchy capacity");
      const visible = views.filter(
        (v) =>
          v.exists &&
          v.data()!.schemaVersion === 2 &&
          (v.data()!.published === true || preview?.mode === "draft"),
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
      const details = visible.length ? await tx.getAll(...visible.map(v => a.root.collection("projects").doc(v.id))) : [];
      const pending = preview?.mode === "draft" && visible.length
        ? await tx.getAll(...visible.map(v => draftRef(a.root, v.id))) : [];
      const projectDetails = details.map((doc, i) => {
        const project = doc.data() as Project | undefined;
        if (!project || project.id !== doc.id || project.tenantId !== tenant || project.schemaVersion !== 2) return;
        const draft = readProjectDraft(pending[i], tenant);
        return draft ? overlayProject(project, draft.content) : project;
      });
      const effort = await readWorkOrderEffort(tx, a.root, visible.map(v => v.id),
        month, visible.map((v, i) => periodSeconds(periods[i], v.id, month)));
      const projects = visible.map((v, i) => {
        const view = v.data() as ProjectView;
        const project = projectDetails[i];
        const projected = !project ? view : preview?.mode === "draft"
          ? { ...projectView(project, view.lifetimeSeconds), ...approvedProjectContent(project) }
          : project.milestones?.some(m => !m.date && m.visible)
            ? { ...view, milestones: approvedProjectContent(project).milestones }
            : view;
        const hours = effort[i];
        return {
          ...publicProject({ ...projected, lifetimeSeconds: projected.lifetimeSeconds + hours.lifetimeRemainingSeconds },
            hours.assignedSeconds + hours.remainingSeconds),
          ...(hours.lifetimeRecordedSeconds || hours.recordedSeconds ? { workOrderEffort: hours } : {}),
        };
      });
      const historicalMonths: string[] = [];
      for (let prior = previousReportingMonth(month); prior && historicalMonths.length < 5; prior = previousReportingMonth(prior))
        historicalMonths.unshift(prior);
      const historyFloor = String(Math.max(1000, Number(month.slice(0, 4)) - 10)) + month.slice(4);
      const timeMonths = visible.length ? await tx.get(a.root.collection("timeMonthlyTotals")
        .where(FieldPath.documentId(), ">=", historyFloor).where(FieldPath.documentId(), "<", month)
        .orderBy(FieldPath.documentId()).limit(120)) : undefined;
      const recent = new Set(historicalMonths);
      const months = [...new Set([...historicalMonths, ...(timeMonths?.docs.map(doc => doc.id) ?? [])])].sort();
      const history: { month: string; seconds: number }[] = [];
      for (const prior of months) {
        const documents = visible.length ? await tx.getAll(...visible.flatMap(v => [
          a.root.collection("projectPeriods").doc(key(prior, v.id)), timeProjectTotal(a.root, v.id, prior),
        ])) : [];
        const seconds = visible.reduce((total, view, index) => {
          const fact = (documents[index * 2 + 1].data() as TimeTotals | undefined) ?? { recorded: 0, allocated: 0 };
          const remainder = fact.recorded - fact.allocated;
          if (!Number.isSafeInteger(remainder) || remainder < 0) throw Error("Invalid reporting summary");
          return total + periodSeconds(documents[index * 2], view.id, prior) + remainder;
        }, 0);
        if (!Number.isSafeInteger(seconds)) throw Error("Invalid reporting summary");
        if (seconds || recent.has(prior)) history.push({ month: prior, seconds });
      }
      const config = await readPortfolio(tx, a.root);
      const delivery: Map<string, Delivery> = new Map();
      const visibleIds = new Set(projects.map(project => project.id));
      const byId = new Map(projects.map(project => [project.id, project]));
      for (const project of projectDetails) {
        if (project?.delivery) delivery.set(project.id, project.delivery);
      }
      const caps = capRollup(projects.map(project => ({ ...project, delivery: delivery.get(project.id) })));
      const hierarchy: NonNullable<ProjectReport["hierarchy"]> = Object.create(null);
      for (const project of projectDetails) {
        if (!project) continue;
        const publishedView = byId.get(project.id)!;
        if (!project.delivery) continue;
        const settings = project.delivery;
        const cap = caps.get(project.id)!;
        const summary = measureDelivery({ ...publishedView, milestones: project.milestones?.filter(m => m.visible), delivery: settings },
          cap, deliveryDate());
        hierarchy[project.id] = {
          ...(settings.blocker?.message ? { blocker: { active: settings.blocker.active, message: settings.blocker.message } } : {}),
          ...(settings.structure === 2 ? { kind: settings.kind } : {}),
          ...(settings.parentId && visibleIds.has(settings.parentId) ? { parentId: settings.parentId } : {}),
          ...(summary.completion !== undefined ? { completion: summary.completion } : {}),
          ...(settings.publishSummary ? {
            type: settings.type,
            ...(settings.monthlyCap !== undefined ? { monthlyCap: settings.monthlyCap, monthlyCapUsed: cap.monthly } : {}),
            ...(settings.lifetimeCap !== undefined ? { lifetimeCap: settings.lifetimeCap, lifetimeCapUsed: cap.lifetime } : {}),
            ...(settings.start ? { start: settings.start } : {}),
            ...(settings.deadline ? { deadline: settings.deadline } : {}),
          } : {}),
        };
      }
      const portfolio = publishedPortfolio(config, projects, month, history, delivery);
      const totalSeconds = projects.reduce((n, p) => n + p.seconds, 0);
      const settings = portalSettings(a.meta.portalSettings);
      if (!Number.isSafeInteger(totalSeconds))
        throw Error("Invalid reporting summary");
      return {
        tenant: { id: tenant, name: settings.clientLabel || a.meta.name },
        month,
        totalSeconds,
        ...(settings.presentationTitle ? { presentationTitle: settings.presentationTitle } : {}),
        projects,
        portfolio,
        ...(Object.keys(hierarchy).length ? { hierarchy } : {}),
      };
    });
  }
  async previewScopes(tenant: string, who: VerifiedIdentity) {
    return this.db.runTransaction(async tx => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      const members = await tx.get(a.root.collection("memberships").limit(250));
      return members.docs.filter(doc => {
        const m = doc.data();
        return m.schemaVersion === 2 && m.tenantId === tenant && m.role === "client" && m.approved && m.enabled &&
          (assertProjectDatabase(this.db).mode !== "production" || typeof m.googleSubject === "string" && Boolean(m.googleSubject));
      }).map((doc, i) => ({ id: doc.id, label: "Client access profile " + (i + 1) + " · " + (doc.data().projectIds?.length ?? 0) + " permitted projects" }));
    });
  }
  async syncDirectory(tenant: string, who: VerifiedIdentity, profiles: () => Promise<WordPressProfile[]>, now: number) {
    await this.db.runTransaction(async tx => {
      if (!(await this.access(tx, tenant, who)).staff) throw Error("Forbidden");
    });
    let imported: WordPressProfile[];
    try { imported = await profiles(); }
    catch { throw Error("WordPress team is temporarily unavailable"); }
    return this.db.runTransaction(async tx => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      const portfolio = await readPortfolio(tx, a.root);
      const directory = mergeDirectory(portfolio.directory, imported);
      if (directory.length > portfolioLimits.directory || Buffer.byteLength(JSON.stringify({ ...portfolio, directory })) > 750_000) throw Error("Invalid directory capacity");
      if (isDeepStrictEqual(directory, portfolio.directory)) return { revision: a.meta.revision, profiles: imported.length, changed: false };
      const revision = a.meta.revision + 1;
      const id = randomUUID();
      tx.set(portfolioRef(a.root), { portfolio: { ...portfolio, directory } });
      tx.update(a.root, { revision });
      tx.create(a.root.collection("audits").doc(id), { id, tenantId: tenant, actor: who.subject,
        entityId: "wordpress-team", action: "wordpress-directory-synced", at: new Date(now).toISOString(), revision });
      return { revision, profiles: imported.length, changed: true };
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
      ((resource !== "projects" && resource !== "sources") || query.search.length > 120)
    )
      throw Error("Invalid project search");
    const search = query.search?.trim().normalize("NFKC").toLowerCase() ?? "";
    if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 25)
      throw Error("Invalid page limit");
    return this.db.runTransaction(async (tx) => {
      const a = await this.access(tx, tenant, who);
      if (!a.staff) throw Error("Forbidden");
      if (resource === "sources") return readSourcePage(tx, a.root, who.subject, a.meta.revision, query);
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
        } catch {
          throw Error("Revision conflict");
        }
      }
      const collection = resource === "history" ? "allocationRevisions" : resource;
      let q: FirebaseFirestore.Query = a.root.collection(collection);
      if (resource === "projects") q = q.where("schemaVersion", "==", 2);
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
        const draftDocs = docs.filter(d => d.data().published === true).map(d => draftRef(a.root, d.id));
        const drafts = new Map((draftDocs.length ? await tx.getAll(...draftDocs) : []).map(d => [d.id, readProjectDraft(d, tenant)]));
        const effort = await readWorkOrderEffort(tx, a.root, docs.map(d => d.id), query.month,
          docs.map((d, i) => periodSeconds(periods[i], d.id, query.month)));
        const summaries = docs.map((d, i) => {
          if (d.data().tenantId !== tenant || d.data().id !== d.id)
            throw Error("Forbidden");
          if (
            !views[i].exists ||
            views[i].data()!.tenantId !== tenant ||
            views[i].data()!.id !== d.id ||
            views[i].data()!.schemaVersion !== 2
          )
            throw Error("Invalid reporting summary");
          const project = d.data() as Project;
          const draft = drafts.get(d.id);
          const milestones = draft?.content.milestones ?? project.milestones;
          return {
            ...projectView(project, views[i].data()!.lifetimeSeconds + effort[i].lifetimeRemainingSeconds),
            seconds: effort[i].assignedSeconds + effort[i].remainingSeconds,
            ...(effort[i].lifetimeRecordedSeconds || effort[i].recordedSeconds ? { workOrderEffort: effort[i] } : {}),
            ...(draft && { draft: draftMetadata(draft) }),
            ...(d.data().delivery ? { delivery: d.data().delivery as Delivery } : {}),
            ...(milestones && { deliveryMilestones: milestones }),
            ...(d.data().workOrderReference ? { workOrderReference: String(d.data().workOrderReference) } : {}),
          };
        });
        if (summaries.length) {
          const preview = publishedPortfolio(await readPortfolio(tx, a.root), summaries, query.month, []);
          out.projects = summaries.map(project => ({
            ...project,
            reportPreview: {
              placement: preview.placements.find(p => p.id === project.id),
              team: preview.directory.filter(person => person.projectIds.includes(project.id)).map(person => ({
                ...person, projectIds: [project.id],
              })),
            },
          }));
        } else out.projects = [];
      } else if (resource === "history")
        out.history = docs.map((d) => {
          const r = d.data();
          return {
            revision: r.revision,
            at: r.at,
            actor: r.actor,
            portions: r.portions,
            ...(r.annotations ? { annotations: r.annotations } : {}),
            ...(r.sourceRevision ? { sourceRevision: r.sourceRevision } : {}),
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
    }, resource === "sources" ? { readOnly: true } : undefined);
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
    private directorySource: () => Promise<WordPressProfile[]> = wordpressProfiles,
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
  async control(token: string, tenant: string, update?: { expectedRevision: number; settings: PortalSettings }) {
    return this.store.control(tenant, await this.identity(token), update, this.policy.now());
  }
  async report(token: string, tenant: string, month: string, preview?: { mode: "published" | "draft"; scope?: string }) {
    return this.store.report(tenant, await this.identity(token), month, preview);
  }
  async previewScopes(token: string, tenant: string) {
    return this.store.previewScopes(tenant, await this.identity(token));
  }
  async syncDirectory(token: string, tenant: string) {
    return this.store.syncDirectory(tenant, await this.identity(token), this.directorySource, this.policy.now());
  }
  async employeeMappings(token: string, tenant: string, cursor?: string) {
    const who = await this.identity(token);
    return this.store.db.runTransaction(async tx => {
      const access = await this.store.access(tx, tenant, who);
      return employeeMappingsPage(tx, { ...access, meta: { revision: access.meta.revision } }, who.subject, cursor);
    }, { readOnly: true });
  }
  async changeEmployeeMapping(token: string, tenant: string, raw: Record<string, unknown>) {
    const who = await this.identity(token);
    return this.store.db.runTransaction(async tx => {
      const access = await this.store.access(tx, tenant, who);
      if (!access.platformAdmin) throw Error("Forbidden");
      return saveEmployeeMapping(tx, { ...access, meta: { revision: access.meta.revision } }, who.subject, employeeMappingChange(raw), this.policy.now());
    });
  }
  async page(
    token: string,
    tenant: string,
    resource: "projects" | "sources" | "history" | "audits",
    query: PageQuery,
  ) {
    return this.store.page(tenant, await this.identity(token), resource, query);
  }
  async portfolio(token: string, tenant: string, change?: {
    section: PortfolioSection; record: unknown; expectedRevision: number;
  }, month?: string) {
    return this.store.portfolio(tenant, await this.identity(token), change && { ...change, now: this.policy.now() }, month);
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
    review?: { expectedSourceRevision: string; annotations: AllocationAnnotations },
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
      review,
    );
  }
  async allocateBulk(token: string, tenant: string, input: unknown, idempotencyKey: string, signal?: AbortSignal) {
    const target = assertProjectDatabase(this.store.db);
    const who = await this.identity(token);
    if (!who.corporatePolicy || who.staffTenantId !== tenant || requestIdentity.getStore()?.identity !== who) throw Error("Forbidden");
    assertProductionTenant(target, tenant);
    return allocateTimeBatch(new FirestoreTenantStore(this.store.db, 2), tenant, who.subject, input, idempotencyKey, this.policy.now(), signal);
  }
}
