import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { m5Fixture, PASSWORD } from "../security-tests/m5-fixture";
import { key } from "../server/firestore-store";
// Run only inside demo Auth+Firestore emulators. Playwright can be installed in an isolated tools directory.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.M5_PLAYWRIGHT_PACKAGE ?? "playwright");
const f = await m5Fixture(8081);
const env = {
  ...process.env,
  VITE_ENABLE_SECURE_API: "true",
  VITE_AUTH_EMULATOR: "true",
  VITE_FIREBASE_PROJECT_ID: "demo-mi-security",
  VITE_FIREBASE_APP_ID: "synthetic-emulator-web",
  VITE_FIREBASE_AUTH_DOMAIN: "demo-mi-security.firebaseapp.com",
  VITE_FIREBASE_API_KEY: "synthetic-emulator-key",
  VITE_SECURE_API_ORIGIN: "http://127.0.0.1:8081",
  VITE_SECURE_TENANT_ID: "m5-lab",
};
const vite = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ],
  { env, stdio: "ignore" },
);
let browser: any, page: any, defaultVite: ReturnType<typeof spawn> | undefined;
const evidence = process.env.MI_BROWSER_EVIDENCE_DIR ?? "docs/qa-m5";
await mkdir(evidence, { recursive: true });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5173")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [],
    apiRequests: string[] = [];
  page.on("response", (r: any) => {
    if (r.url().startsWith(f.base + "/api/"))
      console.log("API", r.status(), new URL(r.url()).pathname);
  });
  page.on("pageerror", (e: Error) => errors.push(e.message));
  page.on("request", (r: any) => {
    if (r.url().startsWith(f.base + "/api/"))
      apiRequests.push(r.method() + " " + new URL(r.url()).pathname);
  });
  async function login(uid: string) {
    await page.goto("http://127.0.0.1:5173/#/secure");
    await page.getByLabel("Synthetic email").fill(uid + "@example.com");
    await page.getByLabel("Synthetic password").fill(PASSWORD);
    await page
      .getByRole("button", { name: "Sign in to local emulator" })
      .click();
    await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();
  }
  await login("m5-admin");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .waitFor();
  for (const width of [1440, 1366, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(150);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `overflow at ${width}`,
    );
    await page.screenshot({
      path: `${evidence}/staff-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Browser synthetic secure delivery");
  await page.getByLabel("Planned hours", { exact: true }).fill("20");
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: evidence + "/create-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const creationKeys: string[] = [];
  let dropped = false;
  await page.route("**/api/tenants/m5-lab/projects", async (route: any) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    creationKeys.push(route.request().headers()["idempotency-key"]);
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByText("Outcome is uncertain.", { exact: false }).waitFor();
  await page
    .getByRole("button", { name: "Retry same creation", exact: true })
    .click();
  await page.getByText("Project created privately.", { exact: true }).waitFor();
  assert.equal(creationKeys.length, 2);
  assert.equal(creationKeys[0], creationKeys[1]);
  assert.equal(
    (
      await f.root
        .collection("projects")
        .where("name", "==", "Browser synthetic secure delivery")
        .get()
    ).size,
    1,
  );
  let card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Browser synthetic secure delivery",
      exact: true,
    }),
  });
  await card.getByText("Private", { exact: true }).waitFor();
  await card.getByRole("button", { name: "Edit project", exact: true }).click();
  await page
    .getByLabel("Project name", { exact: true })
    .fill("Browser updated secure delivery");
  await page.getByLabel("Planned hours", { exact: true }).fill("24");
  await page.getByLabel("Progress (%)", { exact: true }).fill("40");
  await page
    .getByLabel("Optional work-order reference", { exact: true })
    .fill("SYNTHETIC-BROWSER-REF");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await page.getByText("Project saved.", { exact: true }).waitFor();
  card = page.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Browser updated secure delivery",
      exact: true,
    }),
  });
  await card.getByText("SYNTHETIC-BROWSER-REF", { exact: false }).waitFor();
  await card.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Project published.", { exact: true }).waitFor();
  if (process.env.MI_BROWSER_M8 === "true") {
    await page.getByText("Audit activity",{exact:true}).click();
    await page.getByRole("button",{name:"Load audit activity",exact:true}).click();
    await page.getByText("Audit activity loaded.",{exact:true}).waitFor();
    await page.getByText(/publication-changed/).first().waitFor();
    await page.screenshot({path:evidence+"/audit-activity.png",fullPage:true});
  }
  await page
    .getByRole("button", { name: "Time allocation", exact: true })
    .click();
  const source = page.locator("article").filter({
    has: page.getByText("Synthetic unallocated time", { exact: true }),
  });
  await source.getByRole("button", { name: "Review split" }).click();
  await page.getByRole("button", { name: "Add split", exact: true }).click();
  await page.getByLabel("Hours", { exact: true }).fill("1");
  await page
    .getByLabel("Reporting description", { exact: true })
    .fill("Synthetic browser split");
  await page
    .getByRole("button", { name: "Save reporting split", exact: true })
    .click();
  await page
    .getByText("Reporting split saved. Source time unchanged.", { exact: true })
    .waitFor();
  await page
    .locator("article")
    .filter({
      has: page.getByText("Synthetic unallocated time", { exact: true }),
    })
    .getByText("1 h unallocated", { exact: true })
    .waitFor();
  await page
    .locator("article")
    .filter({
      has: page.getByText("Synthetic unallocated time", { exact: true }),
    })
    .getByRole("button", { name: "Review split" })
    .click();
  await page
    .getByRole("button", { name: "View allocation history", exact: true })
    .click();
  await page.getByText("Allocation history loaded.", { exact: true }).waitFor();
  await page.screenshot({
    path: `${evidence}/allocation-history.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: evidence + "/allocation-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const beforeTabRequests = apiRequests.length;
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: "Time allocation", exact: true })
    .click();
  await page.waitForTimeout(200);
  assert.equal(apiRequests.length, beforeTabRequests);
  await page.getByLabel("Reporting month").fill("2026-09");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page.screenshot({
    path: `${evidence}/staff-previous-month.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login("m5-editor");
  await page
    .getByRole("button", { name: "New project", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Publish", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: "Unpublish", exact: true }).count(),
    0,
  );
  await page.screenshot({ path: `${evidence}/editor.png`, fullPage: true });
  await f.root
    .collection("memberships")
    .doc(key("m5-editor"))
    .update({ approved: false });
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click();
  await page
    .getByText("Access changed. Sign out and sign in again.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "New project", exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const clientStart = apiRequests.length;
  await login("m5-client");
  await page
    .getByRole("heading", { name: "Morris synthetic staging lab", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "New project", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Time allocation", exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: `${evidence}/client.png`, fullPage: true });
  assert.ok(
    !apiRequests.slice(clientStart).some((p) => /sources|projects/.test(p)),
  );
  defaultVite = spawn(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "--host",
      "127.0.0.1",
      "--port",
      "5174",
      "--strictPort",
    ],
    {
      env: { ...process.env, VITE_ENABLE_SECURE_API: "false" },
      stdio: "ignore",
    },
  );
  let defaultReady = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:5174")).ok) {
        defaultReady = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(defaultReady);
  const demo = await browser.newPage({ viewport: { width: 390, height: 900 } }),
    protectedRequests: string[] = [];
  demo.on("request", (r: any) => {
    if (/(9099|8081|identitytoolkit|securetoken)/.test(r.url()))
      protectedRequests.push(new URL(r.url()).pathname);
  });
  await demo.goto("http://127.0.0.1:5174/#/secure");
  await demo
    .getByRole("heading", { name: "Protected workspace unavailable" })
    .waitFor();
  await demo.waitForTimeout(150);
  assert.deepEqual(protectedRequests, []);
  await demo.screenshot({
    path: evidence + "/disabled-default.png",
    fullPage: true,
  });
  await demo.goto("http://127.0.0.1:5174/#/");
  await demo.getByLabel("Prototype role").waitFor();
  assert.ok(
    await demo.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await demo.screenshot({
    path: evidence + "/synthetic-demo.png",
    fullPage: true,
  });
  await demo.close();
  assert.deepEqual(errors, []);
  await writeFile(
    `${evidence}/results.json`,
    JSON.stringify(
      {
        syntheticOnly: true,
        viewports: [1440, 1366, 768, 390],
        overflow: false,
        adminCreateEditPublish: true,
        createResponseLostThenRetried: true,
        sameIdempotencyKey: true,
        duplicateProjects: 0,
        allocationAndHistory: true,
        cosmeticTabReads: 0,
        editorPublicationControls: false,
        membershipRevocationClearsStaff: true,
        clientInternalRequests: 0,
        disabledDefaultProtectedRequests: 0,
        syntheticDemoPreserved: true,
        pageErrors: errors,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("M5 secured browser workflows passed. Evidence: docs/qa-m5");
} catch (e) {
  if (page) {
    console.log(await page.locator("body").innerText());
    await page.screenshot({ path: evidence + "/failure.png", fullPage: true });
  }
  throw e;
} finally {
  await browser?.close();
  vite.kill();
  defaultVite?.kill();
  await f.close();
}
