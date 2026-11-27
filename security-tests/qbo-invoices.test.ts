import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { build } from "esbuild";
import { chromium, firefox, webkit } from "playwright";
import type { ReportingBackend } from "../server/backend";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { apiServer, RequestLimit } from "../server/http";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { QboInvoices } from "../server/qbo-invoices";
import { QboInvoicesProvider } from "../server/qbo-invoices-provider";
import { projectView, type Project } from "../src/projects/model";

test("invoice connection, mirror, publication, and responsive workspaces are tenant scoped", { timeout: 160_000 }, async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-invoice-browser";
  const directory = await mkdtemp(join(tmpdir(), "mi-qbo-invoices-"));
  const root = runtime.db.collection("tenants").doc(tenant);
  await seedProjectSynthetic(runtime.db, tenant, true);
  const p1 = "synthetic-delivery", p2 = "synthetic-planning";
  for (const [id, name] of [[p1, "Board reporting"], [p2, "Regular consulting"]]) {
    const ref = root.collection("projects").doc(id);
    const project = { ...(await ref.get()).data(), name, published: true } as Project;
    await ref.set(project);
    await root.collection("projectViews").doc(id).set(projectView(project, 0));
  }
  for (const [id, projectIds] of [["client", [p1, p2]], ["limited", [p1]], ["empty", []]] as const)
    await root.collection("memberships").doc(key(id)).set({
      schemaVersion: 2, tenantId: tenant, subject: id, role: "client", approved: true, enabled: true, projectIds,
    });
  const timeSentinel = root.collection("timeMappings").doc("invoice-isolation-check");
  await timeSentinel.set({ untouched: true });
  const now = () => new Date("2026-11-27T16:00:00Z").getTime();
  const store = new ProjectStore(runtime.db, "owner");
  const projects = new ProjectBackend(store, { async verify(value) {
    const subject = value.slice(7);
    return { subject, issuer: "fixture", audience: "fixture", expiresAt: now() + 60_000, disabled: false, revoked: false,
      ...(subject === "owner" || subject === "staff" ? { corporatePolicy: true, staffTenantId: tenant } : {}) };
  } }, { issuer: "fixture", audience: "fixture", now });
  const fixture = { Id: "1", DocNumber: "1024", TxnDate: "2026-11-01", DueDate: "2026-11-27", TotalAmt: 7800, Balance: 5800,
    CustomerRef: { value: "600", name: "Synthetic private customer" }, ProjectRef: { value: "31" },
    PrivateNote: "QBO-PRIVATE-NOTE", Line: [{ Description: "Related work order WO1267." }],
  };
  const paid = { ...fixture, Id: "2", DocNumber: "1018", Balance: 0, TxnDate: "2026-10-21", Line: [] };
  const next = { ...fixture, Id: "3", DocNumber: "1030", TotalAmt: 2100, Balance: 2100, DueDate: "2026-12-04", Line: [] };
  let fixtureRows = [fixture, paid, next], refreshes = 0, disconnected = false, upstreamFailure = false;
  const cfg = {
    tenant, realm: "123", customerIds: ["600"], currency: "CAD", clientId: "fixture", clientSecret: "fixture",
    key: Buffer.alloc(32, 1), sandbox: true, redirect: "",
    mappings: [{ projectId: p1, qboProjectId: "31" }, { projectId: p2, workOrder: "WO1267" }],
  };
  const provider = new QboInvoicesProvider(cfg, async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("tokens/bearer")) {
      const form = init?.body as URLSearchParams;
      if (form.get("grant_type") === "authorization_code") assert.equal(form.get("code"), "synthetic-code");
      else {
        assert.equal(form.get("refresh_token"), "synthetic-refresh-" + refreshes);
        refreshes++;
      }
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh-" + refreshes });
    }
    if (url.pathname.endsWith("tokens/revoke")) { disconnected = true; return new Response(null, { status: 200 }); }
    assert.match(url.searchParams.get("query")!, /from Invoice where CustomerRef = '600'/);
    return upstreamFailure ? new Response(null, { status: 502 }) : Response.json({ QueryResponse: { Invoice: fixtureRows } });
  });
  const options = { projects, invoices: new QboInvoices(store, provider, now), frontend: directory,
    allowedOrigin: "", limit: new RequestLimit(2000) };
  const server = apiServer(undefined as unknown as ReportingBackend, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
  options.allowedOrigin = origin;
  cfg.redirect = origin + "/qbo-invoice-callback.html";
  const call = (role: string, action = "", body?: Record<string, unknown>, scope = tenant) =>
    fetch(origin + "/api/v2/tenants/" + scope + "/invoices" + action, { headers: {
      Authorization: "Bearer " + role, ...(body && { "Content-Type": "application/json" }),
    }, ...(body && { method: "POST", body: JSON.stringify(body) }) });
  try {
    await build({
      stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {PlatformApplication} from "./src/api/PlatformApplication"; import {SecuredApiClient} from "./src/api/client";
        import {ThemeSelector,usePlatformTheme} from "./src/api/PlatformTheme"; import "./src/api/secure.css";
        import "./src/api/platform.css"; import "./src/api/platform-theme.css";
        const api = new SecuredApiClient(true, location.origin, async () => window.__role, fetch, undefined, "projects");
        const tenant = ${JSON.stringify(tenant)};
        function App({workspace}) { const {theme,appearance,change} = usePlatformTheme();
          return <div className="nordic secure-shell platform-shell" data-theme={theme}>
            <ThemeSelector theme={appearance} onChange={change} />
            <PlatformApplication client={api} workspace={workspace} month="2026-11" unsaved={false} onUnsavedChange={()=>{}} onDenied={()=>{}} />
          </div>; }
        api.call(tenant, "workspace").then(workspace => createRoot(document.getElementById("root")).render(<App workspace={workspace}/>));`,
        resolveDir: process.cwd(), loader: "jsx" },
      bundle: true, outfile: join(directory, "test.js"), jsx: "automatic", external: ["/branding/*"],
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' },
      loader: { ".woff2": "file", ".woff": "file" },
    });
    await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/test.css"><div id="root"></div><script src="/test.js" defer></script></html>');
    await cp(resolve("public/branding"), join(directory, "branding"), { recursive: true });
    for (const ext of ["html", "js"]) await cp(resolve("public/qbo-invoice-callback." + ext), join(directory, "qbo-invoice-callback." + ext));
    assert.equal((await call("stranger")).status, 403);
    assert.equal((await call("client", "/connect", {})).status, 403);
    assert.equal((await call("staff", "/connect", {})).status, 403);
    assert.equal((await call("owner", "", undefined, "unrelated-tenant")).status, 403);
    assert.equal((await call("client", "?preview=published")).status, 403);
    const begin = await call("owner", "/connect", {});
    const state = new URL((await begin.json()).url).searchParams.get("state")!;
    assert.equal((await call("owner", "/callback", { realm: "124", state, code: "synthetic-code" })).status, 403);
    assert.equal((await call("owner", "/callback", { realm: "123", state, code: "incorrect-state", extra: "forbidden" })).status, 400);

    const evidence = resolve("test-results/platform-routes-browser/qbo-invoices");
    await mkdir(evidence, { recursive: true });
    const browser = await chromium.launch();
    try {
      const staff = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      await staff.addInitScript(() => { Reflect.set(window, "__role", "owner"); });
      await staff.route("https://appcenter.intuit.com/**", route => {
        const state = new URL(route.request().url()).searchParams.get("state")!;
        return route.fulfill({ status: 302, headers: { location: cfg.redirect + "?code=synthetic-code&realmId=123&state=" + state } });
      });
      const page = await staff.newPage();
      await page.goto(origin + "/workspace/invoices");
      await page.getByRole("button", { name: "Connect QuickBooks Online" }).click();
      await page.getByText("QuickBooks Online connected. Sync invoices to review them.").waitFor();
      await page.getByRole("button", { name: "Sync invoices" }).click();
      await page.getByText("3 invoices synced from QuickBooks Online.").waitFor();
      await page.getByRole("article", { name: "Invoice 1024" }).waitFor();
      assert.equal(await page.getByRole("navigation", { name: "Morris workspace sections" }).getByRole("button", { name: "Invoices" }).getAttribute("aria-description"), "2 outstanding");
      await page.screenshot({ path: join(evidence, "staff-1440-light.png"), fullPage: true, animations: "disabled" });
      assert.deepEqual((await (await call("client")).json()).invoices, []);
      assert.equal((await call("owner", "/callback", { realm: "123", state, code: "synthetic-code" })).status, 403);
      const connection = (await root.collection("invoiceIntegration").doc("connection").get()).data()!;
      assert.equal(typeof connection.token, "string");
      assert.doesNotMatch(JSON.stringify(connection), /synthetic-refresh/);
      for (const number of ["1024", "1030"]) {
        page.once("dialog", dialog => dialog.accept());
        const row = page.getByRole("article", { name: "Invoice " + number });
        await row.getByRole("button", { name: "Approve for client" }).click();
        await row.getByText("Approved for client", { exact: true }).waitFor();
      }
      const limited = (await (await call("limited")).json()).invoices;
      assert.deepEqual(limited.map((row: { number: string }) => row.number), ["1030"]);
      const client = await browser.newContext({ viewport: { width: 768, height: 1024 }, reducedMotion: "reduce" });
      await client.addInitScript(() => { Reflect.set(window, "__role", "client"); });
      const portal = await client.newPage();
      await portal.goto(origin + "/clients/zagime/invoices");
      await portal.getByRole("article", { name: "Invoice 1024" }).getByText("Due today").waitFor();
      assert.equal(await portal.getByRole("button", { name: "Sync invoices" }).count(), 0);
      assert.doesNotMatch(JSON.stringify(await (await call("client")).json()), /QBO-PRIVATE-NOTE|Synthetic private customer|approval|customerId/);
      await portal.getByLabel("Payment status").selectOption("partiallyPaid");
      await portal.getByText("1 matching invoice · 2 total").waitFor();
      await portal.getByLabel("Project", { exact: true }).selectOption(p2);
      await portal.getByText("1 matching invoice · 2 total").waitFor();
      await portal.getByLabel("Invoice month").selectOption("all");
      await portal.reload();
      await portal.getByText("1 matching invoice · 2 total").waitFor();
      await portal.screenshot({ path: join(evidence, "client-768-light.png"), fullPage: true, animations: "disabled" });
      for (const [engine, type] of [["firefox", firefox], ["webkit", webkit]] as const) {
        const mobile = await type.launch();
        try {
          const context = await mobile.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", colorScheme: "dark" });
          await context.addInitScript(() => { Reflect.set(window, "__role", "client"); });
          const phone = await context.newPage();
          await phone.goto(origin + "/clients/zagime/invoices");
          await phone.getByRole("article", { name: "Invoice 1024" }).waitFor();
          assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await phone.locator('button[aria-label="Invoices"][aria-description="1 overdue or due today"]').count() > 0, true);
          await phone.screenshot({ path: join(evidence, "client-390-dark-" + engine + ".png"), fullPage: true, animations: "disabled" });
        } finally { await mobile.close(); }
      }

      const empty = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await empty.addInitScript(() => { Reflect.set(window, "__role", "empty"); });
      const noProjects = await empty.newPage();
      await noProjects.goto(origin + "/clients/zagime");
      await noProjects.getByText("No approved delivery projects yet").waitFor();
      assert.equal(await noProjects.getByRole("region", { name: "Project Portfolio Distribution" }).count(), 0);
      await noProjects.screenshot({ path: join(evidence, "client-empty-leadership-390.png"), fullPage: true, animations: "disabled" });
      await noProjects.goto(origin + "/clients/zagime/invoices");
      await noProjects.getByText("No approved invoices yet").waitFor();
    } finally { await browser.close(); }

    const before = (await (await call("owner")).json()).invoices.find((row: { number: string }) => row.number === "1024");
    fixtureRows = [{ ...fixture, Balance: 0 }, paid, next];
    assert.equal((await call("owner", "/sync", {})).status, 200);
    assert.equal((await (await call("client")).json()).invoices.find((row: { number: string }) => row.number === "1024").balance, 0);
    upstreamFailure = true;
    assert.equal((await call("owner", "/sync", {})).status, 503);
    assert.equal((await (await call("client")).json()).invoices.length, 2, "failed refresh retains the approved mirror");
    upstreamFailure = false;
    fixtureRows = [{ ...fixture, TotalAmt: 6000 }, paid, next];
    assert.equal((await call("owner", "/sync", {})).status, 200);
    assert.equal((await call("owner", "/approval", { id: "1", approved: true, revision: before.approval.revision })).status, 409);
    assert.equal((await (await call("client")).json()).invoices.length, 1);
    await root.collection("projectViews").doc(p1).update({ published: false });
    assert.deepEqual((await (await call("client")).json()).invoices, []);
    assert.equal((await call("owner", "/disconnect", {})).status, 200);
    assert.equal(disconnected, true);
    assert.equal((await root.collection("invoiceIntegration").doc("mirror").get()).exists, false);
    assert.deepEqual((await timeSentinel.get()).data(), { untouched: true });
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
