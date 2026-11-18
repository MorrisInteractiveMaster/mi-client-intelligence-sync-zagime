import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
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
  { timeout: 120000 },
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
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProjectStaffWorkspace} from './src/api/ProjectWorkspace'; import {SecuredApiClient} from './src/api/client'; import './src/api/secure.css'; import './src/reporting/nordic.css'; const identity=window.__localProjectFixture; const client=new SecuredApiClient(true, location.origin, async()=>identity.token, undefined, ()=>identity.proof, 'projects'); client.call('${tenant}','workspace').then(workspace=>createRoot(document.getElementById('root')).render(<main className="nordic secure-shell"><h1>Synthetic secured project workspace</h1><ProjectStaffWorkspace client={client} tenant="${tenant}" workspace={workspace} month="2026-11" onDenied={()=>document.body.textContent='Access denied'}/></main>)).catch(()=>document.body.textContent='Access denied');`,
        loader: "jsx",
        resolveDir: process.cwd(),
      },
      bundle: true,
      outfile: join(directory, "app.js"),
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".woff2": "file", ".woff": "file" },
      minify: true,
    });
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js" defer></script></body></html>',
    );
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
      const session = async (width: number) => {
        const fresh = await signStaff();
        const context = await browser!.newContext({
          viewport: { width, height: 1000 },
        });
        await context.addInitScript(
          (identity) => {
            (window as any).__localProjectFixture = identity;
          },
          {
            token: fresh.idToken,
            proof: {
              idToken: microsoftToken,
              accessToken: "synthetic-delegated-proof",
            },
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
        await page
          .getByRole("button", { name: "Create project", exact: true })
          .waitFor();
        return { context, page };
      };
      const first = await session(1440);
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
      await card.getByText(/0.5 h in 2026-11/).waitFor();
      await first.page
        .getByRole("button", { name: "Load authorized time", exact: true })
        .click();
      await first.page
        .getByRole("button", { name: "Allocation history", exact: true })
        .click();
      await first.page.getByText(/Revision 2 ·/).waitFor();
      await first.page
        .getByRole("button", { name: "Load audit history", exact: true })
        .click();
      await first.page
        .getByText(/allocation-changed/)
        .first()
        .waitFor();
      await first.page.screenshot({
        path: join(evidence, "staff-1440.png"),
        fullPage: true,
      });
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
        await saved.getByText(/0.5 h in 2026-11/).waitFor();
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
      assert.deepEqual(errors, []);
      const persisted = (
        await root
          .collection("projects")
          .where("name", "==", "Browser saved project")
          .get()
      ).docs[0].data();
      assert.equal(persisted.plan.targetSeconds, 4500);
      assert.equal(persisted.internalNotes, "Browser synthetic private note");
      assert.equal(persisted.published, true);
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
