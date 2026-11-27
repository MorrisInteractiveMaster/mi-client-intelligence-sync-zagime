import assert from "node:assert/strict";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { invoiceSchedulePath, invoiceSchedulerAuthorization } from "./qbo-invoice-scheduler";
import { invoiceFreshness } from "../src/projects/invoices";

test("scheduled invoice requests require the exact Google issuer, audience and verified service identity", async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = await exportJWK(keys.publicKey);
  const env = { QBO_INVOICES_SCHEDULE_ENABLED: "true", QBO_INVOICES_SCHEDULER_SUBJECT: "123456789012345678901",
    QBO_INVOICES_SCHEDULER_EMAIL: "mi-invoice-scheduler@example-project.iam.gserviceaccount.com",
    ALLOWED_ORIGIN: "https://dashboard.example.test" };
  const now = new Date("2026-11-27T13:00:00Z");
  const iat = now.getTime() / 1000;
  const audience = env.ALLOWED_ORIGIN + invoiceSchedulePath;
  const authorize = invoiceSchedulerAuthorization(env, createLocalJWKSet({ keys: [jwk] }), () => now)!;
  const base = { aud: audience, sub: env.QBO_INVOICES_SCHEDULER_SUBJECT, iss: "https://accounts.google.com",
    iat, exp: iat + 600, email: env.QBO_INVOICES_SCHEDULER_EMAIL, email_verified: true };
  const token = async (patch = {}) => "Bearer " + await new SignJWT({ ...base, ...patch }).setProtectedHeader({ alg: "RS256" }).sign(keys.privateKey);
  assert.equal(await authorize(await token()), env.QBO_INVOICES_SCHEDULER_EMAIL);
  for (const patch of [{ aud: env.ALLOWED_ORIGIN }, { aud: [audience, "another"] }, { sub: "other" }, { iss: "https://example.test" },
    { email: "other@example.test" }, { email_verified: false }, { exp: iat - 16 }, { iat: iat - 3600 - 16 }])
    await assert.rejects(authorize(await token(patch)), /Unauthenticated/);
  assert.equal(invoiceSchedulerAuthorization({}), undefined);
});

test("freshness becomes stale after a failed refresh or 26 hours without a complete mirror", () => {
  const syncedAt = "2026-11-27T13:00:00Z";
  const now = Date.parse(syncedAt);
  assert.equal(invoiceFreshness(now), "unavailable");
  assert.equal(invoiceFreshness(now, syncedAt, "bad date"), "current");
  assert.equal(invoiceFreshness(now + 26 * 3600_000 - 1, syncedAt), "current");
  assert.equal(invoiceFreshness(now + 26 * 3600_000, syncedAt), "stale");
  assert.equal(invoiceFreshness(now, syncedAt, syncedAt), "stale");
});
