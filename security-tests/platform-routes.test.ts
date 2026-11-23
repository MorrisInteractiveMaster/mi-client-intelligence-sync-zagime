import { TimeClient } from "../server/time-client";
import { TimeSync } from "../server/time-sync";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit, type Browser, type Page } from "playwright";
import type { ReportingBackend } from "../server/backend";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { apiServer, RequestLimit } from "../server/http";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { projectView, type Project } from "../src/projects/model";
import { otherContacts } from "../src/projects/other-contacts";

test("native portal URLs keep authenticated roles, approved reporting, editable settings and chapter links across reload and history", { timeout: 210000 }, async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const directory = await mkdtemp(join(tmpdir(), "mi-platform-routes-"));
  const tenant = "synthetic-platform-browser";
  const root = runtime.db.collection("tenants").doc(tenant);
  const projectId = "synthetic-delivery";
  const projectName = "Board reporting pilot";
  const month = "2026-11", previousMonth = "2026-10";
  let now = Date.parse("2026-11-20T16:00:00Z");
  await seedProjectSynthetic(runtime.db, tenant, true);
  const projectRef = root.collection("projects").doc(projectId);
  const backendProject: Project = {
    ...(await projectRef.get()).data() as Project, name: projectName, status: "active", published: true,
    description: "The approved November delivery summary.", internalNotes: "Private staff status discussion",
    delivery: { kind: "project", type: "hourly", managerIds: [], teamIds: [], start: "2026-10-21", deadline: "2026-12-14", publishSummary: true },
  };
  const batch = runtime.db.batch();
  const parentId = "synthetic-planning";
  const parentRef = root.collection("projects").doc(parentId);
  const recordedParent: Project = { ...(await parentRef.get()).data() as Project, name: "Regular Consulting fixture", published: true };
  batch.set(parentRef, recordedParent);
  batch.set(root.collection("projectViews").doc(parentId), projectView(recordedParent, 0));
  for (const period of [month, "lifetime"])
    batch.set(root.collection("timeProjectTotals").doc(parentId).collection("periods").doc(period), { recorded: 74700, allocated: 0 });
  batch.set(root.collection("rawTime").doc("recorded-order-fixture"), {
    schemaVersion: 2, source: "quickbooks-time", scopeProjectId: parentId, deleted: false,
    record: { id: "recorded-order-fixture", tenantId: tenant, sourceWorkOrderId: "132160684", date: month + "-03", revision: "fixture-revision", seconds: 74700 },
  });
  batch.set(projectRef, backendProject);
  batch.set(root.collection("projectViews").doc(projectId), projectView(backendProject, 10800));
  batch.set(root.collection("projectPeriods").doc(key(month, projectId)), { projectId, month, seconds: 7200 });
  batch.set(root.collection("projectPeriods").doc(key(previousMonth, projectId)), { projectId, month: previousMonth, seconds: 3600 });
  batch.set(root.collection("projectPeriods").doc(key("2026-09", projectId)), { projectId, month: "2026-09", seconds: 5400 });
  // Tenant-wide month discovery must never disclose activity for hidden projects.
  batch.set(root.collection("timeMonthlyTotals").doc("2025-05"), { recorded: 99999, allocated: 0 });
  batch.set(root.collection("timeProjectTotals").doc("private-history-fixture").collection("periods").doc("2025-05"), { recorded: 99999, allocated: 0 });
  batch.set(root.collection("memberships").doc(key("client")), {
    schemaVersion: 2, tenantId: tenant, subject: "client", role: "client", approved: true, enabled: true,
    projectIds: [projectId, "synthetic-planning"],
  });
  batch.update(root, { portalSettings: { clientLabel: "", presentationTitle: "November Board Briefing", ownerPublishes: true } });
  await batch.commit();

  await build({
    stdin: {
      contents: `import React, {useState} from "react"; import {createRoot} from "react-dom/client";
        import {PlatformApplication} from "./src/api/PlatformApplication"; import {SecuredApiClient} from "./src/api/client";
        import {ThemeSelector,usePlatformTheme} from "./src/api/PlatformTheme"; import "./src/api/platform-theme.css";
        import {useReportingMonth} from "./src/api/portal-location";
        import "./src/reporting/nordic.css"; import "./src/api/secure.css"; import "./src/api/executive.css";
        import "./src/api/intelligence.css"; import "./src/api/delivery-operations.css"; import "./src/api/platform.css";
        const client=new SecuredApiClient(true, location.origin, async()=>window.__localPortalToken, undefined, undefined, "projects");
        const denied=()=>{document.getElementById("auth-status").textContent="Workspace unavailable."};
        function Portal({workspace}) {
          const {theme,change,appearance}=usePlatformTheme(); const month=useReportingMonth("${month}"), [dirty,setDirty]=useState(false);
          return <section className="nordic secure-shell platform-shell" data-theme={appearance}>
            <header className="secure-masthead"><div className="secure-brandmarks">
              <img src="/branding/zagime/zagime.jpeg" alt="Zagime Anishinabek First Nation"/>
              <img src="/branding/morris/morris-wordmark.png" alt="Morris Interactive"/>
            </div><div className="secure-identity"><p>{location.pathname.startsWith("/clients/") ? "Client portal" : "Morris workspace"}</p></div>
            <div className="mi-masthead-actions"><div id="mi-workspace-commands"/><ThemeSelector theme={theme} onChange={change}/></div></header>
            <div id="auth-status" role="status"></div>
            <PlatformApplication client={client} workspace={workspace} month={month} unsaved={dirty} onUnsavedChange={setDirty} onDenied={denied}/>
          </section>;
        }
        client.call("${tenant}", "workspace").then(workspace=>createRoot(document.getElementById("root")).render(<Portal workspace={workspace}/>))
          .catch(()=>{document.getElementById("root").textContent="Workspace unavailable."});`,
      loader: "jsx", resolveDir: process.cwd(),
    },
    bundle: true, outfile: join(directory, "platform.js"), minify: true, jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' },
    external: ["/branding/*"], loader: { ".woff2": "file", ".woff": "file" },
  });
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Client Intelligence</title><link rel="stylesheet" href="/platform.css"><body><div id="root"></div><script src="/platform.js" defer></script></body></html>');
  await cp(resolve("public/branding"), join(directory, "branding"), { recursive: true });

  const timeStore = new ProjectStore(runtime.db, "owner");
  const account = "97", customerParentId = "71", mappedJob = "109";
  const time = new TimeSync(timeStore, {
    tenant, account, customerParentId, admin: "owner", userId: "42",
    clientUrl: "mi-fixture.tsheets.com", from: "2026-01-01",
  }, new TimeClient(async () => { throw Error("Fixture makes no provider requests"); }));
  const options = {
    time,
    frontend: directory,
    allowedOrigin: "",
    limit: new RequestLimit(10000),
    projects: new ProjectBackend(new ProjectStore(runtime.db, "owner"), {
      async verify(token) {
        const subject = token.slice(7);
        return { subject, issuer: "fixture", audience: "fixture", expiresAt: now + 60_000, revoked: false, disabled: false,
          ...(subject === "owner" || subject === "staff" ? { corporatePolicy: true, staffTenantId: tenant } : {}) };
      },
    }, { issuer: "fixture", audience: "fixture", now: () => now }),
  };
  const server = apiServer(undefined as unknown as ReportingBackend, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  options.allowedOrigin = origin;
  const evidence = resolve("test-results/platform-routes-browser");
  await mkdir(evidence, { recursive: true });
  const errors: string[] = [];
  const publicPhotos = new Set(otherContacts.map(contact => contact.photo));
  let mainBrowser: Browser | undefined;
  async function session(browser: Browser, token: "owner" | "staff" | "client", width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(value => { (window as Window & { __localPortalToken?: string }).__localPortalToken = value; }, token);
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      if (publicPhotos.has(url.href)) return route.fulfill({ status: 204 });
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    return { page, context };
  }
  const route = (path: string, extra = "") => origin + path + "?month=" + month + extra;
  async function captureExperience(page: Page, name: string) {
    const matrix = join(evidence, "experience-v2");
    await mkdir(matrix, { recursive: true });
    const appearance = page.getByRole("combobox", { name: "Appearance" });
    for (const theme of ["light", "dark", "system"] as const) {
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      await appearance.selectOption(theme);
      assert.equal(await page.locator(".platform-shell").getAttribute("data-theme"), theme === "dark" ? "dark" : "light");
      for (const [width, height] of [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [390, 844], [320, 568]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => window.scrollTo(0, 0));
        const overflow = await page.evaluate(() => {
          if (document.documentElement.scrollWidth <= innerWidth) return [];
          return [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 10).map(element => `${element.tagName}.${element.getAttribute("class") ?? ""} ${Math.round(element.getBoundingClientRect().right)}`);
        });
        assert.deepEqual(overflow, [], `${name} ${theme} fits ${width} × ${height}`);
        await page.screenshot({ path: join(matrix, `${name}-${theme}-${width}x${height}.png`), animations: "disabled" });
      }
    }
    await appearance.selectOption("light");
    await page.setViewportSize({ width: 1440, height: 900 });
  }
  const editPath = "/workspace/projects/" + projectId;
  async function reviewProjectEdit(page: Page, description: string) {
    await page.goto(route(editPath));
    const wizard = page.getByRole("form", { name: "Edit a project" });
    const next = wizard.getByRole("button", { name: "Continue", exact: true });
    await next.click();
    await next.click();
    await wizard.getByRole("textbox", { name: "Client-facing description" }).fill(description);
    for (let step = 0; step < 3; step++) await next.click();
    await wizard.getByRole("button", { name: "Save Draft", exact: true }).waitFor();
    return wizard;
  }
  try {
    mainBrowser = await chromium.launch({ headless: true,
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : process.platform === "win32"
        ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}),
    });
    const admin = await session(mainBrowser, "owner");
    await admin.page.goto(route("/"));
    await admin.page.getByRole("heading", { name: "Morris Interactive", exact: true }).waitFor();
    await admin.page.getByRole("link", { name: /Open Morris Workspace/ }).waitFor();
    await admin.page.screenshot({ path: join(evidence, "morris-home.png"), animations: "disabled" });
    const appearance = admin.page.getByRole("combobox", { name: "Appearance" });
    const themed = admin.page.locator(".platform-shell");
    assert.equal(await appearance.inputValue(), "system");
    await admin.page.emulateMedia({ colorScheme: "dark" });
    await themed.locator(':scope[data-theme="dark"]').waitFor();
    await admin.page.screenshot({ path: join(evidence, "morris-home-dark.png"), animations: "disabled" });
    await appearance.selectOption("light");
    await themed.locator(':scope[data-theme="light"]').waitFor();
    await admin.page.reload();
    await appearance.waitFor();
    assert.equal(await appearance.inputValue(), "light");
    await admin.page.getByRole("link", { name: /Open Control Panel/ }).click();
    await admin.page.waitForURL(route("/control"));
    await admin.page.getByRole("heading", { name: /Administration for/ }).waitFor();
    await admin.page.screenshot({ path: join(evidence, "control-panel.png"), fullPage: true, animations: "disabled" });
    await admin.page.getByRole("link", { name: "Branding", exact: true }).click();
    await admin.page.waitForURL(route("/control/branding"));
    const clientLabel = admin.page.getByRole("textbox", { name: "Client dashboard display label" });
    await clientLabel.fill("Zagimē Partner Briefing");
    admin.page.once("dialog", dialog => { void dialog.dismiss(); });
    await admin.page.getByRole("link", { name: "Back to Morris Workspace", exact: true }).click();
    assert.equal(admin.page.url(), route("/control/branding"));
    await admin.page.getByRole("button", { name: "Save settings", exact: true }).click();
    await admin.page.getByText("Settings saved.", { exact: true }).waitFor();
    await admin.page.reload();
    await clientLabel.waitFor();
    assert.equal(await clientLabel.inputValue(), "Zagimē Partner Briefing");
    await admin.page.goBack();
    await admin.page.waitForURL(route("/control"));
    await admin.page.getByRole("heading", { name: /Administration for/ }).waitFor();
    await admin.page.goForward();
    await admin.page.waitForURL(route("/control/branding"));
    await clientLabel.waitFor();
    assert.equal(await clientLabel.inputValue(), "Zagimē Partner Briefing");
    await admin.page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await admin.page.screenshot({ path: join(evidence, "control-panel-mobile.png"), fullPage: true, animations: "disabled" });
    await admin.page.setViewportSize({ width: 1440, height: 1000 });
    await admin.page.getByRole("link", { name: "Back to Morris Workspace" }).click();
    await admin.page.waitForURL(route("/workspace"));
    await admin.page.getByRole("link", { name: /View .* Dashboard/, exact: false }).first().waitFor();
    await admin.page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    await admin.page.getByText("20.75 h", { exact: true }).first().waitFor();
    const coverage = admin.page.getByRole("region", { name: "Time allocation coverage", exact: true });
    await coverage.getByText("0% allocated", { exact: true }).waitFor();
    await coverage.getByRole("meter", { name: "Share of recorded time", exact: true }).waitFor();
    const novemberDot = admin.page.getByRole("region", { name: "Recorded hours by month", exact: true })
      .getByRole("button", { name: /November 2026, .* recorded hours/ });
    await novemberDot.focus();
    await admin.page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.includes("November 2026"));
    const createProject = admin.page.getByRole("region", { name: "Morris operating overview" })
      .getByRole("button", { name: "Create Project", exact: true });
    await createProject.waitFor();
    assert.match(await createProject.evaluate(button => getComputedStyle(button).backgroundImage), /linear-gradient/);
    assert.ok((await createProject.boundingBox())!.height >= 44);
    for (const [label, expected] of [["Remaining at parent level", "20.75 h"], ["Hours without a verified work-order association", "2 h"]]) {
      const metric = admin.page.locator("dl div").filter({ has: admin.page.getByText(label, { exact: true }) });
      await metric.getByText(expected, { exact: true }).waitFor();
    }
    await admin.page.screenshot({ path: join(evidence, "morris-workspace-native-overview.png"), fullPage: true, animations: "disabled" });
    await captureExperience(admin.page, "morris-overview");
    const staffNav = admin.page.getByRole("navigation", { name: "Morris workspace sections" });
    assert.equal(await staffNav.getByRole("button", { name: "Milestones", exact: true }).count(), 0);
    await staffNav.getByRole("button", { name: "Health", exact: true }).click();
    await admin.page.waitForURL(route("/workspace/departments/health"));
    await admin.page.getByText("There are no delivery projects in this department.").waitFor();
    assert.equal(await staffNav.getByRole("button", { name: "Health", exact: true }).getAttribute("aria-current"), "page");
    await admin.page.reload();
    await admin.page.getByRole("heading", { name: "Health", exact: true }).waitFor();
    await staffNav.getByRole("button", { name: "Team Directory", exact: true }).click();
    const otherContacts = admin.page.getByRole("region", { name: "MI Other Contacts" });
    for (const name of ["Chris Cey", "Steve Atkinson", "Monica Pollard"]) await otherContacts.getByRole("link", { name: new RegExp(name) }).waitFor();
    await admin.page.screenshot({ path: join(evidence, "staff-directory-public-contacts.png"), fullPage: true, animations: "disabled" });
    await staffNav.getByRole("button", { name: "Overview", exact: true }).click();
    await admin.page.getByRole("region", { name: "Delivery pulse" }).waitFor();
    for (const width of [320, 390, 768, 1024, 1280, 1920]) {
      await admin.page.setViewportSize({ width, height: 900 });
      assert.ok(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Morris workspace fits " + width);
    }
    await admin.page.setViewportSize({ width: 390, height: 844 });
    const menu = admin.page.getByRole("button", { name: "Menu", exact: true });
    await menu.click();
    const drawer = admin.page.getByRole("dialog", { name: "Workspace menu" });
    await drawer.getByRole("button", { name: "Project Management", exact: true }).waitFor();
    await admin.page.screenshot({ path: join(evidence, "morris-workspace-mobile-menu.png"), animations: "disabled" });
    await admin.page.keyboard.press("Escape");
    assert.equal(await menu.evaluate(button => document.activeElement === button), true);
    await menu.click();
    await drawer.getByRole("button", { name: "Project Management", exact: true }).click();
    await admin.page.waitForURL(route("/workspace/project-management"));
    const projectPicker = admin.page.getByRole("combobox", { name: "Find a project" });
    await projectPicker.fill(projectName);
    await admin.page.getByRole("option", { name: projectName, exact: true }).waitFor();
    await projectPicker.press("Enter");
    await admin.page.waitForURL(route("/workspace/project-management/" + projectId));
    const progress = admin.page.getByRole("form", { name: "Delivery progress" });
    await progress.getByRole("combobox", { name: "Delivery status" }).selectOption("paused");
    await progress.getByRole("button", { name: "Save Draft" }).click();
    await progress.getByText("Draft saved.", { exact: true }).waitFor();
    assert.ok(await admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Project Management fits mobile");
    assert.ok((await projectPicker.boundingBox())!.width >= 180, "the mobile project field stays readable");
    await admin.page.screenshot({ path: join(evidence, "project-management-mobile.png"), fullPage: true, animations: "disabled" });
    await admin.page.reload();
    await progress.getByRole("combobox", { name: "Delivery status" }).waitFor();
    assert.equal(await progress.getByRole("combobox", { name: "Delivery status" }).inputValue(), "paused");
    assert.equal((await projectRef.get()).data()?.status, "active", "client-approved project remains unchanged");
    await admin.page.setViewportSize({ width: 1440, height: 1000 });
    await admin.page.getByRole("button", { name: "Search workspace", exact: false }).click();
    const search = admin.page.getByRole("dialog", { name: "Search workspace" });
    await search.getByRole("searchbox").fill("regular consulting");
    await search.getByRole("button", { name: /Regular Consulting fixture/ }).waitFor();
    await admin.page.keyboard.press("Escape");
    await admin.page.screenshot({ path: join(evidence, "project-management.png"), fullPage: true, animations: "disabled" });
    await admin.page.getByRole("link", { name: "Browse all projects", exact: true }).click();
    await admin.page.getByRole("button", { name: "By Parent Project" }).click();
    await admin.page.getByRole("button", { name: "Open Regular Consulting fixture" }).click();
    const engagement = admin.page.getByRole("region", { name: "Parent Project overview" });
    await engagement.getByText("20.75 h", { exact: true }).first().waitFor();
    await engagement.screenshot({ path: join(evidence, "parent-recorded-effort.png"), animations: "disabled" });
    await admin.context.close();

    const staff = await session(mainBrowser, "staff");
    await staff.page.goto(route("/"));
    await staff.page.getByRole("link", { name: /Open Morris Workspace/ }).waitFor();
    assert.equal(await staff.page.getByRole("link", { name: /Open Control Panel/ }).count(), 0);
    await staff.page.goto(route("/control/publication"));
    await staff.page.getByRole("heading", { name: "Access unavailable" }).waitFor();
    const staffDraft = "Draft prepared by staff for publication review.";
    const draftWizard = await reviewProjectEdit(staff.page, staffDraft);
    assert.equal(await draftWizard.getByRole("button", { name: "Save & Publish", exact: true }).count(), 0);
    await draftWizard.getByRole("button", { name: "Save Draft", exact: true }).click();
    await staff.page.getByText("Draft saved. Clients still see the last approved version.", { exact: true }).waitFor();
    assert.equal((await projectRef.get()).data()?.description, backendProject.description);
    const pendingRef = root.collection("projectDrafts").doc(projectId);
    const pending = (await pendingRef.get()).data()!;
    assert.equal(pending.content.description, staffDraft);
    const pendingRevision = (await root.get()).get("revision");
    const projectApi = origin + "/api/v2/tenants/" + tenant + "/projects/" + projectId;
    const patch = { name: projectName, description: staffDraft, internalNotes: backendProject.internalNotes,
      status: "paused", progress: backendProject.progress, plan: backendProject.plan, delivery: backendProject.delivery };
    const attemptPublication = (token: "owner" | "staff" | "client", expectedRevision: number) =>
      staff.context.request.patch(projectApi, { headers: { authorization: "Bearer " + token },
        data: { expectedRevision, patch, publish: true } });
    const staffPublication = await attemptPublication("staff", pendingRevision);
    assert.equal(staffPublication.status(), 403);
    assert.deepEqual(await staffPublication.json(), { error: "publication_approval_required" });
    assert.equal((await attemptPublication("client", pendingRevision)).status(), 403);
    assert.equal((await attemptPublication("owner", pendingRevision - 1)).status(), 409);
    await projectRef.update({ description: "Approved content changed independently." });
    assert.equal((await attemptPublication("owner", pendingRevision)).status(), 409);
    await projectRef.update({ description: backendProject.description });
    assert.equal((await root.get()).get("revision"), pendingRevision);
    assert.deepEqual((await pendingRef.get()).data(), pending);
    await staff.context.close();

    const client = await session(mainBrowser, "client");
    const reportRoute = "/clients/zagime/reports";
    const october = await client.context.request.get(origin + "/api/v2/tenants/" + tenant + "/report?month=2026-10", {
      headers: { authorization: "Bearer client" },
    });
    assert.equal(october.status(), 200);
    const octoberReport = await october.json();
    assert.equal(octoberReport.totalSeconds, 3600);
    assert.deepEqual(octoberReport.portfolio.history.filter((row: { month: string }) => row.month === "2026-11"),
      [{ month: "2026-11", seconds: 7200 }]);
    assert.equal(octoberReport.portfolio.history.some((row: { month: string }) => row.month === "2025-05"), false);
    assert.deepEqual(octoberReport.historyByProject[projectId].find((row: { month: string }) => row.month === "2026-10"),
      { month: "2026-10", seconds: 3600 });
    assert.ok(Object.keys(octoberReport.historyByProject).every(id => octoberReport.projects.some((project: { id: string }) => project.id === id)));
    assert.equal(Object.hasOwn(octoberReport.historyByProject, "private-history-fixture"), false);
    await client.page.goto(origin + reportRoute + "?month=2026-10");
    const monthControl = client.page.getByRole("combobox", { name: "Reporting month" });
    await monthControl.waitFor();
    assert.equal(await monthControl.inputValue(), "2026-10");
    const timeline = client.page.getByRole("region", { name: "Reporting period" });
    await client.page.getByRole("button", { name: "November 2026, 2 hours" }).first().waitFor();
    await client.page.screenshot({ path: join(evidence, "reporting-history-october.png"), fullPage: true, animations: "disabled" });
    await client.page.setViewportSize({ width: 320, height: 780 });
    const periodBounds = await timeline.boundingBox();
    assert.ok(periodBounds && periodBounds.x + periodBounds.width <= 320, "reporting period fits small mobile");
    assert.ok(await client.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await client.page.screenshot({ path: join(evidence, "reporting-history-october-mobile.png"), fullPage: true, animations: "disabled" });
    await client.page.setViewportSize({ width: 1440, height: 1000 });
    await timeline.getByRole("button", { name: "Next reporting month" }).click();
    await client.page.waitForURL(route(reportRoute));
    await monthControl.waitFor();
    assert.equal(await monthControl.inputValue(), "2026-11");
    await timeline.getByRole("button", { name: "Previous reporting month" }).click();
    await client.page.waitForURL(origin + reportRoute + "?month=2026-10");
    await monthControl.selectOption("2026-09");
    await client.page.waitForURL(origin + reportRoute + "?month=2026-09");
    await client.page.getByRole("button", { name: "September 2026, 1.5 hours" }).first().waitFor();
    await timeline.getByRole("button", { name: "Latest available month" }).click();
    await client.page.waitForURL(route(reportRoute));
    await monthControl.waitFor();
    await client.page.goBack();
    await client.page.waitForURL(origin + reportRoute + "?month=2026-09");
    await monthControl.waitFor();
    assert.equal(await monthControl.inputValue(), "2026-09");
    await client.page.goForward();
    await client.page.waitForURL(route(reportRoute));
    await monthControl.waitFor();
    assert.equal(await monthControl.inputValue(), "2026-11");
    await timeline.getByRole("button", { name: "Period options", exact: true }).click();
    await timeline.getByRole("button", { name: "Custom Range" }).click();
    await timeline.getByLabel("From month").fill("2026-09");
    await timeline.getByLabel("Through month").fill("2026-10");
    await timeline.getByRole("button", { name: "Apply range" }).click();
    await client.page.waitForURL(route(reportRoute, "&period-scope=custom&from-month=2026-09&through-month=2026-10"));
    await client.page.getByRole("button", { name: "September 2026, 1.5 hours" }).first().waitFor();
    assert.equal(await client.page.getByRole("button", { name: "November 2026, 2 hours" }).count(), 0);
    await client.page.goto(route("/"));
    await client.page.waitForURL(route("/clients/zagime"));
    await client.page.getByRole("navigation", { name: "Client workspace" }).waitFor();
    await client.page.getByRole("heading", { name: /Leadership\s*summary/i }).waitFor();
    await client.page.getByLabel("All-time delivery projects", { exact: true }).getByText("All-time approved portfolio").waitFor();
    await client.page.screenshot({ path: join(evidence, "client-dashboard-native-overview.png"), fullPage: true, animations: "disabled" });
    await captureExperience(client.page, "client-leadership");
    const clientNav = client.page.getByRole("navigation", { name: "Client workspace" });
    assert.equal(await clientNav.getByRole("button", { name: "Reporting history", exact: true }).count(), 0);
    assert.equal(await client.page.getByText("LIVE PUBLISHED VIEW · MORRIS STAFF PREVIEW").count(), 0);
    await clientNav.getByRole("button", { name: "MI Directory", exact: true }).click();
    const clientContacts = client.page.getByRole("region", { name: "MI Other Contacts" });
    for (const name of ["Chris Cey", "Steve Atkinson", "Monica Pollard"]) await clientContacts.getByRole("link", { name: new RegExp(name) }).waitFor();
    await client.page.screenshot({ path: join(evidence, "client-directory-public-contacts.png"), fullPage: true, animations: "disabled" });
    await clientNav.getByRole("button", { name: "Health", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime/departments/health"));
    assert.equal(await clientNav.getByRole("button", { name: "Health", exact: true }).getAttribute("aria-current"), "page");
    await client.page.screenshot({ path: join(evidence, "client-empty-department.png"), fullPage: true, animations: "disabled" });
    await clientNav.getByRole("button", { name: "Leadership summary", exact: true }).click();
    await client.page.getByRole("heading", { name: /Leadership\s*summary/i }).waitFor();
    await client.page.setViewportSize({ width: 768, height: 1024 });
    assert.ok(await client.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await client.page.screenshot({ path: join(evidence, "client-dashboard-tablet.png"), fullPage: true, animations: "disabled" });
    await client.page.getByRole("button", { name: "Workspace navigation", exact: true }).click();
    await client.page.getByRole("dialog", { name: "Workspace menu" }).getByRole("button", { name: "Projects", exact: true }).click();
    await client.page.getByRole("heading", { name: "Published projects", exact: true }).waitFor();
    await client.page.locator(".secure-published-project .secure-project-hours > div").first().waitFor();
    const narrowestTile = await client.page.locator(".secure-published-project .secure-project-hours > div")
      .evaluateAll(tiles => Math.min(...tiles.map(tile => tile.getBoundingClientRect().width)));
    assert.ok(Number.isFinite(narrowestTile) && narrowestTile >= 96, "tablet project metrics have readable columns");
    await client.page.screenshot({ path: join(evidence, "client-projects-tablet.png"), fullPage: true, animations: "disabled" });
    await client.page.setViewportSize({ width: 1440, height: 1000 });
    assert.equal(await client.page.getByRole("link", { name: /Morris Workspace|Control Panel/ }).count(), 0);
    for (const path of ["/workspace", "/control", "/clients/another-client", "/clients/another-client/present"]) {
      const response = await client.page.goto(route(path));
      assert.equal(response?.status(), 200);
      await client.page.getByRole("heading", { name: "Access unavailable" }).waitFor();
    }
    const projectPath = "/clients/zagime/projects/" + projectId;
    const projectResponse = await client.page.goto(route(projectPath));
    assert.equal(projectResponse?.status(), 200);
    await client.page.getByRole("heading", { name: projectName, level: 2 }).waitFor();
    assert.match(await client.page.title(), /Board reporting pilot/);
    assert.equal(await client.page.getByText(/Private staff status|Synthetic planning project/).count(), 0);
    await client.page.reload();
    await client.page.getByRole("heading", { name: projectName, level: 2 }).waitFor();
    await client.page.screenshot({ path: join(evidence, "client-project-native-route.png"), fullPage: true, animations: "disabled" });

    await client.page.goto(origin + projectPath + "?month=" + previousMonth);
    const approvedExport = client.page.waitForEvent("download");
    await client.page.getByRole("button", { name: "Export project CSV", exact: true }).click();
    const download = await approvedExport;
    assert.match(download.suggestedFilename(), /2026-10.*Board_reporting_pilot[.]csv$/);
    const approvedCsv = await readFile((await download.path())!, "utf8");
    const [columns, exported] = approvedCsv.trim().split(String.fromCharCode(13, 10));
    assert.match(columns, /Reported hours/);
    const content = exported.replaceAll('"', '').split(",");
    assert.equal(content[0], previousMonth);
    assert.equal(content[1], projectName);
    assert.equal(content[6], "1");
    assert.doesNotMatch(approvedCsv, /Private staff status|synthetic-delivery|132160684/);
    await download.saveAs(join(evidence, "client-october-approved-project.csv"));

    const presentationPath = "/clients/zagime/present";
    await client.page.goto(route(presentationPath, "&chapter=5"));
    const dialog = client.page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "Hours by Delivery Project", exact: true }).waitFor();
    await dialog.getByRole("button", { name: /Board reporting pilot.*2 h/ }).waitFor();
    await dialog.getByText("Show data table", { exact: true }).click();
    await dialog.getByRole("table", { name: "Approved reported hours by project" }).getByRole("cell", { name: "2 h", exact: true }).waitFor();
    assert.equal(await dialog.getByText(/Private staff status|Synthetic planning project/).count(), 0);
    await client.page.screenshot({ path: join(evidence, "client-presentation-linked-chart.png"), animations: "disabled" });
    await client.page.reload();
    await dialog.getByRole("heading", { name: "Hours by Delivery Project" }).waitFor();
    await dialog.getByRole("button", { name: "Next chapter", exact: true }).click();
    await client.page.waitForURL(route(presentationPath, "&chapter=6"));
    await dialog.getByRole("heading", { name: "Budget Utilization", exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close presentation", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime"));
    await client.page.goto(route(presentationPath, "&chapter=1"));
    await dialog.getByRole("heading", { name: "November Board Briefing", exact: true }).waitFor();
    await dialog.press("End");
    await dialog.getByRole("heading", { name: "Next Steps and Approved Updates", exact: true }).waitFor();
    await dialog.press("Home");
    await dialog.getByRole("heading", { name: "November Board Briefing", exact: true }).waitFor();
    await client.page.emulateMedia({ media: "print" });
    const printable = client.page.locator(".platform-print-deck");
    await printable.waitFor({ state: "visible" });
    assert.equal(await printable.getByRole("heading", { level: 2 }).count(), 10);
    assert.equal(await printable.getByText(/Private staff status|Synthetic planning project/).count(), 0);
    await client.page.emulateMedia({ media: "screen" });
    await client.context.close();

    const mappingAnchor = "time-" + key(account, mappedJob);
    const timeCatalog = key("quickbooks-time-customer", account, customerParentId);
    const setup = runtime.db.batch();
    setup.set(root.collection("timeRuns").doc(timeCatalog), { customerBound: true, lastSuccess: new Date(now).toISOString() });
    setup.set(root.collection("timeMappings").doc(key(account, mappedJob)), {
      account, catalog: timeCatalog, jobcodeId: mappedJob, projectId: mappingAnchor, scopeProjectId: mappingAnchor,
      sourceJob: { id: mappedJob, name: "Internal reporting and facilitation", parentId: customerParentId, active: true, missing: false },
    });
    setup.set(root.collection("timeProjectTotals").doc(mappingAnchor).collection("periods").doc(month), { recorded: 18900, allocated: 3600 });
    setup.set(root.collection("timeProjectTotals").doc(mappingAnchor).collection("periods").doc("lifetime"), { recorded: 18900, allocated: 3600 });
    setup.update(parentRef, { delivery: { kind: "engagement", structure: 3, type: "hourly", managerIds: [], teamIds: [] } });
    await setup.commit();
    const timeOwner = await session(mainBrowser, "owner");
    await timeOwner.page.goto(route("/workspace/time/mapping"));
    const mappingArea = timeOwner.page.getByRole("region", { name: "QuickBooks Time Mapping" });
    await mappingArea.getByRole("button", { name: "Review mapping" }).click();
    await mappingArea.getByRole("combobox", { name: "Work-order type" }).selectOption("engagement");
    const target = mappingArea.getByRole("combobox", { name: "Reporting project" });
    await target.fill("Regular Consulting");
    await target.press("Enter");
    await mappingArea.getByText(/4.25 h of source time/).waitFor();
    assert.equal(await mappingArea.getByRole("button", { name: "Confirm mapping" }).isDisabled(), true);
    await timeOwner.page.screenshot({ path: join(evidence, "quickbooks-time-mapping.png"), fullPage: true, animations: "disabled" });
    await timeOwner.page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
    await timeOwner.page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await timeOwner.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await timeOwner.page.screenshot({ path: join(evidence, "quickbooks-time-mapping-dark-390.png"), fullPage: true, animations: "disabled" });
    await mappingArea.getByRole("checkbox", { name: "I reviewed the project and affected hours." }).check();
    await mappingArea.getByRole("button", { name: "Confirm mapping" }).click();
    await mappingArea.getByText(/Mapping saved/).waitFor();
    assert.equal((await root.collection("timeMappings").doc(key(account, mappedJob)).get()).get("scopeProjectId"), mappingAnchor);
    await timeOwner.context.close();

    const publisher = await session(mainBrowser, "owner");
    const staleEdit = await reviewProjectEdit(publisher.page, "This outdated edit should stay private.");
    const openedRevision = (await root.get()).get("revision");
    const concurrentSave = await publisher.context.request.patch(projectApi, {
      headers: { authorization: "Bearer owner" },
      data: { expectedRevision: openedRevision, patch: { ...patch, description: "A newer draft saved while the wizard was open." } },
    });
    assert.equal(concurrentSave.status(), 200);
    const newerDraft = (await pendingRef.get()).data();
    const submittedEdit = publisher.page.waitForRequest(request => request.method() === "PATCH" && request.url() === projectApi);
    publisher.page.once("dialog", confirmation => confirmation.accept());
    await staleEdit.getByRole("button", { name: "Save & Publish", exact: true }).click();
    assert.equal((await submittedEdit).postDataJSON().expectedRevision, openedRevision);
    await publisher.page.getByText("This record changed. Refresh before saving again.", { exact: true }).waitFor();
    assert.deepEqual((await pendingRef.get()).data(), newerDraft);
    assert.equal((await projectRef.get()).data()?.description, backendProject.description);
    publisher.page.once("dialog", confirmation => confirmation.accept());
    await staleEdit.getByRole("button", { name: "Cancel", exact: true }).click();
    await publisher.page.waitForURL(route("/workspace/project-management/" + projectId));

    const approvedDescription = "Published directly from the project setup wizard.";
    const publishWizard = await reviewProjectEdit(publisher.page, approvedDescription);
    const publishEdit = publishWizard.getByRole("button", { name: "Save & Publish", exact: true });
    await publishEdit.waitFor();
    const beforeWizardPublish = (await root.get()).get("revision");
    await publishWizard.screenshot({ path: join(evidence, "edit-project-save-and-publish.png"), animations: "disabled" });
    publisher.page.once("dialog", confirmation => confirmation.accept());
    await publishEdit.click();
    await publisher.page.getByText("Project changes published.", { exact: true }).waitFor();
    const approvedEdit = (await projectRef.get()).data()!;
    assert.equal(approvedEdit.description, approvedDescription);
    assert.equal(approvedEdit.status, "paused", "unmodified fields from the draft are retained");
    for (const field of ["start", "deadline", "publishSummary"] as const)
      assert.equal(approvedEdit.delivery[field], backendProject.delivery![field], "the approved schedule stays intact");
    const publishedDraft = (await pendingRef.get()).data()!;
    assert.equal(publishedDraft.state, "published");
    assert.equal("content" in publishedDraft, false);
    assert.equal((await root.get()).get("revision"), beforeWizardPublish + 1);
    const approvals = await root.collection("audits").where("entityId", "==", projectId).get();
    const publishEvents = approvals.docs.map(event => event.data()).filter(event => event.action === "project-edited-and-published");
    assert.equal(publishEvents.length, 1);
    assert.equal(publishEvents[0].actor, "owner");
    assert.equal(publishEvents[0].revision, beforeWizardPublish + 1);
    const clientReport = await publisher.context.request.get(origin + "/api/v2/tenants/" + tenant + "/report?month=" + month, {
      headers: { authorization: "Bearer client" },
    });
    assert.equal(clientReport.status(), 200);
    const report = await clientReport.json();
    assert.equal(report.projects.find((project: { id: string }) => project.id === projectId).description, approvedDescription);
    assert.equal(report.hierarchy[projectId].start, backendProject.delivery!.start);
    assert.doesNotMatch(JSON.stringify(report), /Private staff status discussion/);
    await publisher.context.close();

    if (process.env.MI_SECURE_CROSS_BROWSER === "true") {
      for (const engine of [firefox, webkit]) {
        const mobileBrowser = await engine.launch({ headless: true });
        try {
          const mobile = await session(mobileBrowser, "client", 390);
          await mobile.page.goto(route(presentationPath, "&chapter=3"));
          const scene = mobile.page.getByRole("dialog");
          await scene.getByRole("heading", { name: "Historical Hours and Effort" }).waitFor();
          await scene.getByRole("img", { name: "Approved reported hours by month" }).waitFor();
          await scene.getByRole("button", { name: /November 2026.*2 h/ }).waitFor();
          assert.equal(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          await mobile.page.screenshot({ path: join(evidence, "client-presentation-" + engine.name() + "-390.png"), animations: "disabled" });
          await scene.getByRole("button", { name: "Close presentation" }).click();
          await mobile.page.waitForURL(route("/clients/zagime"));
          await mobile.context.close();
        } finally { await mobileBrowser.close(); }
      }
    }
    const scheduled: Project = {
      ...backendProject, id: "schedule-boundary-fixture", name: "Scheduled client delivery",
      status: "planned",
      delivery: { kind: "project", structure: 3, parentId, areaId: "hr", type: "hourly",
        managerIds: [], teamIds: [], start: "2026-11-24", deadline: "2026-12-19", publishStartStatus: true },
    };
    const scheduleFixture = runtime.db.batch();
    scheduleFixture.set(root.collection("projects").doc(scheduled.id), scheduled);
    scheduleFixture.set(root.collection("projectViews").doc(scheduled.id), projectView(scheduled, 0));
    scheduleFixture.update(root.collection("memberships").doc(key("client")), { projectIds: [projectId, parentId, scheduled.id] });
    await scheduleFixture.commit();
    const scheduledClient = await session(mainBrowser, "client");
    try {
      now = Date.parse("2026-11-24T05:59:59Z");
      await scheduledClient.page.clock.setFixedTime(new Date(now));
      await scheduledClient.page.goto(route("/clients/zagime/projects"));
      const card = scheduledClient.page.getByRole("article").filter({
        has: scheduledClient.page.getByRole("heading", { name: scheduled.name, exact: true }),
      });
      await card.getByText("Upcoming", { exact: true }).waitFor();
      assert.doesNotMatch(await card.innerText(), /Start Nov|Expected completion Dec/);
      await card.screenshot({ path: join(evidence, "project-before-regina-start.png"), animations: "disabled" });
      now = Date.parse("2026-11-24T06:00:00Z");
      await scheduledClient.page.clock.setFixedTime(new Date(now));
      await scheduledClient.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await card.getByText("In progress", { exact: true }).waitFor();
      assert.doesNotMatch(await card.innerText(), /Start Nov|Expected completion Dec/);
      await card.screenshot({ path: join(evidence, "project-at-regina-start.png"), animations: "disabled" });
    } finally {
      await scheduledClient.context.close();
    }
    assert.deepEqual(errors, []);
  } finally {
    await mainBrowser?.close();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
    await runtime.close();
  }
});
