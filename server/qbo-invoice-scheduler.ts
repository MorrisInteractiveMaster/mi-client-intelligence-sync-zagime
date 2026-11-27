import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const invoiceSchedulePath = "/api/internal/qbo-invoices/sync";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export function invoiceSchedulerAuthorization(env: NodeJS.ProcessEnv, keys: JWTVerifyGetKey = googleKeys, now = () => new Date()) {
  if (env.QBO_INVOICES_SCHEDULE_ENABLED !== "true") return;
  const subject = env.QBO_INVOICES_SCHEDULER_SUBJECT;
  const email = env.QBO_INVOICES_SCHEDULER_EMAIL;
  const origin = env.ALLOWED_ORIGIN;
  if (!subject || !/^\d{15,32}$/.test(subject) || !email || !/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(email) ||
      !origin || !/^https:\/\/[a-z0-9.-]+$/.test(origin))
    throw Error("Invalid invoice scheduler configuration");
  return async (authorization: string) => {
    const token = /^Bearer ([^\s]{1,8192})$/.exec(authorization)?.[1];
    if (!token) throw Error("Unauthenticated");
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"], audience: origin + invoiceSchedulePath, subject,
        algorithms: ["RS256"], requiredClaims: ["iat", "exp", "email", "email_verified"],
        maxTokenAge: "1h", clockTolerance: 15, currentDate: now(),
      });
      if (payload.email !== email || payload.email_verified !== true || payload.aud !== origin + invoiceSchedulePath)
        throw Error();
    } catch { throw Error("Unauthenticated"); }
    return email;
  };
}
