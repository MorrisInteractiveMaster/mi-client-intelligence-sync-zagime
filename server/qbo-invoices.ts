import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { deliveryDate } from "../src/projects/delivery";
import { invoiceFreshness, type Invoice, type InvoiceView } from "../src/projects/invoices";
import type { VerifiedIdentity } from "./contracts";
import type { ProjectStore } from "./project-workspace";
import { assertProductionTenant, assertProjectDatabase } from "./database-target";
import { key } from "./firestore-store";
import type { QboCompany, QboCustomer, QboProjectChoice, QboSetup, QboSourceProject } from "../src/projects/qbo-discovery";
import { customerQueryTerm } from "./qbo-discovery-provider";
import { numericQboId, type InvoiceSource, type QboInvoicesProvider } from "./qbo-invoices-provider";

type Approval = string | { revision: string; audience: string[] };
type Mirror = { scope: string; syncedAt: string; rows: InvoiceSource[]; approvals: Record<string, Approval> };
const revisionOf = (approval?: Approval) => typeof approval === "string" ? approval : approval?.revision;
const audienceOf = (approval?: Approval) => typeof approval === "object" ? approval.audience : undefined;
type Authorize = (tx: Transaction) => Promise<{ root: DocumentReference; scope: string }>;
type Binding = {
  id: string; root: QboCustomer; customers: string[]; projects: QboSourceProject[];
  links: Record<string, string>; discoveredAt?: string; newlyDiscovered: string[]; held?: number;
};
type Setup = { company: QboCompany; confirmed: boolean; native: boolean; binding?: Binding };
type Connection = {
  setup?: Setup;
  scope?: string; token?: string; lastFailedAt?: string; busy?: { id: string; expires: number };
  pending?: { hash: string; actor: string; expires: number };
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const invoiceRevision = (row: InvoiceSource) => digest(JSON.stringify([
  row.id, row.customerId, row.number, row.txnDate, row.dueDate, row.currency, row.total, row.projectIds,
  ...(row.sourceProjects ? [row.sourceProjects] : []),
]));
const shortId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

const workOrder = (name: string) => name.match(/(?:^|[^a-z0-9.])(WO[0-9]+(?:\.[0-9]+)*)(?![a-z0-9]|\.[a-z0-9])/gi)
  ?.map(match => match.trim().replace(/^[^w]/i, "").toUpperCase());
const singleWorkOrder = (name: string) => {
  const aliases = [...new Set(workOrder(name) ?? [])];
  return aliases.length === 1 ? aliases[0] : undefined;
};
function projectAliases(projects: QboSourceProject[]) {
  const aliases = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const project of projects) {
    const alias = singleWorkOrder(project.name);
    if (!alias) continue;
    if (aliases.has(alias)) conflicts.add(alias);
    aliases.set(alias, project.key);
  }
  for (const alias of conflicts) aliases.delete(alias);
  return aliases;
}
function projectLinks(row: InvoiceSource, links: Record<string, string>) {
  return [...new Set((row.sourceProjects ?? []).flatMap(source => links[source] ? [links[source]] : []))].sort();
}

export class QboInvoices {
  constructor(private store: ProjectStore, private provider?: QboInvoicesProvider, private now = Date.now) {}
  private scope(tenant: string) {
    const cfg = this.provider?.config;
    return cfg?.tenant === tenant ? digest(JSON.stringify([tenant, cfg.realm, cfg.sandbox, [...cfg.customerIds].sort()])) : undefined;
  }
  private companyScope(tenant: string, realm: string) {
    return digest(JSON.stringify([tenant, realm, this.provider!.config.sandbox]));
  }
  private bindingScope(scope: string, binding: Binding) { return digest(scope + ":" + binding.id); }
  private async projectChoices(tx: Transaction, root: DocumentReference): Promise<QboProjectChoice[]> {
    const docs = (await tx.get(root.collection("projects").limit(601))).docs;
    if (docs.length > 600) throw Error("QBO internal project inventory too large");
    return docs.flatMap(doc => {
      const p = doc.data();
      if (p.tenantId !== root.id || p.schemaVersion !== 2 || p.id !== doc.id || typeof p.name !== "string") return [];
      const workOrder = typeof p.workOrderReference === "string" ? singleWorkOrder(p.workOrderReference) : undefined;
      return [{ id: doc.id, name: p.name, ...(workOrder && { workOrder }) }];
    }).sort((a, b) => a.name.localeCompare(b.name));
  }
  private configRevision() {
    const cfg = this.provider!.config;
    return digest(JSON.stringify([cfg.currency, cfg.mappings]));
  }
  private connection(root: DocumentReference) { return root.collection("invoiceIntegration").doc("connection"); }
  private mirror(root: DocumentReference) { return root.collection("invoiceIntegration").doc("mirror"); }
  private seal(token: string, scope: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.provider!.config.key, iv);
    cipher.setAAD(Buffer.from(scope));
    const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
  }
  private unseal(value: string, scope: string) {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.provider!.config.key, data.subarray(0, 12));
    decipher.setAAD(Buffer.from(scope));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
  private async projectNames(tx: Transaction, root: DocumentReference, ids: string[], publishedOnly: boolean) {
    if (!ids.length) return new Map<string, string>();
    const snapshots = await tx.getAll(...ids.map(id => root.collection(publishedOnly ? "projectViews" : "projects").doc(id)));
    return new Map(snapshots.flatMap(snapshot => {
      const p = snapshot.data();
      return p?.tenantId === root.id && p.schemaVersion === 2 && p.id === snapshot.id && typeof p.name === "string" &&
        (!publishedOnly || p.published === true) ? [[snapshot.id, p.name] as const] : [];
    }));
  }
  async read(tenant: string, who: VerifiedIdentity, request: { preview?: boolean; scope?: string } = {}): Promise<InvoiceView> {
    const scope = this.scope(tenant);
    return this.store.db.runTransaction(async tx => {
      const a = await this.store.access(tx, tenant, who);
      if (request.preview && !a.staff) throw Error("Forbidden");
      const staff = a.staff && !request.preview;
      const empty = { today: deliveryDate(new Date(this.now())), invoices: [], freshness: "unavailable" as const,
        ...(staff && { configured: Boolean(scope), canManage: a.platformAdmin, connected: false }) };
      if (!scope) return empty;
      const [mirrorSnapshot, connectionSnapshot] = await tx.getAll(this.mirror(a.root), this.connection(a.root));
      const mirror = mirrorSnapshot.data() as Mirror | undefined;
      const connection = connectionSnapshot.data() as Connection | undefined;
      const activeSetup = connection?.setup;
      const binding = activeSetup?.binding;
      const tokenScope = activeSetup ? this.companyScope(tenant, activeSetup.company.realm) : scope;
      const visibleScope = activeSetup && binding ? this.bindingScope(tokenScope, binding) : scope;
      const result: InvoiceView = { ...empty, ...(staff && { connected: connection?.scope === tokenScope && Boolean(connection.token) }) };
      if (staff && activeSetup) {
        const choices = a.platformAdmin && binding ? await this.projectChoices(tx, a.root) : [];
        const setup: QboSetup = { company: activeSetup.company, confirmed: activeSetup.confirmed, native: activeSetup.native,
          projects: (binding?.projects ?? []).map(project => {
            const alias = singleWorkOrder(project.name);
            return { ...project, linked: binding!.links[project.key],
              suggestions: alias ? choices.filter(choice => choice.workOrder === alias).map(choice => choice.id) : [],
              newlyDiscovered: binding!.newlyDiscovered.includes(project.key) };
          }), choices, ...(binding && { root: binding.root, binding: binding.id, discoveredAt: binding.discoveredAt, held: binding.held }) };
        if (a.platformAdmin) result.setup = setup;
        result.readyToSync = Boolean(activeSetup.confirmed && binding);
      }
      if (!mirror || mirror.scope !== visibleScope || (activeSetup ? !activeSetup.confirmed || !binding :
          mirrorSnapshot.get("configRevision") !== this.configRevision())) return result;
      const customerScope = new Set(binding?.customers);
      const projectScope = new Set(binding?.projects.map(project => project.key));
      const grants = new Set(request.preview ? await this.store.clientPreviewProjectIds(tx, a.root, request.scope) : a.projectIds);
      const names = await this.projectNames(tx, a.root, [...new Set(mirror.rows.flatMap(row => row.projectIds))].filter(id => staff || grants.has(id)), !staff);
      result.syncedAt = mirror.syncedAt;
      result.freshness = connection?.scope !== tokenScope || !connection.token ? "stale" : invoiceFreshness(this.now(), mirror.syncedAt, connection.lastFailedAt);
      const member = request.preview ? request.scope : key(who.subject);
      result.invoices = mirror.rows.flatMap(row => {
        if (binding && (!customerScope.has(row.customerId) || row.sourceProjects?.some(key => !projectScope.has(key)))) return [];
        const missingProjectLink = Boolean(binding && row.sourceProjects?.some(key => !binding.links[key]));
        if (!staff && (row.unverifiedProjects || missingProjectLink)) return [];
        const revision = invoiceRevision(row);
        const approval = mirror.approvals[row.id];
        const audience = audienceOf(approval);
        const approved = revisionOf(approval) === revision && (row.projectIds.length > 0 || Boolean(audience?.length));
        const allowed = row.projectIds.length ? row.projectIds.every(id => names.has(id)) : Boolean(member && audience?.includes(member));
        if (!staff && (!approved || !allowed)) return [];
        // Finance notes and QBO identifiers belong to the staff projection exclusively.
        const view: Invoice = { id: staff ? row.id : digest(visibleScope + ":" + row.id), number: row.number,
          txnDate: row.txnDate, ...(row.dueDate && { dueDate: row.dueDate }), currency: row.currency,
          total: row.total, balance: row.balance, projects: row.projectIds.map(id => ({ id, name: names.get(id) ?? "Unavailable project" })),
          ...(staff && { customer: row.customer ?? row.customerId,
            ...(row.sourceProjects && { sourceProjects: row.sourceProjects.map(key => ({ key,
              name: binding?.projects.find(project => project.key === key)?.name ?? "Unverified QuickBooks project" })) }),
            ...(row.unverifiedProjects && { unverifiedProjects: true }), ...(missingProjectLink && { missingProjectLink }), ...(row.note && { note: row.note }), approval: { approved, revision, ...(audience?.length && { audience }) } }),
        };
        return [view];
      }).sort((a, b) => b.txnDate.localeCompare(a.txnDate) || a.number.localeCompare(b.number));
      return result;
    }, { readOnly: true });
  }
  private async operator(tx: Transaction, tenant: string, who: VerifiedIdentity) {
    const a = await this.store.access(tx, tenant, who);
    if (!a.platformAdmin) throw Error("Forbidden");
    const scope = this.scope(tenant);
    if (!scope) throw Error("QBO invoices unavailable");
    return { root: a.root, scope };
  }
  async approve(tenant: string, who: VerifiedIdentity, input: Record<string, unknown>) {
    const { id, revision, approved, audience } = input;
    if (!numericQboId(id) || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision) || typeof approved !== "boolean")
      throw Error("Invalid invoice approval");
    if (audience !== undefined && (!Array.isArray(audience) || audience.length < 1 || audience.length > 100 ||
        !audience.every(shortId) || new Set(audience).size !== audience.length)) throw Error("Invalid invoice audience");
    return this.store.db.runTransaction(async tx => {
      const { root, scope } = await this.operator(tx, tenant, who);
      const ref = this.mirror(root);
      const [snap, connection] = await tx.getAll(ref, this.connection(root));
      const setup = connection.get("setup") as Setup | undefined;
      const binding = setup?.binding;
      const effective = setup && binding ? this.bindingScope(this.companyScope(tenant, setup.company.realm), binding) : scope;
      const mirror = snap.data() as Mirror | undefined;
      const row = mirror?.scope === effective && (setup ? setup.confirmed && binding : snap.get("configRevision") === this.configRevision()) &&
        mirror.rows.find(candidate => candidate.id === id);
      if (approved && row && (row.unverifiedProjects || binding && (!binding.customers.includes(row.customerId) ||
          row.sourceProjects?.some(key => !binding.links[key] || !binding.projects.some(project => project.key === key))))) throw Error("Invalid unverified invoice project");
      if (!row || !mirror || invoiceRevision(row) !== revision) throw Error("Revision conflict");
      if (approved && (await this.projectNames(tx, root, row.projectIds, true)).size !== row.projectIds.length)
        throw Error("Invalid unpublished invoice project");
      if (audience !== undefined && (!approved || row.projectIds.length)) throw Error("Invalid invoice audience");
      if (approved && !row.projectIds.length) {
        if (!Array.isArray(audience)) throw Error("Invalid invoice audience");
        const memberships = await tx.getAll(...audience.map(id => root.collection("memberships").doc(id)));
        if (memberships.some(doc => {
          const m = doc.data();
          return m?.tenantId !== tenant || m.schemaVersion !== 2 || m.role !== "client" || m.approved !== true || m.enabled !== true ||
            typeof m.subject !== "string" || key(m.subject) !== doc.id ||
            (assertProjectDatabase(this.store.db).mode === "production" && (typeof m.googleSubject !== "string" || !m.googleSubject));
        })) throw Error("Invalid invoice audience");
      }
      const approvals = { ...mirror.approvals };
      if (approved) approvals[id] = row.projectIds.length ? revision : { revision, audience: [...audience as string[]].sort() };
      else delete approvals[id];
      if (JSON.stringify(approvals) === JSON.stringify(mirror.approvals)) return { ok: true };
      tx.update(ref, { approvals });
      this.audit(tx, root, who.subject, approved ? "invoice-approved" : "invoice-withdrawn", id, audience as string[] | undefined);
      return { ok: true };
    });
  }
  private audit(tx: Transaction, root: DocumentReference, actor: string, action: string, entityId: string, audience?: string[]) {
    const uid = randomUUID();
    tx.create(root.collection("invoiceAudit").doc(uid), {
      id: uid, tenantId: root.id, actor, action, entityId, at: new Date(this.now()).toISOString(), ...(audience && { audience }),
    });
  }
  async connect(tenant: string, who: VerifiedIdentity) {
    const state = randomBytes(32).toString("base64url");
    return this.store.db.runTransaction(async tx => {
      const { root } = await this.operator(tx, tenant, who);
      const ref = this.connection(root);
      const existing = (await tx.get(ref)).data() as Connection | undefined;
      if (existing?.busy && existing.busy.expires > this.now()) throw Error("Revision conflict");
      tx.set(ref, { pending: { hash: digest(state), actor: who.subject, expires: this.now() + 600_000 } }, { merge: true });
      return { url: this.provider!.authorizationUrl(state) };
    });
  }
  private async claim(authorize: Authorize, callback?: { state: string; realm: string; actor: string }) {
    const id = randomUUID();
    return this.store.db.runTransaction(async tx => {
      const { root, scope } = await authorize(tx);
      const ref = this.connection(root);
      const current = (await tx.get(ref)).data() as Connection | undefined;
      if (current?.busy && current.busy.expires > this.now()) throw Error("Revision conflict");
      if (callback) {
        const previousRealm = current?.setup?.binding ? current.setup.company.realm : this.provider!.config.realm;
        if ((previousRealm && callback.realm !== previousRealm) || !current?.pending || current.pending.actor !== callback.actor ||
            current.pending.expires <= this.now() || current.pending.hash !== digest(callback.state)) throw Error("Forbidden");
      }
      const tokenScope = current?.setup ? this.companyScope(root.id, current.setup.company.realm) : scope;
      if (!callback && (current?.scope !== tokenScope || !current.token)) throw Error("QBO invoices unavailable");
      const busy = { id, expires: this.now() + 600_000 };
      tx.set(ref, { ...current, busy, ...(callback && { pending: null }) });
      return { id, root, ref, scope: tokenScope, token: current?.token, setup: current?.setup };
    });
  }
  private async guarded<T>(lease: Awaited<ReturnType<QboInvoices["claim"]>>, step: (tx: Transaction, current: Connection) => Promise<T>) {
    return this.store.db.runTransaction(async tx => {
      const current = (await tx.get(lease.ref)).data() as Connection;
      if (current?.busy?.id !== lease.id) throw Error("Revision conflict");
      return step(tx, current);
    });
  }
  private async release(lease: Awaited<ReturnType<QboInvoices["claim"]>>) {
    await this.guarded(lease, async tx => { tx.update(lease.ref, { busy: null }); }).catch(() => undefined);
  }
  async callback(tenant: string, who: VerifiedIdentity, input: Record<string, unknown>) {
    const { state, realm, code } = input;
    if (!shortId(state) || state.length !== 43 || !numericQboId(realm) || typeof code !== "string" || !code || code.length > 2048)
      throw Error("Invalid QBO callback");
    const lease = await this.claim(tx => this.operator(tx, tenant, who), { state, realm, actor: who.subject });
    try {
      const token = await this.provider!.token({ code });
      const company = !this.provider!.config.realm || lease.setup ? await this.provider!.company(token.access, realm) : undefined;
      const scope = company ? this.companyScope(tenant, realm) : lease.scope;
      await this.guarded(lease, async tx => {
        const existing = lease.setup?.company.realm === realm ? lease.setup : undefined;
        const native = Boolean(this.provider!.config.nativeProjects);
        const setup = company ? { ...existing, company, native, confirmed: existing?.confirmed === true } : undefined;
        tx.update(lease.ref, { scope, token: this.seal(token.refresh, scope), busy: null, ...(setup && { setup }) });
        this.audit(tx, lease.root, who.subject, "qbo-invoices-connected", tenant);
      });
      return { ok: true, setup: Boolean(company) };
    } finally { await this.release(lease); }
  }
  private async rotate(lease: Awaited<ReturnType<QboInvoices["claim"]>>) {
    const token = await this.provider!.token({ refresh: this.unseal(lease.token!, lease.scope) });
    await this.guarded(lease, async tx => { tx.update(lease.ref, { token: this.seal(token.refresh, lease.scope) }); });
    return token.access;
  }

  async discovery(tenant: string, who: VerifiedIdentity, input: Record<string, unknown>) {
    const { action, realm, rootId, term, page, bindingId, source, projectId } = input;
    const lease = await this.claim(tx => this.operator(tx, tenant, who));
    try {
      const setup = lease.setup;
      if (!setup || setup.company.realm !== realm) throw Error("Revision conflict");
      const company = setup.company;
      if (action === "confirm-company") return await this.guarded(lease, async tx => {
        tx.update(lease.ref, { "setup.confirmed": true });
        this.audit(tx, lease.root, who.subject, "qbo-company-confirmed", tenant);
        return { ok: true };
      });
      if (!setup.confirmed) throw Error("Forbidden");
      if (action === "search") {
        customerQueryTerm(term);
        if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > 25) throw Error("Invalid customer page");
        return await this.provider!.search(await this.rotate(lease), company.realm, term as string, page);
      }
      const binding = setup.binding;
      if ((binding?.id ?? null) !== bindingId) throw Error("Revision conflict");
      if (action === "bind") {
        if (!numericQboId(rootId)) throw Error("Invalid QBO customer");
        const access = await this.rotate(lease);
        const root = await this.provider!.customer(access, company.realm, rootId);
        if (root.parentId) throw Error("Invalid QBO root customer");
        if (binding?.root.id === root.id) return { ok: true };
        const next = await this.discover(access, setup, {
          id: randomUUID(), root, customers: [root.id], projects: [], links: {}, newlyDiscovered: [],
        }, AbortSignal.timeout(120_000));
        return await this.guarded(lease, async tx => {
          tx.update(lease.ref, { "setup.binding": next, lastFailedAt: null });
          tx.delete(this.mirror(lease.root));
          this.audit(tx, lease.root, who.subject, "qbo-customer-bound", root.id);
          return { ok: true };
        });
      }
      if (action !== "link" || !binding || typeof source !== "string" || !shortId(projectId) ||
          !binding.projects.some(project => project.key === source)) throw Error("Invalid QBO project link");
      return await this.guarded(lease, async tx => {
        if (binding.links[source] && binding.links[source] !== projectId) throw Error("Revision conflict");
        const project = (await this.projectNames(tx, lease.root, [projectId], false)).get(projectId);
        if (!project) throw Error("Invalid project link target");
        const mirrorRef = this.mirror(lease.root);
        const mirror = (await tx.get(mirrorRef)).data() as Mirror | undefined;
        const links = { ...binding.links, [source]: projectId };
        tx.update(lease.ref, { "setup.binding.links": links });
        if (mirror?.scope === this.bindingScope(lease.scope, binding)) {
          const approvals = { ...mirror.approvals };
          const rows = mirror.rows.map(row => {
            const next = { ...row, projectIds: projectLinks(row, links) };
            if (invoiceRevision(row) !== invoiceRevision(next)) delete approvals[row.id];
            return next;
          });
          if (Buffer.byteLength(JSON.stringify({ ...mirror, rows, approvals }), "utf8") > 700_000)
            throw Error("QBO invoice scope too large");
          tx.update(mirrorRef, { rows, approvals });
        }
        this.audit(tx, lease.root, who.subject, "qbo-project-linked", projectId);
        return { ok: true };
      });
    } finally { await this.release(lease); }
  }

  async sync(tenant: string, who: VerifiedIdentity) {
    return this.synchronize(tx => this.operator(tx, tenant, who), who.subject);
  }
  async syncScheduled(actor: string) {
    const tenant = this.provider?.config.tenant;
    const scope = tenant && this.scope(tenant);
    if (!tenant || !scope) throw Error("QBO invoices unavailable");
    const target = assertProjectDatabase(this.store.db);
    assertProductionTenant(target, tenant);
    const root = this.store.db.collection("tenants").doc(tenant);
    return this.synchronize(async tx => {
      const meta = (await tx.get(root)).data();
      if (meta?.schemaVersion !== 2) throw Error("Forbidden");
      assertProductionTenant(target, tenant, meta);
      return { root, scope };
    }, actor);
  }
  private async discover(access: string, setup: Setup, binding: Binding, deadline: AbortSignal): Promise<Binding> {
    const customers = await this.provider!.customers(access, setup.company.realm, binding.root.id, deadline);
    const ids = customers.map(customer => customer.id);
    const jobs: QboSourceProject[] = customers.slice(1).map(job => ({
      key: "job:" + job.id, id: job.id, name: job.name, active: job.active, customerId: job.id, kind: "job",
    }));
    const native = await this.provider!.projects(access, setup.company.realm, new Set(ids), deadline);
    const projects = [...jobs, ...native];
    if (projects.length > 200) throw Error("QBO authorized project scope too large");
    const prior = new Set(binding.projects.map(project => project.key));
    return { ...binding, root: customers[0], customers: ids, projects, discoveredAt: new Date(this.now()).toISOString(),
      newlyDiscovered: projects.filter(project => !prior.has(project.key)).map(project => project.key) };
  }

  private async fence(lease: Awaited<ReturnType<QboInvoices["claim"]>>, next: Binding) {
    const customers = new Set(next.customers);
    const projects = new Set(next.projects.map(project => project.key));
    await this.guarded(lease, async tx => {
      const ref = this.mirror(lease.root);
      const mirror = (await tx.get(ref)).data() as Mirror | undefined;
      tx.update(lease.ref, { "setup.binding": next });
      if (mirror?.scope !== this.bindingScope(lease.scope, next)) return;
      const approvals = { ...mirror.approvals };
      for (const row of mirror.rows) {
        if (!customers.has(row.customerId) || row.sourceProjects?.some(key => !projects.has(key))) delete approvals[row.id];
      }
      tx.update(ref, { approvals });
    });
  }

  private async synchronize(authorize: Authorize, actor: string) {
    const lease = await this.claim(authorize);
    try {
      if (lease.setup && (!lease.setup.confirmed || !lease.setup.binding)) throw Error("QBO company and customer confirmation required");
      const access = await this.rotate(lease);
      const binding = lease.setup?.binding;
      let scope = lease.scope;
      let rows: InvoiceSource[];
      if (lease.setup && binding) {
        const company = lease.setup.company;
        const deadline = AbortSignal.timeout(120_000);
        let next: Binding;
        try {
          next = await this.discover(access, lease.setup, binding, deadline);
        } catch (error) {
          if (error instanceof Error && error.message === "QBO root customer changed")
            await this.fence(lease, { ...binding, customers: [], projects: [], newlyDiscovered: [] });
          throw error;
        }
        const keys = new Set(next.projects.map(project => project.key));
        // Apply the verified access fence before fetching invoices. The successful mirror is replaced only after every page.
        await this.fence(lease, next);
        scope = this.bindingScope(lease.scope, binding);
        const discovered = await this.provider!.forScope(company.realm, next.customers, company.currency).invoices(
          access, { keys, aliases: projectAliases(next.projects) }, deadline,
        );
        rows = discovered.filter(row => !row.unverifiedProjects).map(row => ({ ...row, projectIds: projectLinks(row, binding.links) }));
        await this.guarded(lease, async tx => {
          tx.update(lease.ref, { "setup.binding.held": discovered.length - rows.length });
        });
      } else {
        rows = await this.provider!.invoices(access);
      }
      const syncedAt = new Date(this.now()).toISOString();
      await this.guarded(lease, async tx => {
        const ref = this.mirror(lease.root);
        const previous = (await tx.get(ref)).data() as Mirror | undefined;
        const approvals = Object.fromEntries(rows.filter(row => previous?.scope === scope &&
          revisionOf(previous.approvals[row.id]) === invoiceRevision(row) &&
          (row.projectIds.length || audienceOf(previous.approvals[row.id])?.length)).map(row => [row.id, previous!.approvals[row.id]]));
        const doc = { scope, rows, approvals, syncedAt, configRevision: this.configRevision() };
        if (Buffer.byteLength(JSON.stringify(doc), "utf8") > 700_000) throw Error("QBO invoice scope too large");
        tx.set(ref, doc);
        tx.update(lease.ref, { busy: null, lastFailedAt: null });
        this.audit(tx, lease.root, actor, "qbo-invoices-synced", lease.root.id);
      });
      return { count: rows.length };
    } catch (error) {
      await this.guarded(lease, async tx => {
        tx.update(lease.ref, { lastFailedAt: new Date(this.now()).toISOString() });
        this.audit(tx, lease.root, actor, "qbo-invoices-sync-failed", lease.root.id);
      }).catch(() => undefined);
      throw error;
    } finally { await this.release(lease); }
  }
  async disconnect(tenant: string, who: VerifiedIdentity) {
    const lease = await this.claim(tx => this.operator(tx, tenant, who));
    try {
      await this.provider!.revoke(this.unseal(lease.token!, lease.scope));
      await this.guarded(lease, async tx => {
        tx.delete(lease.ref);
        tx.delete(this.mirror(lease.root));
        this.audit(tx, lease.root, who.subject, "qbo-invoices-disconnected", tenant);
      });
      return { ok: true };
    } finally { await this.release(lease); }
  }
}
