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
import { invoiceSchedulePath } from "../server/qbo-invoice-scheduler";
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
    const project = { ...(await ref.get()).data(), name, published: true,
      workOrderReference: id === p1 ? "WO1268" : "WO1267" } as Project;
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
  const unmapped = { ...fixture, Id: "4", DocNumber: "1031", ProjectRef: undefined, Line: [], DueDate: "2026-12-12" };
  const next = { ...fixture, Id: "3", DocNumber: "1030", TotalAmt: 2100, Balance: 2100, DueDate: "2026-12-04", Line: [] };
  let queryBarrier: Promise<void> | undefined;
  let reportQuery: (() => void) | undefined;
  let fixtureRows = [fixture, paid, next, unmapped], refreshes = 0, disconnected = false, upstreamFailure = false;
  const customers = [
    { Id: "600", DisplayName: "Zagimē Synthetic Nation", Active: true },
    { Id: "601", DisplayName: "WO1267 — Regular consulting", Job: true, ParentRef: { value: "600" }, Active: true },
    { Id: "602", DisplayName: "WO1267.1 — Historical review", Job: true, ParentRef: { value: "601" }, Active: false },
    { Id: "900", DisplayName: "Zagimē Synthetic Nation Foundation", Active: true },
  ];
  const native = [{ id: "31", name: "WO1268 — Board reporting", status: "OPEN", account: { id: "123" }, customer: { id: "600" } }];
  const queriedCustomers: string[] = [];
  const cfg = {
    tenant, realm: "", customerIds: [], currency: "", clientId: "fixture", clientSecret: "fixture",
    key: Buffer.alloc(32, 1), sandbox: true, redirect: "", nativeProjects: true, mappings: [],
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
    if (url.pathname.endsWith("/companyinfo/124")) return new Response(null, { status: 403 });
    if (url.pathname.endsWith("/companyinfo/123")) return Response.json({ CompanyInfo: { CompanyName: "Synthetic Morris Company" } });
    if (url.pathname.endsWith("/preferences")) return Response.json({ Preferences: { CurrencyPrefs: { HomeCurrency: { value: "CAD" } } } });
    const customerId = /\/customer\/(\d+)$/.exec(url.pathname)?.[1];
    if (customerId) return Response.json({ Customer: customers.find(row => row.Id === customerId) });
    if (url.pathname === "/graphql") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-access");
      assert.ok(JSON.parse(String(init?.body)).variables.filter.customer.in.every((row: { id: string }) => /^\d+$/.test(row.id)));
      assert.match(String(init?.body), /query InvoiceProjects/);
      return Response.json({ data: { projectManagementProjects: { pageInfo: { hasNextPage: false }, edges: native.map(node => ({ node })) } } });
    }
    const query = url.searchParams.get("query")!;
    if (query.includes("from Customer")) return Response.json({ QueryResponse: { Customer: customers } });
    reportQuery?.();
    await queryBarrier;
    const match = /from Invoice where CustomerRef = '(\d+)'/.exec(query);
    assert.ok(match);
    queriedCustomers.push(match[1]);
    return upstreamFailure ? new Response(null, { status: 502 }) : Response.json({ QueryResponse: { Invoice: fixtureRows.filter(row => row.CustomerRef.value === match[1]) } });
  });
  const options = { projects, invoices: new QboInvoices(store, provider, now), frontend: directory,
    allowedOrigin: "", limit: new RequestLimit(2000),
    authorizeInvoiceSchedule: async (auth: string) => {
      if (auth !== "Bearer synthetic-schedule") throw Error("Unauthenticated");
      return "invoice-scheduler@example.invalid";
    } };
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
  const scheduled = (role = "synthetic-schedule") => fetch(origin + invoiceSchedulePath, { method: "POST", headers: { Authorization: "Bearer " + role } });
  try {
    assert.equal((await scheduled("owner")).status, 401);
    await build({
      stdin: { contents: `import React from "react"; import {createRoot} from "react-dom/client";
        import {PlatformApplication} from "./src/api/PlatformApplication"; import {SecuredApiClient} from "./src/api/client";
        import {ThemeSelector,usePlatformTheme} from "./src/api/PlatformTheme"; import {WorkspaceSessionControls,WorkspaceAccount} from "./src/api/WorkspaceToolbar"; import "./src/reporting/nordic.css"; import "./src/api/secure.css";
        import "./src/api/platform.css"; import "./src/api/platform-theme.css";
        const api = new SecuredApiClient(true, location.origin, async () => window.__role, undefined, undefined, "projects");
        const tenant = ${JSON.stringify(tenant)};
        function App({workspace}) { const {theme,appearance,change} = usePlatformTheme();
          return <WorkspaceSessionControls.Provider value={<><ThemeSelector theme={theme} onChange={change} compact /><WorkspaceAccount onSignOut={()=>{}} /></>}>
          <section className="nordic secure-shell platform-shell" data-theme={appearance} data-workspace="true">
            <PlatformApplication client={api} workspace={workspace} month="2026-11" unsaved={false} onUnsavedChange={()=>{}} onDenied={()=>{}} />
          </section></WorkspaceSessionControls.Provider>; }
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
    assert.equal((await call("staff", "/connect", {})).status, 200);
    assert.equal((await (await call("staff")).json()).canManage, true);
    assert.equal((await (await call("client")).json()).canManage, undefined);
    assert.equal((await call("stranger", "/connect", {})).status, 403);
    assert.equal((await call("owner", "", undefined, "unrelated-tenant")).status, 403);
    assert.equal((await call("client", "?preview=published")).status, 403);
    const begin = await call("owner", "/connect", {});
    const state = new URL((await begin.json()).url).searchParams.get("state")!;
    assert.equal((await call("owner", "/callback", { realm: "124", state, code: "synthetic-code" })).status, 503);
    assert.equal((await call("owner", "/sync", {})).status, 503);
    assert.equal(queriedCustomers.length, 0);
    assert.equal((await call("owner", "/callback", { realm: "123", state, code: "incorrect-state", extra: "forbidden" })).status, 400);

    const evidence = resolve("test-results/platform-routes-browser/qbo-invoices");
    await mkdir(evidence, { recursive: true });
    const browser = await chromium.launch();
    try {
      const staff = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      await staff.addInitScript(() => { Reflect.set(window, "__role", "staff"); });
      await staff.route("https://appcenter.intuit.com/**", route => {
        const state = new URL(route.request().url()).searchParams.get("state")!;
        return route.fulfill({ status: 302, headers: { location: cfg.redirect + "?code=synthetic-code&realmId=123&state=" + state } });
      });
      const page = await staff.newPage();
      const browserErrors: string[] = [];
      page.on("pageerror", error => browserErrors.push(error.message));
      page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
      await page.goto(origin + "/workspace/invoices");
      try {
        const connect = page.getByRole("button", { name: "Connect QuickBooks Online", exact: true });
        await connect.waitFor({ timeout: 8000 });
        await page.screenshot({ path: join(evidence, "qbo-disconnected-verified-staff-1440.png") });
        await connect.click();
      } catch (error) {
        throw new Error("Staff invoice screen did not load: " + JSON.stringify(browserErrors) + " " + (await page.locator("body").innerText()).slice(0, 1200), { cause: error });
      }
      await page.getByText("QuickBooks Online connected. Confirm the company and customer.").waitFor();
      const setup = page.getByRole("region", { name: "QuickBooks connection setup" });
      await setup.getByRole("heading", { name: "Synthetic Morris Company" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Sync invoices" }).isDisabled(), true);
      await setup.getByRole("button", { name: "Confirm company" }).click();
      await setup.getByRole("searchbox", { name: "Search for a customer" }).fill("Zagimē Synthetic");
      await setup.getByRole("button", { name: "Search", exact: true }).click();
      await setup.getByRole("button", { name: /Zagimē Synthetic Nation Foundation/ }).waitFor();
      await page.screenshot({ path: join(evidence, "qbo-customer-discovery-1440.png"), fullPage: true, animations: "disabled" });
      await setup.getByRole("button", { name: /Zagimē Synthetic Nation Active/ }).click();
      page.once("dialog", dialog => dialog.accept());
      await setup.getByRole("button", { name: "Confirm customer binding" }).click();
      await setup.getByText("3 discovered projects and jobs · 0 linked").waitFor();
      assert.equal(queriedCustomers.length, 0);
      await setup.getByText(/Customer job · Historical/).waitFor();
      for (const [name, project] of [["WO1267 — Regular consulting", p2], ["WO1268 — Board reporting", p1]]) {
        const row = setup.getByRole("listitem").filter({ hasText: name });
        await row.getByRole("button", { name: "Link to Existing Project" }).click();
        assert.equal(await setup.getByRole("combobox", { name: "Platform project" }).inputValue(), project);
        await setup.getByRole("button", { name: "Confirm link" }).click();
        await row.getByText(/Linked to/).waitFor();
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: join(evidence, "qbo-project-inventory-390.png"), fullPage: true, animations: "disabled" });
      await page.setViewportSize({ width: 1440, height: 900 });
      await setup.getByRole("listitem").filter({ hasText: "Historical review" }).getByRole("link", { name: "Create Project" }).click();
      const draft = page.getByRole("form", { name: "Create a project" });
      assert.equal(await draft.getByRole("textbox", { name: "Project name" }).inputValue(), "WO1267.1 — Historical review");
      await draft.getByRole("button", { name: "Cancel", exact: true }).click();
      await setup.getByText("3 discovered projects and jobs · 2 linked").waitFor();
      assert.equal((await call("client", "/discovery", { action: "search", realm: "123", term: "Zagimē", page: 1 })).status, 403);
      await page.getByRole("button", { name: "Sync invoices" }).click();
      await page.getByText("4 invoices synced from QuickBooks Online.").waitFor();
      assert.deepEqual(new Set(queriedCustomers), new Set(["600", "601", "602"]));
      await page.getByRole("article", { name: "Invoice 1024" }).waitFor();
      assert.equal(await page.getByRole("navigation", { name: "Morris workspace sections" }).getByRole("button", { name: "Invoices" }).getAttribute("aria-description"), "3 outstanding");
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(evidence, "staff-1440-light.png"), fullPage: true, animations: "disabled" });
      const aligned = await page.evaluate(() => {
        const sidebar = document.querySelector(".mi-workspace-sidebar")!.getBoundingClientRect();
        const content = document.querySelector(".mi-workspace-body")!.getBoundingClientRect();
        return Math.abs(sidebar.top - content.top) <= 2;
      });
      assert.equal(aligned, true, "workspace sidebar and content start together");
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      assert.equal(await page.locator('.mi-workspace-sidebar button[aria-label="Invoices"] .mi-nav-notice').isVisible(), true);
      await page.getByRole("button", { name: "Expand navigation" }).click();
      for (const [width, height] of [[768, 1024], [390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: join(evidence, "staff-" + width + "-light.png"), fullPage: true, animations: "disabled" });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
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
      const unlinkedRow = page.getByRole("article", { name: "Invoice 1031" });
      const unlinked = (await (await call("owner")).json()).invoices.find((row: { number: string }) => row.number === "1031");
      const explicit = { id: unlinked.id, revision: unlinked.approval.revision, approved: true };
      assert.equal((await call("owner", "/approval", explicit)).status, 400);
      assert.equal((await call("owner", "/approval", { ...explicit, audience: ["unrelated-profile"] })).status, 400);
      await unlinkedRow.getByRole("button", { name: "Review client audience" }).click();
      const audienceDialog = page.getByRole("dialog", { name: "Choose who can see invoice 1031" });
      await audienceDialog.getByRole("checkbox", { name: new RegExp(key("empty").slice(-8)) }).check();
      await audienceDialog.getByRole("button", { name: "Approve selected profiles" }).click();
      await unlinkedRow.getByText("Approved for client", { exact: true }).waitFor();
      assert.equal((await (await call("empty")).json()).invoices.length, 1);
      await unlinkedRow.getByRole("button", { name: "Withdraw approval" }).click();
      await unlinkedRow.getByText("Staff only", { exact: true }).waitFor();
      const limited = (await (await call("limited")).json()).invoices;
      assert.deepEqual(limited.map((row: { number: string }) => row.number), ["1030"]);
      const client = await browser.newContext({ viewport: { width: 768, height: 1024 }, reducedMotion: "reduce" });
      await client.addInitScript(() => { Reflect.set(window, "__role", "client"); });
      const portal = await client.newPage();
      await portal.goto(origin + "/clients/zagime/invoices");
      await portal.getByRole("article", { name: "Invoice 1024" }).getByText("Due today").waitFor();
      await portal.setViewportSize({ width: 1440, height: 900 });
      await portal.screenshot({ path: join(evidence, "client-1440-light.png"), fullPage: true, animations: "disabled" });
      await portal.setViewportSize({ width: 768, height: 1024 });
      assert.equal(await portal.getByRole("button", { name: "Sync invoices" }).count(), 0);
      const published = await (await call("client")).json();
      assert.doesNotMatch(JSON.stringify(published), /QBO-PRIVATE-NOTE|Synthetic private customer|approval|customerId|connected|configured|token|audience|sourceProjects|setup/);
      assert.notEqual(published.invoices.find((r: { number: string }) => r.number === "1024").id, "1");
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
          assert.equal(await phone.locator(".platform-shell").getAttribute("data-theme"), "dark");
          assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await phone.getByRole("button", { name: "Workspace navigation" }).click();
          const mobileNav = phone.getByRole("dialog", { name: "Workspace menu" });
          assert.equal(await mobileNav.getByRole("button", { name: "Invoices" }).getAttribute("aria-description"), "1 overdue or due today");
          await mobileNav.getByRole("button", { name: "Close menu" }).click();
          await phone.screenshot({ path: join(evidence, "client-390-dark-" + engine + ".png"), fullPage: true, animations: "disabled" });
        } finally { await mobile.close(); }
      }

      upstreamFailure = true;
      assert.equal((await scheduled()).status, 503);
      await portal.reload();
      await portal.getByText("Balances may be out of date").waitFor();
      await portal.screenshot({ path: join(evidence, "client-stale-768-light.png"), fullPage: true, animations: "disabled" });
      await page.reload();
      await page.getByText("Balances may be out of date").waitFor();
      await page.screenshot({ path: join(evidence, "staff-stale-1440-light.png"), fullPage: true, animations: "disabled" });
      upstreamFailure = false;
      fixtureRows = [{ ...fixture, Balance: 0 }, paid, next, unmapped];
      assert.equal((await scheduled()).status, 200);
      await portal.goto(origin + "/clients/zagime/invoices");
      await portal.getByRole("article", { name: "Invoice 1024" }).getByText("Paid", { exact: true }).waitFor();
      assert.equal(await portal.locator('button[aria-label="Invoices"][aria-description]').count(), 0);
      await page.goto(origin + "/clients/zagime?month=2026-11&previewScope=" + key("client"));
      const previewMode = page.getByLabel("Preview mode");
      await previewMode.waitFor();
      const period = page.locator(".reporting-period__stepper");
      const [stepperBox, previewBox] = await Promise.all([period.boundingBox(), previewMode.boundingBox()]);
      assert.ok(stepperBox && previewBox && Math.abs((stepperBox.y + stepperBox.height / 2) - (previewBox.y + previewBox.height / 2)) <= 2,
        "preview picker and reporting stepper share a center line");
      const distribution = page.getByRole("region", { name: "Project Portfolio Distribution" });
      const [options, sortBox] = await Promise.all([
        distribution.getByRole("button", { name: "Departments" }).boundingBox(), distribution.getByLabel("Sort groups").boundingBox(),
      ]);
      assert.ok(options && sortBox && Math.abs((options.y + options.height / 2) - (sortBox.y + sortBox.height / 2)) <= 2,
        "portfolio grouping and sort controls share a center line");
      const signal = page.getByRole("button", { name: "Explain Blocked or at risk" });
      await signal.focus();
      const tooltip = page.getByRole("tooltip").filter({ hasText: /Counts approved projects with an active blocker/ });
      await tooltip.waitFor();
      const [popupBox, cardBox] = await Promise.all([tooltip.boundingBox(), signal.locator("..").boundingBox()]);
      assert.ok(popupBox && cardBox && (popupBox.y >= cardBox.y + cardBox.height || popupBox.y + popupBox.height <= cardBox.y),
        "help tooltip keeps the entire KPI card readable");
      await page.screenshot({ path: join(evidence, "staff-published-preview-1440-light.png"), fullPage: true, animations: "disabled" });
      await page.keyboard.press("Escape");
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
    let unblock!: () => void;
    queryBarrier = new Promise<void>(resolve => { unblock = resolve; });
    const fetching = new Promise<void>(resolve => { reportQuery = resolve; });
    const scheduledSync = scheduled();
    await fetching;
    try {
      assert.equal((await call("owner", "/sync", {})).status, 409);
      assert.equal((await scheduled()).status, 409);
    } finally { unblock(); }
    assert.equal((await scheduledSync).status, 200);
    queryBarrier = undefined;
    reportQuery = undefined;
    assert.equal((await (await call("client")).json()).invoices.find((row: { number: string }) => row.number === "1024").balance, 0);
    upstreamFailure = true;
    assert.equal((await call("owner", "/sync", {})).status, 503);
    const stale = await (await call("client")).json();
    assert.equal(stale.invoices.length, 2, "failed refresh retains the approved mirror");
    assert.equal(stale.freshness, "stale");
    assert.equal(typeof stale.syncedAt, "string");
    upstreamFailure = false;
    fixtureRows = [{ ...fixture, TotalAmt: 6000 }, paid, next];
    assert.equal((await call("owner", "/sync", {})).status, 200);
    assert.equal((await call("owner", "/approval", { id: "1", approved: true, revision: before.approval.revision })).status, 409);
    assert.equal((await (await call("client")).json()).invoices.length, 1);
    assert.equal((await (await call("client")).json()).freshness, "current");
    const reauthorization = await call("owner", "/connect", {});
    const reconnectState = new URL((await reauthorization.json()).url).searchParams.get("state")!;
    assert.equal((await call("owner", "/callback", { realm: "124", state: reconnectState, code: "synthetic-code" })).status, 403);
    assert.equal((await call("owner", "/callback", { realm: "123", state: reconnectState, code: "synthetic-code" })).status, 200);
    assert.equal((await (await call("client")).json()).invoices.length, 1);
    for (const id of ["ambiguous-a", "ambiguous-b"]) {
      const template = (await root.collection("projects").doc(p1).get()).data()!;
      await root.collection("projects").doc(id).set({ ...template, id, name: id, workOrderReference: "WO1411", published: false });
    }
    customers[1].DisplayName = "WO1267 — Renamed consulting";
    customers.push({ Id: "603", DisplayName: "WO1411 — Newly discovered", Job: true, ParentRef: { value: "602" }, Active: true });
    fixtureRows.push({ ...next, Id: "5", DocNumber: "1100", CustomerRef: { value: "603", name: "New scoped project" }, ProjectRef: undefined });
    assert.equal((await scheduled()).status, 200);
    const updated = await (await call("owner")).json();
    assert.ok(updated.setup.projects.some((row: { key: string; linked: string; name: string }) => row.key === "job:601" && row.linked === p2 && /Renamed/.test(row.name)));
    const newlyDiscovered = updated.setup.projects.find((row: { key: string }) => row.key === "job:603");
    assert.equal(newlyDiscovered.newlyDiscovered, true);
    assert.equal(newlyDiscovered.linked, undefined);
    assert.deepEqual(newlyDiscovered.suggestions, ["ambiguous-a", "ambiguous-b"]);
    assert.equal(updated.invoices.find((row: { number: string }) => row.number === "1100").approval.approved, false);
    assert.equal((await (await call("client")).json()).invoices.length, 1);
    // A verified mover disappears even if the subsequent financial query fails.
    native[0].customer.id = "900";
    customers[1].ParentRef!.value = "900";
    upstreamFailure = true;
    assert.equal((await scheduled()).status, 503);
    assert.deepEqual((await (await call("client")).json()).invoices, []);
    upstreamFailure = false;
    native[0].customer.id = "600";
    fixtureRows = [{ ...next, TotalAmt: 0, Balance: 0, PrivateNote: "Voided — fixture" }];
    assert.equal((await scheduled()).status, 200);
    assert.deepEqual((await (await call("owner")).json()).invoices, [], "successful full mirror removes deleted and voided rows");
    const binding = (await (await call("owner")).json()).setup.binding;
    assert.equal((await call("owner", "/discovery", { action: "bind", realm: "123", rootId: "900", bindingId: binding })).status, 200);
    assert.equal((await (await call("owner")).json()).setup.root.id, "900");
    assert.deepEqual((await (await call("client")).json()).invoices, []);
    assert.equal((await call("staff", "/disconnect", {})).status, 400);
    assert.equal((await call("client", "/disconnect", { confirm: true })).status, 403);
    assert.equal((await call("staff", "/disconnect", { confirm: true })).status, 200);
    const audit = (await root.collection("invoiceAudit").get()).docs.map(doc => doc.data());
    for (const action of ["qbo-authorization-started", "qbo-invoices-connected", "qbo-company-confirmed", "qbo-customer-searched", "qbo-customer-bound", "qbo-project-linked", "qbo-invoices-disconnected"]) {
      assert.ok(audit.some(item => item.actor === "staff" && item.action === action), action);
    }
    assert.equal(disconnected, true);
    assert.equal((await root.collection("invoiceIntegration").doc("mirror").get()).exists, false);
    assert.deepEqual((await timeSentinel.get()).data(), { untouched: true });
  } finally {
    await new Promise<void>(done => server.close(() => done()));
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
