import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { ReportingBackend } from "./backend";
const MAX_BYTES = 16384;
export class RequestLimit {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(
    private readonly maximum = 60,
    private readonly now = () => Date.now(),
  ) {}
  accept(ip: string) {
    const now = this.now();
    for (const [k, v] of this.entries)
      if (v.until <= now) this.entries.delete(k);
    let v = this.entries.get(ip);
    if (!v) {
      if (this.entries.size >= 10000) return false;
      v = { count: 0, until: now + 60000 };
      this.entries.set(ip, v);
    }
    return ++v.count <= this.maximum;
  }
}
function send(res: ServerResponse, status: number, body: unknown) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw Error("Invalid content type");
  if (Number(req.headers["content-length"] ?? 0) > MAX_BYTES)
    throw Error("Payload too large");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Error("Payload too large");
    chunks.push(chunk);
  }
  try {
    const b = JSON.parse(Buffer.concat(chunks).toString());
    if (
      !b ||
      typeof b !== "object" ||
      Array.isArray(b) ||
      Object.keys(b).some((k) =>
        ["__proto__", "prototype", "constructor"].includes(k),
      )
    )
      throw Error();
    return b;
  } catch {
    throw Error("Invalid JSON");
  }
}
const only = (value: Record<string, unknown>, keys: string[]) => {
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw Error("Invalid payload fields");
};
export function apiServer(
  backend: ReportingBackend,
  options: { allowedOrigin?: string; limit?: RequestLimit } = {},
) {
  const limit = options.limit ?? new RequestLimit();
  return createServer(async (req, res) => {
    try {
      if (!limit.accept(req.socket.remoteAddress ?? "unknown"))
        return send(res, 429, { error: "rate_limited" });
      if (req.headers.origin && req.headers.origin !== options.allowedOrigin)
        return send(res, 403, { error: "forbidden" });
      if (req.url === "/healthz" && req.method === "GET")
        return send(res, 200, { status: "ready" });
      if (
        req.headers.origin === options.allowedOrigin &&
        options.allowedOrigin
      ) {
        res.setHeader("access-control-allow-origin", options.allowedOrigin);
        res.setHeader("vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.setHeader("access-control-allow-methods", "GET,POST,PATCH");
        res.setHeader(
          "access-control-allow-headers",
          "Authorization,Content-Type",
        );
        return send(res, 204, null);
      }
      const authorization = req.headers.authorization ?? "";
      if (!/^Bearer [^\s]{1,8192}$/.test(authorization))
        return send(res, 401, { error: "unauthenticated" });
      if ((req.url?.length ?? 0) > 2048) throw Error("Invalid URL");
      const url = new URL(req.url!, "http://local");
      const match =
        /^\/api\/tenants\/([-a-zA-Z0-9_]{1,128})\/(report|projects|allocations)(?:\/([-a-zA-Z0-9_]{1,128}))?(?:\/(publication))?$/.exec(
          url.pathname,
        );
      if (!match) return send(res, 404, { error: "not_found" });
      const [, tenant, resource, id, publication] = match;
      if (req.method === "GET" && resource === "report" && !id) {
        if (
          [...url.searchParams.keys()].some(
            (k) => !["month", "agreementId"].includes(k),
          )
        )
          throw Error("Invalid query");
        return send(
          res,
          200,
          await backend.readPublished(authorization, tenant, {
            month: url.searchParams.get("month") ?? "",
            ...(url.searchParams.has("agreementId")
              ? { agreementId: url.searchParams.get("agreementId")! }
              : {}),
          }),
        );
      }
      if (
        req.method === "PATCH" &&
        resource === "allocations" &&
        id &&
        !publication
      ) {
        const b = await body(req);
        only(b, ["expectedRevision", "portions"]);
        if (!Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
          throw Error("Invalid revision");
        return send(
          res,
          200,
          await backend.allocateTime(
            authorization,
            tenant,
            id,
            b.expectedRevision,
            b.portions,
          ),
        );
      }
      if (req.method === "POST" && resource === "projects" && !id) {
        const b = await body(req);
        only(b, ["agreementId", "departmentId", "name", "plan"]);
        if (
          typeof b.name !== "string" ||
          b.name.length > 200 ||
          typeof b.agreementId !== "string" ||
          typeof b.departmentId !== "string" ||
          !b.plan ||
          typeof b.plan !== "object" ||
          Array.isArray(b.plan)
        )
          throw Error("Invalid project");
        only(b.plan, ["basis", "minutes"]);
        if (
          !["monthly", "fixed"].includes(b.plan.basis) ||
          !Number.isSafeInteger(b.plan.minutes) ||
          b.plan.minutes < 0
        )
          throw Error("Invalid plan");
        return send(
          res,
          201,
          await backend.createProject(authorization, tenant, b),
        );
      }
      if (req.method === "PATCH" && resource === "projects" && id) {
        const b = await body(req);
        only(
          b,
          publication
            ? ["expectedRevision", "published"]
            : ["expectedRevision", "patch"],
        );
        if (!Number.isSafeInteger(b.expectedRevision) || b.expectedRevision < 1)
          throw Error("Invalid revision");
        return send(
          res,
          200,
          publication
            ? await backend.publishProject(
                authorization,
                tenant,
                id,
                b.expectedRevision,
                b.published,
              )
            : await backend.editProject(
                authorization,
                tenant,
                id,
                b.expectedRevision,
                b.patch,
              ),
        );
      }
      return send(res, 405, { error: "method_not_allowed" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const [status, error] =
        msg === "Unauthenticated"
          ? [401, "unauthenticated"]
          : msg === "Forbidden" || msg === "Forbidden fields"
            ? [403, "forbidden"]
            : msg === "Revision conflict"
              ? [409, "revision_conflict"]
              : msg === "Payload too large"
                ? [413, "payload_too_large"]
                : msg.startsWith("Invalid") ||
                    msg.startsWith("Missing") ||
                    msg === "Allocated time exceeds source duration"
                  ? [400, "invalid_request"]
                  : [503, "temporarily_unavailable"];
      send(res, status as number, { error });
    }
  });
}
