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
import type { ProjectDeletionReview, ProjectReport, ProjectWorkspace } from "../src/projects/model";

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
  const request = (path: string, session: string, body?: unknown, method = "PATCH") => fetch(endpoint + path, {
    headers: { authorization: "Bearer " + session, ...(body !== undefined && { "content-type": "application/json" }) },
    ...(body !== undefined && { method, body: JSON.stringify(body) }),
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
    const protectedReview = await expectJson<ProjectDeletionReview>(request(projectPath + "/deletion", "microsoft-owner"));
    assert.ok(protectedReview.blockers.includes("Published content or publication history"));
    await expectJson(request(projectPath + "/deletion", "microsoft-owner", {
      expectedRevision: protectedReview.revision, name: protectedReview.name,
    }, "POST"), 409);

    const draftId = "unused-draft";
    const draftPath = "projects/" + draftId + "/deletion";
    const revision = (await control()).revision;
    const record = (await root.collection("projects").doc(projectId).get()).data()!;
    await root.collection("projects").doc(draftId).set({
      ...record, id: draftId, name: "Unused draft", source: null, published: false,
    });
    await root.collection("projectViews").doc(draftId).set({
      schemaVersion: 2, tenantId: tenant, id: draftId, published: false, lifetimeSeconds: 0,
    });
    for (const session of ["staff", "client", "google-same-uid", "microsoft-wrong-tenant"]) {
      assert.equal((await request(draftPath, session)).status, 403);
      assert.equal((await request(draftPath, session, { expectedRevision: revision, name: "Unused draft" }, "POST")).status, 403);
    }
    const review = await expectJson<ProjectDeletionReview>(request(draftPath, "microsoft-owner"));
    assert.deepEqual(review.blockers, []);
    await expectJson(request(draftPath, "microsoft-owner", { expectedRevision: revision, name: "Wrong name" }, "POST"), 409);
    const child = root.collection("projects").doc("dependent");
    await child.set({ ...record, id: "dependent", delivery: { parentId: draftId } });
    const conflict = await expectJson<ProjectDeletionReview>(request(draftPath, "microsoft-owner", {
      expectedRevision: revision, name: review.name,
    }, "POST"), 409);
    assert.ok(conflict.blockers.includes("Child projects"));
    await child.delete();
    const removed = await expectJson<ProjectDeletionReview>(request(draftPath, "microsoft-owner", {
      expectedRevision: revision, name: review.name,
    }, "POST"));
    assert.equal(removed.deleted, true);
    assert.equal((await root.collection("projects").doc(draftId).get()).exists, false);
    assert.equal((await root.collection("projectViews").doc(draftId).get()).exists, false);
    const deletion = await events("project-permanently-deleted");
    assert.equal(deletion.length, 1);
    assert.equal(deletion[0].entityId, draftId);
    assert.equal(deletion[0].actor, ownerUid);
    assert.doesNotMatch(JSON.stringify(deletion), /Unused draft|Staff draft description/);
  } finally {
    server.close();
    await once(server, "close");
    await runtime.close();
  }
});
