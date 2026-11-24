import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit, type Browser } from "playwright";
import { firebaseRuntime, FirebaseIdentityVerifier } from "../server/firebase";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { TimeSync } from "../server/time-sync";
import { timeDetailsRef } from "../server/time-details";
import {
  seedProjectSynthetic,
  provisionProjectClient,
  inspectProjectMigration,
} from "../server/project-operator";
import { seedSynthetic } from "../server/synthetic-seed";
import { key } from "../server/firestore-store";
import { apiServer, RequestLimit } from "../server/http";
import type { ReportingBackend } from "../server/backend";
import { staffTestFixture } from "../server/testing/morris-staff-fixture";
import { staffSegments } from "../src/api/platform-routes";
import { auditViewport } from "./viewport-audit";

test(
  "project-only secured Auth/Firestore workflow and real browser persistence without agreement records",
  { timeout: 240000 },
  async () => {
    const runtime = firebaseRuntime(
      "emulator",
      "demo-mi-security",
      "mi-client-staging",
    );
    const tenant = "synthetic-project-only",
      root = runtime.db.doc(`tenants/${tenant}`);
    assert.equal((await seedProjectSynthetic(runtime.db, tenant)).dryRun, true);
    assert.equal((await root.get()).exists, false);
    await seedProjectSynthetic(runtime.db, tenant, true);
    await assert.rejects(
      seedProjectSynthetic(runtime.db, tenant, true),
      /overwrite/,
    );
    assert.ok(
      !(await root.listCollections()).some((c) =>
        /agreement|department|budget/i.test(c.id),
      ),
    );
    const fixture = await staffTestFixture(tenant),
      oid = "88888888-8888-4888-8888-888888888888";
    fixture.setUser({ ...fixture.user(), id: oid });
    const microsoftToken = await fixture.token({ oid });
    const authenticate = async (route: string, payload: unknown) => {
      const r = await fetch(
        `http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:${route}?key=synthetic`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      assert.equal(r.status, 200, "local Auth fixture sign-in failed");
      return (await r.json()) as any;
    };
    const signStaff = () =>
      authenticate("signInWithIdp", {
        requestUri: "http://localhost",
        returnSecureToken: true,
        postBody: new URLSearchParams({
          providerId: "microsoft.com",
          id_token: microsoftToken,
        }).toString(),
      });
    const staff = await signStaff();
    const password = "synthetic-project-only-password";
    for (const uid of ["project-client", "project-spoof"])
      await runtime.auth.createUser({
        uid,
        email:
          uid === "project-spoof"
            ? "synthetic-project-spoof@morrisinteractive.ca"
            : "project-client@example.com",
        password,
        emailVerified: true,
      });
    await runtime.auth.updateUser("project-client", {
      providerToLink: {
        providerId: "google.com",
        uid: "project-only-google-fixture",
      },
    });
    await runtime.auth.setCustomUserClaims("project-spoof", {
      administrator: true,
      staffTenantId: tenant,
      corporatePolicy: true,
    });
    const client = await authenticate("signInWithPassword", {
      email: "project-client@example.com",
      password,
      returnSecureToken: true,
    });
    const spoof = await authenticate("signInWithPassword", {
      email: "synthetic-project-spoof@morrisinteractive.ca",
      password,
      returnSecureToken: true,
    });
    const directory = await mkdtemp(join(tmpdir(), "mi-project-browser-"));
    // Fixture entry only: no production test hook, token value in bundle, browser storage or real OAuth.
    await build({
      stdin: {
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectStaffWorkspace} from './src/api/ProjectWorkspace'; import {ProjectClientReport} from './src/api/ProjectClientReport'; import {SecuredApiClient} from './src/api/client'; import {useReportingMonth} from './src/api/portal-location'; import './src/api/secure.css'; import './src/reporting/nordic.css'; const identity=window.__localProjectFixture; async function fixtureRequest(input, init) {
  const race = window.__reportRace;
  const url = new URL(input);
  if (race && url.pathname.endsWith("/report")) {
    const month = url.searchParams.get("month");
    if (month === "2026-12") {
      // Return actual data for the wrong scope to exercise the response check.
      url.searchParams.set("month", "2026-10");
      return fetch(url, init);
    }
    if (month === "2026-10" && !race.requested) {
      race.requested = true;
      // Simulate a transport that does not cancel an in-flight response.
      const response = await fetch(url, { ...init, signal: undefined });
      await race.gate;
      race.delivered = true;
      return response;
    }
  }
  const response=await fetch(input, init);
  if (url.pathname.endsWith('/report') && response.ok) {
    const payload=await response.json();
    payload.tenant.name='Zagimē Anishinabēk Nation';
    return new Response(JSON.stringify(payload),{status:response.status,headers:response.headers});
  }
  return response;
}
const client=new SecuredApiClient(true, location.origin, async()=>identity.token, fixtureRequest, ()=>identity.proof, 'projects');
const denied=()=>document.body.textContent='Access denied';
function ClientFixture() {
  const month=useReportingMonth("2026-11");
  return <ProjectClientReport client={client} tenant="${tenant}" month={month} onDenied={denied}/>;
}
function StaffFixture({workspace}) {
  const month=useReportingMonth("2026-11");
  return <ProjectStaffWorkspace client={client} tenant="${tenant}" workspace={{...workspace,tenant:{...workspace.tenant,name:'Zagimē Anishinabēk Nation'}}} month={month} onDenied={denied}/>;
}
client.call('${tenant}','workspace').then(workspace=>createRoot(document.getElementById('root')).render(<section className="nordic secure-shell platform-shell"><header className="secure-masthead"><div className="secure-brandmarks"><img alt="Zagimē Anishinabēk" src="/branding/zagime/zagime-main-logo.png" style={{background:'#01264f',padding:'4px'}}/><img alt="Morris Interactive" src="/branding/morris/morris-wordmark.png"/></div><div className="secure-identity"><h1>Client Intelligence</h1></div><div className="mi-masthead-actions"><div id="mi-workspace-commands"/></div></header><main id="platform-content" className={workspace.role === "staff" ? "platform-workspace" : "platform-client-report"}>{workspace.role === "staff" ? <StaffFixture workspace={workspace}/> : <ClientFixture/>}</main></section>)).catch(()=>document.body.textContent='Access denied');`,
        loader: "jsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      outfile: join(directory, "app.js"),
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": '{"BASE_URL":"/"}' },
      loader: { ".woff2": "file", ".woff": "file" },
      external: ["/branding/*"],
      minify: true,
    });
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>',
    );
    await cp(resolve("public/branding"), join(directory, "branding"), { recursive: true });
    let directoryAvailable = true;
    const options = {
      time: new TimeSync(new ProjectStore(runtime.db)),
      frontend: directory,
      allowedOrigin: "",
      limit: new RequestLimit(10000),
      projects: new ProjectBackend(
        new ProjectStore(runtime.db),
        new FirebaseIdentityVerifier(runtime.auth, fixture.verifier),
        {
          issuer: "https://securetoken.google.com/demo-mi-security",
          audience: "demo-mi-security",
          now: Date.now,
        },
        async () => {
          if (!directoryAvailable) throw Error("Synthetic WordPress outage");
          return [{ id: 41, name: "Example delivery facilitator", title: "Facilitator", url: "https://morrisinteractive.ca/team/example-profile/" }];
        },
      ),
    };
    const server = apiServer(undefined as unknown as ReportingBackend, options);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${(server.address() as any).port}`;
    options.allowedOrigin = origin;
    const base = `${origin}/api/v2/tenants/${tenant}/`;
    const request = (
      path: string,
      method = "GET",
      body?: unknown,
      token = staff.idToken,
      idem?: string,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + token,
          ...(token === staff.idToken
            ? {
                "X-Morris-Microsoft-Identity": microsoftToken,
                "X-Morris-Microsoft-Access": "synthetic-delegated-proof",
              }
            : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(idem ? { "idempotency-key": idem } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const json = async (r: Response, status = 200) => {
      assert.equal(r.status, status, "secured request status");
      return (await r.json()) as any;
    };
    const revision = async () => (await root.get()).data()!.revision as number;
    const auditCount = async () =>
      (await root.collection("audits").count().get()).data().count;
    const projectInput = {
      name: "Synthetic independent project",
      status: "active",
      progress: 10,
      description: "Published synthetic description",
      internalNotes: "PRIVATE-NOTE",
      plan: { basis: "fixed", targetSeconds: 7200 },
    };
    const sourceBefore = (
      await root.collection("rawTime").doc("synthetic-time").get()
    ).data();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      assert.equal(
        (await request("workspace", "GET", undefined, "")).status,
        401,
      );
      assert.equal(
        (await request("workspace", "GET", undefined, spoof.idToken)).status,
        403,
      );
      assert.equal(
        (await request("workspace", "GET", undefined, client.idToken)).status,
        403,
      );
      assert.equal((await request("workspace?agreementId=any")).status, 400);
      assert.equal(
        (
          await fetch(origin + `/api/tenants/${tenant}/workspace`, {
            headers: { Authorization: "Bearer " + staff.idToken },
          })
        ).status,
        404,
      );
      assert.equal((await json(await request("workspace"))).role, "staff");
      assert.equal((await root.collection("memberships").get()).size, 0);
      const idempotency = `${Date.now()}-${crypto.randomUUID()}`;
      const duplicate = await Promise.all([
        request("projects", "POST", projectInput, staff.idToken, idempotency),
        request("projects", "POST", projectInput, staff.idToken, idempotency),
      ]);
      const created = await json(duplicate[0], 201),
        retried = await json(duplicate[1], 201);
      assert.equal(created.id, retried.id);
      assert.equal(created.revision, retried.revision);
      assert.equal(
        (
          await request(
            "projects",
            "POST",
            { ...projectInput, name: "changed" },
            staff.idToken,
            idempotency,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(
            "projects",
            "POST",
            { ...projectInput, agreementId: "no" },
            staff.idToken,
            `${Date.now()}-${crypto.randomUUID()}`,
          )
        ).status,
        403,
      );
      assert.equal(
        (await root.collection("projects").doc(created.id).get()).data()!
          .published,
        false,
      );
      const count = await auditCount(),
        beforeNoop = (await root.get()).updateTime!.toMillis();
      const noOp = await json(
        await request(`projects/${created.id}`, "PATCH", {
          expectedRevision: await revision(),
          patch: projectInput,
        }),
      );
      assert.equal(noOp.changed, false);
      assert.equal(await auditCount(), count);
      assert.equal((await root.get()).updateTime!.toMillis(), beforeNoop);
      assert.equal(
        (
          await request(`projects/${created.id}`, "PATCH", {
            expectedRevision: await revision(),
            patch: { ...projectInput, source: { projectId: "forged" } },
          })
        ).status,
        403,
      );
      const external = {
        product: "qbo-projects",
        realmId: "synthetic-only",
        projectId: "synthetic-native-project",
        revision: "1",
        modifiedAt: null,
        state: "active",
      };
      await root
        .collection("projects")
        .doc(created.id)
        .update({ source: external }); // synthetic source-ownership fixture, not a connector
      const concurrentRevision = await revision();
      const concurrent = await Promise.all([
        request(`projects/${created.id}`, "PATCH", {
          expectedRevision: concurrentRevision,
          patch: { ...projectInput, name: "Concurrent A" },
        }),
        request(`projects/${created.id}`, "PATCH", {
          expectedRevision: concurrentRevision,
          patch: { ...projectInput, name: "Concurrent B" },
        }),
      ]);
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
      assert.deepEqual(
        (await root.collection("projects").doc(created.id).get()).data()!
          .source,
        external,
      );
      const approval = {
        approved: true,
        tenantId: tenant,
        uid: "project-client",
        projectIds: [created.id, "synthetic-planning"],
      };
      assert.equal(
        (await provisionProjectClient(runtime.db, runtime.auth, approval))
          .dryRun,
        true,
      );
      assert.equal(
        (await provisionProjectClient(runtime.db, runtime.auth, approval, true))
          .changed,
        true,
      );
      assert.equal(
        (await provisionProjectClient(runtime.db, runtime.auth, approval, true))
          .changed,
        false,
      );
      await assert.rejects(
        provisionProjectClient(
          runtime.db,
          runtime.auth,
          { ...approval, role: "administrator" },
          true,
        ),
      );
      assert.deepEqual(
        (
          await json(
            await request(
              "report?month=2026-11",
              "GET",
              undefined,
              client.idToken,
            ),
          )
        ).projects,
        [],
      );
      for (const path of [
        "projects?month=2026-11",
        "sources?month=2026-11",
        "audits?month=2026-11",
        "sources/synthetic-time/history?month=2026-11",
        `projects/${created.id}`,
      ])
        assert.equal(
          (await request(path, "GET", undefined, client.idToken)).status,
          403,
        );
      assert.equal(
        (
          await request(
            `projects/${created.id}/publication`,
            "PATCH",
            { expectedRevision: await revision(), published: true },
            client.idToken,
          )
        ).status,
        403,
      );
      const allocated = [
        {
          projectId: created.id,
          seconds: 3600,
          description: "Synthetic split",
        },
        {
          projectId: "synthetic-planning",
          seconds: 3600,
          description: "Synthetic split",
        },
      ];
      const failedRev = await revision(),
        failedAudits = await auditCount();
      assert.equal(
        (
          await request("allocations/synthetic-time", "PATCH", {
            expectedRevision: failedRev,
            portions: [{ ...allocated[0], seconds: 7201 }],
          })
        ).status,
        400,
      );
      assert.equal(await revision(), failedRev);
      assert.equal(await auditCount(), failedAudits);
      await json(
        await request("allocations/synthetic-time", "PATCH", {
          expectedRevision: await revision(),
          portions: allocated,
        }),
      );
      const allocationCount = await auditCount(),
        allocationNoop = await json(
          await request("allocations/synthetic-time", "PATCH", {
            expectedRevision: await revision(),
            portions: allocated,
          }),
        );
      assert.equal(allocationNoop.changed, false);
      assert.equal(await auditCount(), allocationCount);
      assert.deepEqual(
        (await root.collection("rawTime").doc("synthetic-time").get()).data(),
        sourceBefore,
      );
      const nov = await json(await request("projects?month=2026-11")),
        oct = await json(await request("projects?month=2026-10"));
      assert.equal(
        nov.projects.reduce((n: number, p: any) => n + p.seconds, 0),
        7200,
      );
      assert.equal(
        oct.projects.reduce((n: number, p: any) => n + p.seconds, 0),
        0,
      );
      assert.equal(
        oct.projects.reduce((n: number, p: any) => n + p.lifetimeSeconds, 0),
        7200,
      );
      await json(
        await request(`projects/${created.id}/publication`, "PATCH", {
          expectedRevision: await revision(),
          published: true,
        }),
      );
      await root
        .collection("projectViews")
        .doc(created.id)
        .update({
          internalNotes: "MUST-NOT-LEAK",
          source: { personId: "MUST-NOT-LEAK" },
          "plan.internalNotes": "MUST-NOT-LEAK",
        });
      const publicBefore = await json(
        await request("report?month=2026-11", "GET", undefined, client.idToken),
      );
      assert.equal(publicBefore.projects.length, 1);
      assert.equal(publicBefore.totalSeconds, 3600);
      assert.ok(!JSON.stringify(publicBefore).includes("MUST-NOT-LEAK"));
      assert.ok(!JSON.stringify(publicBefore).includes("PRIVATE-NOTE"));
      assert.ok(!("revision" in publicBefore));
      const integrityRevision = await revision(),
        integrityAudits = await auditCount();
      await root
        .collection("projectViews")
        .doc(created.id)
        .update({ tenantId: "synthetic-other-client" });
      assert.equal(
        (
          await request(
            "report?month=2026-11",
            "GET",
            undefined,
            client.idToken,
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request(`projects/${created.id}/publication`, "PATCH", {
            expectedRevision: integrityRevision,
            published: false,
          })
        ).status,
        503,
      );
      assert.equal(await revision(), integrityRevision);
      assert.equal(await auditCount(), integrityAudits);
      await root
        .collection("projectViews")
        .doc(created.id)
        .update({ tenantId: tenant });
      const period = root
        .collection("projectPeriods")
        .doc(key("2026-11", created.id));
      await period.update({ month: "2026-10" });
      assert.equal(
        (
          await request(
            "report?month=2026-11",
            "GET",
            undefined,
            client.idToken,
          )
        ).status,
        503,
      );
      assert.equal(
        (
          await request("allocations/synthetic-time", "PATCH", {
            expectedRevision: integrityRevision,
            portions: [
              {
                projectId: created.id,
                seconds: 7200,
                description: "corruption must roll back",
              },
            ],
          })
        ).status,
        503,
      );
      assert.equal(await revision(), integrityRevision);
      assert.equal(await auditCount(), integrityAudits);
      await period.update({ month: "2026-11" });
      assert.deepEqual(
        await json(
          await request(
            "report?month=2026-11",
            "GET",
            undefined,
            client.idToken,
          ),
        ),
        publicBefore,
      );
      await json(
        await request(`projects/${created.id}/publication`, "PATCH", {
          expectedRevision: await revision(),
          published: false,
        }),
      );
      assert.equal(
        (
          await json(
            await request(
              "report?month=2026-11",
              "GET",
              undefined,
              client.idToken,
            ),
          )
        ).projects.length,
        0,
      );
      await json(
        await request(`projects/${created.id}/publication`, "PATCH", {
          expectedRevision: await revision(),
          published: true,
        }),
      );
      await json(
        await request("projects/synthetic-delivery", "PATCH", {
          expectedRevision: await revision(),
          patch: {
            ...projectInput,
            name: "HIDDEN-PROJECT",
            internalNotes: "Hidden private change",
          },
        }),
      );
      assert.deepEqual(
        await json(
          await request(
            "report?month=2026-11",
            "GET",
            undefined,
            client.idToken,
          ),
        ),
        publicBefore,
      );
      const one = await json(await request("projects?month=2026-11&limit=1"));
      assert.equal(
        (await json(await request("sources?month=2026-10"))).sources.length,
        0,
      );
      assert.equal(
        (await json(await request("sources?month=2026-11"))).sources[0]
          .approval,
        "unknown",
      );
      assert.ok(one.nextCursor);
      const two = await json(
        await request(
          `projects?month=2026-11&limit=1&cursor=${encodeURIComponent(one.nextCursor)}`,
        ),
      );
      assert.notEqual(two.projects[0].id, one.projects[0].id);
      assert.equal(
        (
          await request(
            `sources?month=2026-11&cursor=${encodeURIComponent(one.nextCursor)}`,
          )
        ).status,
        409,
      );
      assert.equal(
        (await request("projects?month=2026-11&limit=26")).status,
        400,
      );
      const history = await json(
        await request("sources/synthetic-time/history?month=2026-11"),
      );
      assert.equal(history.history.length, 1);
      assert.equal(history.history[0].actor, staff.localId);
      const audits = await json(await request("audits?month=2026-11"));
      assert.ok(
        audits.audits.some(
          (a: any) =>
            a.action === "allocation-changed" && a.actor === staff.localId,
        ),
      );
      await runtime.db
        .doc("tenants/synthetic-project-other")
        .set({ schemaVersion: 2, revision: 1, name: "Other synthetic" });
      assert.equal(
        (
          await fetch(
            base.replace(tenant, "synthetic-project-other") + "workspace",
            {
              headers: {
                Authorization: "Bearer " + staff.idToken,
                "X-Morris-Microsoft-Identity": microsoftToken,
                "X-Morris-Microsoft-Access": "synthetic-delegated-proof",
              },
            },
          )
        ).status,
        403,
      );
      const legacyTenant = "synthetic-project-legacy";
      await seedSynthetic(runtime.db, legacyTenant, true);
      const inspected = await inspectProjectMigration(runtime.db, legacyTenant);
      assert.equal(inspected.requiresApprovedMigration, true);
      assert.ok(inspected.counts.projects > 0);
      assert.equal(
        (await runtime.db.doc(`tenants/${legacyTenant}`).get()).data()!
          .schemaVersion,
        undefined,
      );
      assert.equal(
        (await inspectProjectMigration(runtime.db, tenant))
          .requiresApprovedMigration,
        false,
      );

      // Real React component + secured HTTP + Auth/Firestore, two independent browser sessions.
      browser = await chromium.launch({
        headless: true,
        ...(process.env.BROWSER_EXECUTABLE
          ? { executablePath: process.env.BROWSER_EXECUTABLE }
          : process.platform === "win32"
            ? {
                executablePath:
                  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
              }
            : {}),
      });
      const evidence = resolve("test-results/project-only-browser");
      await mkdir(evidence, { recursive: true });
      const errors: string[] = [];
      const session = async (width: number, role: "staff" | "client" = "staff", engine: Browser = browser!) => {
        const fresh = role === "staff" ? await signStaff() : await authenticate("signInWithPassword", { email: "project-client@example.com", password, returnSecureToken: true });
        const context = await engine.newContext({
          viewport: { width, height: 1000 },
          hasTouch: width <= 430,
        });
        await context.addInitScript(
          (identity) => {
            (window as any).__localProjectFixture = identity;
          },
          {
            token: fresh.idToken,
            proof: role === "staff" ? {
              idToken: microsoftToken,
              accessToken: "synthetic-delegated-proof",
            } : undefined,
          },
        );
        await context.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin === origin) return route.continue();
          return route.abort();
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(m.text());
        });
        await page.goto(origin, { waitUntil: "networkidle" });
        if (role === "staff") await page.getByRole("button", { name: "Create project", exact: true }).waitFor();
        else await page.getByRole("heading", { name: "Published projects", exact: true }).waitFor();
        return { context, page };
      };
      await json(await request("directory/wordpress-sync", "POST", {}));
      const contact = { id: "reviewed-contact", name: "Approved synthetic contact", role: "Delivery lead",
        responsibility: "Coordinates delivery", internalContact: "INTERNAL-CONTACT", publicContact: "Approved contact channel",
        areaId: "health", projectIds: [], order: 1, active: true, visible: true };
      await json(await request("portfolio", "PATCH", { section: "directory", record: contact, expectedRevision: await revision() }));
      await json(await request("projects", "POST", {
        ...projectInput, name: "Browser parent project",
        delivery: { structure: 3, kind: "engagement", type: "hourly", managerIds: ["wordpress-41"], teamIds: [] },
      }, staff.idToken, Date.now() + "-" + crypto.randomUUID()), 201);
      const first = await session(1440);
      await first.page
        .getByRole("searchbox", { name: "Search projects" })
        .fill("SYNTHETIC planning");
      await first.page
        .getByRole("button", { name: "Search", exact: true })
        .click();
      await first.page
        .getByRole("heading", { name: "HIDDEN-PROJECT", exact: true })
        .waitFor({ state: "hidden" });
      await first.page
        .getByRole("heading", {
          name: "Synthetic planning project",
          exact: true,
        })
        .waitFor();
      await first.page
        .getByRole("link", {
          name: "View hours for Synthetic planning project",
        })
        .click();
      await first.page
        .getByRole("heading", {
          name: "Project hours · Synthetic planning project",
        })
        .waitFor();
      await first.page.screenshot({ path: join(evidence, "hours-and-allocations.png"), animations: "disabled" });
      const staffNavigation = first.page.getByRole("navigation", { name: "Morris workspace sections" });
      await first.page
        .getByRole("navigation", { name: "Morris workspace sections" })
        .getByRole("button", { name: "Projects", exact: true })
        .click();
      await first.page.getByRole("button", { name: "Clear search", exact: true }).click();
      await staffNavigation.getByRole("button", { name: "Integrations", exact: true }).click();
      await first.page.getByRole("heading", { name: "Integrations", exact: true }).last().waitFor();
      await first.page.screenshot({ path: join(evidence, "integration-status.png"), animations: "disabled" });
      await staffNavigation.getByRole("button", { name: "Projects", exact: true }).click();
      await first.page
        .getByRole("heading", { name: "HIDDEN-PROJECT", exact: true })
        .waitFor();
      await first.page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      const creationForm = first.page.getByRole("form", { name: "Create a project", exact: true });
      await creationForm.getByRole("radio", { name: "Delivery Project", exact: true }).check();
      await creationForm.getByLabel("Project name", { exact: true }).fill("Browser saved project");
      await creationForm.screenshot({ path: join(evidence, "project-creation-wizard.png"), animations: "disabled" });
      const originalWizardViewport = first.page.viewportSize()!;
      async function verifyWizardLayout(width: number, height: number, stacked: boolean, zoom = 1) {
        await first.page.setViewportSize({ width, height });
        await first.page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
        const cardRects = await creationForm.locator(".creation-kinds label").evaluateAll(cards =>
          cards.map(card => {
            const bounds = card.getBoundingClientRect();
            const text = card.querySelector(".creation-kind-copy") as HTMLElement;
            return { x: bounds.x, y: bounds.y, width: bounds.width, right: bounds.right, bottom: bounds.bottom,
              clipped: text.scrollWidth > text.clientWidth + 1 };
          }));
        assert.equal(cardRects.length, 2);
        assert.ok(cardRects.every(card => !card.clipped && card.x >= 0 && card.right <= width + 1));
        assert.ok(Math.abs(cardRects[0].width - cardRects[1].width) < 1);
        assert.equal(cardRects[0].y < cardRects[1].y, stacked);
        if (width === 1440 && zoom === 1) assert.ok(cardRects.every(card => card.bottom <= height));
        await creationForm.screenshot({ path: join(evidence, `project-wizard-${width}x${height}${zoom > 1 ? "-zoom" : ""}.png`), animations: "disabled" });
      }
      await verifyWizardLayout(1440, 900, false);
      await verifyWizardLayout(390, 844, true);
      await verifyWizardLayout(320, 568, true);
      await verifyWizardLayout(1440, 900, true, 2);
      await first.page.evaluate(() => { document.documentElement.style.zoom = ""; });
      await first.page.setViewportSize(originalWizardViewport);
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      await creationForm.getByRole("combobox", { name: "Parent Project", exact: true }).fill("Browser parent");
      await creationForm.getByRole("option", { name: "Browser parent project", exact: true }).click();
      await creationForm.getByRole("combobox", { name: "Department", exact: true }).fill("Heal");
      await creationForm.getByRole("option", { name: "Health", exact: true }).click();
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      await creationForm.getByLabel("Client-facing description").fill("Published synthetic project description");
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      const arrangement = creationForm.getByRole("combobox", { name: "Arrangement", exact: true });
      await arrangement.selectOption("fixed-fee");
      await creationForm.getByLabel("Hour cap", { exact: true }).waitFor();
      assert.equal(await creationForm.getByLabel("Monthly budgeted hours").count(), 0);
      await arrangement.selectOption("training");
      await creationForm.getByLabel("Program length in days").fill("2");
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      await creationForm.getByRole("alert").filter({ hasText: "Choose exactly one distinct calendar date per program day." }).waitFor();
      assert.equal(await creationForm.getByLabel(/hour cap|budgeted hours/i).count(), 0);
      await creationForm.getByRole("button", { name: /Program dates/ }).click();
      const programCalendar = creationForm.getByRole("dialog", { name: "Program dates", exact: true });
      const currentMonthDays = programCalendar.locator('button[data-other-month="false"]');
      await currentMonthDays.nth(2).click();
      await currentMonthDays.nth(8).click();
      await programCalendar.getByRole("button", { name: "Apply dates" }).click();
      assert.ok(await creationForm.getByText("Expected completion", { exact: false }).isVisible());
      await arrangement.selectOption("hourly");
      await creationForm.getByLabel("Whole-project budgeted hours").fill("1.25");
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      await creationForm.getByRole("group", { name: /Project Managers/ }).getByRole("checkbox", { name: /Approved synthetic contact/ }).check();
      await creationForm.getByRole("button", { name: "Continue", exact: true }).click();
      await creationForm.getByRole("button", { name: "Save Draft", exact: true }).click();
      await first.page.getByRole("heading", { name: "Browser saved project", exact: true }).waitFor();
      await first.page.getByRole("button", { name: "Edit Browser saved project", exact: true }).click();
      const editingForm = first.page.getByRole("form", { name: "Edit a project", exact: true });
      assert.equal(await editingForm.getByLabel("Project name", { exact: true }).inputValue(), "Browser saved project");
      await editingForm.screenshot({ path: join(evidence, "project-editor.png"), animations: "disabled" });
      await editingForm.getByRole("button", { name: "Cancel", exact: true }).click();
      const savedBrowserProject = (await root.collection("projects").where("name", "==", "Browser saved project").get()).docs[0];
      const browserProject = savedBrowserProject.data();
      assert.equal(browserProject.delivery.structure, 3);
      assert.equal(browserProject.delivery.lifetimeCap, 4500);
      const { name, description, delivery } = browserProject;
      await json(await request("projects/" + savedBrowserProject.id, "PATCH", {
        expectedRevision: await revision(), patch: {
          name, description, delivery, plan: { basis: "fixed", targetSeconds: 4500 }, status: "active", progress: 100,
          internalNotes: "Browser synthetic private note",
          updates: [
            { id: "browser-approved-update", title: "Approved delivery update", body: "The client can see this update.", date: "2026-11-19", visible: true },
            { id: "browser-private-update", title: "PRIVATE-UPDATE", body: "Private draft detail.", date: "2026-11-19", visible: false },
          ],
          milestones: [{ id: "browser-approved-milestone", title: "Approved milestone", date: "2026-11-20", visible: true, completed: true }],
        },
      }));
      await first.page.reload({ waitUntil: "networkidle" });
      const card = first.page.locator("article").filter({
        has: first.page.getByRole("heading", {
          name: "Browser saved project",
          exact: true,
        }),
      });
      await card.waitFor();
      await first.page.getByRole("button", { name: "Table", exact: true }).click();
      await first.page.getByRole("region", { name: "Projects table" }).waitFor();
      first.page.once("dialog", dialog => void dialog.accept());
      await first.page
        .getByRole("button", {
          name: "Publish Browser saved project",
          exact: true,
        })
        .click();
      await first.page
        .getByRole("button", {
          name: "Unpublish Browser saved project",
          exact: true,
        })
        .waitFor();
      await first.page.getByRole("button", { name: "Project list", exact: true }).click();
      await first.page.getByRole("button", { name: "Time Allocation", exact: true }).click();
      await first.page
        .getByRole("button", { name: "Load authorized time", exact: true })
        .click();
      await first.page
        .getByRole("button", { name: "Manage Time", exact: true })
        .click();
      await first.page.getByLabel("Reporting description", { exact: true }).fill("Reviewed delivery preparation");
      await first.page.getByLabel("Internal note", { exact: true }).fill("Private allocation review");
      await first.page
        .getByLabel("Delivery project", { exact: true })
        .nth(0)
        .selectOption({ label: "Browser saved project" });
      await first.page
        .getByLabel("Allocated seconds", { exact: true })
        .nth(0)
        .fill("1800");
      await first.page
        .getByLabel("Allocated seconds", { exact: true })
        .nth(1)
        .fill("5400");
      const allocationEditor = first.page.getByRole("dialog", { name: "Time allocation", exact: true });
      await allocationEditor.scrollIntoViewIfNeeded();
      await first.page.screenshot({ path: join(evidence, "time-allocation-editor.png"), animations: "disabled" });
      await first.page
        .getByRole("button", { name: "Save allocation", exact: true })
        .click();
      await first.page.getByText("Allocation saved.", { exact: true }).waitFor();
      await first.page.getByText("Reviewed delivery preparation", { exact: true }).waitFor();
      const monthSearch = first.page.getByRole("searchbox", { name: "Search month", exact: true });
      await monthSearch.fill("Reviewed delivery");
      await first.page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await first.page.getByRole("status").filter({ hasText: /Search: Reviewed delivery.*1 match out of/ }).waitFor();
      await monthSearch.fill("No matching reporting text");
      await first.page.getByRole("button", { name: "Apply filters", exact: true }).click();
      await first.page.getByRole("status").filter({ hasText: /0 matches out of/ }).waitFor();
      await first.page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await first.page.getByText("Reviewed delivery preparation", { exact: true }).waitFor();
      const initialTimeViewport = first.page.viewportSize()!;
      const timeLayout = [await auditViewport(first.page, "Legacy Time Allocation", 1440, 1000, { compactSidebar: true })];
      await first.page.screenshot({ path: join(evidence, "time-allocation.png"), fullPage: true, animations: "disabled" });
      assert.equal(await staffNavigation.getByRole("button", { name: "Time Allocation", exact: true }).getAttribute("aria-current"), "page");
      for (const [width, height] of [[1024, 768], [768, 1024], [390, 844], [320, 568]]) {
        timeLayout.push(await auditViewport(first.page, "Legacy Time Allocation", width, height, { compactSidebar: true }));
        await first.page.screenshot({ path: join(evidence, `time-allocation-${width}x${height}.png`), fullPage: true, animations: "disabled" });
      }
      await first.page.setViewportSize(initialTimeViewport);
      const bookmarkPage = await first.context.newPage();
      bookmarkPage.on("pageerror", error => errors.push(error.message));
      try {
        const timeBookmark = new URL("/?staff=hours&month=2026-11&period=month&workOrder=synthetic-job#/secure", origin);
        await bookmarkPage.goto(timeBookmark.href);
        const selectedTimeScope = bookmarkPage.getByRole("status").filter({ hasText: /Work order: synthetic-job.*1 match out of/ });
        await selectedTimeScope.waitFor();
        assert.equal(bookmarkPage.url(), timeBookmark.href);
        timeLayout.push(await auditViewport(bookmarkPage, "Bookmarked legacy Time filter", 1440, 1000, { compactSidebar: true }));
        await bookmarkPage.getByRole("button", { name: "Manage Time", exact: true }).click();
        const entryLink = bookmarkPage.getByRole("link", { name: "Link to this entry", exact: true });
        const linkedEntry = new URL((await entryLink.getAttribute("href"))!, origin);
        assert.equal(linkedEntry.hash, "#/secure");
        assert.equal(linkedEntry.searchParams.get("workOrder"), "synthetic-job");
        assert.ok(linkedEntry.searchParams.get("source"));
        await bookmarkPage.goto(linkedEntry.href);
        const linkedDrawer = bookmarkPage.getByRole("dialog", { name: "Time allocation", exact: true });
        await linkedDrawer.waitFor();
        const linkedDescription = linkedDrawer.getByRole("textbox", { name: /^Reporting description/ });
        assert.equal(await linkedDescription.inputValue(), "Reviewed delivery preparation");
        timeLayout.push(await auditViewport(bookmarkPage, "Bookmarked legacy Time entry", 390, 844));
        await bookmarkPage.screenshot({ path: join(evidence, "time-allocation-bookmarked-entry-390.png"), animations: "disabled" });
        await bookmarkPage.getByRole("button", { name: "Close allocation", exact: true }).click();
        await bookmarkPage.getByRole("link", { name: "Back to Time Allocation", exact: true }).click();
        await selectedTimeScope.waitFor();
        assert.equal(bookmarkPage.url(), timeBookmark.href);
      } finally {
        await bookmarkPage.close();
      }
      await writeFile(join(evidence, "legacy-staff-time-layout.json"), JSON.stringify(timeLayout, null, 2));
      const historic = root.collection("rawTime").doc("historical-browser-row");
      const historicModified = "2025-03-07T17:00:00Z";
      const historicRevision = "historic-1";
      await historic.set({
        schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "prototype-source", scopeProjectId: "synthetic-planning",
        modifiedAt: historicModified, deleted: false, approval: "unknown",
        record: { id: historic.id, tenantId: tenant, sourceWorkOrderId: "987", sourcePersonId: "",
          date: "2025-03-06", seconds: 18000, revision: historicRevision, description: "QuickBooks Time" },
      });
      await timeDetailsRef(historic, historicRevision).set({ provider: "quickbooks-time", sourceRevision: historicRevision,
        sourceModifiedAt: historicModified, observedAt: historicModified, retrievedVia: "exact-id-lookup",
        personId: "7909", consultantName: "Avery Morgan", notes: "Review department rollout requirements" });
      await first.page.getByLabel("Period", { exact: true }).selectOption("all");
      await first.page.getByRole("button", { name: "Apply period", exact: true }).click();
      await first.page.getByRole("heading", { name: "Recorded time · All history", exact: true }).waitFor();
      await first.page.getByRole("button", { name: "Consultants", exact: true }).click();
      await first.page.getByRole("button", { name: "Avery Morgan", exact: true }).click();
      await first.page.getByRole("status").filter({ hasText: /Consultant: Avery Morgan.*1 match out of/ }).waitFor();
      const historicRow = first.page.getByRole("row").filter({ hasText: "Review department rollout requirements" });
      await historicRow.getByText("Approval not verified", { exact: true }).waitFor();
      await historicRow.getByText("5 h", { exact: true }).waitFor();
      await first.page.screenshot({ path: join(evidence, "historical-time.png"), fullPage: true, animations: "disabled" });
      await historicRow.getByRole("button", { name: "Manage Time", exact: true }).click();
      await first.page.getByLabel("Reporting description", { exact: true }).fill("Historical review");
      await first.page.getByRole("button", { name: "Save notes", exact: true }).click();
      await first.page.getByText("Notes saved.", { exact: true }).waitFor();
      await historicRow.getByText("Historical review", { exact: true }).waitFor();
      assert.equal((await historic.get()).data()?.record.seconds, 18000);
      await first.page.locator("summary").filter({ hasText: /^Reporting options$/ }).click();
      await first.page.getByRole("button", { name: "Save reporting scope", exact: true }).click();
      await first.page.getByText("Reporting scope saved on this device.", { exact: true }).waitFor();
      await first.page.getByLabel("Period", { exact: true }).selectOption("specific");
      await first.page.getByRole("button", { name: "Apply period", exact: true }).click();
      await first.page.getByRole("heading", { name: "Recorded time · November 2026", exact: true }).waitFor();
      await first.page.getByRole("button", { name: "Use saved scope", exact: true }).click();
      await first.page.getByRole("heading", { name: "Recorded time · All history", exact: true }).waitFor();
      await historicRow.getByText("5 h", { exact: true }).waitFor();
      assert.ok(await first.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const desktopTimeViewport = first.page.viewportSize()!;
      await first.page.setViewportSize({ width: 390, height: 844 });
      const mobileTimeWidths = await first.page.getByRole("region", { name: "Recorded time table", exact: true })
        .evaluate(table => ({
          document: document.documentElement.scrollWidth, viewport: innerWidth, ledger: table.scrollWidth, tableWidth: table.clientWidth,
        }));
      assert.ok(mobileTimeWidths.document <= mobileTimeWidths.viewport, JSON.stringify(mobileTimeWidths));
      assert.ok(mobileTimeWidths.ledger <= mobileTimeWidths.tableWidth, "The ledger cards should fit the mobile Time section.");
      const mobileManage = historicRow.getByRole("button", { name: "Manage Time", exact: true });
      const mobileManageBounds = (await mobileManage.boundingBox())!;
      assert.ok(mobileManageBounds.x >= 0 && mobileManageBounds.x + mobileManageBounds.width <= 390);
      await mobileManage.click();
      await first.page.getByRole("button", { name: "Close allocation", exact: true }).waitFor();
      await first.page.screenshot({ path: join(evidence, "time-classification-mobile.png"), animations: "disabled" });
      await first.page.keyboard.press("Escape");
      await mobileManage.waitFor();
      assert.ok(await mobileManage.evaluate(button => document.activeElement === button));
      await first.page.screenshot({ path: join(evidence, "historical-time-mobile.png"), fullPage: true, animations: "disabled" });
      await first.page.setViewportSize(desktopTimeViewport);
      await first.page.getByRole("navigation").getByRole("button", { name: "Projects", exact: true }).click();
      await card.locator("dd").first().filter({ hasText: /^0\.5 h$/ }).waitFor();
      await first.page.getByRole("button", { name: "Time Allocation", exact: true }).click();
      await first.page
        .getByRole("button", { name: "Load authorized time", exact: true })
        .click();
      await first.page
        .getByRole("button", { name: "Manage Time", exact: true })
        .click();
      await first.page.getByRole("button", { name: "Activity History", exact: true }).click();
      await first.page.getByText(/Revision 2 ·/).waitFor();
      await first.page.getByRole("button", { name: "Close allocation", exact: true }).click();
      await first.page.getByRole("navigation").getByRole("button", { name: "Audit & Settings", exact: true }).click();
      await first.page
        .getByRole("button", { name: "Load audit history", exact: true })
        .click();
      await first.page
        .getByText(/allocation-changed/)
        .first()
        .waitFor();
      await first.page.getByRole("button", { name: "Integrations", exact: true }).click();
      await first.page.getByText("QuickBooks Time is disconnected.").waitFor();
      await first.page.getByRole("navigation").getByRole("button", { name: "Projects", exact: true }).click();
      await first.page.screenshot({
        path: join(evidence, "staff-1440.png"),
        fullPage: true,
      });
      await first.page.getByRole("button", { name: "Team Directory", exact: true }).click();
      await first.page.getByRole("button", { name: "Sync team from WordPress", exact: true }).click();
      await first.page.getByText("1 public WordPress profiles checked.", { exact: true }).waitFor();
      await first.page.getByRole("button", { name: /Example delivery facilitator/ }).click();
      await first.page.getByLabel("Email", { exact: true }).fill("facilitator@example.test");
      await first.page.getByLabel("Phone", { exact: true }).fill("555-0111");
      await first.page.getByLabel("Internal role", { exact: true }).fill("Private coordination");
      await first.page.getByRole("button", { name: "Save contact settings", exact: true }).click();
      await first.page.getByText("Contact settings saved.", { exact: true }).waitFor();
      await first.page.screenshot({ path: join(evidence, "team-directory.png"), animations: "disabled" });
      await first.page.getByRole("button", { name: "Sync team from WordPress", exact: true }).click();
      await first.page.getByText("1 public WordPress profiles checked.", { exact: true }).waitFor();
      directoryAvailable = false;
      assert.equal((await request("directory/wordpress-sync", "POST", {})).status, 503);
      const afterDirectoryOutage = await json(await request("portfolio"));
      const syncedPerson = afterDirectoryOutage.portfolio.directory.find((person: { id: string }) => person.id === "wordpress-41");
      assert.equal(syncedPerson.email, "facilitator@example.test");
      assert.equal(syncedPerson.phone, "555-0111");
      assert.equal(syncedPerson.internalRole, "Private coordination");
      assert.equal(syncedPerson.visible, false);
      directoryAvailable = true;
      await staffNavigation.getByRole("button", { name: "Departments", exact: true }).click();
      await first.page.getByRole("button", { name: "Manage departments", exact: true }).click();
      await first.page.getByRole("button", { name: "Edit Health", exact: true }).click();
      await first.page.getByLabel("Description", { exact: true }).fill("Approved health service area.");
      await first.page.getByRole("button", { name: "Save changes", exact: true }).click();
      await first.page.getByRole("heading", { name: "Departments editor", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await first.page.getByRole("navigation", { name: "Portfolio settings", exact: true }).count(), 0);
      await first.page.reload();
      await first.page.getByRole("button", { name: "Edit Health", exact: true }).waitFor();
      assert.equal(new URL(first.page.url()).searchParams.get("subsection"), "areas");
      await first.page.screenshot({ path: join(evidence, "portfolio-management.png"), fullPage: true });
      await first.context.close();
      for (const width of [1366, 768, 390]) {
        const second = await session(width);
        const saved = second.page.locator("article").filter({
          has: second.page.getByRole("heading", {
            name: "Browser saved project",
            exact: true,
          }),
        });
        await saved.locator("dd").first().filter({ hasText: /^0\.5 h$/ }).waitFor();
        assert.ok(
          await second.page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await second.page.screenshot({
          path: join(evidence, `staff-${width}-new-session.png`),
          fullPage: true,
        });
        await second.context.close();
      }
      const persisted = (
        await root
          .collection("projects")
          .where("name", "==", "Browser saved project")
          .get()
      ).docs[0].data();
      assert.equal(persisted.plan.targetSeconds, 4500);
      assert.equal(persisted.internalNotes, "Browser synthetic private note");
      assert.equal(persisted.published, true);
      assert.equal(persisted.updates[1].visible, false);
      assert.deepEqual(
        (await root.collection("rawTime").doc("synthetic-time").get()).data(),
        sourceBefore,
      );
      assert.ok(
        !JSON.stringify(
          await json(
            await request(
              "report?month=2026-11",
              "GET",
              undefined,
              client.idToken,
            ),
          ),
        ).includes("Browser saved project"),
      );
      // Add only the new browser project to the already approved synthetic client's scope.
      const membershipRef = root.collection("memberships").doc(key("project-client"));
      const originalScope = (await membershipRef.get()).data()!.projectIds;
      await membershipRef.update({ projectIds: [...originalScope, persisted.id] });
      const patchPortfolio = async (section: string, record: object, expectedRevision?: number, token?: string) =>
        request("portfolio", "PATCH", { section, record, expectedRevision: expectedRevision ?? await revision() }, token);
      assert.equal((await request("portfolio", "GET", undefined, client.idToken)).status, 403);
      const group = { id: "delivery-group", name: "Approved delivery group", reference: "INTERNAL-GROUP-REFERENCE",
        monthlySeconds: 7200, areaPlans: [{ areaId: "health", seconds: 3600 }], order: 0, visible: true };
      const prior = await revision();
      await json(await patchPortfolio("engagements", group, prior));
      assert.equal((await patchPortfolio("engagements", group, prior)).status, 409);
      assert.equal((await patchPortfolio("engagements", group, undefined, client.idToken)).status, 403);
      await json(await patchPortfolio("directory", { ...contact, id: "unlinked", name: "UNLINKED-DIRECTORY" }));
      await json(await patchPortfolio("directory", { ...contact, id: "private", name: "PRIVATE-DIRECTORY", visible: false, projectIds: [persisted.id] }));
      const placement = { id: persisted.id, areaId: "health", engagementId: group.id, leadId: contact.id,
        teamIds: [contact.id], start: "2026-10-15", target: "2027-01-15", attention: "PRIVATE-ATTENTION",
        publishDates: false, archived: false };
      assert.equal((await patchPortfolio("placements", { ...placement, id: "out-of-scope", areaId: "invalid" })).status, 400);
      await json(await patchPortfolio("placements", placement));
      const note = { id: "2026-11", month: "2026-11", narrative: "Approved November narrative.",
        action: "Leadership decision to review", visible: true };
      await json(await patchPortfolio("notes", note));
      await json(await patchPortfolio("notes", { ...note, id: "2026-10", month: "2026-10", narrative: "PRIVATE-NARRATIVE", visible: false }));
      const staffPortfolio = await json(await request("portfolio?month=2026-11"));
      assert.equal(staffPortfolio.portfolio.areas.find((a: { id: string }) => a.id === "health").description, "Approved health service area.");
      assert.deepEqual(staffPortfolio.totals, [{ engagementId: group.id, areaId: "health", projects: 1,
        monthlyPlanSeconds: 0, lifetimePlanSeconds: 4500, allocatedSeconds: 1800 }]);
      const scopedReport = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      assert.equal(scopedReport.portfolio.directory.length, 1);
      assert.equal(scopedReport.portfolio.directory[0].publicContact, "Approved contact channel");
      assert.deepEqual(scopedReport.portfolio.directory[0].projectIds, [persisted.id]);
      assert.equal(scopedReport.portfolio.placements[0].target, "");
      assert.equal(scopedReport.portfolio.placements[0].leadId, contact.id);
      assert.deepEqual(scopedReport.portfolio.history.map((row: { month: string }) => row.month),
        ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
      assert.doesNotMatch(JSON.stringify(scopedReport), /INTERNAL-CONTACT|PRIVATE-ATTENTION|PRIVATE-DIRECTORY|UNLINKED-DIRECTORY|INTERNAL-GROUP-REFERENCE/);
      assert.deepEqual((await root.collection("rawTime").doc("synthetic-time").get()).data(), sourceBefore);

      const previewBrowser = await session(1280);
      const previewPage = previewBrowser.page;
      const draftPreview = previewPage.locator("article.secure-card:not(.secure-published-project)").filter({ has: previewPage.getByRole("heading", { name: "Browser saved project", exact: true }) });
      await draftPreview.getByText("Preview approved content", { exact: true }).click();
      const previewCard = draftPreview.locator(".secure-published-project");
      await previewCard.getByText("Project details", { exact: true }).click();
      await previewCard.getByText(/Approved synthetic contact.*Project manager/).waitFor();
      assert.doesNotMatch(await previewCard.innerText(), /PRIVATE|INTERNAL/);
      await previewPage.getByRole("navigation", { name: "Morris workspace sections" }).getByRole("button", { name: "Client Preview", exact: true }).click();
      await previewPage.getByText("LIVE PUBLISHED VIEW · MORRIS STAFF PREVIEW", { exact: true }).waitFor();
      await previewPage.getByRole("heading", { name: "Leadership summary", exact: true }).waitFor();
      await previewPage.getByLabel("Preview mode").selectOption("draft");
      await previewPage.getByText("DRAFT PREVIEW · MORRIS STAFF ONLY", { exact: true }).waitFor();
      await previewPage.getByRole("heading", { name: "Leadership summary", exact: true }).waitFor();
      await auditViewport(previewPage, "Legacy staff client preview", 1440, 1000, { compactSidebar: true });
      const browsePreview = previewPage.getByRole("button", { name: "Browse client preview", exact: true });
      await browsePreview.click();
      await previewPage.getByRole("dialog", { name: "Client preview menu", exact: true })
        .getByRole("button", { name: "Leadership summary", exact: true }).waitFor();
      await previewPage.keyboard.press("Escape");
      await browsePreview.waitFor();
      assert.ok(await browsePreview.evaluate(button => document.activeElement === button));
      await previewPage.screenshot({ path: join(evidence, "staff-draft-preview.png"), fullPage: true, animations: "disabled" });
      await previewPage.getByRole("navigation", { name: "Morris workspace sections" }).getByRole("button", { name: "Projects", exact: true }).click();
      await previewPage.getByRole("button", { name: "Edit Browser saved project", exact: true }).click();
      const draftForm = previewPage.getByRole("form", { name: "Edit a project" });
      const continueDraft = draftForm.getByRole("button", { name: "Continue", exact: true });
      await continueDraft.click();
      await continueDraft.click();
      await draftForm.getByLabel("Client-facing description").fill("Editorial revision in progress");
      for (let i = 0; i < 3; i++) await continueDraft.click();
      await draftForm.getByRole("button", { name: "Save Draft", exact: true }).click();
      await previewPage.getByText("Draft saved. Clients still see the last approved version.", { exact: true }).waitFor();
      await previewPage.getByRole("button", { name: "Preview Changes", exact: true }).click();
      await previewPage.getByText("DRAFT PREVIEW · MORRIS STAFF ONLY", { exact: true }).waitFor();
      await previewPage.getByText("Editorial revision in progress", { exact: true }).first().waitFor();
      await previewPage.screenshot({ path: join(evidence, "staff-project-revision-preview.png"), animations: "disabled" });
      const duringDraft = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      assert.doesNotMatch(JSON.stringify(duringDraft), /Editorial revision in progress/);
      await previewPage.getByRole("button", { name: "Back to project" }).click();
      previewPage.once("dialog", dialog => void dialog.accept());
      await previewPage.getByRole("button", { name: "Discard Draft", exact: true }).click();
      await previewPage.getByText("Draft discarded. The approved version is unchanged.", { exact: true }).waitFor();
      await previewBrowser.context.close();

      for (const width of [1440, 390]) {
        const clientBrowser = await session(width, "client");
        const { page } = clientBrowser;
        const search = page.getByRole("searchbox", { name: "Search published projects" });
        await search.fill("HIDDEN-PROJECT");
        await page.getByText("No published projects match.").waitFor();
        await search.fill("BROWSER SAVED");
        const visibleCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Browser saved project", exact: true }) });
        await visibleCard.getByText("100% work completion", { exact: true }).waitFor();
        await visibleCard.locator("dd").first().filter({ hasText: /^0\.5 h$/ }).waitFor();
        await visibleCard.getByText("Project details", { exact: true }).click();
        await visibleCard.getByText("Approved delivery update", { exact: true }).waitFor();
        await visibleCard.getByRole("button", { name: "Approved milestone", exact: true }).waitFor();
        assert.ok(!(await page.locator("body").innerText()).match(/PRIVATE-UPDATE|Browser synthetic private note|QuickBooks Time|Allocate recorded hours/));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(evidence, `client-${width}.png`), fullPage: true });
        if (width === 1440) {
          await page.evaluate(() => {
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            (window as any).__reportRace = { gate, release };
          });
          const filter = page.getByLabel("Reporting month");
          const portfolio = page.getByLabel("Published portfolio summary");
          try {
            await filter.fill("2026-10");
            await page.waitForFunction(() => (window as any).__reportRace.requested);
            await page.getByRole("status").filter({ hasText: "Loading approved reporting" }).waitFor();
            assert.equal(await portfolio.count(), 0);
            await filter.fill("2026-12");
            await page.getByRole("alert").filter({ hasText: "The published report could not be loaded" }).waitFor();
            assert.equal(await portfolio.count(), 0);
            await filter.fill("2026-11");
            await portfolio.getByText("Reported effort · November 2026").waitFor();
            await portfolio.getByText("0.5 h", { exact: true }).waitFor();
            assert.equal(await page.getByRole("alert").count(), 0);
            await page.evaluate(() => (window as any).__reportRace.release());
            await page.waitForFunction(() => (window as any).__reportRace.delivered);
            assert.equal(await portfolio.getByText("Reported effort · November 2026").count(), 1);
            assert.equal(await portfolio.getByText("0.5 h", { exact: true }).count(), 1);

            await filter.fill("2026-10");
            await portfolio.getByText("Reported effort · October 2026").waitFor();
            await portfolio.getByText("0 h", { exact: true }).waitFor();
            const octoberProject = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Browser saved project", exact: true }) });
            assert.equal(await octoberProject.locator("dd").first().textContent(), "0 h");
          } finally {
            await page.evaluate(() => (window as any).__reportRace.release());
          }
        }

        await page.getByLabel("Reporting month").fill("2026-11");
        const nav = page.getByRole("navigation", { name: "Client workspace", exact: true });
        const visit = async (name: string) => {
          const menu = page.getByRole("button", { name: "Workspace navigation", exact: true });
          if (await menu.isVisible()) {
            await menu.click();
            await page.getByRole("dialog", { name: "Workspace menu" }).getByRole("button", { name, exact: true }).click();
          } else await nav.getByRole("button", { name, exact: true }).click();
        };
        const visitDepartment = async (name: string) => {
          await visit("Departments");
          await page.getByRole("region", { name: "Published departments" }).getByRole("button", { name: new RegExp("^" + name + "\\b") }).click();
        };
        await visitDepartment("Health");
        await page.getByText("Approved health service area.").waitFor();
        await page.getByText("Approved delivery group", { exact: true }).waitFor();
        const departmentMetrics = page.getByRole("region", { name: "Health delivery metrics" });
        await departmentMetrics.getByRole("button", { name: /November 2026 hours/ }).click();
        await page.getByText(/With attributable hours/).filter({ hasText: /project/ }).waitFor();
        await page.getByLabel("Sort by").selectOption("completion");
        assert.match(page.url(), /project-sort=completion/);
        await page.screenshot({ path: join(evidence, "area-" + width + ".png"), fullPage: true });
        await visit("MI Directory");
        await page.getByRole("heading", { name: "Approved synthetic contact" }).waitFor();
        assert.doesNotMatch(await page.locator("body").innerText(), /INTERNAL-CONTACT|PRIVATE-DIRECTORY|UNLINKED-DIRECTORY/);
        await page.screenshot({ path: join(evidence, "directory-" + width + ".png"), fullPage: true });
        await visit("Leadership summary");
        await page.getByLabel("All-time delivery projects", { exact: true }).getByText("All-time approved portfolio", { exact: true }).waitFor();
        assert.equal(await nav.getByRole("button", { name: "Engagements", exact: true }).count(), 0);
        assert.equal(await nav.getByRole("button", { name: "Milestones", exact: true }).count(), 0);
        await page.waitForFunction(() => document.activeElement?.classList.contains("exec-content"));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(evidence, "leadership-" + width + ".png"), animations: "disabled" });
        if (width === 1440) {
          for (const area of ["Finance", "HR", "CFW", "Health", "Miscellaneous", "Training"]) {
            await visitDepartment(area);
            await page.getByRole("heading", { name: area, exact: true }).waitFor();
            assert.match(await page.title(), new RegExp(area));
            await page.screenshot({ path: join(evidence, "service-" + area.toLowerCase() + ".png"), animations: "disabled" });
          }
          await nav.getByRole("button", { name: "Leadership summary", exact: true }).click();
          const expand = page.getByRole("button", { name: "Explore reported hours by department" });
          await expand.click();
          const analytics = page.getByRole("dialog", { name: "Delivery by department analysis" });
          const healthHours = analytics.getByRole("button", { name: "Health, 0.5 hours" });
          await healthHours.click();
          assert.equal(await healthHours.getAttribute("aria-pressed"), "true");
          assert.ok(await healthHours.locator(".mi-bar-track > i").evaluate(bar => bar.getBoundingClientRect().width > 0));
          await analytics.getByText("Show data table").click();
          await analytics.getByRole("table").waitFor();
          await page.screenshot({ path: join(evidence, "analytics.png"), animations: "disabled" });
          await analytics.getByRole("button", { name: /Browser saved project/ }).click();
          await page.getByRole("heading", { name: "Browser saved project", level: 2, exact: true }).waitFor();
          await page.reload({ waitUntil: "networkidle" });
          await page.getByRole("heading", { name: "Browser saved project", level: 2, exact: true }).waitFor();
          await page.screenshot({ path: join(evidence, "project-detail.png"), animations: "disabled" });
          await page.getByRole("button", { name: "Project timeline", exact: true }).click();
          await page.getByRole("heading", { name: "Project timeline", exact: true }).waitFor();
          await page.screenshot({ path: join(evidence, "project-timeline.png"), animations: "disabled" });
          await page.goBack();
          await page.getByRole("heading", { name: "Browser saved project", level: 2, exact: true }).waitFor();
          await page.goForward();
          await page.getByRole("heading", { name: "Project timeline", exact: true }).waitFor();
          await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "Browser saved project", exact: true }).click();
          await page.getByRole("button", { name: "Present this view" }).click();
          const contextual = page.getByRole("dialog");
          await contextual.getByRole("heading", { name: "Browser saved project", exact: true }).waitFor();
          await page.screenshot({ path: join(evidence, "presentation-project.png"), animations: "disabled" });
          await contextual.getByRole("button", { name: "Close presentation" }).click();
          await contextual.waitFor({ state: "hidden" });
          await nav.getByRole("button", { name: "Leadership summary", exact: true }).click();
        }
        const help = page.getByRole("button", { name: "How are reported hours calculated?" });
        await help.focus();
        const tooltip = page.getByRole("tooltip");
        await tooltip.waitFor();
        const bounds = (await tooltip.boundingBox())!;
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1000);
        await page.keyboard.press("Escape");
        await tooltip.waitFor({ state: "hidden" });
        const trigger = page.getByRole("button", { name: "At a Glance", exact: true });
        if (width <= 430) await trigger.tap();
        else await trigger.click();
        const presentation = page.getByRole("dialog");
        if (width === 1440) {
          await presentation.waitFor();
          await page.waitForFunction(() => {
            const scene = document.querySelector(".exec-scene");
            return scene && Number(getComputedStyle(scene).opacity) >= .99;
          });
          await page.screenshot({ path: join(evidence, "presentation-opening.png"), animations: "disabled" });
        }
        await presentation.getByRole("button", { name: "Next chapter" }).click();
        await presentation.getByRole("heading", { name: "Reporting period" }).waitFor();
        await page.keyboard.press("ArrowRight");
        await presentation.getByRole("heading", { name: "Published delivery" }).waitFor();
        await presentation.getByText("0.5 h", { exact: true }).waitFor();
        if (width === 1440) {
          await page.screenshot({ path: join(evidence, "presentation-reported-effort.png"), animations: "disabled" });
          const maximize = presentation.getByRole("button", { name: "Toggle fullscreen" });
          if (await maximize.count()) {
            await maximize.click();
            await page.waitForFunction(() => document.fullscreenElement?.classList.contains("exec-presentation-stage"));
            await maximize.click();
            await page.waitForFunction(() => !document.fullscreenElement);
          }
        }
        await presentation.getByRole("button", { name: "Play", exact: true }).click();
        await presentation.getByRole("button", { name: "Pause", exact: true }).click();
        await presentation.getByLabel("Presentation chapter").selectOption("8");
        await presentation.getByText("Approved November narrative.").waitFor();
        await page.screenshot({ path: join(evidence, "presentation-" + width + ".png"), animations: "disabled" });
        await page.keyboard.press("Escape");
        await presentation.waitFor({ state: "hidden" });
        await page.waitForFunction(() => document.activeElement?.textContent?.includes("At a Glance"));
        if (width === 1440) {
          const toggle = page.getByRole("button", { name: "Collapse sidebar" });
          await toggle.click();
          await page.getByRole("button", { name: "Expand sidebar" }).waitFor();
          await page.screenshot({ path: join(evidence, "collapsed-navigation.png"), fullPage: true });
          await page.getByRole("button", { name: "Expand sidebar" }).click();
          for (const [width, height] of [[320,440],[360,640],[390,844],[430,932],[768,1024],[1024,768],[1280,800],[1440,900],[1920,1080],[2560,1440]]) {
            await page.setViewportSize({ width, height });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "client overflow at " + width);
          }
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
          const zoomBounds = await trigger.boundingBox();
          assert.ok(zoomBounds && zoomBounds.x >= 0 && zoomBounds.x + zoomBounds.width <= 1280);
          await page.evaluate(() => { document.documentElement.style.zoom = ""; });
        } else {
          await page.setViewportSize({ width: 844, height: 390 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.setViewportSize({ width: 390, height: 440 });
          for (const [vertical, horizontal] of [["top", "left"], ["top", "right"], ["bottom", "left"], ["bottom", "right"]] as const) {
            await help.evaluate((button, [y, x]) => Object.assign(button.style, { position: "fixed", [y]: "0px", [x]: "0px" }), [vertical, horizontal]);
            await help.blur();
            await help.focus();
            await tooltip.waitFor();
            assert.equal(await help.getAttribute("aria-describedby"), await tooltip.getAttribute("id"));
            const fits = await tooltip.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return rect.x >= 7 && rect.y >= 7 && rect.right <= innerWidth - 7 && rect.bottom <= innerHeight - 7;
            });
            assert.ok(fits, "tooltip collision at " + vertical + " " + horizontal);
            await page.keyboard.press("Escape");
            await tooltip.waitFor({ state: "hidden" });
            await help.evaluate(button => button.removeAttribute("style"));
          }
          await page.setViewportSize({ width: 844, height: 390 });
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        }
        await clientBrowser.context.close();
      }
      const browserMeasurements: Record<string, number> = {};
      if (process.env.MI_SECURE_CROSS_BROWSER === "true") {
        for (const engine of [firefox, webkit]) {
          const alternate = await engine.launch();
          try {
            const start = performance.now();
            const { context, page } = await session(390, "client", alternate);
            try {
              browserMeasurements[engine.name() + "FixtureLoadMs"] = Math.round(performance.now() - start);
              await page.emulateMedia({ reducedMotion: "reduce" });
              await page.setViewportSize({ width: 390, height: 640 });
              await page.getByRole("button", { name: "At a Glance", exact: true }).click();
              const dialog = page.getByRole("dialog");
              await dialog.getByRole("heading", { name: "Zagimē Anishinabēk Nation", exact: true }).waitFor();
              await dialog.getByRole("button", { name: "Next chapter" }).click();
              await dialog.getByRole("heading", { name: "Reporting period" }).waitFor();
              assert.equal(await dialog.locator(".exec-scene").evaluate(element => getComputedStyle(element).animationName), "none");
              assert.equal(await dialog.getByRole("heading", { name: "Reporting period" }).evaluate(element => getComputedStyle(element).color), "rgb(255, 255, 255)");
              assert.equal(await dialog.getByLabel("Presentation chapter").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(20, 59, 98)");
              const dialogRect = (await dialog.boundingBox())!;
              assert.ok(dialogRect.x >= 0 && dialogRect.x + dialogRect.width <= 390 && dialogRect.y >= 0 && dialogRect.y + dialogRect.height <= 640);
              await page.setViewportSize({ width: 320, height: 440 });
              const shortDialog = (await dialog.boundingBox())!;
              const footer = (await dialog.locator("footer").boundingBox())!;
              assert.ok(footer.y + footer.height <= shortDialog.y + shortDialog.height);
              await page.setViewportSize({ width: 390, height: 640 });
              await page.screenshot({ path: join(evidence, "presentation-" + engine.name() + "-390.png") });
              await dialog.getByRole("button", { name: "Close presentation" }).click();
              await dialog.waitFor({ state: "hidden" });
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            } finally {
              await context.close();
            }
          } finally {
            await alternate.close();
          }
        }
      }
      const approvedReport = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      const approvedCard = approvedReport.projects.find((item: { id: string }) => item.id === persisted.id);
      assert.equal(approvedCard.updates.length, 1);
      assert.equal(approvedCard.milestones.length, 1);
      assert.ok(!JSON.stringify(approvedCard).includes("PRIVATE-UPDATE"));
      assert.ok(!JSON.stringify(approvedCard).includes("internalNotes"));
      const projectPath = `projects/${persisted.id}`;
      const approvedProjectRef = root.collection("projects").doc(persisted.id);
      const approvedViewRef = root.collection("projectViews").doc(persisted.id);
      const draftRef = root.collection("projectDrafts").doc(persisted.id);
      const approvedView = (await approvedViewRef.get()).data();
      const changes = { name: persisted.name, description: "Candidate description", internalNotes: "PRIVATE-DRAFT-ONLY",
        plan: persisted.plan, progress: 50, status: persisted.status };
      const raceRevision = await revision();
      const competing = await Promise.all([
        request(projectPath, "PATCH", { expectedRevision: raceRevision, patch: changes }),
        request(projectPath, "PATCH", { expectedRevision: raceRevision, patch: { ...changes, description: "Competing description" } }),
      ]);
      assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
      const firstDraft = await json(await request(projectPath));
      assert.equal(firstDraft.draft.revision, raceRevision + 1);
      assert.equal(firstDraft.project.progress, 50);
      assert.match(firstDraft.project.description, /^(Candidate|Competing) description$/);
      assert.deepEqual((await approvedViewRef.get()).data(), approvedView);
      assert.deepEqual((await approvedProjectRef.get()).data(), persisted);
      assert.deepEqual(await json(await request("report?month=2026-11", "GET", undefined, client.idToken)), approvedReport);
      const previewWithDraft = await json(await request("client-preview?month=2026-11&mode=draft"));
      assert.equal(previewWithDraft.projects.find((p: { id: string }) => p.id === persisted.id).description, firstDraft.project.description);
      assert.doesNotMatch(JSON.stringify(previewWithDraft), /PRIVATE-DRAFT-ONLY|PRIVATE-UPDATE/);
      for (const action of ["publish", "discard"]) {
        assert.equal((await request(projectPath + "/draft", "PATCH", { expectedRevision: await revision(), action }, client.idToken)).status, 403);
      }
      assert.equal((await request(projectPath + "/draft", "PATCH", { expectedRevision: raceRevision, action: "publish" })).status, 409);
      assert.equal((await request(projectPath + "/publication", "PATCH", { expectedRevision: await revision(), published: false })).status, 409);
      await approvedProjectRef.update({ description: "Approval changed independently" });
      assert.equal((await request(projectPath + "/draft", "PATCH", { expectedRevision: await revision(), action: "publish" })).status, 409);
      await approvedProjectRef.update({ description: persisted.description });
      const beforePublish = await revision();
      const promoted = await Promise.all([
        request(projectPath + "/draft", "PATCH", { expectedRevision: beforePublish, action: "publish" }),
        request(projectPath + "/draft", "PATCH", { expectedRevision: beforePublish, action: "discard" }),
      ]);
      assert.deepEqual(promoted.map(response => response.status).sort(), [200, 409]);
      if (promoted[0].status !== 200) {
        await json(await request(projectPath, "PATCH", { expectedRevision: await revision(), patch: changes }));
        await json(await request(projectPath + "/draft", "PATCH", { expectedRevision: await revision(), action: "publish" }));
      }
      const publishedDraft = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      assert.match(publishedDraft.projects.find((p: { id: string }) => p.id === persisted.id).description, /^(Candidate|Competing) description$/);
      assert.doesNotMatch(JSON.stringify(publishedDraft), /PRIVATE-DRAFT-ONLY/);
      assert.equal(publishedDraft.totalSeconds, approvedReport.totalSeconds);
      assert.equal((await draftRef.get()).data()!.state, "published");
      assert.ok(!("content" in (await draftRef.get()).data()!));
      const revisionAudits = (await root.collection("audits").where("entityId", "==", persisted.id).get()).docs
        .map(doc => doc.data()).filter(entry => entry.action.startsWith("project-draft-"));
      assert.ok(revisionAudits.some(entry => entry.action === "project-draft-saved"));
      assert.ok(revisionAudits.some(entry => entry.action === "project-draft-discarded"));
      assert.ok(revisionAudits.some(entry => entry.action === "project-draft-published"));
      assert.ok(revisionAudits.every(entry => entry.actor === staff.localId && !("content" in entry)));
      const legacyEdit = (await root.collection("projects").doc(persisted.id).get()).data()!;
      assert.deepEqual(legacyEdit.updates, persisted.updates);
      assert.deepEqual(legacyEdit.milestones, persisted.milestones);
      await json(await request(`projects/${persisted.id}/publication`, "PATCH", {
        expectedRevision: await revision(), published: false,
      }));
      const afterUnpublish = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      assert.ok(!afterUnpublish.projects.some((item: { id: string }) => item.id === persisted.id));
      const activePreview = await json(await request("client-preview?month=2026-11&mode=published&scope=" + membershipRef.id));
      assert.deepEqual(activePreview, afterUnpublish);
      const privatePreview = await json(await request("client-preview?month=2026-11&mode=draft"));
      assert.ok(privatePreview.projects.some((item: { id: string }) => item.id === persisted.id));
      assert.doesNotMatch(JSON.stringify(privatePreview), /PRIVATE-UPDATE|Private allocation review|Browser synthetic private note/);
      for (const route of [
        "client-preview?month=2026-11&mode=draft",
        "client-preview?month=2026-11&mode=published&scope=" + membershipRef.id,
        "client-preview/scopes",
      ]) assert.equal((await request(route, "GET", undefined, client.idToken)).status, 403);
      assert.equal((await request("directory/wordpress-sync", "POST", {}, client.idToken)).status, 403);

      const createAndPublish = {
        project: {
          ...projectInput, name: "Approved on creation fixture", internalNotes: "PRIVATE-CREATION-NOTE",
          delivery: { structure: 3, kind: "engagement", type: "hourly", managerIds: ["wordpress-41"], teamIds: [] },
        },
        publish: true,
      };
      const createKey = Date.now() + "-" + crypto.randomUUID();
      const createPolicy = { clientLabel: "", presentationTitle: "", ownerPublishes: true };
      await root.update({ portalSettings: createPolicy });
      const createRevision = await revision();
      const createAudits = await auditCount();
      assert.equal((await json(await request("workspace"))).canPublish, false);
      assert.equal((await request("projects", "POST", createAndPublish, client.idToken, createKey)).status, 403);
      assert.equal((await request("projects", "POST", createAndPublish, staff.idToken, createKey)).status, 403);
      assert.equal(await revision(), createRevision);
      assert.equal(await auditCount(), createAudits);
      assert.equal((await root.collection("projects").where("name", "==", createAndPublish.project.name).count().get()).data().count, 0);
      await root.update({ portalSettings: { ...createPolicy, ownerPublishes: false } });
      assert.equal((await json(await request("workspace"))).canPublish, true);
      const createdPublic = await Promise.all([
        request("projects", "POST", createAndPublish, staff.idToken, createKey).then(r => json(r, 201)),
        request("projects", "POST", createAndPublish, staff.idToken, createKey).then(r => json(r, 201)),
      ]);
      assert.deepEqual(createdPublic[0], createdPublic[1]);
      assert.equal(await revision(), createRevision + 1);
      assert.equal(await auditCount(), createAudits + 1);
      const [publishedProject, publishedProjection] = await Promise.all([
        root.collection("projects").doc(createdPublic[0].id).get(),
        root.collection("projectViews").doc(createdPublic[0].id).get(),
      ]);
      assert.equal(publishedProject.data()?.published, true);
      assert.equal(publishedProjection.data()?.published, true);
      assert.doesNotMatch(JSON.stringify(publishedProjection.data()), /PRIVATE-CREATION-NOTE/);
      const createEvents = await root.collection("audits").where("entityId", "==", publishedProject.id).get();
      assert.deepEqual(createEvents.docs.map(doc => doc.data().action), ["project-created-and-published"]);
      assert.equal((await request("projects", "POST", { ...createAndPublish, publish: false }, staff.idToken, createKey)).status, 409);
      assert.deepEqual((await root.collection("rawTime").doc("synthetic-time").get()).data(), sourceBefore);

      // Isolated work-order identities and imported total. These represent the
      // source contract shape without contacting QuickBooks or adding real records.
      const fixtureJobs = ["132160684", "135372950", "132160686", "136571342"];
      const syntheticRecorded = [360_000, 360_000, 360_000, 564_300];
      for (const [i, jobcodeId] of fixtureJobs.entries()) {
        await root.collection("timeMappings").doc(key("verified-fixture", jobcodeId)).set({ jobcodeId, account: "verified-fixture",
          projectId: "synthetic-delivery", scopeProjectId: "synthetic-delivery",
          sourceJob: { id: jobcodeId, name: "Fixture source order " + (i + 1), missing: false } });
        const id = "delivery-record-" + i;
        await root.collection("rawTime").doc(id).set({ schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: "verified-fixture",
          scopeProjectId: "synthetic-delivery", record: { id, tenantId: tenant, sourceWorkOrderId: jobcodeId, sourcePersonId: "",
            date: "2026-10-20", description: "Synthetic Time", seconds: syntheticRecorded[i], revision: "fixture-1" } });
      }
      const snapshotRecords = async () => (await root.collection("rawTime").get()).docs.map(doc => [doc.id, doc.data()]);
      const recordsBefore = await snapshotRecords();
      const baseDelivery = { structure: 2, kind: "project", type: "hourly", managerIds: [], teamIds: [] };
      const create = (name: string, delivery: object) => request("projects", "POST", {
        name, internalNotes: "", description: "", status: "active", progress: 0, plan: { basis: "monthly", targetSeconds: 0 }, delivery,
      }, staff.idToken, Date.now() + "-" + crypto.randomUUID());
      const parent = await json(await create("Consulting engagement fixture", { ...baseDelivery, kind: "engagement", monthlyCap: 36_000,
        lifetimeCap: 72_000, allowDirectAllocation: false, publishSummary: true }), 201);
      const direct = await json(await create("Direct delivery fixture", { ...baseDelivery, parentId: parent.id }), 201);
      const department = await json(await create("Personnel group fixture", { ...baseDelivery, kind: "service-area",
        parentId: parent.id, areaId: "hr", monthlyCap: 25_200, publishSummary: true }), 201);
      const nested = await json(await create("Policy assessment fixture", { ...baseDelivery, parentId: department.id, areaId: "hr", countAgainstParentCap: false }), 201);
      assert.equal((await create("Loose leaf fixture", baseDelivery)).status, 400);
      assert.equal((await create("Too deep fixture", { ...baseDelivery, parentId: nested.id, areaId: "hr" })).status, 400);
      assert.equal((await create("Wrong area fixture", { ...baseDelivery, parentId: department.id, areaId: "finance" })).status, 400);
      assert.equal((await create("Unstructured child fixture", { ...baseDelivery, structure: undefined, parentId: department.id })).status, 400);
      assert.ok(direct.id);
      const historyPrior = (await root.collection("allocationRevisions").get()).docs.map(doc => doc.data());
      const link = async (id: string, config: object) => {
        const { project } = await json(await request("projects/" + id));
        const { name, status, progress, description, internalNotes, plan } = project;
        return request("projects/" + id, "PATCH", { expectedRevision: await revision(), patch: { name, status, progress, description, internalNotes, plan, delivery: config } });
      };
      assert.equal((await link(nested.id, { ...baseDelivery, parentId: department.id, areaId: "hr", countAgainstParentCap: false, workOrderIds: [fixtureJobs[0]] })).status, 200);
      assert.equal((await link(parent.id, { ...baseDelivery, parentId: nested.id })).status, 400);
      assert.equal((await link(nested.id, { ...baseDelivery, parentId: department.id, workOrderIds: ["999999"] })).status, 400);
      assert.deepEqual(await snapshotRecords(), recordsBefore);
      assert.deepEqual((await root.collection("allocationRevisions").get()).docs.map(doc => doc.data()), historyPrior);
      const imported = await json(await request("sources?month=2026-10"));
      const workOrders = imported.sources.filter((source: { sourceWorkOrderId: string }) => fixtureJobs.includes(source.sourceWorkOrderId));
      assert.deepEqual(workOrders.map((source: { sourceWorkOrderId: string }) => source.sourceWorkOrderId), fixtureJobs);
      assert.equal(workOrders.reduce((sum: number, source: { seconds: number }) => sum + source.seconds, 0), 456.75 * 3600);
      const hierarchyBrowser = await session(1440);
      await hierarchyBrowser.page.getByRole("button", { name: "Budgets & Delivery Health", exact: true }).click();
      await hierarchyBrowser.page.getByRole("button", { name: "Policy assessment fixture", exact: true }).waitFor();
      await hierarchyBrowser.page.getByText("1 department · 2 active · 0 completed", { exact: true }).waitFor();
      await hierarchyBrowser.page.screenshot({ path: join(evidence, "delivery-hierarchy.png"), animations: "disabled" });
      const editCap = hierarchyBrowser.page.getByRole("button", { name: "Edit cap for Consulting engagement fixture" });
      await editCap.click();
      const capEditor = hierarchyBrowser.page.getByRole("form", { name: "Edit caps for Consulting engagement fixture" });
      const monthlyCap = capEditor.getByLabel("Monthly cap (hours)", { exact: true });
      const originalCap = await monthlyCap.inputValue();
      await monthlyCap.fill("1.23456");
      await capEditor.getByRole("button", { name: "Save", exact: true }).click();
      await capEditor.getByRole("alert").filter({ hasText: /whole number of seconds|exact second precision/ }).waitFor();
      await monthlyCap.press("Escape");
      await capEditor.waitFor({ state: "hidden" });
      await editCap.focus();
      await editCap.press("Enter");
      await monthlyCap.fill("6.25");
      await capEditor.screenshot({ path: join(evidence, "budget-inline-cap-editor.png"), animations: "disabled" });
      await capEditor.getByRole("button", { name: "Save", exact: true }).click();
      await hierarchyBrowser.page.getByText("Caps saved and utilization updated.", { exact: true }).waitFor();
      await hierarchyBrowser.page.getByRole("listitem").filter({ has: editCap }).getByText("6.25 h", { exact: true }).waitFor();
      assert.deepEqual(await snapshotRecords(), recordsBefore);
      await editCap.click();
      await monthlyCap.fill(originalCap);
      await capEditor.getByRole("button", { name: "Save", exact: true }).click();
      await capEditor.waitFor({ state: "hidden" });

      const bulkReady = root.collection("rawTime").doc("browser-bulk-ready");
      const bulkConflict = root.collection("rawTime").doc("browser-bulk-changed");
      const bulkFixture = (id: string, day: string, description: string) => ({
        schemaVersion: 2, source: "synthetic", scopeProjectId: "synthetic-delivery", deleted: false,
        record: { id, tenantId: tenant, sourcePersonId: "synthetic-person", sourceWorkOrderId: "synthetic-job",
          date: "2026-11-" + day, seconds: 1733, description, revision: "browser-bulk-1" },
      });
      const readyEntry = bulkFixture(bulkReady.id, "21", "Browser bulk ready entry");
      await Promise.all([
        bulkReady.set(readyEntry),
        bulkConflict.set(bulkFixture(bulkConflict.id, "22", "Browser bulk changed entry")),
      ]);
      const bulkPage = hierarchyBrowser.page;
      await bulkPage.getByRole("button", { name: "Time Allocation", exact: true }).click();
      await bulkPage.getByRole("row").filter({ hasText: "Browser bulk ready entry" }).getByRole("checkbox").check();
      await bulkPage.getByRole("row").filter({ hasText: "Browser bulk changed entry" }).getByRole("checkbox").check();
      await bulkPage.getByLabel("Assign 2 unallocated entries").selectOption(nested.id);
      // The browser has already loaded its revisions. Simulate a source correction in the emulator only.
      await bulkConflict.update({ "record.revision": "browser-bulk-2" });
      const confirmBulk = bulkPage.waitForEvent("dialog").then(async dialog => {
        const message = dialog.message();
        await dialog.accept();
        assert.match(message, /Assign all recorded time on 2 selected entries to Policy assessment fixture/);
      });
      await Promise.all([bulkPage.getByRole("button", { name: "Assign selected time" }).click(), confirmBulk]);
      const bulkResults = bulkPage.getByRole("region", { name: "Bulk allocation results" });
      await bulkResults.getByText("1 of 2 entries saved.", { exact: true }).waitFor();
      await bulkResults.getByText(/Nov 21.*Saved\./).waitFor();
      await bulkResults.getByText(/Nov 22.*Source changed/).waitFor();
      assert.equal(await bulkResults.getByRole("button", { name: "Retry unsaved entries" }).count(), 0);
      assert.deepEqual((await root.collection("allocationHeads").doc(bulkReady.id).get()).data()?.portions,
        [{ projectId: nested.id, description: "", seconds: 1733 }]);
      assert.equal((await root.collection("allocationHeads").doc(bulkConflict.id).get()).exists, false);
      assert.deepEqual((await bulkReady.get()).data(), readyEntry);
      await bulkResults.scrollIntoViewIfNeeded();
      await bulkPage.screenshot({ path: join(evidence, "bulk-allocation-results.png"), animations: "disabled" });
      const splitSource = root.collection("rawTime").doc("five-hour-delivery-split");
      const fiveHours = bulkFixture(splitSource.id, "23", "Five hours for two projects");
      fiveHours.record.seconds = 18_000;
      await splitSource.set(fiveHours);
      const assignFiveHoursTo = async (id: string) => request("allocations/" + splitSource.id, "PATCH", {
        expectedRevision: await revision(), portions: [{ projectId: id, seconds: 18_000, description: "" }],
      });
      assert.equal((await assignFiveHoursTo(parent.id)).status, 400, "engagement disallows direct allocation");
      assert.equal((await assignFiveHoursTo(department.id)).status, 400, "service area disallows direct allocation");
      const split = [
        { projectId: direct.id, seconds: 10_800, description: "Three hours" },
        { projectId: nested.id, seconds: 7_200, description: "Two hours" },
      ];
      await json(await request("allocations/" + splitSource.id, "PATCH", { expectedRevision: await revision(), portions: split }), 200);
      assert.deepEqual((await splitSource.get()).data(), fiveHours);
      assert.deepEqual((await root.collection("allocationHeads").doc(splitSource.id).get()).data()?.portions, split);
      const hierarchyDraft = await json(await request("client-preview?month=2026-11&mode=draft"));
      assert.equal(hierarchyDraft.hierarchy[parent.id].monthlyCapUsed, 10_800);
      assert.equal(hierarchyDraft.hierarchy[department.id].monthlyCapUsed, 7_200 + 1_733);
      assert.equal(hierarchyDraft.hierarchy[parent.id].completion, undefined);
      assert.equal(hierarchyDraft.projects.filter((item: { id: string }) => [direct.id, nested.id].includes(item.id))
        .reduce((total: number, item: { seconds: number }) => total + item.seconds, 0), 18_000 + 1_733);
      const hierarchyNavigation = bulkPage.getByRole("navigation", { name: "Morris workspace sections" });
      const managementBrowser = await session(1440);
      try {
        const page = managementBrowser.page;
        await page.goto(origin + "/workspace/project-management?month=2026-11");
        const picker = page.getByRole("combobox", { name: "Find a project" });
        await picker.fill(persisted.name);
        await page.getByRole("option", { name: persisted.name, exact: true }).waitFor();
        await picker.press("Enter");
        const management = page.getByRole("form", { name: "Delivery progress" });
        await management.getByRole("heading", { name: persisted.name, exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, "/workspace/project-management/" + persisted.id);
        const slider = management.getByRole("slider", { name: "Project completion" });
        await management.getByRole("button", { name: "50%", exact: true }).click();
        await slider.press("ArrowRight");
        assert.equal(await slider.inputValue(), "51");
        await management.getByRole("button", { name: "100%", exact: true }).click();
        const confirmCompletion = page.getByRole("dialog", { name: "Confirm Project Completion" });
        await confirmCompletion.waitFor();
        await confirmCompletion.getByRole("button", { name: "Cancel", exact: true }).click();
        assert.equal(await slider.inputValue(), "51");
        assert.equal(await management.getByRole("button", { name: "100%", exact: true }).evaluate(element => element === document.activeElement), true);
        await management.getByRole("button", { name: "100%", exact: true }).click();
        await confirmCompletion.getByRole("button", { name: /Completion date/ }).click();
        const calendar = page.getByRole("dialog", { name: "Completion date" });
        await calendar.getByRole("grid").waitFor();
        await page.keyboard.press("Escape");
        await calendar.waitFor({ state: "hidden" });
        await confirmCompletion.getByRole("button", { name: /Completion date/ }).click();
        await calendar.getByRole("grid").waitFor();
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("Enter");
        await calendar.waitFor({ state: "hidden" });
        await confirmCompletion.getByRole("button", { name: "Confirm", exact: true }).click();
        assert.equal(await slider.inputValue(), "100");
        await management.getByText("Add milestones", { exact: true }).click();
        await management.getByLabel("Custom milestone title").fill("Confirm community delivery");
        await management.getByLabel("Optional milestone note").fill("Review the approved delivery checklist.");
        await management.getByRole("button", { name: "Add selected milestones (1)", exact: true }).click();
        const addedMilestone = management.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: "Confirm community delivery", exact: true }) });
        await addedMilestone.getByRole("button", { name: "Block", exact: true }).click();
        const blockerDialog = page.getByRole("dialog", { name: "Report blocker" });
        await blockerDialog.getByLabel("Client-facing explanation").fill("Waiting for scope confirmation.");
        await blockerDialog.getByLabel("Private blocker details (optional)").fill("PRIVATE-MILESTONE-DETAIL");
        await blockerDialog.getByRole("button", { name: "Confirm", exact: true }).click();
        await addedMilestone.getByText("Blocked", { exact: true }).waitFor();
        await management.getByLabel("Project Update").fill("The leadership review is ready.");
        await management.getByRole("button", { name: "Save Draft", exact: true }).click();
        await management.getByText("Draft saved.", { exact: true }).waitFor();
        const latest = (await approvedProjectRef.get()).data()!;
        assert.equal(latest.published, false);
        assert.equal(latest.delivery.manualCompletion, 100);
        assert.match(latest.delivery.completedOn, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(latest.milestones.find((item: { title: string }) => item.title === "Confirm community delivery").status, "blocked");
        const managementPatch = {
          name: latest.name, status: latest.status, progress: latest.progress, description: latest.description,
          internalNotes: latest.internalNotes, plan: latest.plan, milestones: latest.milestones, delivery: latest.delivery,
          updates: latest.updates, workOrderReference: latest.workOrderReference,
        };
        assert.equal((await request(projectPath, "PATCH", { expectedRevision: await revision(), patch: managementPatch, publish: true }, client.idToken)).status, 403);
        assert.equal((await request(projectPath, "PATCH", { expectedRevision: (await revision()) - 1, patch: managementPatch, publish: true })).status, 409);
        await page.screenshot({ path: join(evidence, "project-management-blocker.png"), fullPage: true, animations: "disabled" });
        const publishManagement = async () => {
          await management.getByRole("button", { name: "Save & Publish", exact: true }).click();
          await page.getByRole("dialog", { name: "Publish project changes?" }).getByRole("button", { name: "Publish", exact: true }).click();
          await management.getByText("Project changes published.", { exact: true }).waitFor();
        };
        await publishManagement();
        const readClientReport = async () => json(await request("report?month=2026-11", "GET", undefined, client.idToken));
        const blockedReport = await readClientReport();
        const clientMilestone = blockedReport.projects.find((item: { id: string }) => item.id === persisted.id)
          .milestones.find((item: { title: string }) => item.title === "Confirm community delivery");
        assert.equal(clientMilestone.blocker.message, "Waiting for scope confirmation.");
        assert.doesNotMatch(JSON.stringify(blockedReport), /PRIVATE-MILESTONE-DETAIL/);
        await addedMilestone.getByRole("button", { name: "Resolve blocker" }).click();
        await addedMilestone.getByRole("checkbox", { name: "Confirm community delivery" }).click();
        await page.getByRole("dialog", { name: "Complete milestone" }).getByRole("button", { name: "Confirm", exact: true }).click();
        await management.getByRole("button", { name: "Save Draft", exact: true }).click();
        await management.getByText("Draft saved.", { exact: true }).waitFor();
        assert.deepEqual(await readClientReport(), blockedReport, "a published project retains its approved milestone until publishing");
        await publishManagement();
        const managedReport = await readClientReport();
        const resolvedMilestone = managedReport.projects.find((item: { id: string }) => item.id === persisted.id)
          .milestones.find((item: { title: string }) => item.title === "Confirm community delivery");
        assert.equal(resolvedMilestone.completed, true);
        assert.match(resolvedMilestone.completedAt, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(resolvedMilestone.blocker.resolvedOn, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(managedReport.hierarchy[persisted.id].completion, 100);
        assert.equal(managedReport.totalSeconds, blockedReport.totalSeconds);
        const actions = (await root.collection("audits").where("entityId", "==", persisted.id).get()).docs.map(doc => doc.data().action);
        for (const event of ["project-milestone-blocked", "project-milestone-blocker-resolved",
          "project-milestone-completed", "project-edited-and-published"]) assert.ok(actions.includes(event), event);
        await page.setViewportSize({ width: 320, height: 640 });
        await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: join(evidence, "project-management-mobile.png"), fullPage: true, animations: "disabled" });
      } finally {
        await managementBrowser.context.close();
      }
      await hierarchyNavigation.getByRole("button", { name: "Projects", exact: true }).click();
      await bulkPage.getByRole("button", { name: "Create project", exact: true }).click();
      const wizard = bulkPage.getByRole("form", { name: "Create a project" });
      await wizard.getByRole("radio", { name: "Delivery Project", exact: true }).check();
      await wizard.getByLabel("Project name", { exact: true }).fill("Community readiness fixture");
      const continueWizard = wizard.getByRole("button", { name: "Continue", exact: true });
      await continueWizard.click();
      await wizard.getByRole("combobox", { name: "Parent Project", exact: true }).fill("Consulting engagement");
      await wizard.getByRole("option", { name: "Consulting engagement fixture", exact: true }).click();
      await wizard.getByRole("combobox", { name: "Department", exact: true }).fill("CFW");
      await wizard.getByRole("option", { name: "CFW", exact: true }).click();
      await continueWizard.click();
      await wizard.getByLabel("Client-facing description").fill("Approved community program preparation.");
      await continueWizard.click();
      await wizard.getByLabel("Monthly budgeted hours", { exact: true }).fill("20");
      await wizard.getByLabel("Whole-project budgeted hours", { exact: true }).fill("80");
      await wizard.getByRole("checkbox", { name: /count this project.*against the parent/i }).uncheck();
      await continueWizard.click();
      await wizard.getByRole("group", { name: /Project Managers/ }).getByRole("checkbox", { name: /Example delivery facilitator/ }).check();
      await continueWizard.click();
      await wizard.getByLabel("Project location").getByText("Community readiness fixture", { exact: true }).waitFor();
      await wizard.screenshot({ path: join(evidence, "project-creation-review.png"), animations: "disabled" });
      await wizard.getByRole("button", { name: "Save Draft", exact: true }).click();
      await bulkPage.getByRole("heading", { name: "Community readiness fixture", exact: true }).waitFor();
      const createdDelivery = (await root.collection("projects").where("name", "==", "Community readiness fixture").get()).docs[0].data();
      assert.equal(createdDelivery.delivery.structure, 3);
      assert.equal(createdDelivery.delivery.kind, "project");
      assert.equal(createdDelivery.delivery.parentId, parent.id);
      assert.equal(createdDelivery.delivery.areaId, "cfw");
      assert.equal(createdDelivery.delivery.monthlyCap, 72_000);
      assert.equal(createdDelivery.delivery.lifetimeCap, 288_000);
      assert.equal(createdDelivery.delivery.countAgainstParentCap, false);
      assert.equal(createdDelivery.published, false);
      const compactCreation = await session(390);
      await compactCreation.page.getByRole("button", { name: "Create project", exact: true }).click();
      const compactWizard = compactCreation.page.getByRole("form", { name: "Create a project" });
      await compactWizard.getByRole("radio", { name: "Delivery Project", exact: true }).check();
      await compactWizard.getByLabel("Project name", { exact: true }).fill("Miscellaneous planning fixture");
      const compactNext = compactWizard.getByRole("button", { name: "Continue", exact: true });
      await compactNext.click();
      await compactWizard.getByRole("combobox", { name: "Parent Project", exact: true }).fill("Consulting engagement");
      await compactWizard.getByRole("option", { name: "Consulting engagement fixture", exact: true }).click();
      await compactWizard.getByRole("combobox", { name: "Department", exact: true }).fill("Misc");
      await compactWizard.getByRole("option", { name: "Miscellaneous", exact: true }).click();
      await compactNext.click();
      assert.equal(await compactWizard.getByLabel("Arrangement", { exact: true }).count(), 0);
      assert.equal(await compactWizard.getByLabel("Client-facing description").count(), 0);
      await compactWizard.getByLabel("Monthly budgeted hours", { exact: true }).fill("10");
      assert.ok(await compactCreation.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await compactWizard.screenshot({ path: join(evidence, "project-creation-mobile.png"), animations: "disabled" });
      await compactNext.click();
      assert.equal(await compactWizard.getByRole("group", { name: /Facilitators/ }).count(), 0);
      await compactWizard.getByRole("group", { name: /Project Managers/ }).getByRole("checkbox", { name: /Example delivery facilitator/ }).check();
      await compactNext.click();
      compactCreation.page.once("dialog", dialog => void dialog.accept());
      await compactWizard.getByRole("button", { name: "Create & Publish", exact: true }).click();
      await compactCreation.page.getByText("Project created and published.", { exact: true }).waitFor();
      await compactCreation.context.close();
      await hierarchyBrowser.context.close();

      const legacyClient = await session(1440, "client");
      const legacyClientAudit: Awaited<ReturnType<typeof auditViewport>>[] = [];
      try {
        const views = [
          ["overview", "Leadership summary"], ["projects", "Projects"], ["engagements", "Parent engagements"],
          ["areas", "Departments"], ["area:health", "Health"], ["project:" + persisted.id, "Browser saved project"],
          ["timeline:" + persisted.id, "Project timeline"], ["milestones", "Milestones"],
          ["milestone:" + persisted.id + ":browser-approved-milestone", "Approved milestone"],
          ["history", "Reporting history"], ["notes", "Executive notes"],
          ["directory", "MI Directory"], ["contact:reviewed-contact", "Approved synthetic contact"],
        ];
        for (const [view, heading] of views) {
          const query = new URLSearchParams({ month: "2026-11", view });
          const page = legacyClient.page;
          await page.goto(`${origin}/?${query}#/secure`);
          await page.getByRole("heading", { name: heading, exact: true, level: 2 }).waitFor();
          assert.equal(await page.getByText("This link is unavailable for your approved report.").count(), 0, view);
          if (view === "engagements") {
            await page.getByRole("region", { name: "Parent engagements" }).waitFor();
            legacyClientAudit.push(await auditViewport(page, "legacy client parent engagement cards", 1661, 930, { compactSidebar: true }));
            await page.screenshot({ path: join(evidence, "04-parent-engagements-1661x930.png"), animations: "disabled" });
          }
          for (const [width, height] of [[1440, 900], [390, 844], [320, 568]]) {
            legacyClientAudit.push(await auditViewport(page, `legacy client ${view}`, width, height, { compactSidebar: true }));
            if (view === "directory" && width !== 320) {
              const images = page.getByRole("region", { name: "MI Other Contacts" }).locator("img");
              assert.equal(await images.count(), 3);
              for (const image of await images.all()) {
                await image.scrollIntoViewIfNeeded();
                assert.equal(await image.evaluate(async element => {
                  const img = element as HTMLImageElement;
                  await img.decode();
                  return img.naturalWidth;
                }), 300);
              }
              await page.evaluate(() => window.scrollTo(0, 0));
              await page.screenshot({ path: join(evidence, `legacy-client-directory-${width}.png`), fullPage: true, animations: "disabled" });
            }
          }
        }
      } finally {
        await legacyClient.context.close();
      }
      const legacyStaff = await session(1440, "staff");
      const legacyStaffAudit: Awaited<ReturnType<typeof auditViewport>>[] = [];
      try {
        for (const staff of Object.keys(staffSegments)) {
          const query = new URLSearchParams({ month: "2026-11", staff });
          const page = legacyStaff.page;
          await page.goto(`${origin}/?${query}#/secure`, { waitUntil: "domcontentloaded" });
          await page.locator("#platform-content h2:visible").first().waitFor();
          await page.waitForLoadState("networkidle");
          for (const [width, height] of [[1440, 900], [768, 1024], [390, 844], [320, 568]]) {
            legacyStaffAudit.push(await auditViewport(page, `legacy staff ${staff}`, width, height, { compactSidebar: true }));
          }
        }
      } finally {
        await legacyStaff.context.close();
      }
      assert.deepEqual(errors, []);
      await writeFile(
        join(evidence, "report.json"),
        JSON.stringify(
          {
            synthetic: true,
            remote: false,
            browser: "production-built component fixture",
            authenticatedEmulator: true,
            viewports: [1440, 1366, 768, 390],
            reload: true,
            independentSession: true,
            publication: true,
            projectCreationWizard: true,
            threeLevelHierarchy: true,
            separateCapConsumption: true,
            approvedClientViewports: [1440, 390],
            clientLayoutWidths: [320, 360, 390, 430, 768, 1024, 1280, 1440, 1920, 2560],
            tooltipCorners: true,
            browserMeasurements,
            legacyClientAudit,
            legacyStaffAudit,
            publishedTimeline: true,
            rapidMonthSwitch: true,
            allocation: true,
            bulkAllocationPartialConflict: true,
            history: true,
            audits: true,
            errors,
            agreementCollections: 0,
            rawSourceUnchanged: true,
          },
          null,
          2,
        ),
      );

      await root
        .collection("rawTime")
        .doc("synthetic-time")
        .update({ "record.revision": "synthetic-2" }); // adversarial source-version fixture only
      const heads = (
        await root.collection("allocationHeads").doc("synthetic-time").get()
      ).data();
      assert.equal(
        (
          await request("allocations/synthetic-time", "PATCH", {
            expectedRevision: await revision(),
            portions: allocated,
          })
        ).status,
        409,
      );
      assert.deepEqual(
        (
          await root.collection("allocationHeads").doc("synthetic-time").get()
        ).data(),
        heads,
      );
      await root
        .collection("memberships")
        .doc(key("project-client"))
        .update({ enabled: false });
      assert.equal(
        (await request("workspace", "GET", undefined, client.idToken)).status,
        403,
      );
      fixture.setUser({ ...fixture.user(), accountEnabled: false });
      assert.equal((await request("workspace")).status, 401);
      fixture.setUser({ ...fixture.user(), accountEnabled: true });
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await runtime.auth.revokeRefreshTokens(staff.localId);
      assert.equal((await request("workspace")).status, 401);
      await runtime.auth.updateUser(staff.localId, { disabled: true });
      assert.equal((await request("workspace")).status, 401);
    } catch (error) {
      const p = browser
        ?.contexts()
        .flatMap((c) => c.pages())
        .at(-1);
      if (p) {
        const evidence = resolve("test-results/project-only-browser");
        await mkdir(evidence, { recursive: true });
        await p.screenshot({
          path: join(evidence, "failure.png"),
          fullPage: true,
        });
        await writeFile(
          join(evidence, "failure.txt"),
          await p.locator("body").innerText(),
        );
      }
      throw error;
    } finally {
      await browser?.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
