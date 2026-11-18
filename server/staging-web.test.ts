import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve, basename } from "node:path";
import { once } from "node:events";
import { apiServer, RequestLimit } from "./http";
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
  const server = apiServer(backend, {
    frontend: dir,
    previewOnly: true,
    limit: new RequestLimit(3),
  });
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
    assert.match(
      root.headers.get("content-security-policy")!,
      /script-src 'self' https:\/\/apis\.google\.com;/,
    );
    assert.ok(
      !root.headers.get("content-security-policy")!.includes("unsafe-eval"),
    );
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
    for (let i = 0; i < 4; i++)
      assert.equal((await fetch(base + "/")).status, 200);
    assert.equal(
      (await fetch(base + "/api/tenants/synthetic-zagime/workspace")).status,
      429,
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("mi-m8-static-"));
    await rm(dir, { recursive: true, force: true });
  }
});
test("preview public assets accept browser Origin headers with correct MIME; protected API origin policy stays closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mi-preview-origin-"));
  await mkdir(join(dir, "assets"));
  for (const [file, content] of [
    ["entry.js", "export const example=1;"],
    ["main.css", "body{color:black}"],
    ["font.woff2", "synthetic-font"],
    ["brand.jpeg", "synthetic-jpeg"],
    ["brand.jpg", "synthetic-jpeg"],
  ])
    await writeFile(join(dir, "assets", file), content);
  let accesses = 0;
  const backend = new Proxy(
    {},
    {
      get() {
        accesses++;
        throw Error("No preview database access");
      },
    },
  ) as ReportingBackend;
  const server = apiServer(backend, { frontend: dir, previewOnly: true });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const [file, mime] of [
      ["entry.js", "text/javascript"],
      ["main.css", "text/css"],
      ["font.woff2", "font/woff2"],
      ["brand.jpeg", "image/jpeg"],
      ["brand.jpg", "image/jpeg"],
    ]) {
      for (const origin of [base, "https://untrusted.example"]) {
        const asset = await fetch(base + "/assets/" + file, {
          headers: { Origin: origin },
        });
        assert.equal(asset.status, 200);
        assert.equal(asset.headers.get("content-type"), mime);
        assert.equal(asset.headers.get("access-control-allow-origin"), null);
      }
    }
    const head = await fetch(base + "/assets/entry.js", {
      method: "HEAD",
      headers: { Origin: base },
    });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const missing = await fetch(base + "/assets/missing.css", {
      headers: { Origin: base },
    });
    assert.equal(missing.status, 404);
    assert.equal(
      missing.headers.get("content-type"),
      "text/plain; charset=utf-8",
    );
    assert.equal((await fetch(base+"/assets/missing.unknown",{headers:{Origin:base}})).status,404);
    assert.equal(
      (await fetch(base + "/api/tenants/synthetic-zagime/workspace")).status,
      503,
    );
    assert.equal(
      (
        await fetch(base + "/api/tenants/synthetic-zagime/workspace", {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/.env", {
          headers: { Origin: "https://untrusted.example" },
        })
      ).status,
      403,
    );
    assert.equal(accesses, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("mi-preview-origin-"));
    await rm(dir, { recursive: true, force: true });
  }
});
