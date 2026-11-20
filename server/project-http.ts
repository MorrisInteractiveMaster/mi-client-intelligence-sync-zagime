import { portfolioLimits, type PortfolioSection } from "../src/projects/portfolio";
import type { IncomingMessage } from "node:http";
import type { ProjectBackend } from "./project-workspace";
import type { TimeSync } from "./time-sync";
import { sourceFilterKeys } from "./source-page";
import type { SourceFilters } from "../src/api/types";
/** Called only after common origin, rate, identity-header and preview gates. */
export async function projectRequest(
  backend: ProjectBackend,
  req: IncomingMessage,
  readBody: () => Promise<Record<string, any>>,
  time?: TimeSync,
  disconnected?: AbortSignal,
) {
  const url = new URL(req.url!, "http://local");
  const control = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/control$/.exec(url.pathname);
  if (control) {
    if (url.search) throw Error("Invalid query");
    const token = req.headers.authorization ?? "";
    if (req.method === "GET") return { status: 200, body: await backend.control(token, control[1]) };
    if (req.method === "PATCH") {
      const update = await readBody();
      if (Object.keys(update).some(key => key !== "settings" && key !== "expectedRevision") ||
         !Number.isSafeInteger(update.expectedRevision) || update.expectedRevision < 1 || !update.settings)
        throw Error("Invalid portal settings");
      return { status: 200, body: await backend.control(token, control[1], { expectedRevision: update.expectedRevision, settings: update.settings }) };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  const bulkAllocation = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/allocations\/bulk$/.exec(url.pathname);
  if (bulkAllocation && req.method === "POST") {
    if (url.search) throw Error("Invalid bulk allocation query");
    const idempotency = req.headers["idempotency-key"];
    return { status: 200, body: await backend.allocateBulk(
      req.headers.authorization ?? "",
      bulkAllocation[1],
      await readBody(),
      typeof idempotency === "string" ? idempotency : "",
      disconnected,
    ) };
  }
  const employeeMappings = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/directory\/employee-mappings$/.exec(url.pathname);
  if (employeeMappings) {
    const tenant = employeeMappings[1], token = req.headers.authorization ?? "";
    if (req.method === "GET") {
      const cursor = url.searchParams.get("cursor");
      if ([...url.searchParams.keys()].some(k => k !== "cursor") || url.searchParams.getAll("cursor").length > 1 ||
          (cursor !== null && !/^[A-Za-z0-9_-]{1,256}$/.test(cursor))) throw Error("Invalid employee mapping page");
      return { status: 200, body: await backend.employeeMappings(token, tenant, cursor ?? undefined) };
    }
    if (req.method === "PATCH" && !url.search)
      return { status: 200, body: await backend.changeEmployeeMapping(token, tenant, await readBody()) };
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  const directorySync = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/directory\/wordpress-sync$/.exec(url.pathname);
  if (directorySync) {
    if (url.search || req.method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
    if (Object.keys(await readBody()).length) throw Error("Invalid directory request");
    return { status: 200, body: await backend.syncDirectory(req.headers.authorization ?? "", directorySync[1]) };
  }
  const preview = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/client-preview(?:\/(scopes))?$/.exec(url.pathname);
  if (preview) {
    if (req.method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
    const token = req.headers.authorization ?? "";
    if (preview[2]) {
      if (url.search) throw Error("Invalid query");
      return { status: 200, body: await backend.previewScopes(token, preview[1]) };
    }
    const mode = url.searchParams.get("mode");
    const scope = url.searchParams.get("scope") ?? undefined;
    if ((mode !== "published" && mode !== "draft") || (mode === "draft" && Boolean(scope)) ||
      [...url.searchParams.keys()].some(key => !["month", "mode", "scope"].includes(key) || url.searchParams.getAll(key).length !== 1))
      throw Error("Invalid preview query");
    const report = await backend.report(token, preview[1], url.searchParams.get("month") ?? "", { mode, scope });
    const sourceUpdatedAt = mode === "published" ? await time?.reportFreshness(preview[1]) : undefined;
    return { status: 200, body: sourceUpdatedAt ? { ...report, sourceUpdatedAt } : report };
  }
  const timeRoute =
    /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/time(?:\/(mapping|sync))?$/.exec(
      url.pathname,
    );
  if (timeRoute && time) {
    const [, tenant, action] = timeRoute;
    const month = url.searchParams.get("month");
    const project = url.searchParams.get("project");
    if (
      url.search &&
      (action ||
        req.method !== "GET" ||
        [...url.searchParams.keys()].some(
          (k) =>
            !["month", "project"].includes(k) ||
            url.searchParams.getAll(k).length !== 1,
        ) ||
        (project !== null && !/^[-a-zA-Z0-9_]{1,128}$/.test(project)) ||
        !month ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    )
      throw Error("Invalid query");
    const who = await backend.identity(req.headers.authorization ?? "");
    if (!action && req.method === "GET")
      return {
        status: 200,
        body: await time.status(
          tenant,
          who,
          month ?? undefined,
          project ?? undefined,
        ),
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
            ? await time.approve(tenant, who, body.jobcodeId, body.projectId, disconnected)
            : await time.sync(tenant, who, body.jobcodeId, disconnected),
      };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  const portfolio = /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/portfolio$/.exec(url.pathname);
  if (portfolio) {
    if ([...url.searchParams].some(([k]) => k !== "month") || url.searchParams.getAll("month").length > 1 || (url.search && req.method !== "GET"))
      throw Error("Invalid query");
    const tenant = portfolio[1], token = req.headers.authorization ?? "";
    if (req.method === "GET") return { status: 200, body: await backend.portfolio(token, tenant, undefined, url.searchParams.get("month") ?? undefined) };
    if (req.method === "PATCH") {
      const input = await readBody();
      if (!Object.hasOwn(portfolioLimits, input.section) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 ||
          Object.keys(input).some(k => !["section", "record", "expectedRevision"].includes(k)))
        throw Error("Invalid portfolio request");
      return { status: 200, body: await backend.portfolio(token, tenant, {
        section: input.section as PortfolioSection, record: input.record, expectedRevision: input.expectedRevision,
      }) };
    }
    return { status: 405, body: { error: "method_not_allowed" } };
  }
  const m =
    /^\/api\/v2\/tenants\/([-a-zA-Z0-9_]{1,128})\/(workspace|report|projects|sources|allocations|audits)(?:\/([-a-zA-Z0-9_]{1,128}))?(?:\/(publication|history|draft))?$/.exec(
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
  const sourceList = req.method === "GET" && resource === "sources" && !id && !action;
  if (
    queryKeys.some(
      (k) =>
        !(
          (k === "search" &&
            req.method === "GET" &&
            resource === "projects" &&
            !id) ||
          (sourceList && sourceFilterKeys.some(field => field === k)) ||
          ["month", "limit", "cursor"].includes(k)
        ) || url.searchParams.getAll(k).length !== 1,
    )
  )
    throw Error("Invalid query");
  const page = {
    month: url.searchParams.get("month") ?? "",
    limit: Number(url.searchParams.get("limit") ?? 25),
    ...(url.searchParams.has("search")
      ? { search: url.searchParams.get("search")! }
      : {}),
    ...(url.searchParams.has("cursor")
      ? { cursor: url.searchParams.get("cursor")! }
      : {}),
    ...(sourceList ? { sourceFilters: Object.fromEntries(sourceFilterKeys.filter(field => field !== "search" && url.searchParams.has(field))
      .map(field => [field, url.searchParams.get(field)!])) as SourceFilters } : {}),
  };
  const ok = (body: unknown, status = 200) => ({ status, body });
  if (req.method === "GET") {
    if (resource === "workspace" && !id && !url.search)
      return ok(await backend.workspace(token, tenant));
    if (resource === "report" && !id && queryKeys.every((k) => k === "month")) {
      const report = await backend.report(token, tenant, page.month);
      const sourceUpdatedAt = await time?.reportFreshness(tenant);
      return ok(sourceUpdatedAt ? { ...report, sourceUpdatedAt } : report);
    }
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
      if (action === "draft") {
        only(b, ["expectedRevision", "action"]);
        if (b.action !== "publish" && b.action !== "discard") throw Error("Invalid draft action");
        return ok(await backend.save(token, tenant, undefined, { id, expectedRevision: b.expectedRevision, draftAction: b.action }));
      }
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
      only(b, ["expectedRevision", "portions", "expectedSourceRevision", "annotations"]);
      const review = b.expectedSourceRevision === undefined && b.annotations === undefined ? undefined :
        { expectedSourceRevision: b.expectedSourceRevision, annotations: b.annotations };
      return ok(
        await backend.allocate(
          token,
          tenant,
          id,
          b.expectedRevision,
          b.portions,
          review,
        ),
      );
    }
  }
  return { status: 405, body: { error: "method_not_allowed" } };
}
