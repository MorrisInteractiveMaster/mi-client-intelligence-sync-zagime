import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { apiServer, RequestLimit } from "./http";
import type { ReportingBackend } from "./backend";
test("HTTP rate bucket is bounded and recovers after window", () => {
  let now = 0;
  const l = new RequestLimit(2, () => now);
  assert.equal(l.accept("local"), true);
  assert.equal(l.accept("local"), true);
  assert.equal(l.accept("local"), false);
  now = 60001;
  assert.equal(l.accept("local"), true);
});
test("HTTP internal failure is controlled and subsequent request recovers", async () => {
  let fail = true;
  const backend = {
    async readPublished() {
      if (fail) throw Error("private database transport failure details");
      return { totalSeconds: 0 };
    },
  } as unknown as ReportingBackend;
  const s = apiServer(backend, { limit: new RequestLimit(10) });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const base = `http://127.0.0.1:${(s.address() as any).port}`;
  try {
    const a = await fetch(base + "/api/tenants/t/report?month=2026-10", {
      headers: { Authorization: "Bearer synthetic" },
    });
    assert.equal(a.status, 503);
    assert.deepEqual(await a.json(), { error: "temporarily_unavailable" });
    fail = false;
    assert.equal(
      (
        await fetch(base + "/api/tenants/t/report?month=2026-10", {
          headers: { Authorization: "Bearer synthetic" },
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((r) => s.close(() => r()));
  }
});
test("HTTP rate enforcement ignores spoofed forwarding headers", async () => {
  const backend = {} as ReportingBackend;
  const s = apiServer(backend, {
    allowedOrigin: "https://approved.example",
    limit: new RequestLimit(1),
  });
  s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const url = `http://127.0.0.1:${(s.address() as any).port}/health`;
  try {
    assert.equal(
      (await fetch(url, { headers: { "x-forwarded-for": "1.1.1.1" } })).status,
      200,
    );
    const denied = await fetch(url, {
      headers: {
        "x-forwarded-for": "2.2.2.2",
        Origin: "https://approved.example",
      },
    });
    assert.equal(denied.status, 429);
    assert.equal(
      denied.headers.get("access-control-allow-origin"),
      "https://approved.example",
    );
    assert.deepEqual(await denied.json(), { error: "rate_limited" });
  } finally {
    await new Promise<void>((r) => s.close(() => r()));
  }
});
