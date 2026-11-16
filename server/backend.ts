import { approvedMember, canAccessProject } from "./authorization";
import { randomUUID } from "node:crypto";
import {
  clientProjection,
  validate,
  type DeliveryProject,
  type ReportingScope,
} from "../src/reporting/model";
import {
  safeId,
  type IdentityPolicy,
  type IdentityVerifier,
  type Membership,
  type TenantRecord,
  type TenantStore,
} from "./contracts";
export class ReportingBackend {
  constructor(
    private readonly store: TenantStore,
    private readonly verifier: IdentityVerifier,
    private readonly policy: IdentityPolicy,
  ) {}
  private async identity(authorization: string) {
    if (!authorization.startsWith("Bearer ") || authorization.length > 8192)
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
    return who;
  }
  private member(r: TenantRecord, tenantId: string, subject: string) {
    return approvedMember(r, tenantId, subject);
  }
  private canProject(m: Membership, p: DeliveryProject) {
    return canAccessProject(m, p);
  }

  private audit(
    r: TenantRecord,
    tenantId: string,
    actor: string,
    action: string,
    entityId: string,
  ) {
    r.revision++;
    r.audits.push({
      id: randomUUID(),
      tenantId,
      actor,
      action,
      entityId,
      at: new Date(this.policy.now()).toISOString(),
      revision: r.revision,
    });
  }
  async readPublished(
    authorization: string,
    tenantId: string,
    scope: ReportingScope,
  ) {
    safeId(tenantId);
    const who = await this.identity(authorization);
    if (this.store.readPublished)
      return this.store.readPublished(tenantId, who.subject, scope);
    return this.store.transaction(tenantId, (r) => {
      const m = this.member(r, tenantId, who.subject);
      const state = structuredClone(r.state);
      state.projects = state.projects.map((p) => ({
        ...p,
        published: p.published && this.canProject(m, p),
      }));
      if (
        scope.agreementId &&
        m.role !== "administrator" &&
        !m.agreementIds.includes(scope.agreementId)
      )
        throw Error("Forbidden");
      const view = clientProjection(state, scope);
      if (m.role === "administrator") return { ...view, revision: r.revision };
      return {
        ...view,
        revision: r.revision,
        agreements: view.agreements.filter((a) =>
          m.agreementIds.includes(a.id),
        ),
        departments: view.departments.filter((d) =>
          m.agreementIds.includes(d.agreementId),
        ),
      };
    });
  }
  async createProject(
    authorization: string,
    tenantId: string,
    input: Pick<
      DeliveryProject,
      "agreementId" | "departmentId" | "name" | "plan"
    >,
  ) {
    safeId(tenantId);
    const who = await this.identity(authorization);
    return this.store.transaction(
      tenantId,
      (r) => {
        const m = this.member(r, tenantId, who.subject);
        if (
          m.role === "client" ||
          (m.role !== "administrator" &&
            !m.agreementIds.includes(input.agreementId))
        )
          throw Error("Forbidden");
        if (
          Object.keys(input).some(
            (k) => !["agreementId", "departmentId", "name", "plan"].includes(k),
          ) ||
          !input.name ||
          input.name.length > 200 ||
          Object.keys(input.plan).some((k) => !["basis", "minutes"].includes(k))
        )
          throw Error("Invalid project payload");
        const p: DeliveryProject = {
          id: randomUUID(),
          agreementId: input.agreementId,
          departmentId: input.departmentId,
          name: input.name,
          plan: { basis: input.plan.basis, minutes: input.plan.minutes },
          progress: 0,
          published: false,
          internalNotes: "",
          trainingSessions: [],
        };
        r.state.projects.push(p);
        validate(r.state);
        this.audit(r, tenantId, who.subject, "project-created-internal", p.id);
        return structuredClone(p);
      },
      {
        subject: who.subject,
        agreementId: input.agreementId,
        departmentId: input.departmentId,
      },
    );
  }
  async editProject(
    authorization: string,
    tenantId: string,
    projectId: string,
    expectedRevision: number,
    patch: unknown,
  ) {
    safeId(tenantId);
    safeId(projectId);
    const who = await this.identity(authorization);
    return this.store.transaction(
      tenantId,
      (r) => {
        const m = this.member(r, tenantId, who.subject);
        const p = r.state.projects.find((p) => p.id === projectId);
        if (!p || m.role === "client" || !this.canProject(m, p))
          throw Error("Forbidden");
        if (r.revision !== expectedRevision) throw Error("Revision conflict");
        if (
          !patch ||
          typeof patch !== "object" ||
          Array.isArray(patch) ||
          Object.keys(patch).some((k) => !["name", "progress"].includes(k))
        )
          throw Error("Forbidden fields");
        const change = patch as { name?: string; progress?: number };
        if (
          change.name !== undefined &&
          (typeof change.name !== "string" ||
            !change.name.trim() ||
            change.name.length > 200)
        )
          throw Error("Invalid name");
        if (
          change.progress !== undefined &&
          (!Number.isFinite(change.progress) ||
            change.progress < 0 ||
            change.progress > 100)
        )
          throw Error("Invalid progress");
        const before = JSON.stringify(p);
        Object.assign(p, change);
        validate(r.state);
        if (JSON.stringify(p) === before)
          return { revision: r.revision, changed: false };
        this.audit(r, tenantId, who.subject, "project-edited", projectId);
        return { revision: r.revision, changed: true };
      },
      { subject: who.subject, projectId },
    );
  }
  async publishProject(
    authorization: string,
    tenantId: string,
    projectId: string,
    expectedRevision: number,
    published: boolean,
  ) {
    safeId(tenantId);
    safeId(projectId);
    const who = await this.identity(authorization);
    return this.store.transaction(
      tenantId,
      (r) => {
        const m = this.member(r, tenantId, who.subject);
        if (m.role !== "administrator") throw Error("Forbidden");
        if (r.revision !== expectedRevision) throw Error("Revision conflict");
        if (typeof published !== "boolean") throw Error("Invalid publication");
        const p = r.state.projects.find((p) => p.id === projectId);
        if (!p) throw Error("Project not found");
        if (p.published === published)
          return { revision: r.revision, changed: false };
        p.published = published;
        this.audit(r, tenantId, who.subject, "publication-changed", projectId);
        return { revision: r.revision, changed: true };
      },
      { subject: who.subject, projectId },
    );
  }
  async allocateTime(
    authorization: string,
    tenantId: string,
    sourceId: string,
    expectedRevision: number,
    portions: import("../src/reporting/model").Allocation[],
  ) {
    safeId(tenantId);
    safeId(sourceId);
    const who = await this.identity(authorization);
    if (!this.store.allocateReporting)
      throw Error("Persistent allocation unavailable");
    return this.store.allocateReporting(
      tenantId,
      who.subject,
      sourceId,
      expectedRevision,
      portions,
      this.policy.now(),
    );
  }
}
