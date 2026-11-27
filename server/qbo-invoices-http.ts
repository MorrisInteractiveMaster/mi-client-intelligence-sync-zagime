import type { IncomingMessage } from "node:http";
import type { ProjectBackend } from "./project-workspace";
import type { QboInvoices } from "./qbo-invoices";

export async function invoiceRequest(service: QboInvoices, backend: ProjectBackend, req: IncomingMessage, readBody: () => Promise<Record<string, unknown>>) {
  const url = new URL(req.url!, "http://localhost");
  const match = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/invoices(?:\/(connect|callback|sync|disconnect|approval|discovery))?$/.exec(url.pathname);
  if (!match) return;
  const [, tenant, action] = match;
  const who = await backend.identity(req.headers.authorization ?? "");
  if (!action && req.method === "GET") {
    const preview = url.searchParams.get("preview");
    const scope = url.searchParams.get("scope") ?? undefined;
    if (preview !== null && preview !== "published" || scope && (!preview || !/^[-a-zA-Z0-9_]{1,128}$/.test(scope)) ||
      [...url.searchParams.keys()].some(k => !["preview", "scope"].includes(k) || url.searchParams.getAll(k).length !== 1))
      throw Error("Invalid invoice view");
    return { status: 200, body: await service.read(tenant, who, { preview: preview === "published", scope }) };
  }
  if (req.method !== "POST" || !action || url.search) return { status: 405, body: { error: "method_not_allowed" } };
  const input = await readBody();
  const fields = action === "callback" ? ["state", "realm", "code"] : action === "approval" ? ["id", "revision", "approved", "audience"] :
    action === "discovery" ? ["action", "realm", "rootId", "term", "page", "bindingId", "source", "projectId"] :
    action === "disconnect" ? ["confirm"] : [];
  if (Object.keys(input).some(key => !fields.includes(key))) throw Error("Invalid invoice request");
  if (action === "disconnect" && input.confirm !== true) throw Error("Invalid invoice disconnect confirmation");
  const body = action === "discovery" ? await service.discovery(tenant, who, input) : action === "approval" ? await service.approve(tenant, who, input) : action === "callback" ? await service.callback(tenant, who, input) :
    action === "connect" ? await service.connect(tenant, who) : action === "sync" ? await service.sync(tenant, who) : await service.disconnect(tenant, who);
  return { status: 200, body };
}
