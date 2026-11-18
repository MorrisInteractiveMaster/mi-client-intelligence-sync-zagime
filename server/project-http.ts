import type { IncomingMessage } from "node:http";
import type { ProjectBackend } from "./project-workspace";
import type { TimeSync } from "./time-sync";
/** Called only after common origin, rate, identity-header and preview gates. */
export async function projectRequest(
  backend: ProjectBackend,
  req: IncomingMessage,
  readBody: () => Promise<Record<string, any>>,
  time?: TimeSync,
) {
  const url = new URL(req.url!, "http://local");
  const timeRoute =
    /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/time(?:\/(mapping|sync))?$/.exec(
      url.pathname,
    );
  if (timeRoute && time) {
    const [, tenant, action] = timeRoute;
    const month = url.searchParams.get("month");
    if (
      url.search &&
      (action ||
        req.method !== "GET" ||
        [...url.searchParams.keys()].length !== 1 ||
        !month ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    )
      throw Error("Invalid query");
    const who = await backend.identity(req.headers.authorization ?? "");
    if (!action && req.method === "GET")
      return {
        status: 200,
        body: await time.status(tenant, who, month ?? undefined),
      };
    if (action && req.method === "POST") {
      const body = await readBody();
      if (
        typeof body.jobcodeId !== "string" ||
        Object.keys(body).some(
          (k) =>
            !(
              action === "mapping" ? ["jobcodeId", "projectId"] : ["jobcodeId"]
            ).includes(k),
        )
      )
        throw Error("Invalid Time request");
      if (action === "mapping" && typeof body.projectId !== "string")
        throw Error("Invalid project ID");
      return {
        status: 200,
        body:
          action === "mapping"
            ? await time.approve(tenant, who, body.jobcodeId, body.projectId)
            : await time.sync(tenant, who, body.jobcodeId),
      };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  const m =
    /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/(workspace|report|projects|sources|allocations|audits)(?:\/([-a-zA-Z0-9_]{1,128}))?(?:\/(publication|history))?$/.exec(
      url.pathname,
    );
  if (!m) return { status: 404, body: { error: "not_found" } };
  const [, tenant, resource, id, action] = m;
  const token = req.headers.authorization ?? "";
  const only = (b: Record<string, any>, fields: string[]) => {
    if (!b || Object.keys(b).some((k) => !fields.includes(k)))
      throw Error("Invalid fields");
  };
  const queryKeys = [...url.searchParams.keys()];
  if (
    queryKeys.some(
      (k) =>
        !["month", "limit", "cursor"].includes(k) ||
        url.searchParams.getAll(k).length !== 1,
    )
  )
    throw Error("Invalid query");
  const page = {
    month: url.searchParams.get("month") ?? "",
    limit: Number(url.searchParams.get("limit") ?? 25),
    ...(url.searchParams.has("cursor")
      ? { cursor: url.searchParams.get("cursor")! }
      : {}),
  };
  const ok = (body: unknown, status = 200) => ({ status, body });
  if (req.method === "GET") {
    if (resource === "workspace" && !id && !url.search)
      return ok(await backend.workspace(token, tenant));
    if (resource === "report" && !id && queryKeys.every((k) => k === "month"))
      return ok(await backend.report(token, tenant, page.month));
    if (resource === "projects" && id && !action && !url.search)
      return ok(await backend.detail(token, tenant, id));
    if (["projects", "sources", "audits"].includes(resource) && !id && !action)
      return ok(
        await backend.page(
          token,
          tenant,
          resource as "projects" | "sources" | "audits",
          page,
        ),
      );
    if (resource === "sources" && id && action === "history")
      return ok(
        await backend.page(token, tenant, "history", { ...page, sourceId: id }),
      );
  }
  if (url.search) throw Error("Invalid query");
  if (req.method === "POST" && resource === "projects" && !id) {
    const b = await readBody();
    return ok(
      await backend.save(token, tenant, b, {
        idempotency:
          typeof req.headers["idempotency-key"] === "string"
            ? req.headers["idempotency-key"]
            : "",
      }),
      201,
    );
  }
  if (req.method === "PATCH" && id) {
    const b = await readBody();
    if (!Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
      throw Error("Invalid revision");
    if (resource === "projects") {
      only(
        b,
        action === "publication"
          ? ["expectedRevision", "published"]
          : ["expectedRevision", "patch"],
      );
      if (action && action !== "publication") throw Error("Invalid action");
      if (action === "publication" && typeof b.published !== "boolean")
        throw Error("Invalid publication");
      return ok(
        await backend.save(token, tenant, b.patch, {
          id,
          expectedRevision: b.expectedRevision,
          ...(action === "publication" ? { published: b.published } : {}),
        }),
      );
    }
    if (resource === "allocations" && !action) {
      only(b, ["expectedRevision", "portions"]);
      return ok(
        await backend.allocate(
          token,
          tenant,
          id,
          b.expectedRevision,
          b.portions,
        ),
      );
    }
  }
  return { status: 405, body: { error: "method_not_allowed" } };
}
