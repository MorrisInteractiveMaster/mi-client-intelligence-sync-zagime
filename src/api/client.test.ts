import test from "node:test";
import assert from "node:assert/strict";
import { SecuredApiClient } from "./client";
test("disabled protected API client makes no network or token calls", async () => {
  let calls = 0;
  const client = new SecuredApiClient(
    false,
    "",
    async () => {
      calls++;
      return "test";
    },
    async () => {
      calls++;
      throw Error();
    },
  );
  await assert.rejects(() => client.report("tenant", "2026-10"));
  assert.equal(calls, 0);
});
test("protected API sends only current bearer token and safely handles denied/failed responses", async () => {
  const client = new SecuredApiClient(
    true,
    "https://api.example.com",
    async () => "synthetic",
    async (input, init) => {
      assert.equal(
        input,
        "https://api.example.com/api/tenants/tenant/report?month=2026-10",
      );
      assert.deepEqual(init?.headers, { Authorization: "Bearer synthetic" });
      assert.equal(init?.credentials, "omit");
      return new Response("{}", { status: 403 });
    },
  );
  await assert.rejects(
    () => client.report("tenant", "2026-10"),
    /not approved/,
  );
  assert.throws(
    () => new SecuredApiClient(true, "http://untrusted", async () => ""),
  );
});
