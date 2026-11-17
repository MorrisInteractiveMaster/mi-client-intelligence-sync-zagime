import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { once } from "node:events";
import { apiServer } from "./http";
import type { ReportingBackend } from "./backend";
test("same-origin inactive preview serves only frontend files and never invokes authenticated data operations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mi-m8-static-"));
  await writeFile(join(dir, "index.html"), "<h1>Synthetic frontend</h1>");
  await writeFile(join(dir, ".env"), "must never be served");
  let accesses = 0;
  const backend = new Proxy(
    {},
    {
      get() {
        accesses++;
        throw Error("Must not acquire database");
      },
    },
  ) as ReportingBackend;
  const server = apiServer(backend, { frontend: dir, previewOnly: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const root = await fetch(base + "/");
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Synthetic frontend/);
    assert.match(
      root.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.match(root.headers.get("content-security-policy")!, /script-src 'self' https:\/\/apis\.google\.com;/);
    assert.ok(!root.headers.get("content-security-policy")!.includes("unsafe-eval"));
    assert.equal((await fetch(base + "/.env")).status, 503);
    assert.equal(
      (await fetch(base + "/api/tenants/synthetic-zagime/workspace")).status,
      503,
    );
    assert.equal(
      ((await fetch(base + "/healthz").then((r) => r.json())) as any).status,
      "inactive-preview",
    );
    assert.equal(accesses, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("mi-m8-static-"));
    await rm(dir, { recursive: true, force: true });
  }
});
