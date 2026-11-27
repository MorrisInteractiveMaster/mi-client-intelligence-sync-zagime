import type { QboCompany, QboCustomer, QboSourceProject } from "../src/projects/qbo-discovery";
import type { QboConfig } from "./qbo-invoices-provider";

const numeric = (id: unknown): id is string => typeof id === "string" && /^\d{1,32}$/.test(id);
const label = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 250) : "";
const currencies = new Set(Intl.supportedValuesOf("currency"));
export const customerPageSize = 20;
type CustomerRow = { Id?: string; DisplayName?: string; Active?: boolean; Job?: boolean; ParentRef?: { value?: string } };

function customer(row: CustomerRow): QboCustomer {
  const name = label(row?.DisplayName);
  if (!numeric(row?.Id) || !name || (row.ParentRef !== undefined && !numeric(row.ParentRef.value)) ||
      (row.Job === true && !row.ParentRef)) throw Error("QBO customer identity invalid");
  return { id: row.Id, name, active: row.Active !== false, ...(row.ParentRef && { parentId: row.ParentRef.value }) };
}

export function customerQueryTerm(input: unknown) {
  if (typeof input !== "string" || /[\p{Cc}\p{Cf}]/u.test(input) || input.trim().length < 2 || input.length > 100)
    throw Error("Invalid customer search");
  // QBO treats percent as a wildcard. Narrow on a literal segment and verify the full term after the response.
  const literal = input.trim().normalize("NFC").split("%").sort((a, b) => b.length - a.length)[0];
  if (literal.length < 2) throw Error("Invalid customer search");
  return literal.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export function customerHierarchy(rows: QboCustomer[], root: string) {
  const byId = new Map(rows.map(row => [row.id, row]));
  const selected = byId.get(root);
  if (byId.size !== rows.length) throw Error("QBO customer inventory changed while paging");
  if (!selected || selected.parentId) throw Error("QBO root customer changed");
  const children = new Map<string, QboCustomer[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(row);
    children.set(row.parentId, siblings);
  }
  const descendants = [selected];
  for (const row of descendants) {
    descendants.push(...(children.get(row.id) ?? []));
    if (descendants.length > 100) throw Error("QBO authorized customer scope too large");
  }
  return descendants;
}

export class QboDiscoveryProvider {
  constructor(readonly config: QboConfig, protected request: typeof fetch = fetch) {}
  private async read(access: string, realm: string, path: string, signal?: AbortSignal) {
    if (!numeric(realm)) throw Error("QBO company identity invalid");
    const host = this.config.sandbox ? "sandbox-quickbooks.api.intuit.com" : "quickbooks.api.intuit.com";
    const result = await this.request("https://" + host + "/v3/company/" + realm + "/" + path, {
      headers: { accept: "application/json", authorization: "Bearer " + access },
      redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), ...(signal ? [signal] : [])]),
    });
    if (!result.ok) throw Error("QBO company metadata unavailable");
    return result.json();
  }
  async company(access: string, realm: string): Promise<QboCompany> {
    const [identity, preferences] = await Promise.all([
      this.read(access, realm, "companyinfo/" + realm), this.read(access, realm, "preferences"),
    ]);
    const name = label(identity.CompanyInfo?.CompanyName);
    const currency = preferences.Preferences?.CurrencyPrefs?.HomeCurrency?.value;
    if (!name || !currencies.has(currency)) throw Error("QBO company or home currency unavailable");
    return { realm, name, currency };
  }
  async customer(access: string, realm: string, id: string) {
    if (!numeric(id)) throw Error("Invalid QBO customer");
    const body = await this.read(access, realm, "customer/" + id);
    const parsed = customer(body.Customer);
    if (parsed.id !== id) throw Error("QBO customer identity mismatch");
    return parsed;
  }
  private async customerQuery(access: string, realm: string, statement: string, size: number, signal?: AbortSignal) {
    const body = await this.read(access, realm, "query?" + new URLSearchParams({ query: statement }), signal);
    const page = body.QueryResponse?.Customer ?? [];
    if (!body.QueryResponse || body.Fault || !Array.isArray(page) || page.length > size ||
      Object.keys(body.QueryResponse).some(key => !["Customer", "startPosition", "maxResults", "totalCount"].includes(key)))
      throw Error("QBO customer page invalid");
    return page.map(customer);
  }
  async search(access: string, realm: string, input: string, page: number) {
    const term = customerQueryTerm(input);
    const rows = await this.customerQuery(access, realm,
      "select * from Customer where Active in (true,false) and DisplayName like '%" + term +
      "%' orderby DisplayName startposition " + ((page - 1) * customerPageSize + 1) + " maxresults " + customerPageSize, customerPageSize);
    const exact = input.trim().normalize("NFC").toLocaleLowerCase();
    return { matches: rows.filter(row => !row.parentId && row.name.normalize("NFC").toLocaleLowerCase().includes(exact)),
      more: rows.length === customerPageSize && page < 25 };
  }
  async customers(access: string, realm: string, root: string, signal: AbortSignal) {
    const rows: QboCustomer[] = [];
    const size = 100;
    for (let offset = 0; offset <= 2500; offset += size) {
      const page = await this.customerQuery(access, realm, "select * from Customer where Active in (true,false) orderby DisplayName startposition " +
        (offset + 1) + " maxresults " + size, size, signal);
      if (offset === 2500 && page.length) throw Error("QBO customer inventory exceeds capacity");
      rows.push(...page);
      if (page.length < size) return customerHierarchy(rows, root);
    }
    throw Error("QBO customer inventory exceeds capacity");
  }
  async projects(access: string, realm: string, customers: Set<string>, signal: AbortSignal) {
    if (!this.config.nativeProjects) return [];
    const host = this.config.sandbox ? "qb-sandbox.api.intuit.com" : "qb.api.intuit.com";
    const projects: QboSourceProject[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let after: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = await this.request("https://" + host + "/graphql", {
        method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(12_000), signal]),
        headers: { authorization: "Bearer " + access, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          query: "query InvoiceProjects($first: PositiveInt!, $after: String, $filter: ProjectManagement_ProjectFilter!) { projectManagementProjects(first: $first, after: $after, filter: $filter) { edges { node { id name status customer { id } account { id } } } pageInfo { hasNextPage endCursor } } }",
          variables: { first: 50, after, filter: { customer: { in: [...customers].map(id => ({ id })) } } },
        }),
      });
      if (!response.ok) throw Error("QBO Projects scope unavailable");
      const payload = await response.json();
      const data = payload?.data?.projectManagementProjects;
      if (payload?.errors?.length || !Array.isArray(data?.edges) || data.edges.length > 50 ||
          typeof data?.pageInfo?.hasNextPage !== "boolean") throw Error("QBO project page invalid");
      for (const { node } of data.edges) {
        if (!numeric(node?.id) || node.account?.id !== realm || seen.has(node.id))
          throw Error("QBO project company mismatch or duplicate");
        seen.add(node.id);
        if (!customers.has(node.customer?.id)) continue;
        if (!label(node.name)) throw Error("QBO project name unavailable");
        projects.push({ key: "project:" + node.id, id: node.id, name: label(node.name), customerId: node.customer.id,
          active: !["COMPLETED", "CANCELLED", "CLOSED", "INACTIVE"].includes(node.status), kind: "project" });
      }
      if (!data.pageInfo.hasNextPage) return projects;
      after = data.pageInfo.endCursor;
      if (typeof after !== "string" || !after || after.length > 1024 || cursors.has(after) || !data.edges.length)
        throw Error("QBO project cursor invalid");
      cursors.add(after);
    }
    throw Error("QBO project inventory exceeds capacity");
  }
}
