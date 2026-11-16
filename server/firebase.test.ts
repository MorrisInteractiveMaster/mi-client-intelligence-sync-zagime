import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FirebaseIdentityVerifier, firebaseRuntime } from "./firebase";
test("production Firebase verifier checks actual RS256 signatures with fixture public keys and current account checks", async () => {
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const app = initializeApp(
    { projectId: "offline-signature-project" },
    "offline-signature-test",
  );
  const auth = getAuth(app);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  let disabled = false,
    revoked = false;
  let accountChecks = 0;
  const internal = auth as any;
  internal.idTokenVerifier.signatureVerifier.keyFetcher.fetchPublicKeys =
    async () => ({
      "fixture-key": publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    });
  internal.getUser = async () => {
    accountChecks++;
    return {
      disabled,
      tokensValidAfterTime: new Date(
        revoked ? Date.now() + 60000 : 0,
      ).toUTCString(),
    };
  };
  const verifier = new FirebaseIdentityVerifier(auth);
  const encode = (x: unknown) =>
    Buffer.from(JSON.stringify(x)).toString("base64url");
  const token = (changes: Record<string, unknown> = {}) => {
    const header = encode({ alg: "RS256", kid: "fixture-key" });
    const payload = encode({
      sub: "approved-subject",
      aud: "offline-signature-project",
      iss: "https://securetoken.google.com/offline-signature-project",
      iat: Math.floor(Date.now() / 1000),
      auth_time: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...changes,
    });
    const part = header + "." + payload;
    return (
      part +
      "." +
      sign("RSA-SHA256", Buffer.from(part), privateKey).toString("base64url")
    );
  };
  try {
    const good = token();
    assert.equal(
      (await verifier.verify("Bearer " + good)).subject,
      "approved-subject",
    );
    assert.ok(accountChecks > 0);
    const badSignature = good.split(".");
    badSignature[2] = "AAAA";
    await assert.rejects(() =>
      verifier.verify("Bearer " + badSignature.join(".")),
    );
    await assert.rejects(() =>
      verifier.verify("Bearer " + token({ aud: "other" })),
    );
    await assert.rejects(() => verifier.verify("Bearer " + token({ exp: 1 })));
    await assert.rejects(() =>
      verifier.verify(
        "Bearer " + token({ firebase: { tenant: "unapproved-auth-tenant" } }),
      ),
    );
    disabled = true;
    await assert.rejects(() => verifier.verify("Bearer " + good));
    disabled = false;
    revoked = true;
    await assert.rejects(() => verifier.verify("Bearer " + good));
  } finally {
    await deleteApp(app);
  }
});
test("live Firebase startup fails closed without explicit configuration", () => {
  delete process.env.ENABLE_LIVE_FIREBASE;
  assert.throws(() =>
    firebaseRuntime("production", "morris-client-dash-zagime"),
  );
  assert.throws(() => firebaseRuntime("emulator", "morris-client-dash-zagime"));
});

test('isolated staging cannot target production or start by merging disabled configuration',()=>{
  assert.throws(()=>firebaseRuntime('staging','morris-client-dash-zagime'));
  assert.throws(()=>firebaseRuntime('staging','unapproved-staging'));
});
