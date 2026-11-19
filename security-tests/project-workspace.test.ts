import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium, firefox, webkit, type Browser } from "playwright";
import { firebaseRuntime, FirebaseIdentityVerifier } from "../server/firebase";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { TimeSync } from "../server/time-sync";
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

test(
  "project-only secured Auth/Firestore workflow and real browser persistence without agreement records",
  { timeout: 150000 },
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
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectStaffWorkspace} from './src/api/ProjectWorkspace'; import {ProjectClientReport} from './src/api/ProjectClientReport'; import {SecuredApiClient} from './src/api/client'; import './src/api/secure.css'; import './src/reporting/nordic.css'; const identity=window.__localProjectFixture; async function fixtureRequest(input, init) {
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
  return fetch(input, init);
}
const client=new SecuredApiClient(true, location.origin, async()=>identity.token, fixtureRequest, ()=>identity.proof, 'projects');
const denied=()=>document.body.textContent='Access denied';
function ClientFixture() {
  const [month, setMonth] = React.useState("2026-11");
  return <><label>Reporting month<input type="month" value={month} onChange={(event)=>setMonth(event.target.value)}/></label><ProjectClientReport client={client} tenant="${tenant}" month={month} onDenied={denied}/></>;
}
 client.call('${tenant}','workspace').then(workspace=>createRoot(document.getElementById('root')).render(<main className="nordic secure-shell"><h1>Synthetic secured project workspace</h1>{workspace.role === "staff" ? <ProjectStaffWorkspace client={client} tenant="${tenant}" workspace={workspace} month="2026-11" onDenied={()=>document.body.textContent='Access denied'}/> : <ClientFixture/>}</main>)).catch(()=>document.body.textContent='Access denied');`,
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
      minify: true,
    });
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>',
    );
    await mkdir(join(directory, "branding", "zagime"), { recursive: true });
    await copyFile(resolve("public/branding/zagime/zagime-main-logo.png"), join(directory, "branding", "zagime", "zagime-main-logo.png"));
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
        await context.route("**/*", (route) =>
          new URL(route.request().url()).origin === origin
            ? route.continue()
            : route.abort(),
        );
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
      await first.page
        .getByRole("navigation", { name: "Morris workspace sections" })
        .getByRole("button", { name: "Projects", exact: true })
        .click();
      await first.page.getByRole("button", { name: "Clear search", exact: true }).click();
      await first.page
        .getByRole("heading", { name: "HIDDEN-PROJECT", exact: true })
        .waitFor();
      await first.page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await first.page
        .getByLabel("Project name", { exact: true })
        .fill("Browser saved project");
      await first.page
        .getByLabel("Planned hours", { exact: true })
        .fill("1.25");
      await first.page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await first.page
        .getByRole("heading", { name: "Browser saved project", exact: true })
        .waitFor();
      await first.page
        .getByRole("button", {
          name: "Edit Browser saved project",
          exact: true,
        })
        .click();
      await first.page.getByLabel("Progress (%)", { exact: true }).fill("45");
      await first.page
        .getByLabel("Internal notes", { exact: true })
        .fill("Browser synthetic private note");
      await first.page.getByLabel("Client description").fill("Published synthetic project description");
      await first.page.getByRole("button", { name: "Add update", exact: true }).click();
      await first.page.getByLabel("Update title").fill("Approved delivery update");
      await first.page.getByLabel("Update text").fill("The client can see this update.");
      await first.page.getByLabel("Show this update to clients").check();
      await first.page.getByRole("button", { name: "Add update", exact: true }).click();
      await first.page.getByLabel("Update title").nth(1).fill("PRIVATE-UPDATE");
      await first.page.getByLabel("Update text").nth(1).fill("Private draft detail.");
      await first.page.getByRole("button", { name: "Add milestone", exact: true }).click();
      await first.page.getByLabel("Milestone title").fill("Approved milestone");
      await first.page.getByLabel("Milestone completed").check();
      await first.page.getByLabel("Show this milestone to clients").check();
      await first.page
        .getByRole("button", { name: "Save project", exact: true })
        .click();
      await first.page
        .getByLabel("Internal notes", { exact: true })
        .waitFor({ state: "detached" });
      await first.page.reload({ waitUntil: "networkidle" });
      const card = first.page.locator("article").filter({
        has: first.page.getByRole("heading", {
          name: "Browser saved project",
          exact: true,
        }),
      });
      await card.getByText(/45% progress/).waitFor();
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
      await first.page.getByRole("button", { name: "Hours & allocations", exact: true }).click();
      await first.page
        .getByRole("button", { name: "Load authorized time", exact: true })
        .click();
      await first.page
        .getByRole("button", { name: "Allocate recorded hours", exact: true })
        .click();
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
      await first.page
        .getByRole("button", { name: "Save allocation", exact: true })
        .click();
      await first.page.getByRole("navigation").getByRole("button", { name: "Projects", exact: true }).click();
      await card.locator("dd").first().filter({ hasText: /^0\.5 h$/ }).waitFor();
      await first.page.getByRole("button", { name: "Hours & allocations", exact: true }).click();
      await first.page
        .getByRole("button", { name: "Load authorized time", exact: true })
        .click();
      await first.page
        .getByRole("button", { name: "Allocation history", exact: true })
        .click();
      await first.page.getByText(/Revision 2 ·/).waitFor();
      await first.page.getByRole("navigation").getByRole("button", { name: "Audit history", exact: true }).click();
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
      await first.page.getByRole("button", { name: "Portfolio management", exact: true }).click();
      await first.page.getByRole("button", { name: "Edit Health", exact: true }).click();
      await first.page.getByLabel("Description", { exact: true }).fill("Approved health service area.");
      await first.page.getByRole("button", { name: "Save changes", exact: true }).click();
      await first.page.getByRole("heading", { name: "Service areas editor", exact: true }).waitFor({ state: "hidden" });
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
        await saved.getByText(/45% progress/).waitFor();
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
      const contact = { id: "reviewed-contact", name: "Approved synthetic contact", role: "Delivery lead",
        responsibility: "Coordinates delivery", internalContact: "INTERNAL-CONTACT", publicContact: "Approved contact channel",
        areaId: "health", projectIds: [], order: 1, active: true, visible: true };
      await json(await patchPortfolio("directory", contact));
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
      await previewCard.getByText("Approved synthetic contact · Lead", { exact: true }).waitFor();
      assert.doesNotMatch(await previewCard.innerText(), /PRIVATE|INTERNAL/);
      await previewBrowser.context.close();

      for (const width of [1440, 390]) {
        const clientBrowser = await session(width, "client");
        const { page } = clientBrowser;
        const search = page.getByRole("searchbox", { name: "Search published projects" });
        await search.fill("HIDDEN-PROJECT");
        await page.getByText("No published projects match.").waitFor();
        await search.fill("BROWSER SAVED");
        const visibleCard = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Browser saved project", exact: true }) });
        await visibleCard.getByText("45% progress").waitFor();
        await visibleCard.locator("dd").first().filter({ hasText: /^0\.5 h$/ }).waitFor();
        await visibleCard.getByText("Updates and milestones").click();
        await visibleCard.getByText("Approved delivery update").waitFor();
        await visibleCard.getByText("Approved milestone").waitFor();
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
            await portfolio.getByText("Allocated hours · November 2026").waitFor();
            await portfolio.getByText("0.5 h", { exact: true }).waitFor();
            assert.equal(await page.getByRole("alert").count(), 0);
            await page.evaluate(() => (window as any).__reportRace.release());
            await page.waitForFunction(() => (window as any).__reportRace.delivered);
            assert.equal(await portfolio.getByText("Allocated hours · November 2026").count(), 1);
            assert.equal(await portfolio.getByText("0.5 h", { exact: true }).count(), 1);

            await filter.fill("2026-10");
            await portfolio.getByText("Allocated hours · October 2026").waitFor();
            await portfolio.getByText("0 h", { exact: true }).waitFor();
            const octoberProject = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Browser saved project", exact: true }) });
            assert.equal(await octoberProject.locator("dd").first().textContent(), "0 h");
          } finally {
            await page.evaluate(() => (window as any).__reportRace.release());
          }
        }

        await page.getByLabel("Reporting month").fill("2026-11");
        const nav = page.getByRole("navigation", { name: "Client workspace", exact: true });
        await nav.getByRole("button", { name: "Health", exact: true }).click();
        await page.getByText("Approved health service area.").waitFor();
        await page.getByText("Approved delivery group", { exact: true }).waitFor();
        await page.screenshot({ path: join(evidence, "area-" + width + ".png"), fullPage: true });
        await nav.getByRole("button", { name: "MI Directory", exact: true }).click();
        await page.getByRole("heading", { name: "Approved synthetic contact" }).waitFor();
        assert.doesNotMatch(await page.locator("body").innerText(), /INTERNAL-CONTACT|PRIVATE-DIRECTORY|UNLINKED-DIRECTORY/);
        await page.screenshot({ path: join(evidence, "directory-" + width + ".png"), fullPage: true });
        await nav.getByRole("button", { name: "Leadership summary", exact: true }).click();
        const help = page.getByRole("button", { name: "How are allocated hours calculated?" });
        await help.focus();
        const tooltip = page.getByRole("tooltip");
        await tooltip.waitFor();
        const bounds = (await tooltip.boundingBox())!;
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 1000);
        await page.keyboard.press("Escape");
        await tooltip.waitFor({ state: "hidden" });
        const trigger = page.getByRole("button", { name: "At a Glance", exact: true });
        await trigger.click();
        const presentation = page.getByRole("dialog");
        await presentation.getByRole("button", { name: "Next chapter" }).click();
        await presentation.getByRole("heading", { name: "Reporting period" }).waitFor();
        await page.keyboard.press("ArrowRight");
        await presentation.getByRole("heading", { name: "Published delivery" }).waitFor();
        await presentation.getByText("0.5 h", { exact: true }).waitFor();
        if (width === 1440) {
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
          for (const viewport of [320, 390, 768, 1024, 1280, 1440, 1920]) {
            await page.setViewportSize({ width: viewport, height: 760 });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "client overflow at " + viewport);
          }
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
          const zoomBounds = await trigger.boundingBox();
          assert.ok(zoomBounds && zoomBounds.x >= 0 && zoomBounds.x + zoomBounds.width <= 1280);
          await page.evaluate(() => { document.documentElement.style.zoom = ""; });
        } else {
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
              await dialog.getByRole("heading", { name: /synthetic/i }).waitFor();
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
      await json(await request(`projects/${persisted.id}`, "PATCH", {
        expectedRevision: await revision(),
        patch: {
          name: persisted.name,
          description: persisted.description,
          internalNotes: persisted.internalNotes,
          plan: persisted.plan,
          progress: 50,
          status: persisted.status,
        },
      }));
      const legacyEdit = (await root.collection("projects").doc(persisted.id).get()).data()!;
      assert.deepEqual(legacyEdit.updates, persisted.updates);
      assert.deepEqual(legacyEdit.milestones, persisted.milestones);
      await json(await request(`projects/${persisted.id}/publication`, "PATCH", {
        expectedRevision: await revision(), published: false,
      }));
      const afterUnpublish = await json(await request("report?month=2026-11", "GET", undefined, client.idToken));
      assert.ok(!afterUnpublish.projects.some((item: { id: string }) => item.id === persisted.id));
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
            approvedClientViewports: [1440, 390],
            clientLayoutWidths: [320, 390, 768, 1024, 1280, 1440, 1920],
            tooltipCorners: true,
            browserMeasurements,
            publishedTimeline: true,
            rapidMonthSwitch: true,
            allocation: true,
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
