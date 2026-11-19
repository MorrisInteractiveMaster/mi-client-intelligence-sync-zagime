import test from "node:test";
import assert from "node:assert/strict";
import { TimeClient } from "./time-client";
import {
  beginTimeState,
  exchangeTimeCode,
  type TimeStateStore,
} from "./time-oauth";
const since = "2026-11-01T00:00:00.000Z",
  before = "2026-11-02T00:00:00.000Z";
const row = {
  id: 8,
  jobcode_id: 42,
  duration: 137,
  date: "2026-10-30",
  last_modified: "2026-11-01T05:00:00+00:00",
  type: "manual",
  locked: 1,
  notes: "private",
};
test("Time client pages scoped GETs, retries 429, and projects only normalized fields", async () => {
  let calls = 0;
  const wait: number[] = [];
  const client = new TimeClient(
    async () => "synthetic",
    async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://rest.tsheets.com");
      assert.equal(url.pathname, "/api/v1/timesheets");
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(url.searchParams.get("jobcode_ids"), "42");
      assert.equal(url.searchParams.get("supplemental_data"), "no");
      assert.equal(
        url.searchParams.get("modified_since"),
        "2026-11-01T00:00:00+00:00",
      );
      assert.equal(
        url.searchParams.get("modified_before"),
        "2026-11-02T00:00:00+00:00",
      );
      if (++calls === 1)
        return new Response("", {
          status: 429,
          headers: { "Retry-After": "2" },
        });
      const first = url.searchParams.get("page") === "1";
      const id = first ? 8 : 9;
      return Response.json({
        results: { timesheets: { [id]: { ...row, id } } },
        more: first,
      });
    },
    async (ms) => wait.push(ms),
  );
  const records = await client.read("42", since, before, false);
  assert.equal(calls, 3);
  assert.ok(wait.includes(2000));
  assert.deepEqual(
    records.map((r) => r.id),
    ["8", "9"],
  );
  assert.deepEqual(records[0], {
    id: "8",
    jobcodeId: "42",
    date: "2026-10-30",
    seconds: 137,
    modifiedAt: "2026-11-01T05:00:00.000Z",
    deleted: false,
  });
});
test("scope failures, invalid durations and long Retry-After stop without widening reads", async () => {
  for (const modified of [
    { ...row, jobcode_id: 43 },
    { ...row, duration: 0.5 },
  ]) {
    let calls = 0;
    const c = new TimeClient(
      async () => "synthetic",
      async () => {
        calls++;
        return Response.json({
          results: { timesheets_deleted: { 8: modified } },
          more: false,
        });
      },
      async () => {},
    );
    await assert.rejects(c.read("42", since, before, true));
    assert.equal(calls, 1);
  }
  const c = new TimeClient(
    async () => "synthetic",
    async () =>
      new Response("private", {
        status: 429,
        headers: { "Retry-After": "60" },
      }),
    async () => assert.fail("must not retry"),
  );
  await assert.rejects(
    c.read("42", since, before, false),
    /temporarily unavailable/,
  );
});
test("OAuth grant requires exact HTTPS callback, one-use actor-bound state and correct company", async () => {
  const attempt = {
    tenant: "synthetic",
    actor: "staff",
    account: "99",
    redirectUri: "https://example.test/callback",
  };
  const values = new Map<string, { binding: string; expires: number }>();
  const stateStore: TimeStateStore = {
    async put(digest, binding, expires) {
      values.set(digest, { binding: JSON.stringify(binding), expires });
    },
    async consume(digest, binding, now) {
      const old = values.get(digest);
      if (!old || old.expires <= now || old.binding !== JSON.stringify(binding))
        return false;
      values.delete(digest);
      return true;
    },
  };
  const state = await beginTimeState(stateStore, attempt, 1000);
  assert.ok(!values.has(state));
  let sent = 0;
  const grant: typeof fetch = async (url, init) => {
    sent++;
    assert.equal(String(url), "https://rest.tsheets.com/api/v1/grant");
    assert.equal(
      (init?.body as URLSearchParams).get("redirect_uri"),
      attempt.redirectUri,
    );
    return Response.json({
      company_id: "99",
      token_type: "bearer",
      expires_in: 3600,
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
    });
  };
  const input = {
    attempt,
    state,
    registeredRedirect: attempt.redirectUri,
    code: "fixture-code",
    clientId: "test",
    clientSecret: "fixture-only",
  };
  await assert.rejects(
    exchangeTimeCode(
      { ...input, attempt: { ...attempt, actor: "other" } },
      stateStore,
      grant,
      2000,
    ),
  );
  await assert.rejects(
    exchangeTimeCode(
      { ...input, registeredRedirect: "https://example.test/other" },
      stateStore,
      grant,
      2000,
    ),
  );
  assert.equal(
    (await exchangeTimeCode(input, stateStore, grant, 2000)).expiresAt,
    3602000,
  );
  await assert.rejects(exchangeTimeCode(input, stateStore, grant, 2000));
  const expired = await beginTimeState(stateStore, attempt, 1000);
  await assert.rejects(
    exchangeTimeCode({ ...input, state: expired }, stateStore, grant, 301000),
  );
  assert.equal(sent, 1);
});

test("project metadata is limited to the exact jobcode with no fallback", async () => {
  const project = { id: 17, jobcode_id: 42, parent_jobcode_id: 0, name: "Time planning", status: "not_started", active: true, notes: "private" };
  const reply = (projects: unknown, more = false) =>
    Response.json({ results: { projects }, more });
  let response = reply({ 17: project });
  let calls = 0;
  const client = new TimeClient(async () => "fixture", async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/projects");
    assert.equal(init?.method, "GET");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      jobcode_ids: "42", active: "both", supplemental_data: "no",
    });
    return response;
  }, async () => {});
  assert.deepEqual(await client.projectMetadata("42"), {
    state: "verified", id: "17", parentJobcodeId: null, name: "Time planning", status: "not_started", active: true,
  });
  response = reply([]);
  assert.deepEqual(await client.projectMetadata("42"), { state: "no-match" });
  for (const status of [403, 404]) {
    response = new Response(null, { status });
    assert.deepEqual(await client.projectMetadata("42"), { state: "unavailable" });
  }
  response = new Response(null, { status: 401 });
  await assert.rejects(client.projectMetadata("42"), /authorization/);
  response = reply({ 17: { ...project, jobcode_id: 43 } });
  await assert.rejects(client.projectMetadata("42"), /scope mismatch/);
  response = reply({ 17: project }, true);
  await assert.rejects(client.projectMetadata("42"), /Ambiguous/);
  response = reply({ 17: project, 18: { ...project, id: 18 } });
  await assert.rejects(client.projectMetadata("42"), /Ambiguous/);
  assert.equal(calls, 8);
});

test("aborted Time sessions do not retry or continue pagination", async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = new TimeClient(async () => "fixture", async (_input, init) => {
    calls++;
    controller.abort();
    assert.equal(init?.signal?.aborted, true);
    return Response.json({ results: { timesheets: { 8: row } }, more: true });
  }, async () => {});
  const session = await client.session(controller.signal);
  await assert.rejects(session.read("42", since, before, false));
  assert.equal(calls, 1);
});

test("actor verification rejects conflicting account metadata even when the user and slug match", async () => {
  let reply: Record<string, unknown> = {};
  const user = { id: 7, client_url: "fixture-company", active: true };
  const client = new TimeClient(async () => "fixture", async (input) => {
    assert.equal(new URL(String(input)).pathname, "/api/v1/current_user");
    return Response.json(reply);
  }, async () => {});
  reply = { results: { users: { 7: user } } };
  await client.verifyActor("fixture-company", "7", "99");
  reply = { ...reply, company_id: 98 };
  await assert.rejects(client.verifyActor("fixture-company", "7", "99"), /account mismatch/);
  reply = { results: { users: { 7: { ...user, company_id: 98 } } } };
  await assert.rejects(client.verifyActor("fixture-company", "7", "99"), /account mismatch/);
});

test("capacity overflow fails without returning an incomplete feed", async () => {
  const pages: string[] = [];
  const client = new TimeClient(async () => "fixture", async (input) => {
    const query = new URL(String(input)).searchParams;
    assert.equal(query.get("jobcode_ids"), "42");
    pages.push(query.get("page")!);
    return Response.json({ results: { timesheets_deleted: { 8: row } }, more: true });
  }, async () => {});
  await assert.rejects(client.read("42", since, before, true), /capacity exceeded/);
  assert.deepEqual(pages, ["1", "2", "3", "4", "5"]);
});
