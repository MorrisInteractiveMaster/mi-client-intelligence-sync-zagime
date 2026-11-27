import { invoiceFraction } from "../src/projects/invoices";
import { calendarDate } from "../src/projects/delivery";

export type InvoiceSource = {
  id: string; number: string; customerId: string; customer?: string; note?: string;
  txnDate: string; dueDate?: string; currency: string; total: number; balance: number;
  projectIds: string[];
};
export type InvoiceMapping = { projectId: string; qboProjectId?: string; workOrder?: string };
export type QboConfig = {
  tenant: string; realm: string; customerIds: string[]; currency: string; mappings: InvoiceMapping[];
  clientId: string; clientSecret: string; key: Buffer; redirect: string; sandbox: boolean;
};
type Ref = { value?: string; name?: string };
type Line = { Description?: string; SalesItemLineDetail?: { ProjectRef?: Ref }; GroupLineDetail?: { Line?: Line[] } };
type Entity = {
  Id?: string; DocNumber?: string; CustomerRef?: Ref; ProjectRef?: Ref; CurrencyRef?: Ref; TxnDate?: string;
  DueDate?: string; TotalAmt?: number; Balance?: number; PrivateNote?: string; Line?: Line[]; TxnStatus?: string;
};
const currencies = new Set(Intl.supportedValuesOf("currency"));
export const numericQboId = (value: unknown): value is string => typeof value === "string" && /^\d{1,32}$/.test(value);
const localId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const boundedText = (value: unknown, size: number) => typeof value === "string" ? value.trim().slice(0, size) : "";

export function qboConfig(env: NodeJS.ProcessEnv, mode: string): QboConfig | undefined {
  if (env.QBO_INVOICES_ENABLED !== "true") return;
  const tenant = env.QBO_INVOICES_TENANT;
  const realm = env.QBO_INVOICES_REALM;
  const currency = env.QBO_INVOICES_CURRENCY ?? "";
  const customerIds = [...new Set((env.QBO_INVOICES_CUSTOMER_IDS ?? "").split(",").map(value => value.trim()))];
  const clientId = env.QBO_INVOICES_CLIENT_ID;
  const clientSecret = env.QBO_INVOICES_CLIENT_SECRET;
  const key = Buffer.from(env.QBO_INVOICES_TOKEN_KEY ?? "", "base64");
  const origin = env.ALLOWED_ORIGIN ?? "";
  const sandbox = env.QBO_INVOICES_SANDBOX === "true";
  const mappings: InvoiceMapping[] = JSON.parse(env.QBO_INVOICES_PROJECT_MAP ?? "[]");
  if (!localId(tenant) || !numericQboId(realm) || !currencies.has(currency) || !customerIds.every(numericQboId) ||
      customerIds.length > 30 || !clientId || !clientSecret || key.length !== 32 ||
      !/^https:\/\/[a-z0-9.-]+$/.test(origin) || (mode === "production" ? sandbox : !sandbox) ||
      !Array.isArray(mappings) || mappings.length > 100 || mappings.some(mapping => !mapping ||
        !localId(mapping.projectId) || (!mapping.qboProjectId && !mapping.workOrder) ||
        (mapping.qboProjectId !== undefined && !numericQboId(mapping.qboProjectId)) ||
        (mapping.workOrder !== undefined && !/^[A-Z0-9.-]{2,32}$/i.test(mapping.workOrder))) ||
      new Set(mappings.flatMap(row => row.qboProjectId ? [row.qboProjectId] : [])).size !== mappings.filter(row => row.qboProjectId).length ||
      new Set(mappings.flatMap(row => row.workOrder ? [row.workOrder.toUpperCase()] : [])).size !== mappings.filter(row => row.workOrder).length)
    throw Error("Invalid QBO invoices configuration");
  return { tenant, realm, customerIds, currency, mappings, clientId, clientSecret, key, sandbox, redirect: origin + "/qbo-invoice-callback.html" };
}

function minorUnits(value: unknown, currency: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw Error("Invalid QBO invoice amounts");
  const scaled = value * 10 ** invoiceFraction(currency);
  const minor = Math.round(scaled);
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > Number.MAX_SAFE_INTEGER / 500 || Math.abs(scaled - minor) > 0.00001) throw Error("Invalid QBO invoice amount precision");
  return minor;
}

export function projectInvoice(row: Entity, config: QboConfig): InvoiceSource | undefined {
  const id = row.Id, customerId = row.CustomerRef?.value;
  if (!numericQboId(id) || !numericQboId(customerId) || !config.customerIds.includes(customerId)) throw Error("QBO invoice scope mismatch");
  // QBO marks a void with zero amounts and prepends “Voided” to the private note.
  if (row.TxnStatus?.toLowerCase() === "voided" ||
      (row.TotalAmt === 0 && row.Balance === 0 && /^Voided\b/i.test(row.PrivateNote ?? ""))) return;
  const currency = row.CurrencyRef?.value ?? config.currency;
  if (!currencies.has(currency) || !calendarDate(row.TxnDate) || (row.DueDate && !calendarDate(row.DueDate)))
    throw Error("Invalid QBO invoice dates or currency");
  const refs = new Set([customerId, row.ProjectRef?.value]);
  const descriptions: string[] = [];
  function inspect(lines: Line[] | undefined, depth = 0) {
    if (depth > 5 || !Array.isArray(lines)) return;
    for (const line of lines) {
      if (line.SalesItemLineDetail?.ProjectRef?.value) refs.add(line.SalesItemLineDetail.ProjectRef.value);
      if (typeof line.Description === "string") descriptions.push(line.Description.slice(0, 2000));
      inspect(line.GroupLineDetail?.Line, depth + 1);
    }
  }
  inspect(row.Line);
  const projectIds = [...new Set(config.mappings.filter(({ qboProjectId, workOrder }) =>
    (qboProjectId && refs.has(qboProjectId)) || (workOrder && descriptions.some(description =>
      new RegExp("(^|[^a-z0-9.])" + workOrder.replaceAll(".", "\\.") + "(?![a-z0-9]|\\.[a-z0-9])", "i").test(description)))
  ).map(mapping => mapping.projectId))].sort();
  return { id, customerId, currency, txnDate: row.TxnDate!, number: boundedText(row.DocNumber, 64),
    ...(row.DueDate && { dueDate: row.DueDate }), ...(row.CustomerRef?.name && { customer: boundedText(row.CustomerRef.name, 160) }),
    ...(row.PrivateNote && { note: boundedText(row.PrivateNote, 500) }),
    total: minorUnits(row.TotalAmt, currency), balance: minorUnits(row.Balance, currency), projectIds };
}

export class QboInvoicesProvider {
  constructor(readonly config: QboConfig, private request: typeof fetch = fetch) {}
  authorizationUrl(state: string) {
    return "https://appcenter.intuit.com/connect/oauth2?" + new URLSearchParams({
      client_id: this.config.clientId, redirect_uri: this.config.redirect, response_type: "code",
      scope: "com.intuit.quickbooks.accounting", state,
    });
  }
  private async oauth(path: string, body: URLSearchParams) {
    return this.request("https://oauth.platform.intuit.com/oauth2/v1/" + path, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json", authorization: "Basic " + Buffer.from(this.config.clientId + ":" + this.config.clientSecret).toString("base64") },
      body,
    });
  }
  async token(grant: { code: string } | { refresh: string }) {
    const response = await this.oauth("tokens/bearer", new URLSearchParams("code" in grant
      ? { grant_type: "authorization_code", code: grant.code, redirect_uri: this.config.redirect }
      : { grant_type: "refresh_token", refresh_token: grant.refresh }));
    if (!response.ok) throw Error("QBO authorization unavailable");
    const data = await response.json();
    if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" ||
        !data.access_token || !data.refresh_token || data.access_token.length > 8192 || data.refresh_token.length > 8192)
      throw Error("QBO authorization unavailable");
    return { access: data.access_token as string, refresh: data.refresh_token as string };
  }
  async revoke(token: string) {
    const response = await this.request("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "content-type": "application/json", authorization: "Basic " + Buffer.from(this.config.clientId + ":" + this.config.clientSecret).toString("base64") },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw Error("QBO revocation unavailable");
  }
  async invoices(access: string): Promise<InvoiceSource[]> {
    const host = this.config.sandbox ? "sandbox-quickbooks.api.intuit.com" : "quickbooks.api.intuit.com";
    const rows = new Map<string, InvoiceSource>();
    const seen = new Set<string>();
    const pageSize = 100;

    const deadline = AbortSignal.timeout(75_000);
    for (const customerId of this.config.customerIds) for (let start = 1; start <= 501; start += pageSize) {
      const query = "select * from Invoice where CustomerRef = '" + customerId + "' startposition " + start + " maxresults " + pageSize;
      const response = await this.request("https://" + host + "/v3/company/" + this.config.realm + "/query?" + new URLSearchParams({ query }), {
        headers: { accept: "application/json", authorization: "Bearer " + access }, redirect: "error",
        signal: AbortSignal.any([deadline, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok) throw Error("QBO invoice query unavailable");
      const body = await response.json();
      const result = body?.QueryResponse;
      const page = result?.Invoice ?? [];
      if (!result || typeof result !== "object" || Array.isArray(result) || !Array.isArray(page) ||
          page.length > pageSize || Object.keys(result).some(field => !["Invoice", "startPosition", "maxResults", "totalCount"].includes(field)))
        throw Error("Invalid QBO invoice response");
      if (start > 500 && page.length) throw Error("QBO invoice scope too large");
      for (const item of page) {
        const invoice = projectInvoice(item, this.config);
        if (item.CustomerRef?.value !== customerId) throw Error("QBO invoice scope mismatch");
        if (seen.has(item.Id)) throw Error("QBO invoices changed while paging");
        seen.add(item.Id);
        if (seen.size > 500) throw Error("QBO invoice scope too large");
        if (invoice) rows.set(invoice.id, invoice);
      }
      if (page.length < pageSize) break;
    }
    return [...rows.values()];
  }
}
