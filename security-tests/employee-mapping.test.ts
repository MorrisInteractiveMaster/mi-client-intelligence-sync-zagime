import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { apiServer } from "../server/http";
import type { ReportingBackend } from "../server/backend";
import { firebaseRuntime } from "../server/firebase";
import { sourceRecordId } from "../server/contracts";
import { key } from "../server/firestore-store";
import { readEmployeeProfiles, timeEmployeeKey } from "../server/employee-mapping";
import { portfolioRef, readPortfolio } from "../server/portfolio";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { timeMapping, timeRun } from "../server/time-catalog";
import { timeDetailsRef } from "../server/time-details";
import type { EmployeeMappingChange, EmployeeMappingsPage } from "../src/projects/employee-mapping";
import { newPortfolio } from "../src/projects/portfolio";

test("admin links verified Time employees to one unique WordPress profile with reversible audit and browser feedback", { timeout: 90000 }, async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-employee-mapping";
  const root = runtime.db.collection("tenants").doc(tenant);
  const account = "77", workOrder = "333", parent = "55", date = "2026-11-10";
  const catalog = key("quickbooks-time-customer", account, parent);
  const scopeProjectId = "synthetic-planning";
  const revision = key("source-before");
  const modifiedAt = date + "T18:00:00Z";
  const wordPress = [{ id: 705, name: "Morgan Fixture", title: "Consulting Lead", url: "https://morrisinteractive.ca/team/morgan-fixture/" },
    { id: 706, name: "Mila Fixture", title: "Project Specialist", url: "https://morrisinteractive.ca/team/mila-fixture/" }];
  const portfolio = { ...newPortfolio(), directory: wordPress.map((profile, index) => ({
    id: "wordpress-" + profile.id, name: profile.name, role: "", responsibility: "", email: "private@example.test",
    internalContact: "", publicContact: "", areaId: "", projectIds: [],
    order: index, active: true, visible: false, profile,
  })) };
  const source = (external: string, company = account) => root.collection("rawTime").doc(sourceRecordId("quickbooks-time", company, external));
  const timeDoc = (externalId: string, company = account) => ({
    schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: company, externalId, scopeProjectId, modifiedAt, deleted: false,
    record: { tenantId: tenant, id: source(externalId, company).id, sourceWorkOrderId: workOrder, date, seconds: 18000, revision },
  });
  const detail = (personId: string, consultantName: string) => ({
    provider: "quickbooks-time", sourceRevision: revision, sourceModifiedAt: modifiedAt, observedAt: modifiedAt,
    retrievedVia: "exact-id-lookup", personId, consultantName, notes: "Private time notes",
  });
  await seedProjectSynthetic(runtime.db, tenant, true);
  const batch = runtime.db.batch();
  batch.set(portfolioRef(root), { portfolio });
  batch.set(timeRun(root, catalog), { customerBound: true });
  batch.set(timeMapping(root, account, workOrder), {
    account, jobcodeId: workOrder, projectId: scopeProjectId, scopeProjectId, catalog,
    sourceJob: { id: workOrder, missing: false, name: "Verified consulting", parentId: parent, active: true },
  });
  batch.set(root.collection("memberships").doc(key("client")), { schemaVersion: 2, subject: "client", tenantId: tenant, role: "client", approved: true, enabled: true, projectIds: ["synthetic-delivery"] });
  for (let i = 0; i < 150; i++) batch.set(root.collection("rawTime").doc("0-" + String(i).padStart(3, "0")), { schemaVersion: 2 });
  for (const [external, personId, name] of [["444", "9001", "Morgan H. Fixture"], ["445", "9002", "Mila G. Fixture"]]) {
    batch.set(source(external), timeDoc(external));
    batch.set(timeDetailsRef(source(external), revision), detail(personId, name));
  }
  batch.set(source("446", "89"), timeDoc("446", "89"));
  batch.set(timeDetailsRef(source("446", "89"), revision), detail("9003", "Unapproved account"));
  batch.set(source("447"), timeDoc("447"));
  batch.set(timeDetailsRef(source("447"), revision), { ...detail("9004", "Stale details"), sourceModifiedAt: date + "T01:00:00Z" });
  await batch.commit();
  const directory = await mkdtemp(join(tmpdir(), "mi-employee-mapping-"));
  const fixedNow = Date.parse(modifiedAt);
  const options = {
    frontend: directory,
    allowedOrigin: "",
    projects: new ProjectBackend(new ProjectStore(runtime.db, "owner"), { async verify(token) {
      const subject = token.slice(7);
      return { subject, issuer: "fixture", audience: "fixture", expiresAt: fixedNow + 60_000, revoked: false, disabled: false,
        ...(subject === "owner" || subject === "staff" ? { corporatePolicy: true, staffTenantId: tenant } : {}) };
    } }, { issuer: "fixture", audience: "fixture", now: () => fixedNow }),
  };
  const server = apiServer(undefined as unknown as ReportingBackend, options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  options.allowedOrigin = origin;
  const api = origin + `/api/v2/tenants/${tenant}/directory/employee-mappings`;
  const request = (url = api, subject = "owner", input?: EmployeeMappingChange) => fetch(url, {
    headers: { authorization: "Bearer " + subject, ...(input && { "content-type": "application/json" }) },
    ...(input && { method: "PATCH", body: JSON.stringify(input) }),
  });
  const payload = async (url?: string) => {
    const result = await request(url);
    assert.equal(result.status, 200, await result.clone().text());
    return result.json() as Promise<EmployeeMappingsPage>;
  };
  const firstKey = timeEmployeeKey(account, "9001"), secondKey = timeEmployeeKey(account, "9002");
  let browser: Browser | undefined;
  try {
    assert.equal((await request(api, "staff")).status, 403);
    assert.equal((await request(api, "client")).status, 403);
    assert.equal((await request(api.replace(tenant, "other-tenant"))).status, 403);
    const first = await payload();
    assert.equal(first.revision, 0);
    assert.equal(first.candidates.length, 0);
    assert.ok(first.nextCursor);
    const next = await payload(api + "?cursor=" + first.nextCursor);
    assert.deepEqual(next.candidates.map(person => person.userId).sort(), ["9001", "9002"]);
    assert.doesNotMatch(JSON.stringify(next), /private@example\.test|Private time notes|Unapproved account|Stale details/);
    const target = { action: "link", expectedRevision: 0, employeeKey: firstKey, sourceId: source("444").id, sourceRevision: revision, profileId: 705 } as const;
    assert.equal((await request(api, "staff", target)).status, 403);
    assert.equal((await request(api, "owner", { ...target, employeeKey: secondKey })).status, 409);
    assert.equal((await request(api, "owner", { ...target, sourceId: source("446", "89").id, employeeKey: timeEmployeeKey("89", "9003") })).status, 409);
    assert.equal((await request(api, "owner", { ...target, profileId: 808 })).status, 400);

    await build({
      stdin: {
        contents: `import React from "react"; import {createRoot} from "react-dom/client";
          import {EmployeeMapping} from "./src/api/EmployeeMapping"; import {SecuredApiClient} from "./src/api/client";
          import "./src/api/secure.css"; import "./src/reporting/nordic.css";
          const api=new SecuredApiClient(true, location.origin, async () => "owner", undefined, undefined, "projects");
          createRoot(document.getElementById("root")).render(<main className="nordic secure-shell"><EmployeeMapping client={api} tenant="${tenant}" onDenied={() => {document.title="Access denied"}} /></main>);`,
        loader: "jsx", resolveDir: process.cwd(),
      },
      bundle: true, outfile: join(directory, "mapping.js"), minify: true, jsx: "automatic",
      loader: { ".woff2": "file", ".woff": "file" },
      external: ["/branding/*"],
      define: { "process.env.NODE_ENV": '"production"' },
    });
    await writeFile(join(directory, "index.html"), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Employee Mapping</title><link rel="stylesheet" href="/mapping.css"><div id="root"></div><script src="/mapping.js" defer></script>');
    browser = await chromium.launch({ headless: true,
      ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : process.platform === "win32"
        ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(origin);
    await page.getByRole("heading", { name: "Employee Mapping" }).waitFor();
    await page.getByRole("button", { name: "Scan more imported time" }).click();
    await page.getByRole("searchbox", { name: "Search employees" }).fill("Morgan");
    await page.getByLabel("Verified employee").selectOption(firstKey);
    await page.getByLabel("WordPress profile", { exact: true }).selectOption("705");
    assert.match(await page.getByText("Morgan H. Fixture", { exact: true }).textContent() ?? "", /Morgan/);
    await page.getByText("Consulting Lead", { exact: true }).waitFor();
    const evidence = resolve("test-results/employee-mapping-browser");
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, "employee-mapping.png"), animations: "disabled", fullPage: true });
    await page.getByRole("button", { name: "Confirm employee link" }).click();
    await page.getByText("Employee link saved.", { exact: true }).waitFor();
    const linked = await payload();
    assert.equal(linked.revision, 1);
    assert.equal(linked.links[0].profileId, 705);
    assert.equal((await request(api, "owner", { ...target, employeeKey: secondKey, sourceId: source("445").id, expectedRevision: 1 })).status, 409);
    assert.equal((await request(api, "owner", target)).status, 409);
    const profiles = await runtime.db.runTransaction(async tx => readEmployeeProfiles(tx, root, await readPortfolio(tx, root)), { readOnly: true });
    assert.equal(profiles.get(firstKey)?.title, "Consulting Lead");
    assert.equal(profiles.has(secondKey), false);
    assert.equal((await request(api, "owner", { ...target, expectedRevision: 1 })).status, 200);
    assert.equal((await payload()).revision, 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Remove link", exact: true }).click();
    await page.screenshot({ path: join(evidence, "employee-mapping-mobile.png"), animations: "disabled", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Confirm removal" }).click();
    await page.getByText("Employee link removed.", { exact: true }).waitFor();
    const unlinked = await payload();
    assert.equal(unlinked.revision, 2);
    assert.deepEqual(unlinked.links, []);
    const events = (await root.collection("audits").get()).docs.map(doc => doc.data()).filter(event => event.entityId === firstKey);
    assert.deepEqual(events.map(event => [event.action, event.previousProfileId, event.nextProfileId]).sort(), [
      ["time-employee-linked", null, 705], ["time-employee-unlinked", 705, null],
    ]);
    assert.deepEqual((await source("444").get()).data(), timeDoc("444"));
    assert.deepEqual((await portfolioRef(root).get()).data(), { portfolio });
    const clientReport = await request(origin + "/api/v2/tenants/" + tenant + "/report?month=2026-11", "client");
    assert.equal(clientReport.status, 200);
    assert.doesNotMatch(await clientReport.text(), /Morgan H\. Fixture|9001|Private time notes|private@example\.test/);
  } finally {
    await browser?.close();
    server.close();
    await once(server, "close");
    await rm(directory, { recursive: true, force: true });
    await runtime.close();
  }
});
