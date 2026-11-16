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
export class SecuredApiClient {
  constructor(
    private readonly enabled: boolean,
    private readonly origin: string,
    private readonly token: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
  ) {
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
    const token = await this.token();
    const r = await this.request(
      `${this.origin}/api/tenants/${tenantId}/report?month=${month}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        credentials: "omit",
        signal,
      },
    );
    if (!r.ok)
      throw Error(
        r.status === 401
          ? "Please sign in again."
          : r.status === 403
            ? "This account is not approved for this workspace."
            : r.status === 429
              ? "Please wait before retrying."
              : "The workspace is temporarily unavailable.",
      );
    return (await r.json()) as Report;
  }
}
