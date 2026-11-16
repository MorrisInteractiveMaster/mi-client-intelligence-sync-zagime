import test from "node:test";
import assert from "node:assert/strict";
import {
  STAGING_SERVICE_ACCOUNT,
  verifyAttachedIdentity,
} from "./attached-identity";
test("attached identity is read from trusted metadata endpoint, not supplied browser role or deployment label", async () => {
  let calls = 0;
  await verifyAttachedIdentity(STAGING_SERVICE_ACCOUNT, async (input, init) => {
    calls++;
    assert.equal(
      input,
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email",
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    assert.deepEqual(init?.headers, { "Metadata-Flavor": "Google" });
    assert.equal(init?.body, undefined);
    return new Response(STAGING_SERVICE_ACCOUNT + "\n", {
      headers: { "Metadata-Flavor": "Google" },
    });
  });
  assert.equal(calls, 1);
});
test("wrong/unavailable/untrusted attached identity fails closed without exposing details", async () => {
  for (const response of [
    new Response("wrong@project.example", {
      headers: { "Metadata-Flavor": "Google" },
    }),
    new Response(STAGING_SERVICE_ACCOUNT),
    new Response("private detail", { status: 403 }),
  ])
    await assert.rejects(
      () =>
        verifyAttachedIdentity(STAGING_SERVICE_ACCOUNT, async () => response),
      /^Error: Attached staging identity verification failed$/,
    );
  await assert.rejects(
    () =>
      verifyAttachedIdentity(STAGING_SERVICE_ACCOUNT, async () => {
        throw Error("private transport detail");
      }),
    /^Error: Attached staging identity verification failed$/,
  );
  await assert.rejects(
    () =>
      verifyAttachedIdentity("unapproved", async () => {
        throw Error("must not request");
      }),
    /Approved staging identity required/,
  );
});
