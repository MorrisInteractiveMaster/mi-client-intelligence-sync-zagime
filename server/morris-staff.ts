import { validProductionTenant } from "./database-target";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { MicrosoftProof } from "./request-identity";
export const MORRIS_STAFF_DOMAIN = "morrisinteractive.ca";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface StaffConfiguration {
  entraTenantId: string;
  clientId: string;
  tenantId: string;
}
export function staffConfiguration(env: NodeJS.ProcessEnv): StaffConfiguration {
  const {
    MORRIS_ENTRA_TENANT_ID: entraTenantId = "",
    MORRIS_ENTRA_CLIENT_ID: clientId = "",
    MORRIS_DASHBOARD_TENANT_ID: tenantId = "",
  } = env;
  if (
    !uuid.test(entraTenantId) ||
    !uuid.test(clientId) ||
    !(env.BACKEND_MODE === "production" ? validProductionTenant(tenantId) : /^synthetic-[-a-z0-9]{1,100}$/.test(tenantId))
  )
    throw Error("Missing approved corporate dashboard configuration");
  return { entraTenantId, clientId, tenantId };
}
/** No email-only grant, custom claim or employee membership. Keys are pinned to the configured tenant. */
export class MorrisStaffVerifier {
  private readonly keys: JWTVerifyGetKey;
  constructor(
    readonly config: StaffConfiguration,
    private readonly request: typeof fetch = fetch,
    keys?: JWTVerifyGetKey,
  ) {
    if (!uuid.test(config.entraTenantId) || !uuid.test(config.clientId))
      throw Error("Invalid Entra configuration");
    this.keys =
      keys ??
      createRemoteJWKSet(
        new URL(
          `https://login.microsoftonline.com/${config.entraTenantId}/discovery/v2.0/keys`,
        ),
        { timeoutDuration: 4000, cooldownDuration: 30000 },
      );
  }
  async verify(providerOid: string, proof?: MicrosoftProof) {
    try {
      if (
        !uuid.test(providerOid) ||
        !proof ||
        [proof.idToken, proof.accessToken].some(
          (t) =>
            typeof t !== "string" ||
            t.length < 1 ||
            t.length > 16000 ||
            /\s/.test(t),
        )
      )
        throw Error();
      const { payload } = await jwtVerify(proof.idToken, this.keys, {
        issuer: `https://login.microsoftonline.com/${this.config.entraTenantId}/v2.0`,
        audience: this.config.clientId,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "oid", "tid"],
        maxTokenAge: "1h",
      });
      if (
        payload.tid !== this.config.entraTenantId ||
        payload.oid !== providerOid ||
        payload.idtyp === "app"
      )
        throw Error();
      // Graph validates its own bearer token. Never decode a Graph token as proof.
      // Check current account status on EVERY request; do not cache positive authorization.
      const r = await this.request(
        "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,userType,accountEnabled",
        {
          headers: { Authorization: "Bearer " + proof.accessToken },
          redirect: "error",
          signal: AbortSignal.timeout(4000),
          cache: "no-store",
        },
      );
      if (!r.ok) throw Error();
      const text = await r.text();
      if (text.length > 16384) throw Error();
      const user = JSON.parse(text);
      const upn =
        typeof user.userPrincipalName === "string"
          ? user.userPrincipalName.toLowerCase()
          : "";
      if (
        user.id !== providerOid ||
        user.userType !== "Member" ||
        user.accountEnabled !== true ||
        !/^[^@\s]+@[^@\s]+$/.test(upn) ||
        upn.split("@")[1] !== MORRIS_STAFF_DOMAIN
      )
        throw Error();
      return this.config.tenantId;
    } catch {
      throw Error("Unauthenticated");
    }
  }
}
