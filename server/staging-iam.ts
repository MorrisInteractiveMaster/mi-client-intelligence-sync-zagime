import {
  COMPANY_PROJECT,
  STAGING_DATABASE,
  type DatabaseTarget,
} from "./database-target";
import type { Credential } from "firebase-admin/app";
export const STAGING_PERMISSIONS = [
  "datastore.databases.get",
  "datastore.databases.getMetadata",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.create",
  "datastore.entities.update",
] as const;
export interface IamCheck {
  databaseId: string;
  permission: string;
  state: string;
}
/** Retired: a matrix built from unsupported named-resource troubleshooting is not IAM proof. */
export function assertIamEvidence(
  _rows: IamCheck[],
  _allowStagingDelete = false,
): never {
  throw Error(
    "UNSUPPORTED / INCONCLUSIVE: named Firestore Troubleshooter matrix cannot establish effective IAM. Use actual policy/role/inheritance review and approved runtime checks.",
  );
}
/** Explicit future read-only cloud probe. Never run automatically on startup or in CI. No production writes. */
export async function probeDatabaseReads(
  target: DatabaseTarget,
  credential: Credential,
  request: typeof fetch = (input, init) => fetch(input, init),
) {
  if (
    target.mode !== "staging" ||
    target.projectId !== COMPANY_PROJECT ||
    target.databaseId !== STAGING_DATABASE
  )
    throw Error("Named same-project staging probe required");
  const token = await credential.getAccessToken();
  const random = `staging-iam-probe-${crypto.randomUUID()}`;
  for (const databaseId of [STAGING_DATABASE, "(default)"]) {
    const base = `https://firestore.northamerica-northeast1.rep.googleapis.com/v1/projects/${COMPANY_PROJECT}/databases/${databaseId}/documents/${random}`;
    for (const [path, stageStatus] of [
      ["/nonexistent", 404],
      ["?pageSize=1", 200],
    ] as const) {
      const r = await request(base + path, {
        method: "GET",
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      if (databaseId === STAGING_DATABASE) {
        if (r.status !== stageStatus)
          throw Error("Staging read permission probe failed");
      } else {
        if (
          r.status !== 403 ||
          ((await r.json()) as any)?.error?.status !== "PERMISSION_DENIED"
        )
          throw Error("Default database denial not proven");
      }
    }
  }
  return {
    stagingReadAllowed: true,
    defaultGetDenied: true,
    defaultListDenied: true,
    writePermissions: "require separate IAM policy evidence",
    writes: 0,
  };
}
