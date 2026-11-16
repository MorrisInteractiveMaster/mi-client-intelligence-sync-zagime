import type { Membership, TenantRecord } from "./contracts";
import type { DeliveryProject } from "../src/reporting/model";
export function approvedMember(
  record: TenantRecord,
  tenantId: string,
  subject: string,
): Membership {
  const m = record.memberships.find(
    (m) => m.tenantId === tenantId && m.subject === subject,
  );
  if (
    record.state.tenant.id !== tenantId ||
    m?.approved!==true ||
    m.enabled!==true ||
    !["administrator", "editor", "client"].includes(m.role) ||
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
