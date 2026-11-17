import { AsyncLocalStorage } from "node:async_hooks";
import type { VerifiedIdentity, Membership } from "./contracts";
export interface MicrosoftProof {
  idToken: string;
  accessToken: string;
}
export const requestIdentity = new AsyncLocalStorage<{
  proof?: MicrosoftProof;
  identity?: VerifiedIdentity;
}>();
export function rememberIdentity(identity: VerifiedIdentity) {
  const context = requestIdentity.getStore();
  if (identity.corporatePolicy && !context) throw Error("Unauthenticated");
  if (context) context.identity = identity;
}
export function corporateMembership(
  tenant: string,
  subject: string,
): Membership | undefined {
  const who = requestIdentity.getStore()?.identity;
  if (who?.subject !== subject || who.staffTenantId !== tenant)
    return undefined;
  // Application editing/publishing only; no HTTP infrastructure/bootstrap routes exist.
  return {
    tenantId: tenant,
    subject,
    role: "administrator",
    approved: true,
    enabled: true,
    agreementIds: [],
    projectIds: "all-authorized-agreements",
  };
}
