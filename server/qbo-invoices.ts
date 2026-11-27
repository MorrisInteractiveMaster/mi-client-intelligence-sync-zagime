import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import type { DocumentReference, Transaction } from "firebase-admin/firestore";
import { deliveryDate } from "../src/projects/delivery";
import { invoiceFreshness, type Invoice, type InvoiceView } from "../src/projects/invoices";
import type { VerifiedIdentity } from "./contracts";
import type { ProjectStore } from "./project-workspace";
import { assertProductionTenant, assertProjectDatabase } from "./database-target";
import { key } from "./firestore-store";
import { numericQboId, type InvoiceSource, type QboInvoicesProvider } from "./qbo-invoices-provider";

type Approval = string | { revision: string; audience: string[] };
type Mirror = { scope: string; syncedAt: string; rows: InvoiceSource[]; approvals: Record<string, Approval> };
const revisionOf = (approval?: Approval) => typeof approval === "string" ? approval : approval?.revision;
const audienceOf = (approval?: Approval) => typeof approval === "object" ? approval.audience : undefined;
type Authorize = (tx: Transaction) => Promise<{ root: DocumentReference; scope: string }>;
type Connection = {
  scope?: string; token?: string; lastFailedAt?: string; busy?: { id: string; expires: number };
  pending?: { hash: string; actor: string; expires: number };
};

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const invoiceRevision = (row: InvoiceSource) => digest(JSON.stringify([
  row.id, row.customerId, row.number, row.txnDate, row.dueDate, row.currency, row.total, row.projectIds,
]));
const shortId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

export class QboInvoices {
  constructor(private store: ProjectStore, private provider?: QboInvoicesProvider, private now = Date.now) {}
  private scope(tenant: string) {
    const cfg = this.provider?.config;
    return cfg?.tenant === tenant ? digest(JSON.stringify([tenant, cfg.realm, cfg.sandbox, [...cfg.customerIds].sort()])) : undefined;
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
      const result: InvoiceView = { ...empty, ...(staff && { connected: connection?.scope === scope && Boolean(connection.token) }) };
      if (!mirror || mirror.scope !== scope || mirrorSnapshot.get("configRevision") !== this.configRevision()) return result;
      const grants = new Set(request.preview ? await this.store.clientPreviewProjectIds(tx, a.root, request.scope) : a.projectIds);
      const names = await this.projectNames(tx, a.root, [...new Set(mirror.rows.flatMap(row => row.projectIds))].filter(id => staff || grants.has(id)), !staff);
      result.syncedAt = mirror.syncedAt;
      result.freshness = connection?.scope !== scope || !connection.token ? "stale" : invoiceFreshness(this.now(), mirror.syncedAt, connection.lastFailedAt);
      const member = request.preview ? request.scope : key(who.subject);
      result.invoices = mirror.rows.flatMap(row => {
        const revision = invoiceRevision(row);
        const approval = mirror.approvals[row.id];
        const audience = audienceOf(approval);
        const approved = revisionOf(approval) === revision && (row.projectIds.length > 0 || Boolean(audience?.length));
        const allowed = row.projectIds.length ? row.projectIds.every(id => names.has(id)) : Boolean(member && audience?.includes(member));
        if (!staff && (!approved || !allowed)) return [];
        // Finance notes and QBO identifiers belong to the staff projection exclusively.
        const view: Invoice = { id: staff ? row.id : digest(scope + ":" + row.id), number: row.number,
          txnDate: row.txnDate, ...(row.dueDate && { dueDate: row.dueDate }), currency: row.currency,
          total: row.total, balance: row.balance, projects: row.projectIds.map(id => ({ id, name: names.get(id) ?? "Unavailable project" })),
          ...(staff && { customer: row.customer ?? row.customerId, ...(row.note && { note: row.note }), approval: { approved, revision, ...(audience?.length && { audience }) } }),
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
      const snap = await tx.get(ref);
      const mirror = snap.data() as Mirror | undefined;
      const row = mirror?.scope === scope && snap.get("configRevision") === this.configRevision() && mirror.rows.find(candidate => candidate.id === id);
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
        if (callback.realm !== this.provider!.config.realm || !current?.pending || current.pending.actor !== callback.actor ||
            current.pending.expires <= this.now() || current.pending.hash !== digest(callback.state)) throw Error("Forbidden");
      } else if (current?.scope !== scope || !current.token) throw Error("QBO invoices unavailable");
      const busy = { id, expires: this.now() + 600_000 };
      tx.set(ref, { ...current, busy, ...(callback && { pending: null }) });
      return { id, root, ref, scope, token: current?.token };
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
      await this.guarded(lease, async tx => {
        tx.update(lease.ref, { scope: lease.scope, token: this.seal(token.refresh, lease.scope), busy: null });
        this.audit(tx, lease.root, who.subject, "qbo-invoices-connected", tenant);
      });
      return { ok: true };
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
  private async synchronize(authorize: Authorize, actor: string) {
    const lease = await this.claim(authorize);
    try {
      const token = await this.provider!.token({ refresh: this.unseal(lease.token!, lease.scope) });
      await this.guarded(lease, async tx => {
        tx.update(lease.ref, { token: this.seal(token.refresh, lease.scope) });
      });
      const rows = await this.provider!.invoices(token.access);
      const syncedAt = new Date(this.now()).toISOString();
      await this.guarded(lease, async tx => {
        const ref = this.mirror(lease.root);
        const previous = (await tx.get(ref)).data() as Mirror | undefined;
        const approvals = Object.fromEntries(rows.filter(row => previous?.scope === lease.scope &&
          revisionOf(previous.approvals[row.id]) === invoiceRevision(row) &&
          (row.projectIds.length || audienceOf(previous.approvals[row.id])?.length)).map(row => [row.id, previous!.approvals[row.id]]));
        const doc = { scope: lease.scope, rows, approvals, syncedAt, configRevision: this.configRevision() };
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
