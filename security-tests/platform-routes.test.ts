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
import { approvedProjectContent, projectView, type Project } from "../src/projects/model";
import { newPortfolio, type Portfolio } from "../src/projects/portfolio";
import { portfolioRef } from "../server/portfolio";
import { clientBase, clientPath, controlSections, staffPath, staffSegments, type StaffSection } from "../src/api/platform-routes";
import { auditViewport } from "./viewport-audit";
import { otherContacts } from "../src/projects/other-contacts";

test("native portal URLs keep authenticated roles, approved reporting, editable settings and chapter links across reload and history", { timeout: 420000 }, async () => {
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
            <header className="secure-masthead mi-compact-masthead">
              <div className="secure-identity"><h1>{location.pathname.startsWith("/clients/") ? "Zagimē A. FN Workshop" : "Morris workspace"}</h1></div>
              <div className="mi-masthead-actions"><div id="mi-workspace-commands"/><ThemeSelector theme={theme} onChange={change} compact/></div></header>
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
  let mainBrowser: Browser | undefined;
  async function session(browser: Browser, token: "owner" | "staff" | "client", width = 1440) {
    const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(value => { (window as Window & { __localPortalToken?: string }).__localPortalToken = value; }, token);
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(60_000);
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

  async function checkContactPortraits(page: Page, missing?: string) {
    const section = page.getByRole("region", { name: "MI Other Contacts" });
    await section.waitFor();
    assert.equal(await section.getByRole("link").count(), otherContacts.length);
    for (const contact of otherContacts) {
      const link = section.getByRole("link", { name: new RegExp(contact.name) });
      await link.scrollIntoViewIfNeeded();
      if (contact.slug === missing) {
        await link.locator(".delivery-initials").waitFor();
        assert.equal(await link.locator("img").count(), 0);
      } else {
        const [src, width, height] = await link.locator("img").evaluate(async element => {
          const img = element as HTMLImageElement;
          await img.decode();
          return [img.currentSrc, img.naturalWidth, img.naturalHeight];
        });
        assert.deepEqual([src, width, height], [`${origin}/${contact.photo}`, 300, 300]);
      }
      assert.equal(await link.getAttribute("href"), contact.url);
    }
    assert.ok(await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".mi-public-contacts a")].map(card => card.getBoundingClientRect());
      return document.documentElement.scrollWidth <= innerWidth && cards.every((card, index) =>
        card.left >= 0 && card.right <= innerWidth && cards.slice(index + 1).every(other =>
          card.right <= other.left || other.right <= card.left || card.bottom <= other.top || other.bottom <= card.top));
    }), "Public contact cards fit the viewport without overlap");
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  async function auditNativeRoutes(browser: Browser) {
    const auditEvidence = join(evidence, "route-layout-audit");
    const referenceEvidence = join(auditEvidence, "reference-sizes");
    await mkdir(auditEvidence, { recursive: true });
    await mkdir(referenceEvidence, { recursive: true });
    const probes: Awaited<ReturnType<typeof auditViewport>>[] = [];
    const references: Record<string, [string, number, number][]> = {
      "/workspace/portfolio": [["01-portfolio-layout", 1792, 920]],
      "/workspace/portfolio?subsection=engagements": [["11-portfolio-settings", 1473, 794]],
      [clientBase + "?previewMode=draft"]: [["02-client-preview", 1731, 948]],
      [clientBase + "?month=2026-08"]: [["03-department-zero-allocated", 1293, 723]],
      [clientBase + "/projects"]: [["05-client-projects", 1622, 881]],
      "/workspace": [["06-staff-overview", 1684, 877], ["v3-05-staff-overview", 1066, 909]],
      [clientBase + "/team"]: [["07-directory", 1684, 868]],
      "/workspace/projects/new": [["08-project-wizard", 1415, 888]],
      "/workspace/time": [["09-time-allocation", 926, 889]],
      [staffPath("management", projectId)]: [["10-contextual-milestones", 1276, 784], ["v3-08-project-blocker", 1265, 945]],
      [staffPath("health")]: [["v3-09-budget-light", 1206, 922], ["v3-10-masthead", 1158, 420]],
    };
    for (const [role, paths] of [
      ["owner", ["/", ...Object.keys(staffSegments).map(key => staffPath(key as StaffSection)), staffPath("departments", "health"),
        staffPath("projects", "new"), editPath, staffPath("management", projectId), "/workspace/portfolio?subsection=engagements",
        "/control", ...Object.keys(controlSections).map(key => "/control/" + key), clientBase, clientBase + "?previewMode=draft"]],
      ["client", ["overview", "engagements", "areas", "area:health", "projects", "project:" + projectId, "timeline:" + projectId,
        "milestones", "directory", "history", "notes"].map(view => clientPath("zagime", view)).concat(clientBase + "/service-areas", clientBase + "/present", clientBase + "?month=2026-08")],
    ] as const) {
      const review = await session(browser, role);
      try {
        for (const path of paths) {
          const destination = new URL(path, origin);
          if (!destination.searchParams.has("month")) destination.searchParams.set("month", month);
          try {
            await review.page.setViewportSize({ width: 1440, height: 900 });
            await review.page.goto(destination.href, { waitUntil: "domcontentloaded" });
            await review.page.locator(path.endsWith("/present") ? "dialog[open]" : "#platform-content h2:visible").first().waitFor({ timeout: 15_000 });
            await review.page.waitForLoadState("networkidle");
            if (path === "/control/team") await review.page.getByRole("region", { name: "MI Other Contacts" }).waitFor();
            if (path === clientBase + "?month=2026-08")
              await review.page.getByText("No approved effort yet for this period.", { exact: true }).waitFor();
            const compactSidebar = path.startsWith("/workspace") || path.startsWith("/control") ||
              path.startsWith(clientBase) && !path.endsWith("/present");
            for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 568]]) {
              probes.push(await auditViewport(review.page, role + " " + path, width, height, { compactSidebar }));
              if (["/workspace/time", "/control/branding", clientBase + "/team", clientBase + "/projects"].includes(path)) {
                const scene = path.slice(1).replaceAll("/", "-");
                await review.page.screenshot({ path: join(auditEvidence, `${scene}-${width}x${height}.png`), animations: "disabled" });
              }
            }
            for (const [width, height] of [[1440, 900], [390, 844]]) {
              await review.page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
              probes.push(await auditViewport(review.page, role + " dark " + path, width, height, { compactSidebar }));
            }
            await review.page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
            if (path === "/control/branding") {
              const controlMenu = review.page.getByText("Control Panel sections", { exact: true });
              await controlMenu.click();
              await review.page.getByRole("navigation", { name: "Control Panel sections" }).getByRole("link", { name: "Branding", exact: true }).waitFor();
              await review.page.keyboard.press("Escape");
              assert.equal(await controlMenu.evaluate(element => document.activeElement === element), true);
            }
            if (path === staffPath("health")) {
              const appearance = review.page.getByRole("combobox", { name: "Appearance" });
              await appearance.selectOption("dark");
              const budgetFilters = review.page.locator(".delivery-filters").filter({ has: review.page.getByLabel("Search projects") }).first();
              await budgetFilters.waitFor();
              assert.equal(await budgetFilters.evaluate(element => getComputedStyle(element).backgroundColor), "rgb(20, 37, 55)");
              probes.push(await auditViewport(review.page, "Dark budget board", 1365, 801, { compactSidebar }));
              await review.page.screenshot({ path: join(referenceEvidence, "v3-11-budget-dark-1365x801.png"), animations: "disabled" });
              await appearance.selectOption("system");
            }
            if (role === "client" || !path.startsWith(clientBase) || path.includes("previewMode")) {
              for (const [name, width, height] of references[path] ?? []) {
                probes.push(await auditViewport(review.page, role + " " + path, width, height, { compactSidebar }));
                await review.page.screenshot({ path: join(referenceEvidence, `${name}-${width}x${height}.png`), animations: "disabled" });
              }
            }
          } catch (cause) {
            await review.page.screenshot({ path: join(auditEvidence, "layout-audit-failure.png"), fullPage: true, animations: "disabled" });
            const recentErrors = errors.slice(-3).join(" · ");
            throw new Error(`Layout audit failed for ${role} ${path}${recentErrors ? ` (${recentErrors})` : ""}`, { cause });
          }
        }
      } finally { await review.context.close(); }
    }
    await writeFile(join(auditEvidence, "viewport-audit.json"), JSON.stringify(probes, null, 2));
  }
  async function verifyExplorerScale() {
    const scaleEvidence = join(evidence, "experience-v4");
    await mkdir(scaleEvidence, { recursive: true });
    const teams = ["finance", "hr", "cfw", "health", "miscellaneous", "training"];
    const ids = Array.from({ length: 300 }, (_, index) => "v4-project-" + String(index + 1).padStart(3, "0"));
    const writeFixture = async (project: Project) => {
      const batch = runtime.db.batch();
      batch.set(root.collection("projects").doc(project.id), project);
      batch.set(root.collection("projectViews").doc(project.id), projectView(project, 0));
      await batch.commit();
    };
    const parentProjects = ["v4-parent-north", "v4-parent-south"];
    for (const [index, id] of parentProjects.entries()) await writeFixture({
      ...backendProject, id, name: index === 0 ? "Northern engagement" : "Southern engagement",
      status: "active", delivery: { kind: "engagement", type: "hourly", managerIds: [], teamIds: [] },
    });
    for (let start = 0; start < ids.length; start += 125) {
      const batch = runtime.db.batch();
      for (const [offset, id] of ids.slice(start, start + 125).entries()) {
        const index = start + offset;
        const completed = index % 7 === 0;
        const upcoming = index % 7 === 1;
        const blocked = index % 7 === 3;
        const project: Project = {
          ...backendProject, id, name: "V4 project " + id.slice(-3), status: completed ? "completed" : "active",
          published: index < 299, internalNotes: "V4-PRIVATE-NOTE", description: "Approved delivery overview for the synthetic portfolio.",
          delivery: { kind: "project", type: "hourly", parentId: parentProjects[index % 2],
            areaId: index < 6 ? index === 1 || index === 2 ? "hr" : undefined : teams[index % teams.length],
            managerIds: [], teamIds: [], manualCompletion: completed ? 100 : index % 7 === 2 ? undefined : 48,
            completedOn: completed ? index === 0 ? "2026-04-17" : index === 7 ? "2025-10-17" : "2026-10-17" : undefined,
            start: upcoming ? "2026-12-04" : "2026-09-03",
            deadline: index % 5 === 0 ? undefined : "2026-12-10", publishSummary: index % 5 !== 0,
            ...(blocked ? { blocker: { active: true, message: "Awaiting scope review", internal: "V4-PRIVATE-BLOCKER" } } : {}),
          },
          milestones: [{ id: "review", title: "Published review", completed, visible: true, date: "2026-11-19",
            status: completed ? "completed" : blocked ? "blocked" : "in-progress" }],
        };
        const plain = JSON.parse(JSON.stringify(project)) as Project;
        batch.set(root.collection("projects").doc(id), plain);
        batch.set(root.collection("projectViews").doc(id), projectView(plain, 0));
      }
      await batch.commit();
    }
    const sample = await session(mainBrowser!, "client");
    const explorer = sample.page.getByRole("region", { name: "Project Explorer", exact: true });
    const grants = root.collection("memberships").doc(key("client"));
    try {
      await sample.page.clock.setFixedTime(new Date("2026-11-24T17:00:00Z"));
      await grants.update({ projectIds: ids.slice(0, 6) });
      await sample.page.goto(route("/clients/zagime/projects"));
      await explorer.getByText("Showing 1–6 of 6 projects", { exact: true }).waitFor();
      await sample.page.goto(route("/clients/zagime"));
      const distribution = sample.page.getByRole("region", { name: "Project Portfolio Distribution" });
      const hr = distribution.getByRole("listitem").filter({ has: sample.page.getByRole("button", { name: "HR", exact: true }) });
      await hr.getByText("2 · 33.3%", { exact: true }).waitFor();
      await distribution.getByText("4 · 66.7%", { exact: true }).waitFor();
      await distribution.getByText("0 · 0%", { exact: true }).first().waitFor();
      await sample.page.getByRole("button", { name: "Explain Approved projects", exact: true }).click();
      await sample.page.getByRole("tooltip").filter({ hasText: /Parent project containers are excluded/ }).waitFor();
      await sample.page.screenshot({ path: join(scaleEvidence, "v41-kpi-tooltip.png"), animations: "disabled" });
      await sample.page.keyboard.press("Escape");
      await hr.getByRole("button", { name: "HR", exact: true }).focus();
      await sample.page.getByRole("tooltip").filter({ hasText: /2 of 6 approved delivery projects.*33.3%/ }).waitFor();
      await sample.page.screenshot({ path: join(scaleEvidence, "v41-distribution-tooltip.png"), fullPage: true, animations: "disabled" });
      await sample.page.keyboard.press("Escape");
      for (const theme of ["light", "dark"]) {
        await sample.page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
        for (const width of [390, 768, 1024, 1440, 1920]) {
          await auditViewport(sample.page, "V4.1 Leadership " + theme, width, 900, { compactSidebar: true });
          await sample.page.screenshot({ path: join(scaleEvidence, "v41-leadership-" + theme + "-" + width + ".png"), animations: "disabled" });
        }
        await sample.page.getByRole("region", { name: "Department distribution" })
          .screenshot({ path: join(scaleEvidence, "v41-department-composition-" + theme + ".png"), animations: "disabled" });
      }
      await sample.page.setViewportSize({ width: 1440, height: 900 });
      await distribution.getByRole("button", { name: "Delivery status", exact: true }).click();
      await distribution.getByRole("button", { name: "In progress", exact: true }).waitFor();
      await distribution.getByRole("button", { name: "Departments", exact: true }).click();
      await distribution.getByLabel("Sort groups").selectOption("most");
      assert.match(await distribution.getByRole("listitem").first().innerText(), /No department/);
      await hr.getByRole("button", { name: "HR", exact: true }).click();
      await sample.page.waitForURL(url => url.searchParams.get("explorer-department") === "hr" && url.searchParams.get("month") === month);
      await explorer.getByText("Showing 1–2 of 2 projects", { exact: true }).waitFor();
      await grants.update({ projectIds: ids.slice(0, 100) });
      await sample.page.goto(route("/clients/zagime/projects"));
      await explorer.getByText("Showing 1–20 of 100 projects", { exact: true }).waitFor();
      assert.equal(await explorer.locator(".mi-explorer-project").count(), 20);
      await sample.page.screenshot({ path: join(scaleEvidence, "project-explorer-100-full.png"), fullPage: true, animations: "disabled" });
      const projectsPerPage = explorer.getByLabel("Projects per page", { exact: true });
      await projectsPerPage.selectOption("10");
      await explorer.getByRole("button", { name: "Next", exact: true }).click();
      await explorer.getByText("Showing 11–20 of 100 projects", { exact: true }).waitFor();
      await explorer.getByRole("button", { name: "Open project V4 project 011", exact: true }).click();
      await sample.page.getByRole("heading", { name: "V4 project 011", level: 2 }).waitFor();
      assert.equal(await sample.page.getByText("V4-PRIVATE-NOTE").count(), 0);
      await sample.page.screenshot({ path: join(scaleEvidence, "project-detail-full.png"), fullPage: true, animations: "disabled" });
      await sample.page.getByRole("button", { name: "Back to Project Explorer", exact: true }).click();
      await explorer.getByText("Showing 11–20 of 100 projects", { exact: true }).waitFor();
      assert.equal(await sample.page.evaluate(() => document.activeElement?.id), "client-open-v4-project-011");
      await explorer.getByRole("button", { name: /^HR · .*approved projects/ }).click();
      await sample.page.waitForURL(url => url.searchParams.get("explorer-department") === "hr" && !url.searchParams.has("explorer-page"));
      await explorer.getByRole("button", { name: "Cards", exact: true }).click();
      await sample.page.waitForURL(url => url.searchParams.get("explorer-view") === "cards");
      for (const theme of ["light", "dark"] as const) {
        await sample.page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
        for (const width of [320, 390, 768, 1024, 1440, 1920]) {
          await auditViewport(sample.page, "V4 Project Explorer " + theme, width, 940, { compactSidebar: true });
          const boxes = await explorer.locator(".mi-explorer-project").evaluateAll(elements => elements.map(el => {
            const box = el.getBoundingClientRect(); return { top: Math.round(box.top), bottom: Math.round(box.bottom) };
          }));
          for (const box of boxes) assert.ok(boxes.every(other => other.top !== box.top || other.bottom === box.bottom));
          if (width === 1024 || width === 1440) {
            const miscellaneous = explorer.getByRole("button", { name: /^Miscellaneous · .*approved projects/ })
              .locator(".mi-explorer-department-name");
            assert.equal(await miscellaneous.evaluate(label => {
              const text = document.createRange(); text.selectNodeContents(label);
              return text.getClientRects().length;
            }), 1, "Miscellaneous fits on one line at " + width);
          }
          await sample.page.screenshot({ path: join(scaleEvidence, "explorer-" + theme + "-" + width + ".png"), animations: "disabled" });
        }
      }
      await sample.page.setViewportSize({ width: 1440, height: 900 });
      await sample.page.evaluate(() => { document.documentElement.style.zoom = "2"; });
      assert.ok(await sample.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await sample.page.screenshot({ path: join(scaleEvidence, "explorer-200-percent.png"), animations: "disabled" });
      await sample.page.evaluate(() => { document.documentElement.style.zoom = ""; });
      await sample.page.goto(route("/clients/zagime"));
      const chart = sample.page.getByRole("region", { name: "Department distribution" });
      await chart.getByRole("button", { name: "Project count", exact: true }).waitFor();
      await sample.page.getByText("No approved effort yet for this period.", { exact: true }).first().waitFor();
      await sample.page.screenshot({ path: join(scaleEvidence, "leadership-100-zero-hours-full.png"), fullPage: true, animations: "disabled" });
      const completionChart = sample.page.getByRole("region", { name: "Completed projects by month" });
      assert.equal(await completionChart.locator(".mi-completion-month").count(), 12);
      await completionChart.getByRole("button", { name: "May 2026 · 0 recorded completions", exact: true }).waitFor();
      await completionChart.locator('[data-state="unavailable"]').filter({ hasText: /Nov.*Historical reporting unavailable/ }).waitFor();
      await completionChart.getByRole("button", { name: "Earlier 12 months" }).click();
      await completionChart.getByRole("button", { name: /^October 2025 · 1 recorded completion/ }).waitFor();
      await completionChart.getByRole("button", { name: "Later 12 months" }).click();
      for (const theme of ["light", "dark"]) {
        await sample.page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
        await sample.page.locator('.secure-shell[data-theme="' + theme + '"]').waitFor();
        await completionChart.screenshot({ path: join(scaleEvidence, "completion-calendar-" + theme + ".png"), animations: "disabled" });
      }
      await completionChart.getByRole("button", { name: /^April 2026 · 1 recorded completion/ }).click();
      await sample.page.waitForURL(url => url.searchParams.get("explorer-completed-month") === "2026-04");
      await explorer.getByText("Showing 1–1 of 1 project", { exact: true }).waitFor();
      await sample.page.goBack();
      await chart.getByRole("button", { name: /^HR · In progress · / }).first().click();
      await sample.page.waitForURL(url => url.searchParams.get("explorer-department") === "hr" && url.searchParams.get("status") === "active");
      await explorer.locator(".mi-explorer-project").first().waitFor();
      assert.equal(await explorer.getByLabel("Department", { exact: true }).inputValue(), "hr");
      const scopedResponse = await sample.context.request.get(origin + "/api/v2/tenants/" + tenant + "/report?month=" + month, { headers: { authorization: "Bearer client" } });
      assert.equal(scopedResponse.status(), 200);
      const body = await scopedResponse.text();
      assert.equal(JSON.parse(body).projects.length, 100);
      assert.doesNotMatch(body, /V4-PRIVATE|V4 project 300/);
      await sample.page.goto(route("/clients/zagime/departments"));
      const departmentChart = sample.page.getByRole("region", { name: "Department distribution" });
      await departmentChart.waitFor();
      const readSegmentColors = () => departmentChart.locator(".mi-v4-stack-list > li").first().evaluate(row =>
        [...row.querySelectorAll(".mi-v4-stack-segment")].map(segment => {
          const legend = row.closest("section")?.querySelector('.mi-v4-legend i[data-state="' + segment.getAttribute("data-state") + '"]');
          return { segment: getComputedStyle(segment).backgroundColor, legend: legend ? getComputedStyle(legend).backgroundColor : undefined };
        }));
      for (const theme of ["light", "dark"]) {
        await sample.page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
        await sample.page.locator('.secure-shell[data-theme="' + theme + '"]').waitFor();
        const colors = await readSegmentColors();
        assert.ok(new Set(colors.map(color => color.segment)).size >= 3, "Delivery status segments use distinct colors in " + theme);
        assert.ok(colors.every(color => color.segment === color.legend), "Segment colors match their legend");
      }
      await sample.page.screenshot({ path: join(scaleEvidence, "departments-100-full.png"), fullPage: true, animations: "disabled" });
    } finally { await sample.context.close(); }
    const staffPreview = await session(mainBrowser!, "owner");
    try {
      await staffPreview.page.goto(route("/clients/zagime/projects", "&previewMode=draft&q=V4+project&explorer-size=50&explorer-page=6"));
      const staffExplorer = staffPreview.page.getByRole("region", { name: "Project Explorer", exact: true });
      await staffExplorer.getByText("Showing 251–300 of 300 projects", { exact: true }).waitFor();
      assert.equal(await staffExplorer.locator(".mi-explorer-project").count(), 50);
      await staffExplorer.getByRole("button", { name: "Open project V4 project 300", exact: true }).waitFor();
      await staffPreview.page.screenshot({ path: join(scaleEvidence, "project-explorer-300-page-six.png"), animations: "disabled" });
    } finally { await staffPreview.context.close(); }

    const fullId = ids[10];
    const context = portfolioRef(root);
    const fullProject: Project = {
      ...backendProject, id: fullId, name: "Community reporting toolkit", status: "completed",
      description: "A shared reporting toolkit with an agreed set of measures, templates and handover materials.",
      plan: { basis: "monthly", targetSeconds: 43200 },
      internalNotes: "V4-PRIVATE-DETAIL-NOTE",
      delivery: { structure: 3, kind: "project", type: "hourly", areaId: "miscellaneous",
        start: "2026-08-10", deadline: "2026-11-20", completedOn: "2026-11-17", publishSummary: true,
        managerIds: ["detail-manager"], teamIds: ["detail-specialist", "detail-hidden"], monthlyCap: 86400, lifetimeCap: 216000 },
      milestones: [
        { id: "scope", title: "Confirm reporting measures", date: "2026-08-26", completed: true, visible: true },
        { id: "review", title: "Review toolkit with leadership", date: "2026-10-21", completed: true, visible: true },
        { id: "handover", title: "Hand over templates and guide", date: "2026-11-17", completed: true, visible: true },
        { id: "private", title: "V4-PRIVATE-MILESTONE", date: "2026-11-14", completed: true, visible: false },
      ],
      updates: [{ id: "handover-note", title: "Toolkit delivered", date: "2026-11-17", body: "Templates and the reporting guide are ready to use.", visible: true }],
    };
    const setup = runtime.db.batch();
    setup.set(root.collection("projects").doc(fullId), fullProject);
    setup.set(root.collection("projectViews").doc(fullId), { ...projectView(fullProject, 43200), ...approvedProjectContent(fullProject) });
    for (const [period, seconds] of [[month, 21600], [previousMonth, 21600]] as const) {
      setup.set(root.collection("projectPeriods").doc(key(period, fullId)), { projectId: fullId, month: period, seconds });
    }
    const portfolio = ((await context.get()).data()?.portfolio as Portfolio | undefined) ?? newPortfolio();
    setup.set(context, { portfolio: { ...portfolio, directory: [...portfolio.directory, ...[
      { id: "detail-manager", name: "Avery Morgan", role: "Delivery lead", visible: true },
      { id: "detail-specialist", name: "Jordan Lee", role: "Reporting specialist", visible: true },
      { id: "detail-hidden", name: "V4-PRIVATE-CONTACT", role: "Private reviewer", visible: false },
    ].map((entry, order) => ({
      ...entry, areaId: "", responsibility: "", internalContact: "", publicContact: "", active: true,
      email: "private@fixture.invalid", shareEmail: false, projectIds: [fullId], order: order + portfolio.directory.length,
    }))] } });
    await setup.commit();
    const detailed = await session(mainBrowser!, "client");
    try {
      const evidencePath = route("/clients/zagime/projects/" + fullId);
      const response = await detailed.context.request.get(origin + "/api/v2/tenants/" + tenant + "/report?month=" + month,
        { headers: { authorization: "Bearer client" } });
      assert.equal(response.status(), 200, await response.text());
      assert.doesNotMatch(await response.text(), /V4-PRIVATE-DETAIL-NOTE|V4-PRIVATE-MILESTONE|V4-PRIVATE-CONTACT|private@fixture/);
      await detailed.page.goto(evidencePath);
      await detailed.page.getByRole("heading", { name: "Community reporting toolkit", exact: true }).waitFor();
      const sections = detailed.page.locator(".mi-detailed-project");
      for (const label of ["Avery Morgan", "Jordan Lee", "Toolkit delivered", "Confirm reporting measures"]) {
        await sections.getByText(label, { exact: true }).waitFor();
      }
      await sections.getByRole("progressbar", { name: "Completed approved milestones" }).waitFor();
      assert.equal(await sections.locator("time[datetime='2026-11-17']").count(), 3);
      assert.doesNotMatch(await sections.innerText(), /V4-PRIVATE|private@fixture/);
      const budget = sections.getByRole("region", { name: "Delivery project hour caps" });
      await sections.getByRole("button", { name: "Hours", exact: true }).click();
      await budget.getByRole("meter", { name: "Monthly hours used" }).getByText("6 of 24 hours", { exact: true }).waitFor();
      await budget.getByRole("meter", { name: "Whole-project hours used" }).getByText("12 of 60 hours", { exact: true }).waitFor();
      await sections.getByRole("button", { name: "Percentage", exact: true }).click();
      for (const theme of ["light", "dark"]) {
        await detailed.page.getByRole("combobox", { name: "Appearance" }).selectOption(theme);
        for (const width of [390, 1024, 1440]) {
          await auditViewport(detailed.page, "Populated project detail " + theme, width, 900, { compactSidebar: true });
          await detailed.page.screenshot({ path: join(scaleEvidence, "populated-project-" + theme + "-" + width + ".png"), fullPage: true, animations: "disabled" });
        }
      }
    } finally { await detailed.context.close(); }

    const timeRows = runtime.db.batch();
    for (let i = 0; i < 52; i++) {
      const id = "v41-browser-time-" + String(i).padStart(2, "0");
      timeRows.set(root.collection("rawTime").doc(id), {
        schemaVersion: 2, source: "quickbooks-time", scopeProjectId: parentId, deleted: false,
        record: { id, tenantId: tenant, sourceWorkOrderId: i % 2 ? "132160684" : "132160686",
          date: month + "-" + String(i % 24 + 1).padStart(2, "0"), revision: "v41-fixture", seconds: (i + 1) * 600,
          description: i % 3 ? "Reporting task " + i : "QuickBooks Time" },
      });
    }
    await timeRows.commit();
    const time = await session(mainBrowser!, "owner");
    try {
      await time.page.goto(route("/workspace/time"));
      const table = time.page.getByRole("region", { name: "Recorded time table" });
      await table.getByRole("button", { name: "Recorded", exact: true }).click();
      await table.locator('th[aria-sort="ascending"]').getByRole("button", {name: "Recorded", exact: true}).waitFor();
      await table.locator("thead").screenshot({ path: join(scaleEvidence, "v41-time-ascending.png"), animations: "disabled" });
      await table.getByRole("checkbox", { name: /^Select entry/ }).first().check();
      await table.getByRole("button", { name: "Recorded", exact: true }).click();
      await table.locator('th[aria-sort="descending"]').getByRole("button", {name: "Recorded", exact: true}).waitFor();
      await time.page.getByLabel("Assign 1 unallocated entries").waitFor();
      await time.page.getByRole("button", { name: "More recorded time" }).click();
      await table.getByRole("row").nth(30).waitFor();
      await time.page.getByLabel("Sort time distribution").selectOption("recorded-asc");
      await time.page.getByRole("region", { name: "Recorded time distribution" }).getByRole("listitem").first().getByText("synthetic-job", { exact: true }).waitFor();
      await time.page.getByText("Exact breakdowns and CSV exports", { exact: true }).click();
      await time.page.locator("summary").filter({ hasText: /^Hours by work order$/ }).click();
      const breakdown = time.page.getByLabel("Hours by work order", { exact: true });
      await breakdown.getByRole("button", { name: "Recorded", exact: true }).click();
      await breakdown.locator('th[aria-sort="ascending"]').waitFor();
      await time.page.getByText("Exact breakdowns and CSV exports", { exact: true }).click();
      await auditViewport(time.page, "Sorted Time Allocation", 1440, 1000, { compactSidebar: true });
      await time.page.screenshot({ path: join(scaleEvidence, "v41-time-sorted-light.png"), fullPage: true, animations: "disabled" });
      await time.page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
      await time.page.screenshot({ path: join(scaleEvidence, "v41-time-sorted-dark.png"), fullPage: true, animations: "disabled" });
      await time.page.reload();
      await table.locator('th[aria-sort="descending"]').getByRole("button", {name: "Recorded", exact: true}).waitFor();
    } finally { await time.context.close(); }
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
    await auditNativeRoutes(mainBrowser);
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
    await checkContactPortraits(admin.page);
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
    assert.equal(await client.page.locator(".mi-workspace-sidebar").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(16, 41, 66)");
    const panelBounds = await client.page.locator(".mi-v4-analytics-grid > section").evaluateAll(panels => panels.slice(0, 2)
      .map(panel => [panel.getBoundingClientRect().top, panel.getBoundingClientRect().bottom]));
    assert.deepEqual(panelBounds[0], panelBounds[1], "Leadership analytics cards align in their shared row");
    await client.page.screenshot({ path: join(evidence, "client-dashboard-native-overview.png"), fullPage: true, animations: "disabled" });
    await captureExperience(client.page, "client-leadership");
    const referenceEvidence = join(evidence, "v3-reference-sizes");
    await mkdir(referenceEvidence, { recursive: true });
    async function captureReference(page: Page, name: string, width: number, height: number, compactSidebar = true) {
      await auditViewport(page, name, width, height, { compactSidebar });
      await page.screenshot({ path: join(referenceEvidence, name + ".png"), animations: "disabled" });
    }
    await captureReference(client.page, "04-leadership-layout-1649x844", 1649, 844);
    await auditViewport(client.page, "Leadership engagement section", 1647, 868, { compactSidebar: true });
    const engagements = client.page.getByRole("region", { name: "Parent projects" }).first();
    await engagements.scrollIntoViewIfNeeded();
    await client.page.screenshot({ path: join(referenceEvidence, "03-leadership-engagements-1647x868.png"), animations: "disabled" });
    const effort = client.page.getByRole("group", { name: "Effort display", exact: true });
    assert.equal(await effort.getByRole("button", { name: "Percentage", exact: true }).getAttribute("aria-pressed"), "true");
    const monthlyEffort = client.page.getByRole("region", { name: "Monthly approved effort", exact: true });
    await monthlyEffort.getByRole("img", { name: "Share of selected-period effort", exact: true }).waitFor();
    const septemberPoint = monthlyEffort.getByRole("button", { name: /^September 2026, .*33\.3%/ });
    await septemberPoint.hover();
    const inspection = monthlyEffort.getByRole("tooltip");
    const tooltip = await inspection.innerText();
    for (const value of ["September 2026", "1.5 h (5,400 seconds)", "4.5 h (16,200 seconds)", "33.3%"])
      assert.ok(tooltip.includes(value), value + " appears in the point tooltip");
    await monthlyEffort.getByText("Show approved monthly effort table").click();
    const effortTable = monthlyEffort.getByRole("table");
    for (const [label, percent] of [["September", "33.3%"], ["October", "22.2%"], ["November", "44.4%"]]) {
      await effortTable.getByRole("row", { name: new RegExp("^" + label + " 2026") }).getByRole("cell", { name: percent, exact: true }).waitFor();
    }
    await septemberPoint.hover();
    await monthlyEffort.screenshot({ path: join(evidence, "monthly-approved-effort-selected-period.png"), animations: "disabled" });
    await monthlyEffort.getByText("Show approved monthly effort table").click();
    let reportRequests = 0;
    const countRequests = (request: import("playwright").Request) => {
      if (new URL(request.url()).pathname.endsWith("/report")) reportRequests++;
    };
    client.page.on("request", countRequests);
    await effort.getByRole("button", { name: "Hours", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime", "&effort-unit=hours"));
    const departmentChart = client.page.getByRole("region", { name: "Department distribution" });
    await departmentChart.getByRole("button", { name: "Project count", exact: true }).click();
    await departmentChart.getByRole("combobox", { name: "Project status" }).selectOption("active");
    const deadlines = client.page.getByRole("group", { name: "Deadline horizon" });
    for (const value of [6, 9, 12, 3]) {
      const choice = deadlines.getByRole("button", { name: value + " months", exact: true });
      await choice.click();
      assert.equal(await choice.getAttribute("aria-pressed"), "true");
    }
    await monthlyEffort.getByRole("img", { name: "Monthly approved allocation in hours" }).waitFor();
    await monthlyEffort.getByRole("button", { name: /^September 2026, Approved effort: 1\.5 h/ }).waitFor();
    const effortDepartment = monthlyEffort.getByRole("combobox", { name: "Effort department" });
    await effortDepartment.selectOption("hr");
    await client.page.waitForURL(url => url.searchParams.get("effort-department") === "hr");
    const hrNovember = monthlyEffort.getByRole("button", { name: /^November 2026, Approved effort: 0 h.*0%/ });
    await client.page.mouse.move(0, 0);
    await hrNovember.focus();
    await monthlyEffort.getByRole("tooltip").filter({ hasText: /November 2026.*Monthly portfolio effort: 2 h.*0%/ }).waitFor();
    await effortDepartment.selectOption("");
    const effortProject = monthlyEffort.getByRole("combobox", { name: "Effort project" });
    await effortProject.selectOption(projectId);
    await monthlyEffort.getByText("Show approved monthly effort table").click();
    await monthlyEffort.getByRole("table", { name: "Share of monthly portfolio effort" }).getByRole("row", { name: /November 2026.*2.*2.*100%/ }).waitFor();
    await monthlyEffort.getByText("No published cap", { exact: false }).waitFor();
    assert.equal(reportRequests, 0, "Visual controls use the same authorized report");
    client.page.off("request", countRequests);
    const octoberPoint = monthlyEffort.getByRole("button", { name: /^October 2026, Approved effort: 1 h/ });
    await octoberPoint.click();
    await monthlyEffort.getByRole("button", { name: "Open October 2026 detail" }).click();
    await client.page.waitForURL(url => url.pathname === "/clients/zagime/projects/" + projectId && url.searchParams.get("month") === previousMonth);
    await client.page.getByRole("heading", { name: projectName, level: 2 }).waitFor();
    await client.page.goBack();
    await effortProject.waitFor();
    assert.equal(await effortProject.inputValue(), projectId);
    await monthlyEffort.getByRole("button", { name: "Open October 2026 detail" }).waitFor();
    await client.page.getByRole("combobox", { name: "Reporting month", exact: true }).selectOption(previousMonth);
    await monthlyEffort.getByText("Historical cap versions unavailable", { exact: false }).waitFor();
    await monthlyEffort.getByRole("button", { name: "Open October 2026 detail" }).waitFor();
    await client.page.getByRole("combobox", { name: "Reporting month", exact: true }).selectOption(month);
    await effortProject.selectOption("");
    const departmentMode = departmentChart.getByRole("button", { name: "Project count", exact: true });
    await departmentMode.click();
    await departmentChart.getByRole("combobox", { name: "Project status" }).selectOption("active");
    await departmentChart.getByRole("button", { name: /No department.*approved delivery project/ }).click();
    await client.page.waitForURL(route("/clients/zagime/projects", "&effort-unit=hours&status=unassigned-active"));
    await captureReference(client.page, "01-client-projects-1740x907", 1740, 907);
    await client.page.goBack();
    await effort.getByRole("button", { name: "Hours", exact: true }).waitFor();
    await effort.getByRole("button", { name: "Percentage", exact: true }).click();
    await client.page.setViewportSize({ width: 1440, height: 900 });
    const clientNav = client.page.getByRole("navigation", { name: "Client workspace" });
    assert.equal(await clientNav.getByRole("button", { name: "Reporting history", exact: true }).count(), 0);
    assert.equal(await client.page.getByText("LIVE PUBLISHED VIEW · MORRIS STAFF PREVIEW").count(), 0);
    await clientNav.getByRole("button", { name: "MI Directory", exact: true }).click();
    await checkContactPortraits(client.page);
    await client.page.screenshot({ path: join(evidence, "client-directory-public-contacts.png"), fullPage: true, animations: "disabled" });
    const directoryViewport = client.page.viewportSize()!;
    await client.page.setViewportSize({ width: 390, height: 844 });
    await checkContactPortraits(client.page);
    await client.page.screenshot({ path: join(evidence, "client-directory-public-contacts-mobile.png"), fullPage: true, animations: "disabled" });
    await client.page.setViewportSize(directoryViewport);
    const missingPortrait = "**/branding/morris/contacts/monica-pollard.png";
    await client.page.route(missingPortrait, request => request.fulfill({ status: 204 }));
    await client.page.reload();
    await checkContactPortraits(client.page, "monica-pollard");
    await client.page.unroute(missingPortrait);
    await clientNav.getByRole("button", { name: "Health", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime/departments/health"));
    assert.equal(await clientNav.getByRole("button", { name: "Health", exact: true }).getAttribute("aria-current"), "page");
    await clientNav.getByRole("button", { name: "HR", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime/departments/hr"));
    await client.page.getByRole("heading", { name: "HR", level: 2 }).waitFor();
    await captureReference(client.page, "02-hr-department-1674x887", 1674, 887);
    await clientNav.getByRole("button", { name: "Health", exact: true }).click();
    await client.page.waitForURL(route("/clients/zagime/departments/health"));
    await client.page.screenshot({ path: join(evidence, "client-empty-department.png"), fullPage: true, animations: "disabled" });
    await clientNav.getByRole("button", { name: "Leadership summary", exact: true }).click();
    await client.page.getByRole("heading", { name: /Leadership\s*summary/i }).waitFor();
    await client.page.setViewportSize({ width: 768, height: 1024 });
    assert.ok(await client.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await client.page.screenshot({ path: join(evidence, "client-dashboard-tablet.png"), fullPage: true, animations: "disabled" });
    await client.page.getByRole("button", { name: "Workspace navigation", exact: true }).click();
    await client.page.getByRole("dialog", { name: "Workspace menu" }).getByRole("button", { name: "Projects", exact: true }).click();
    await client.page.getByRole("heading", { name: "Project Explorer", exact: true }).waitFor();
    await client.page.locator(".mi-explorer-project").first().waitFor();
    await auditViewport(client.page, "Tablet explorer", 768, 1024);
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
    await mappingArea.getByText("Eligible entries", { exact: true }).waitFor();
    await mappingArea.getByText("Will remain unchanged", { exact: true }).waitFor();
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
    await publisher.page.goto(route("/workspace/projects/new"));
    const newWizard = publisher.page.getByRole("form", { name: "Create a project" });
    await newWizard.getByRole("textbox", { name: "Project name", exact: true }).fill("Training candidate fixture");
    await newWizard.getByRole("button", { name: "Continue", exact: true }).click();
    await newWizard.getByRole("button", { name: "Continue", exact: true }).click();
    const arrangement = newWizard.getByRole("combobox", { name: "Arrangement" });
    await arrangement.selectOption("training");
    assert.equal(await arrangement.getByRole("option", { name: "Training & Workshops", exact: true }).count(), 1);
    assert.equal(await newWizard.getByLabel(/hour cap|budgeted hours/i).count(), 0);
    await captureReference(publisher.page, "06-training-schedule-1209x907", 1209, 907);
    await newWizard.getByText("Delivery activity dates and venue", { exact: true }).click();
    await newWizard.getByLabel("Delivery days", { exact: true }).selectOption("consecutive");
    assert.equal(await newWizard.getByLabel("Program length in days").count(), 0, "delivery dates replace the legacy training date form");
    for (const [label, date] of [["First delivery date", "5"], ["Last delivery date", "6"]]) {
      await newWizard.getByRole("button", { name: new RegExp("^" + label) }).click();
      await publisher.page.getByRole("dialog", { name: label, exact: true })
        .locator('button[data-other-month="false"]').filter({ hasText: new RegExp("^" + date + "$") }).click();
    }
    await newWizard.getByText("2 of 2 delivery days selected", { exact: true }).waitFor();
    await newWizard.getByRole("checkbox", { name: "Use the same venue for all dates", exact: true }).uncheck();
    assert.equal(await newWizard.getByRole("combobox", { name: /Venue for/ }).count(), 2);
    await newWizard.getByRole("combobox", { name: /Venue for/ }).first().selectOption("physical");
    await newWizard.getByRole("textbox", { name: "Staff-only venue details" }).fill("Synthetic delivery venue");
    await newWizard.screenshot({ path: join(evidence, "v5-consecutive-schedule-and-venues.png"), animations: "disabled" });
    const activityMode = newWizard.getByLabel("Delivery days", { exact: true });
    await activityMode.selectOption("single");
    await newWizard.getByRole("button", { name: /^Delivery date/ }).click();
    await publisher.page.getByRole("dialog", { name: "Delivery date", exact: true })
      .locator('button[data-other-month="false"]').filter({ hasText: /^7$/ }).click();
    await newWizard.getByText("1 of 1 delivery days selected", { exact: true }).waitFor();
    await newWizard.screenshot({ path: join(evidence, "v5-single-delivery-date.png"), animations: "disabled" });
    await activityMode.selectOption("separate");
    await newWizard.getByRole("checkbox", { name: "Use the same venue for all dates", exact: true }).check();
    for (const [label, date] of [["Delivery date 1", "5"], ["Delivery date 2", "8"]]) {
      await newWizard.getByRole("button", { name: new RegExp("^" + label + " ") }).click();
      await publisher.page.getByRole("dialog", { name: label, exact: true })
        .locator('button[data-other-month="false"]').filter({ hasText: new RegExp("^" + date + "$") }).click();
    }
    await newWizard.getByText("2 of 2 delivery days selected", { exact: true }).waitFor();
    await newWizard.screenshot({ path: join(evidence, "v5-separate-dates-shared-venue.png"), animations: "disabled" });
    await activityMode.selectOption("unscheduled");
    await arrangement.selectOption("hourly");
    assert.equal(await newWizard.getByLabel("Number of delivery days").count(), 0);
    await newWizard.screenshot({ path: join(evidence, "v5-ongoing-unscheduled.png"), animations: "disabled" });
    const staleEdit = await reviewProjectEdit(publisher.page, "This outdated edit should stay private.");
    const openedRevision = (await root.get()).get("revision");
    const concurrentSave = await publisher.context.request.patch(projectApi, {
      headers: { authorization: "Bearer owner" },
      data: { expectedRevision: openedRevision, patch: { ...patch, description: "A newer draft saved while the wizard was open." } },
    });
    assert.equal(concurrentSave.status(), 200);
    const newerDraft = (await pendingRef.get()).data();
    const submittedEdit = publisher.page.waitForRequest(request => request.method() === "PATCH" && request.url() === projectApi);
    await staleEdit.getByRole("button", { name: "Save & Publish", exact: true }).click();
    await publisher.page.getByRole("dialog", { name: "Publish project changes?" }).getByRole("button", { name: "Publish", exact: true }).click();
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
    assert.equal(await publishWizard.getByRole("checkbox", { name: /start date is private|share schedule and hours caps/i }).count(), 0);
    await captureReference(publisher.page, "07-wizard-review-1274x876", 1274, 876);
    const beforeWizardPublish = (await root.get()).get("revision");
    await publishWizard.screenshot({ path: join(evidence, "edit-project-save-and-publish.png"), animations: "disabled" });
    await publishEdit.click();
    const publishDialog = publisher.page.getByRole("dialog", { name: "Publish project changes?" });
    await publishDialog.screenshot({ path: join(evidence, "wizard-publication-confirmation.png"), animations: "disabled" });
    await publisher.page.keyboard.press("Escape");
    await publishDialog.waitFor({ state: "hidden" });
    assert.equal(await publishEdit.evaluate(element => document.activeElement === element), true);
    assert.equal((await root.get()).get("revision"), beforeWizardPublish);
    await publishEdit.click();
    await publishDialog.getByRole("button", { name: "Publish", exact: true }).click();
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
      await captureReference(scheduledClient.page, "01-client-projects-1740x907", 1740, 907);
      await scheduledClient.page.goto(route("/clients/zagime/departments/hr"));
      await scheduledClient.page.getByRole("region", { name: "HR delivery metrics", exact: true }).waitFor();
      await captureReference(scheduledClient.page, "02-hr-department-1674x887", 1674, 887);
      await scheduledClient.page.goto(route("/clients/zagime"));
      await scheduledClient.page.getByRole("region", { name: "Parent projects", exact: true }).waitFor();
      await auditViewport(scheduledClient.page, "Leadership parent cards", 1647, 868, { compactSidebar: true });
      await scheduledClient.page.getByRole("region", { name: "Parent projects", exact: true }).scrollIntoViewIfNeeded();
      await scheduledClient.page.screenshot({ path: join(referenceEvidence, "03-leadership-engagements-1647x868.png"), animations: "disabled" });
    } finally {
      await scheduledClient.context.close();
    }

    await verifyExplorerScale();
    assert.deepEqual(errors, []);
  } finally {
    await mainBrowser?.close();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
    await runtime.close();
  }
});
