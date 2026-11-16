import type { Credential } from "firebase-admin/app";
import {
  assertStagingMetadata,
  REGION,
  type DatabaseTarget,
} from "./database-target";
/** Only the explicit regional metadata GET. Does not query data or change/create a database. */
export async function verifyDatabase(
  target: DatabaseTarget,
  credential: Credential,
  request: typeof fetch = (input, init) => fetch(input, init),
) {
  if (target.mode !== "staging" || target.databaseId !== "mi-client-staging")
    throw Error("Staging database verification failed");
  try {
    const token = await credential.getAccessToken();
    const response = await request(
      `https://firestore.${REGION}.rep.googleapis.com/v1/${target.resource}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token.access_token}` },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      },
    );
    if (!response.ok) throw Error();
    assertStagingMetadata(target, await response.json());
  } catch {
    throw Error("Staging database verification failed");
  }
}
