import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, SecuredApiClient } from "./client";
test("active project client selects versioned API with fresh identity/proof and no browser role", async () => {
  let calls = 0;
  const c = new SecuredApiClient(
    true,
    "http://127.0.0.1:8081",
    async () => "synthetic-" + ++calls,
    async (input, init) => {
      assert.equal(
        String(input),
        "http://127.0.0.1:8081/api/v2/tenants/synthetic-projects/projects",
      );
      assert.equal(
        (init!.headers as any).Authorization,
        "Bearer synthetic-" + calls,
      );
      assert.equal(
        (init!.headers as any)["X-Morris-Microsoft-Identity"],
        "synthetic-proof",
      );
      assert.equal(init!.credentials, "omit");
      assert.equal(init!.cache, "no-store");
      return new Response(JSON.stringify({ id: "example" }));
    },
    () => ({ idToken: "synthetic-proof", accessToken: "synthetic-access" }),
    "projects",
  );
  await c.call("synthetic-projects", "projects");
  await c.call("synthetic-projects", "projects");
  assert.equal(calls, 2);
});
test("migration required is a safe user-facing state; disabled project client never obtains a token", async () => {
  const c = new SecuredApiClient(
    true,
    "http://127.0.0.1:8081",
    async () => "synthetic",
    async () =>
      new Response(JSON.stringify({ error: "migration_required" }), {
        status: 409,
      }),
    undefined,
    "projects",
  );
  await assert.rejects(
    c.call("synthetic-projects", "workspace"),
    (e) =>
      e instanceof ApiError &&
      e.code === "migration_required" &&
      /reviewed project-data migration/.test(e.message),
  );
  const disabled = new SecuredApiClient(
    false,
    "",
    async () => {
      throw Error("Token getter must not run");
    },
    undefined,
    undefined,
    "projects",
  );
  await assert.rejects(
    disabled.call("synthetic-projects", "workspace"),
    /disabled/,
  );
});
