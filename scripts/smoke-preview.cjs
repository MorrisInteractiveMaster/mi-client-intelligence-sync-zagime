// Real-browser smoke against the production server/container, never Vite dev.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve } = require("node:path");
const base = new URL(process.argv[2] ?? "http://127.0.0.1:8089");
const broken = process.argv.includes("--expect-broken");
const live = process.argv.includes("--live-read-only");
const liveHost = "mi-client-staging-dashboard-u3xjh6xfkq-nn.a.run.app";
if (
  base.origin !== base.href.replace(/\/$/, "") ||
  base.username ||
  base.password ||
  !(
    base.hostname === "127.0.0.1" ||
    (live &&
      base.protocol === "https:" &&
      (base.hostname === liveHost ||
        base.hostname === "render-check---" + liveHost))
  )
)
  throw Error(
    "Only loopback or the explicit existing read-only staging URL is allowed",
  );
const output = resolve(
  process.env.BROWSER_EVIDENCE_DIR ?? "test-results/preview-browser",
);
const report = {
  target: base.origin,
  expectedBaselineFailure: broken,
  routes: [],
  errors: [],
  failedAssets: [],
  csp: [],
  assets: [],
  externalRequests: [],
  firestoreRequests: [],
  faultStates: [],
};
let browser;
let closeForwarder;
const failures = [];
async function observe(context, page) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      /firestore\.googleapis\.com|firestore\..*googleapis\.com/.test(
        url.hostname,
      )
    )
      report.firestoreRequests.push({ host: url.hostname, path: url.pathname });
    if (
      url.origin !== base.origin &&
      ["http:", "https:"].includes(url.protocol)
    ) {
      report.externalRequests.push({ host: url.hostname, path: url.pathname });
      return route.abort("blockedbyclient"); // no external Auth/Firestore interaction in a rendering test
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    window.__previewCsp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__previewCsp.push({
        directive: e.effectiveDirective,
        blocked: e.blockedURI.split("?")[0],
      }),
    );
  });
  page.on("pageerror", (e) =>
    report.errors.push({ kind: "exception", message: e.message }),
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      report.errors.push({
        kind: "console",
        message: m
          .text()
          .replace(/data:[^\s"']+/g, "data:[redacted]")
          .replace(/\?[^\s"']+/g, "?redacted")
          .slice(0, 800),
      });
  });
  page.on("requestfailed", (r) =>
    report.failedAssets.push({
      path: new URL(r.url()).pathname,
      reason: r.failure()?.errorText,
    }),
  );
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (url.origin !== base.origin) return;
    if (/\.(js|css|woff2|png|jpg|jpeg|webp|svg|ico)$/.test(url.pathname)) {
      const mime = r.headers()["content-type"] ?? "";
      const asset = {
        path: url.pathname,
        status: r.status(),
        mime,
        originHeader: r.request().headers().origin ?? null,
      };
      report.assets.push(asset);
      if (r.status() >= 400) report.failedAssets.push(asset);
      if (url.pathname.endsWith(".js") && !/javascript/.test(mime))
        report.failedAssets.push({ ...asset, reason: "wrong JavaScript MIME" });
      if (url.pathname.endsWith(".css") && !mime.startsWith("text/css"))
        report.failedAssets.push({ ...asset, reason: "wrong CSS MIME" });
      if (url.pathname.endsWith(".woff2") && !/font\/woff2/.test(mime))
        report.failedAssets.push({ ...asset, reason: "wrong font MIME" });
      if (/\.(jpg|jpeg)$/.test(url.pathname) && mime !== "image/jpeg")
        report.failedAssets.push({ ...asset, reason: "wrong JPEG MIME" });
      if (url.pathname.endsWith(".webp") && mime !== "image/webp")
        report.failedAssets.push({ ...asset, reason: "wrong WebP MIME" });
    }
  });
}
(async () => {
  await mkdir(output, { recursive: true });
  if (process.env.CONTAINER_HOST) {
    assert.equal(base.hostname, "127.0.0.1");
    closeForwarder = await require("./forward-preview.cjs").forwardPreview(
      process.env.CONTAINER_HOST,
      Number(base.port),
    );
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
  });
  const cases = broken
    ? [{ path: "/#/secure", heading: "Morris protected workspace" }]
    : [
        { path: "/", heading: "Partnership dashboard" },
        { path: "/#/welcome", heading: "Clarity for today." },
        { path: "/#/secure", heading: "Morris protected workspace" },
        {
          path: "/?utm_source=chatgpt.com#/secure",
          heading: "Morris protected workspace",
        },
        { path: "/workspace/projects/new", heading: "Sign in to your workspace", protected: true },
        { path: "/control/branding", heading: "Sign in to your workspace", protected: true },
        { path: "/clients/zagime/present?chapter=3&month=2026-11", heading: "Sign in to your workspace", protected: true },
      ];
  for (const width of broken ? [1440] : [1440, 390]) {
    for (const [i, item] of cases.entries()) {
      const context = await browser.newContext({
        viewport: { width, height: 1000 },
      });
      const page = await context.newPage();
      await observe(context, page);
      try {
        await page.goto(base.origin + item.path, {
          waitUntil: "networkidle",
          timeout: 30000,
        });
        if (broken) {
          assert.equal((await page.locator("#root").innerText()).trim(), "");
          assert.ok(
            report.assets.some(
              (a) => a.status === 403 && a.originHeader === base.origin,
            ),
          );
        } else {
          await page.waitForFunction(
            () => document.documentElement.dataset.applicationState === "ready",
            undefined,
            { timeout: 15000 },
          );
          const heading = page.getByRole("heading", {
            name: new RegExp(item.heading.replace(/\./g, "\\.")),
          });
          await heading.waitFor({ state: "visible", timeout: 10000 });
          if (item.path.includes("secure") || item.protected) {
            await page
              .getByRole("button", {
                name: "Sign in with Microsoft",
                exact: true,
              })
              .waitFor({ state: "visible" });
            await page
              .getByRole("button", { name: "Sign in with Google", exact: true })
              .waitFor({ state: "visible" });
          }
          if (item.path.includes("welcome")) {
            await page.screenshot({
              path: resolve(output, `welcome-${width}.png`),
              fullPage: true,
            });
            await page
              .getByRole("button", { name: /Client experience/ })
              .click();
            await page
              .getByRole("heading", {
                name: "Partnership dashboard",
                exact: true,
              })
              .waitFor();
            assert.equal(new URL(page.url()).hash, "#/");
          }
          await page.evaluate(() => document.fonts.ready);
          if (item.protected) {
            const contrast = await page.locator(".mi-access-card > p").first().evaluate(paragraph => {
              const luminosity = color => {
                const srgb = color.match(/[0-9.]+/g).slice(0, 3).map(value => Number(value) / 255);
                const linear = srgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
                return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
              };
              const foreground = luminosity(getComputedStyle(paragraph).color);
              const background = luminosity(getComputedStyle(paragraph.parentElement).backgroundColor);
              return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
            });
            assert.ok(contrast >= 4.5, "native sign-in instructions contrast");
          }
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            "horizontal overflow",
          );
        }
        report.routes.push({
          path: item.path,
          width,
          rendered: !broken,
          rootTextLength: (await page.locator("#root").innerText()).length,
        });
      } catch (e) {
        failures.push({ path: item.path, width, reason: e.message });
      }
      try {
        report.csp.push(
          ...((await page.evaluate(() => window.__previewCsp)) ?? []),
        );
        await page.screenshot({
          path: resolve(
            output,
            `${broken ? "baseline" : "render"}-${width}-${i}.png`,
          ),
          fullPage: true,
        });
      } catch (e) {
        failures.push({ path: item.path, width, reason: e.message });
      }
      await context.close();
    }
  }
  if (!broken) {
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    assert.equal(
      report.failedAssets.length,
      0,
      JSON.stringify(report.failedAssets),
    );
    assert.equal(report.csp.length, 0, JSON.stringify(report.csp));
    assert.equal(report.firestoreRequests.length, 0);
    assert.ok(
      report.assets.some((a) => a.path.endsWith(".woff2")),
      "No fonts loaded",
    );
    assert.ok(
      report.assets.some(
        (a) => a.path.endsWith(".js") && a.originHeader === base.origin,
      ),
      "Browser Origin-header requests were not exercised",
    );
    const api = await browser.newContext();
    const r = await api.request.get(
      base.origin + "/api/tenants/synthetic-zagime/workspace",
    );
    report.apiStatus = r.status();
    assert.equal(r.status(), 503);
    const projectApi = await api.request.get(base.origin + "/api/v2/tenants/synthetic-zagime-projects/workspace");
    report.projectApiStatus = projectApi.status();
    assert.equal(projectApi.status(), 503);
    await api.close();
    if (!live) {
      // Fail an entry module and a real React DOM operation; no production test hook.
      for (const kind of ["module-load", "react-render"]) {
        const c = await browser.newContext();
        const p = await c.newPage();
        if (kind === "module-load")
          await c.route("**/assets/index-*.js", (route) =>
            route.abort("failed"),
          );
        else
          await p.addInitScript(() => {
            const original = document.createElementNS;
            document.createElementNS = function (namespace, ...args) {
              if (namespace === "http://www.w3.org/2000/svg")
                throw Error("synthetic-private-render-detail");
              return original.call(this, namespace, ...args);
            };
          });
        await p.goto(base.origin + "/", { waitUntil: "networkidle" });
        await p
          .getByRole("heading", {
            name:
              kind === "module-load"
                ? "The dashboard could not be loaded"
                : "The dashboard could not be displayed",
            exact: true,
          })
          .waitFor();
        assert.ok(
          !(await p.locator("body").innerText()).includes(
            "synthetic-private-render-detail",
          ),
        );
        report.faultStates.push({ kind, visibleSafeError: true });
        await p.screenshot({
          path: resolve(output, `${kind}.png`),
          fullPage: true,
        });
        await c.close();
      }
    }
  }
  assert.equal(failures.length, 0, JSON.stringify(failures));
  report.passed = true;
})()
  .catch((e) => {
    report.passed = false;
    report.failure = e.message;
    process.exitCode = 1;
  })
  .finally(async () => {
    report.routeFailures = failures;
    await writeFile(
      resolve(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        passed: report.passed,
        baselineReproduced: broken,
        routes: report.routes.length,
        assets: report.assets.length,
        errors: report.errors.length,
        evidence: output,
        failure: report.failure,
      }),
    );
    await browser?.close();
    await closeForwarder?.();
  });
