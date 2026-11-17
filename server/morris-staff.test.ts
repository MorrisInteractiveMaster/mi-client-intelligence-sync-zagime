import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { MorrisStaffVerifier, staffConfiguration } from "./morris-staff";
import { approvedMember } from "./authorization";
import { requestIdentity, rememberIdentity } from "./request-identity";
import { demo } from "../src/reporting/model";
import { staffTestFixture, employeeOid } from "./testing/morris-staff-fixture";
test("signed Entra identity, exact Firebase provider OID and current corporate ownership required every time", async () => {
  const f = await staffTestFixture();
  const proof = {
    idToken: await f.token(),
    accessToken: "synthetic-delegated-proof",
  };
  assert.equal(await f.verifier.verify(employeeOid, proof), "synthetic-zagime");
  assert.equal(await f.verifier.verify(employeeOid, proof), "synthetic-zagime");
  assert.equal(f.calls(), 2);
  for (const change of [
    { accountEnabled: false },
    { accountEnabled: undefined },
    { userType: "Guest" },
    { id: crypto.randomUUID() },
    { userPrincipalName: "synthetic@morrisinteractive.ca.attacker.test" },
    { userPrincipalName: "synthetic@morrisinteractive.ca@attacker.test" },
  ]) {
    const before = f.user();
    f.setUser({ ...before, ...change });
    await assert.rejects(
      f.verifier.verify(employeeOid, proof),
      /Unauthenticated/,
    );
    f.setUser(before);
  }
  f.setStatus(403);
  await assert.rejects(f.verifier.verify(employeeOid, proof));
  f.setStatus(200);
  await assert.rejects(f.verifier.verify(employeeOid));
  await assert.rejects(f.verifier.verify(crypto.randomUUID(), proof));
  await assert.rejects(
    f.verifier.verify(employeeOid, {
      ...proof,
      idToken: await f.token({ tid: crypto.randomUUID() }),
    }),
  );
  await assert.rejects(
    f.verifier.verify(employeeOid, {
      ...proof,
      idToken: await f.token({ aud: crypto.randomUUID() }),
    }),
  );
  await assert.rejects(
    f.verifier.verify(employeeOid, {
      ...proof,
      idToken: await f.token({ exp: 1 }),
    }),
  );
  await assert.rejects(
    f.verifier.verify(employeeOid, {
      ...proof,
      idToken: proof.idToken.slice(0, -5) + "wrong",
    }),
  );
});
test("corporate staff grant is request-local and tenant-scoped, never a persisted staff allowlist or infrastructure grant", async () => {
  const state = demo();
  state.tenant.id = "synthetic-zagime";
  const record = {
    state,
    revision: 1,
    memberships: [],
    audits: [],
    checkpoints: [],
  };
  const identity = {
    subject: "synthetic-uid",
    issuer: "test",
    audience: "test",
    expiresAt: Date.now() + 10000,
    disabled: false,
    revoked: false,
    corporatePolicy: true,
    staffTenantId: "synthetic-zagime",
  };
  await Promise.all([
    requestIdentity.run({}, async () => {
      rememberIdentity(identity);
      assert.equal(
        approvedMember(record, "synthetic-zagime", identity.subject).role,
        "administrator",
      );
      assert.throws(() => approvedMember(record, "other", identity.subject));
    }),
    requestIdentity.run({}, async () =>
      assert.throws(() =>
        approvedMember(record, "synthetic-zagime", identity.subject),
      ),
    ),
  ]);
  assert.equal(record.memberships.length, 0);
  assert.throws(() => staffConfiguration({ MORRIS_ENTRA_TENANT_ID: "common" }));
});
