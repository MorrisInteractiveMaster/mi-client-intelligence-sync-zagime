import { createHash } from "node:crypto";
import { regionalSecret } from "./regional-secret";
import { timeId, type TimeToken } from "./time-client";

interface CredentialBinding {
  account: string;
  userId: string;
  clientUrl: string;
  tenant: string;
  customerParentId: string;
  secret: string;
  version: string;
  sha256: string;
  production?: { databaseUid: string; modifiedFrom: string };
}

export function verifyTimeCredential(
  bytes: Buffer,
  binding: CredentialBinding,
  now = Date.now(),
) {
  try {
    if (
      bytes.length > 8192 ||
      createHash("sha256").update(bytes).digest("hex") !== binding.sha256
    )
      throw Error();
    const grant = JSON.parse(bytes.toString("utf8"));
    if (
      grant.companyId !== binding.account ||
      grant.userId !== binding.userId ||
      grant.clientUrl !== binding.clientUrl ||
      grant.tenant !== binding.tenant ||
      grant.customerParentId !== timeId(binding.customerParentId) ||
      grant.jobcodeIds !== undefined ||
      (binding.production ? grant.environment !== "production" ||
        grant.databaseUid !== binding.production.databaseUid || grant.modifiedFrom !== binding.production.modifiedFrom
        : grant.environment === "production") ||
      typeof grant.expiresAt !== "string" ||
      new Date(grant.expiresAt).toISOString() !== grant.expiresAt ||
      Date.parse(grant.expiresAt) <= now ||
      typeof grant.accessToken !== "string" ||
      !/^[\x21-\x7e]{1,4096}$/.test(grant.accessToken)
    )
      throw Error();
    return grant.accessToken as string;
  } catch {
    throw Error("Time credential binding failed");
  }
}

export function regionalTimeToken(binding: CredentialBinding, request = fetch): TimeToken {
  let read: ReturnType<typeof regionalSecret>;
  try {
    read = regionalSecret(binding.secret, binding.version, request);
  } catch {
    throw Error("Invalid Time secret reference");
  }
  return async (signal) => {
    let bytes: Buffer | undefined;
    try {
      bytes = await read(signal);
      return verifyTimeCredential(bytes, binding);
    } catch {
      throw Error("Time credential unavailable or unapproved");
    } finally {
      bytes?.fill(0);
    }
  };
}
