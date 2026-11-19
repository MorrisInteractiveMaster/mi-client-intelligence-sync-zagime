import { COMPANY_PROJECT, REGION } from "./database-target";
import { readTimeJson } from "./time-client";

export function regionalSecret(secretId: string, version: string, request = fetch): (signal?: AbortSignal) => Promise<Buffer> {
  if (
    !/^[a-zA-Z0-9_-]{1,255}$/.test(secretId) ||
    !/^[1-9][0-9]*$/.test(version)
  )
    throw Error("Invalid secret reference");
  const resource = `projects/${COMPANY_PROJECT}/locations/${REGION}/secrets/${secretId}/versions/${version}`;
  return async (signal) => {
    const deadline = () => {
      const timeout = AbortSignal.timeout(5000);
      return signal ? AbortSignal.any([signal, timeout]) : timeout;
    };
    try {
      const metadata = await request(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {
          headers: { "Metadata-Flavor": "Google" },
          redirect: "error",
          signal: deadline(),
        },
      );
      if (
        !metadata.ok ||
        metadata.headers.get("Metadata-Flavor") !== "Google"
      ) {
        await metadata.body?.cancel();
        throw Error();
      }
      const identity = await readTimeJson(metadata, 8192);
      if (
        typeof identity.access_token !== "string" ||
        !/^[\x21-\x7e]{1,4096}$/.test(identity.access_token)
      )
        throw Error();
      const secret = await request(
        `https://secretmanager.${REGION}.rep.googleapis.com/v1/${resource}:access`,
        {
          headers: { Authorization: "Bearer " + identity.access_token },
          redirect: "error",
          signal: deadline(),
        },
      );
      if (!secret.ok) {
        await secret.body?.cancel();
        throw Error();
      }
      const value = await readTimeJson(secret, 16384);
      const name = typeof value.name === "string" ? value.name : "";
      const [, project] = name.split("/");
      // The response may canonicalize the fixed request's project ID to its number.
      if (
        name !== resource &&
        (!/^\d+$/.test(project ?? "") ||
          name !== resource.replace(COMPANY_PROJECT, project))
      )
        throw Error();
      const data = (value.payload as { data?: unknown } | undefined)?.data;
      if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
        throw Error();
      const bytes = Buffer.from(data, "base64");
      try {
        signal?.throwIfAborted();
        if (bytes.length > 8192) throw Error();
        return bytes;
      } catch (error) {
        bytes.fill(0);
        throw error;
      }
    } catch {
      throw Error("Regional secret unavailable");
    }
  };
}
