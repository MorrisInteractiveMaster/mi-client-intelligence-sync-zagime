import { createHash } from "node:crypto";
import { COMPANY_PROJECT, REGION } from "./database-target";
import { readTimeJson, timeId, type TimeToken } from "./time-client";

interface CredentialBinding {
  account: string;
  userId: string;
  clientUrl: string;
  tenant: string;
  jobcodes: string[];
  secret: string;
  version: string;
  sha256: string;
}

export function verifyTimeCredential(bytes: Buffer, binding: CredentialBinding, now = Date.now()) {
  try {
    if (bytes.length > 8192 || createHash("sha256").update(bytes).digest("hex") !== binding.sha256)
      throw Error();
    const grant = JSON.parse(bytes.toString("utf8"));
    if (
      grant.companyId !== binding.account ||
      grant.userId !== binding.userId ||
      grant.clientUrl !== binding.clientUrl ||
      grant.tenant !== binding.tenant ||
      !Array.isArray(grant.jobcodeIds) ||
      grant.jobcodeIds.length !== binding.jobcodes.length ||
      JSON.stringify(grant.jobcodeIds.map(timeId).sort()) !== JSON.stringify([...binding.jobcodes].sort()) ||
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

export function regionalTimeToken(
  binding: CredentialBinding,
  request = fetch,
): TimeToken {
  if (!/^[a-zA-Z0-9_-]{1,255}$/.test(binding.secret) || !/^[1-9][0-9]*$/.test(binding.version))
    throw Error("Invalid Time secret reference");
  const resource = `projects/${COMPANY_PROJECT}/locations/${REGION}/secrets/${binding.secret}/versions/${binding.version}`;
  return async (signal) => {
    const deadline = () => {
      const timeout = AbortSignal.timeout(5000);
      return signal ? AbortSignal.any([signal, timeout]) : timeout;
    };
    try {
      const metadata = await request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        { headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: deadline() },
      );
      if (!metadata.ok || metadata.headers.get("Metadata-Flavor") !== "Google") {
        await metadata.body?.cancel();
        throw Error();
      }
      const identity = await readTimeJson(metadata, 8192);
      if (typeof identity.access_token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(identity.access_token))
        throw Error();
      const secret = await request(
        `https://secretmanager.${REGION}.rep.googleapis.com/v1/${resource}:access`,
        { headers: { Authorization: "Bearer " + identity.access_token }, redirect: "error", signal: deadline() },
      );
      if (!secret.ok) {
        await secret.body?.cancel();
        throw Error();
      }
      const value = await readTimeJson(secret, 16384);
      const name = typeof value.name === "string" ? value.name : "";
      const [, project] = name.split("/");
      // The response may canonicalize the fixed request's project ID to its number.
      if (name !== resource && (!/^\d+$/.test(project ?? "") ||
          name !== resource.replace(COMPANY_PROJECT, project)))
        throw Error();
      const data = (value.payload as { data?: unknown } | undefined)?.data;
      if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw Error();
      const bytes = Buffer.from(data, "base64");
      try {
        signal?.throwIfAborted();
        return verifyTimeCredential(bytes, binding);
      } finally {
        bytes.fill(0);
      }
    } catch {
      throw Error("Time credential unavailable or unapproved");
    }
  };
}
