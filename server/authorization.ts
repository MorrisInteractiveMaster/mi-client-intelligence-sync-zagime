import type { Membership, TenantRecord } from "./contracts";
import type { DeliveryProject } from "../src/reporting/model";
import { corporateMembership, requestIdentity } from "./request-identity";
export function approvedMember(
  record: TenantRecord,
  tenantId: string,
  subject: string,
): Membership {
  const staff = corporateMembership(tenantId, subject);
  if (record.state.tenant.id !== tenantId) throw Error("Forbidden");
  if (staff) return staff;
  const m = record.memberships.find(
    (m) => m.tenantId === tenantId && m.subject === subject,
  );
  if (
    record.state.tenant.id !== tenantId ||
    m?.approved!==true ||
    m.enabled!==true ||
    !["administrator", "editor", "client"].includes(m.role) ||
    (requestIdentity.getStore()?.identity?.corporatePolicy && m.role !== "client") ||
    !Array.isArray(m.agreementIds) ||
    !(
      m.projectIds === "all-authorized-agreements" ||
      Array.isArray(m.projectIds)
    )
  )
    throw Error("Forbidden");
  return m;
}
export function canAccessProject(
  m: Membership,
  p: Pick<DeliveryProject, "id" | "agreementId">,
) {
  return (
    m.role === "administrator" ||
    (m.agreementIds.includes(p.agreementId) &&
      (m.projectIds === "all-authorized-agreements" ||
        m.projectIds.includes(p.id)))
  );
}
