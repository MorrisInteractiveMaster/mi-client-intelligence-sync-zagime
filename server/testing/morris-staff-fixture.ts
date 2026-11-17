import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { MorrisStaffVerifier } from "../morris-staff";
const tenant = "11111111-1111-4111-8111-111111111111",
  app = "22222222-2222-4222-8222-222222222222";
export const employeeOid = "33333333-3333-4333-8333-333333333333";
export async function staffTestFixture(tenantId = "synthetic-zagime") {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  let user: any = {
    id: employeeOid,
    userPrincipalName: "synthetic-staff@morrisinteractive.ca",
    userType: "Member",
    accountEnabled: true,
  };
  let status = 200,
    calls = 0;
  const request: typeof fetch = async (url, options) => {
    assert.equal(
      String(url),
      "https://graph.microsoft.com/v1.0/me?$select=id,userPrincipalName,userType,accountEnabled",
    );
    assert.equal(
      (options?.headers as any).Authorization,
      "Bearer synthetic-delegated-proof",
    );
    calls++;
    return new Response(JSON.stringify(user), { status });
  };
  const verifier = new MorrisStaffVerifier(
    { entraTenantId: tenant, clientId: app, tenantId },
    request,
    createLocalJWKSet({ keys: [jwk] }),
  );
  const token = async (claims: any = {}) =>
    new SignJWT({ oid: employeeOid, tid: tenant, ...claims })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
      .setSubject(claims.oid ?? employeeOid)
      .setAudience(claims.aud ?? app)
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? "1h")
      .sign(pair.privateKey);
  return {
    verifier,
    token,
    setUser: (u: any) => {
      user = u;
    },
    user: () => user,
    setStatus: (s: number) => {
      status = s;
    },
    calls: () => calls,
  };
}
