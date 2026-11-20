import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { ReportingBackend } from "../server/backend";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { apiServer } from "../server/http";
import { seedProjectSynthetic } from "../server/project-operator";
import { ProjectBackend, ProjectStore } from "../server/project-workspace";
import { defaultPortalSettings, type PlatformControl } from "../src/projects/control";
import type { ProjectReport, ProjectWorkspace } from "../src/projects/model";

test("Control Panel requires configured corporate admin and preserves approved publication and safe client fields", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-platform-control";
  const root = runtime.db.collection("tenants").doc(tenant);
  const projectId = "synthetic-delivery", projectPath = "projects/" + projectId;
  const month = "2026-11";
  const ownerUid = "configured-platform-owner";
  const now = Date.parse("2026-11-16T20:00:00Z");
  await seedProjectSynthetic(runtime.db, tenant, true);
  for (const subject of [ownerUid, "client"]) {
    await root.collection("memberships").doc(key(subject)).set({
      schemaVersion: 2, tenantId: tenant, subject, role: "client", approved: true, enabled: true, projectIds: [projectId],
    });
  }
  const server = apiServer(undefined as unknown as ReportingBackend, {
    projects: new ProjectBackend(new ProjectStore(runtime.db, ownerUid), {
      async verify(authorization) {
        const token = authorization.slice(7);
        const subject = ["microsoft-owner", "google-same-uid", "microsoft-wrong-tenant"].includes(token) ? ownerUid : token;
        const staff = ["microsoft-owner", "staff", "microsoft-wrong-tenant"].includes(token);
        return {
          subject, issuer: "fixture", audience: "fixture", expiresAt: now + 60_000, revoked: false, disabled: false,
          ...(staff && { corporatePolicy: true, staffTenantId: token === "microsoft-wrong-tenant" ? "other-tenant" : tenant }),
        };
      },
    }, { issuer: "fixture", audience: "fixture", now: () => now }),
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v2/tenants/${tenant}/`;
  const request = (path: string, session: string, body?: unknown) => fetch(endpoint + path, {
    headers: { authorization: "Bearer " + session, ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { method: "PATCH", body: JSON.stringify(body) }),
  });
  async function expectJson<T>(response: Promise<Response>, status = 200) {
    const value = await response, payload = await value.json();
    assert.equal(value.status, status, JSON.stringify(payload));
    return payload as T;
  }
  const control = () => expectJson<PlatformControl>(request("control", "microsoft-owner"));
  const report = () => expectJson<ProjectReport>(request("report?month=" + month, "client"));
  const publication = (session: string, revision: number, published: boolean, status = 200) =>
    expectJson<{ revision: number }>(request(projectPath + "/publication", session, { expectedRevision: revision, published }), status);
  const draftAction = (session: string, revision: number, action: "publish" | "discard", status = 200) =>
    expectJson<{ revision: number }>(request(projectPath + "/draft", session, { expectedRevision: revision, action }), status);
  const events = async (action: string) => (await root.collection("audits").get()).docs.map(doc => doc.data()).filter(doc => doc.action === action);
  try {
    const initial = await control();
    assert.deepEqual(initial.settings, defaultPortalSettings);
    assert.equal((await expectJson<ProjectWorkspace>(request("workspace", "microsoft-owner"))).platformAdmin, true);
    const pending = { expectedRevision: initial.revision, settings: { clientLabel: " Preview label ", presentationTitle: " Board briefing ", ownerPublishes: true } };
    for (const session of ["staff", "client", "google-same-uid", "microsoft-wrong-tenant"]) {
      assert.equal((await request("control", session)).status, 403);
      assert.equal((await request("control", session, pending)).status, 403);
      assert.equal((await expectJson<ProjectWorkspace>(request("workspace", session))).platformAdmin, undefined);
    }
    assert.equal((await report()).projects.length, 0);
    const legacyPublish = await publication("staff", initial.revision, true);
    assert.equal((await report()).projects[0].name, "Synthetic delivery project");
    assert.equal((await request("control", "microsoft-owner", pending)).status, 409);
    assert.equal((await request("control", "microsoft-owner", { expectedRevision: legacyPublish.revision, settings: { ...pending.settings, contact: "private" } })).status, 400);
    const allowed = await expectJson<PlatformControl>(request("control", "microsoft-owner", { ...pending, expectedRevision: legacyPublish.revision }));
    assert.deepEqual(allowed.settings, { clientLabel: "Preview label", presentationTitle: "Board briefing", ownerPublishes: true });
    assert.equal(allowed.revision, legacyPublish.revision + 1);
    assert.deepEqual(await control(), allowed);
    assert.deepEqual(await expectJson<PlatformControl>(request("control", "microsoft-owner", { ...pending, expectedRevision: allowed.revision })), allowed);
    const settingsAudit = await events("portal-settings-changed");
    assert.equal(settingsAudit.length, 1);
    assert.equal(settingsAudit[0].actor, ownerUid);
    assert.equal(settingsAudit[0].revision, allowed.revision);
    assert.equal(settingsAudit[0].entityId, tenant);
    const publicState = await report();
    assert.equal(publicState.tenant.name, "Preview label");
    assert.equal(publicState.presentationTitle, "Board briefing");
    assert.doesNotMatch(JSON.stringify(publicState), /portalSettings|ownerPublishes|platformAdmin|configured-platform-owner|Synthetic internal note/);
    await publication("staff", allowed.revision, false, 403);
    await publication("google-same-uid", allowed.revision, false, 403);
    assert.equal((await control()).revision, allowed.revision);

    const draft = await expectJson<{ revision: number; draft?: { revision: number } }>(request(projectPath, "staff", {
      expectedRevision: allowed.revision,
      patch: {
        name: "Approved after review", status: "planned", progress: 0, description: "Staff draft description",
        internalNotes: "Do not publish this", plan: { basis: "fixed", targetSeconds: 36000 },
      },
    }));
    assert.equal(draft.draft?.revision, draft.revision);
    assert.equal((await report()).projects[0].name, "Synthetic delivery project");
    await draftAction("staff", draft.revision, "publish", 403);
    await draftAction("client", draft.revision, "publish", 403);
    await draftAction("google-same-uid", draft.revision, "publish", 403);
    await draftAction("microsoft-owner", allowed.revision, "publish", 409);
    const published = await draftAction("microsoft-owner", draft.revision, "publish");
    assert.equal((await events("project-draft-published"))[0].actor, ownerUid);
    const approved = await report();
    assert.equal(approved.projects[0].name, "Approved after review");
    assert.doesNotMatch(JSON.stringify(approved), /Do not publish this|ownerPublishes|platformAdmin/);
    await publication("microsoft-owner", published.revision, false);
    assert.equal((await report()).projects.length, 0);
  } finally {
    server.close();
    await once(server, "close");
    await runtime.close();
  }
});
