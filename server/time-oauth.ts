import { createHash, randomBytes } from "node:crypto";
import { timeId } from "./time-client";

export interface TimeOAuthAttempt {
  tenant: string;
  actor: string;
  account: string;
  redirectUri: string;
}
export interface TimeStateStore {
  put(
    digest: string,
    attempt: TimeOAuthAttempt,
    expires: number,
  ): Promise<void>;
  /** Compare every binding and expiry and consume atomically. */
  consume(
    digest: string,
    attempt: TimeOAuthAttempt,
    now: number,
  ): Promise<boolean>;
}
const hash = (state: string) =>
  createHash("sha256").update(state).digest("hex");
export async function beginTimeState(
  store: TimeStateStore,
  attempt: TimeOAuthAttempt,
  now = Date.now(),
) {
  const state = randomBytes(32).toString("base64url");
  await store.put(hash(state), attempt, now + 300000);
  return state;
}

/** Unwired until the callback and regional secret rotation process are approved. */
export async function exchangeTimeCode(
  input: {
    attempt: TimeOAuthAttempt;
    registeredRedirect: string;
    state: string;
    code: string;
    clientId: string;
    clientSecret: string;
  },
  store: TimeStateStore,
  request = fetch,
  now = Date.now(),
) {
  const { attempt } = input;
  const redirect = new URL(input.registeredRedirect);
  if (
    redirect.protocol !== "https:" ||
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search ||
    attempt.redirectUri !== input.registeredRedirect ||
    !/^[\w-]{43}$/.test(input.state) ||
    !input.code ||
    input.code.length > 4096 ||
    !input.clientId ||
    !input.clientSecret
  )
    throw Error("Invalid Time authorization");
  if (!(await store.consume(hash(input.state), attempt, now)))
    throw Error("Invalid Time authorization");
  try {
    const response = await request("https://rest.tsheets.com/api/v1/grant", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.registeredRedirect,
      }),
    });
    if (!response.ok) throw Error();
    const result = await response.json();
    if (
      timeId(result.company_id) !== attempt.account ||
      !/^[\x21-\x7e]{1,4096}$/.test(result.access_token ?? "") ||
      !/^[\x21-\x7e]{1,4096}$/.test(result.refresh_token ?? "") ||
      typeof result.access_token !== "string" ||
      typeof result.refresh_token !== "string" ||
      String(result.token_type).toLowerCase() !== "bearer" ||
      !Number.isSafeInteger(result.expires_in) ||
      result.expires_in <= 0 ||
      result.expires_in > 31536000
    )
      throw Error();
    return {
      accessToken: result.access_token as string,
      refreshToken: result.refresh_token as string,
      expiresAt: now + result.expires_in * 1000,
    };
  } catch {
    throw Error("Time authorization failed");
  }
}
