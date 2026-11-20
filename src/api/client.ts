export interface Report {
  revision: number;
  month: string;
  tenant: { id: string; name: string };
  totalSeconds: number;
  projects: {
    id: string;
    name: string;
    agreementId: string;
    departmentId: string;
    seconds: number;
    lifetimeSeconds: number;
    progress: number;
  }[];
  agreements: {
    id: string;
    name: string;
    capMinutes: number;
    seconds: number;
    departments: {
      id: string;
      name: string;
      seconds: number;
      minutes: number;
    }[];
  }[];
}
/** No token persistence. Each request obtains a current ID token; no role/UID flags are sent. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
export class SecuredApiClient {
  constructor(
    private readonly enabled: boolean,
    private readonly origin: string,
    private readonly token: () => Promise<string>,
    private readonly request: typeof fetch = (input, init) =>
      fetch(input, init),
    private readonly microsoftProof?: () => { idToken: string; accessToken: string } | undefined,
    private readonly workflow: "legacy" | "projects" = "legacy",
  ) {
    if (origin === "same-origin" && typeof location !== "undefined") this.origin = origin = location.origin;
    if (enabled) {
      let u: URL;
      try {
        u = new URL(origin);
      } catch {
        throw Error("Invalid protected API origin");
      }
      if (
        u.origin !== origin ||
        u.username ||
        u.password ||
        (u.protocol !== "https:" &&
          !(u.protocol === "http:" && u.hostname === "127.0.0.1" && u.port))
      )
        throw Error("Invalid protected API origin");
    }
  }
  async report(
    tenantId: string,
    month: string,
    signal?: AbortSignal,
  ): Promise<Report> {
    if (!this.enabled) throw Error("Protected workspace is disabled");
    if (
      !/^[-a-zA-Z0-9_]{1,128}$/.test(tenantId) ||
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    )
      throw Error("Invalid reporting scope");
    return this.call<Report>(tenantId, "report?month=" + month, { signal });
  }
  async call<T>(
    tenant: string,
    path: string,
    options: {
      method?: string;
      body?: unknown;
      key?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    if (!this.enabled) throw Error("Protected workspace is disabled");
    if (
      !/^[-a-zA-Z0-9_]{1,128}$/.test(tenant) ||
      (!/^(report|workspace|projects|sources|allocations|audits|time|portfolio)([/?].*)?$/.test(path) &&
        !(this.workflow === "projects" && /^(client-preview(?:\/scopes|\?.*)?|directory\/wordpress-sync)$/.test(path)))
    )
      throw Error("Invalid reporting scope");
    const token = await this.token();
    const proof = this.microsoftProof?.();
    const r = await this.request(
      this.origin + (this.workflow === "projects" ? "/api/v2/tenants/" : "/api/tenants/") + tenant + "/" + path,
      {
        method: options.method ?? "GET",
        headers: {
          Authorization: "Bearer " + token,
          ...(proof ? { "X-Morris-Microsoft-Identity": proof.idToken, "X-Morris-Microsoft-Access": proof.accessToken } : {}),
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        cache: "no-store",
        credentials: "omit",
        signal: options.signal,
      },
    );
    if (!r.ok) {
      const code = await r
        .json()
        .then((v: { error?: string }) => v.error ?? "")
        .catch(() => "");
      throw new ApiError(
        code === "migration_required"
          ? "This workspace needs a reviewed project-data migration. Contact Morris Interactive."
          : code === "wordpress_unavailable"
          ? "Morris WordPress is temporarily unavailable. Stored profiles and assignments are still available."
          : code === "source_month_too_large"
          ? "This month exceeds the supported size for exact search and counts."
          : code === "project_draft_pending"
          ? "Publish or discard the saved draft before unpublishing this project."
          : r.status === 401
          ? "Please sign in again."
          : r.status === 403
            ? "This account is not approved for this workspace."
            : r.status === 409
              ? "This record changed. Refresh before saving again."
              : r.status === 429
                ? "Please wait before retrying."
                : r.status === 400
                  ? "Check the entered values."
                  : "The workspace is temporarily unavailable.",
        r.status,
        code,
      );
    }
    return (await r.json()) as T;
  }
}
