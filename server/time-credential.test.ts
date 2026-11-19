import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { regionalTimeToken, verifyTimeCredential } from "./time-credential";

const approval = {
  account: "99", userId: "7", clientUrl: "fixture-company", tenant: "synthetic",
  jobcodes: ["42"], secret: "fixture-secret", version: "3",
};
const grant = {
  companyId: "99", userId: "7", clientUrl: "fixture-company", tenant: "synthetic",
  jobcodeIds: ["42"], accessToken: "fixture-access", expiresAt: "2099-01-01T00:00:00.000Z",
};
const pack = (value: unknown) => {
  const bytes = Buffer.from(JSON.stringify(value));
  return { bytes, bound: { ...approval, sha256: createHash("sha256").update(bytes).digest("hex") } };
};

test("approved credential bytes bind the company, actor, tenant and entire jobcode scope", () => {
  const { bytes, bound } = pack(grant);
  assert.equal(verifyTimeCredential(bytes, bound), "fixture-access");
  for (const altered of [
    { companyId: "98" }, { userId: "8" }, { clientUrl: "other-company" },
    { tenant: "other-tenant" }, { jobcodeIds: ["43"] }, { jobcodeIds: ["42", "43"] },
    { expiresAt: "2020-01-01T00:00:00.000Z" },
  ]) {
    const invalid = pack({ ...grant, ...altered });
    assert.throws(() => verifyTimeCredential(invalid.bytes, invalid.bound), /binding failed/);
  }
  assert.throws(() => verifyTimeCredential(pack({ ...grant, accessToken: "substituted" }).bytes, bound), /binding failed/);
});

test("uses attached identity and only the pinned Canadian secret version", async () => {
  const { bytes, bound } = pack(grant);
  const resource = "projects/morris-client-dash-zagime/locations/northamerica-northeast1/secrets/fixture-secret/versions/3";
  const cloudUrl = "https://secretmanager.northamerica-northeast1.rep.googleapis.com/v1/" + resource + ":access";
  let responseName = resource;
  const token = regionalTimeToken(bound, async (input, init) => {
    assert.equal(init?.redirect, "error");
    if (String(input).startsWith("http://")) {
      assert.equal(String(input), "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token");
      assert.equal(new Headers(init?.headers).get("Metadata-Flavor"), "Google");
      return Response.json({ access_token: "fixture-google" }, { headers: { "Metadata-Flavor": "Google" } });
    }
    assert.equal(String(input), cloudUrl);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-google");
    return Response.json({ name: responseName, payload: { data: bytes.toString("base64") } });
  });
  assert.equal(await token(), "fixture-access");
  responseName = resource.replace(/3$/, "4");
  await assert.rejects(token(), /unavailable or unapproved/);
  assert.throws(() => regionalTimeToken({ ...bound, version: "latest" }), /secret reference/);
});
