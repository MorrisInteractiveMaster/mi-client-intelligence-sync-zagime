import { readWorkOrderEffort } from "../server/time-totals";
import test from "node:test";
import assert from "node:assert/strict";
import { firebaseRuntime } from "../server/firebase";
import { ProjectStore } from "../server/project-workspace";
import { seedProjectSynthetic } from "../server/project-operator";
import { TimeClient } from "../server/time-client";
import { TimeSync } from "../server/time-sync";
import { key } from "../server/firestore-store";
import { sourceRecordId, type VerifiedIdentity } from "../server/contracts";

test("verified customer discovery, registration, linking, daily reconciliation and recovery", async () => {
  const runtime = firebaseRuntime(
    "emulator",
    "demo-mi-security",
    "mi-client-staging",
  );
  const tenant = "synthetic-time-customer";
  const root = runtime.db.doc(`tenants/${tenant}`);
  const account = "9941",
    parent = "71";
  const map = (job: string) =>
    root.collection("timeMappings").doc(key(account, job));
  const checkpoint = (job: string) =>
    root
      .collection("syncCheckpoints")
      .doc(key("quickbooks-time", account, job));
  const originalJobs = [
    { id: 101, parent_id: 71, name: "WO1267 Regular Consulting", active: true },
    {
      id: 105,
      parent_id: 101,
      name: "WO1267.1 HR Policy Review",
      active: true,
    },
    {
      id: 102,
      parent_id: 71,
      name: "WO1268 Financial Consulting",
      active: false,
    },
    {
      id: 103,
      parent_id: 71,
      name: "WO1411 Facilitated Session",
      active: true,
    },
  ];
  let jobs = [...originalJobs];
  let now = Date.parse("2026-11-06T12:00:00Z");
  let mode = "initial",
    requests = 0;
  let validName = false;
  const provider = new TimeClient(
    async () => "synthetic-credential",
    async (input) => {
      requests++;
      const url = new URL(String(input)),
        query = url.searchParams;
      const path = url.pathname.split("/").at(-1)!;
      const result = (values: [string, unknown][], more = false) =>
        Response.json({
          results: {
            [path === "current_user" ? "users" : path]:
              Object.fromEntries(values),
          },
          more,
        });
      if (path === "current_user")
        return result([
          [
            "7",
            {
              id: 7,
              client_url: "fixture-company",
              company_id: 9941,
              active: true,
            },
          ],
        ]);
      if (path === "jobcodes") {
        const all = [
          {
            id: 71,
            parent_id: 0,
            name: validName
              ? "Zagim\u0113 Anishinab\u0113k Nation"
              : "Other customer",
            active: true,
          },
          { id: 81, parent_id: 0, name: "Zagim\u0113 Anishinab\u0113k Nation", active: true },
          ...jobs,
        ];
        let found = query.has("ids")
          ? all.filter((row) => String(row.id) === query.get("ids"))
          : all.filter((row) =>
              query
                .get("parent_ids")
                ?.split(",")
                .includes(String(row.parent_id)),
            );
        assert.equal(query.get("active"), "both");
        assert.ok(
          query.has("ids") || query.has("parent_ids"),
          "unscoped discovery",
        );
        if (mode === "outside" && query.get("parent_ids") === "71")
          found = [{ id: 999, parent_id: 81, name: "Unrelated", active: true }];
        const page = Number(query.get("page") ?? "1");
        if (!query.has("ids")) found = found.slice((page - 1) * 2, page * 2);
        const count = all.filter((row) =>
          query.get("parent_ids")?.split(",").includes(String(row.parent_id)),
        ).length;
        return result(
          found.map((row) => [String(row.id), { ...row, type: "regular" }]),
          !query.has("ids") && mode !== "outside" && count > page * 2,
        );
      }
      const jobcodeId = Number(query.get("jobcode_ids"));
      if (path === "projects") {
        const job = jobs.find((row) => row.id === jobcodeId);
        assert.ok(job);
        const id = 9000 + job.id;
        return result([
          [
            String(id),
            {
              id,
              jobcode_id: job.id,
              parent_jobcode_id: job.parent_id,
              name: job.name,
              active: job.active,
              status: "in_progress",
            },
          ],
        ]);
      }
      if (query.get("on_the_clock") === "yes") {
        assert.equal(jobcodeId, 71);
        return result([
          [
            "990",
            {
              id: 990,
              jobcode_id: 105,
              type: "regular",
              end: "",
              start: "2026-11-06T11:50:00Z",
            },
          ],
        ]);
      }
      assert.ok(
        jobs.some((job) => job.id === jobcodeId),
        "read requires a currently verified job",
      );
      const deleted = path === "timesheets_deleted";
      if (mode === "provider-failure" && jobcodeId === 103)
        return new Response(null, { status: 503 });
      const changes = jobs
        .filter((row) => row.id === jobcodeId || row.parent_id === jobcodeId)
        .flatMap((job) => {
          const update =
            job.id === 104 || (job.id === 101 && mode !== "initial");
          if (deleted !== (job.id === 101 && update)) return [];
          const id = 600 + job.id;
          const modified = update
            ? "2026-11-07T11:00:00Z"
            : "2026-11-06T11:00:00Z";
          if (
            Date.parse(modified) < Date.parse(query.get("modified_since")!) ||
            Date.parse(modified) > Date.parse(query.get("modified_before")!)
          )
            return [];
          return [
            [
              String(id),
              {
                id,
                jobcode_id: job.id,
                duration: 61,
                date: "2026-11-05",
                last_modified: modified,
                type: "manual",
                locked: 1,
              },
            ],
          ] as [string, unknown][];
        });
      return result(changes);
    },
    async () => {},
  );
  const sync = new TimeSync(
    new ProjectStore(runtime.db),
    {
      tenant,
      account,
      customerParentId: parent,
      onClock: true,
      userId: "7",
      clientUrl: "fixture-company",
      admin: "time-operator",
      from: "2026-11-05",
    },
    provider,
    () => now,
  );
  const identity = (subject: string): VerifiedIdentity => ({
    subject,
    issuer: "fixture",
    audience: "fixture",
    expiresAt: now + 200000,
    disabled: false,
    revoked: false,
    corporatePolicy: true,
    staffTenantId: tenant,
  });
  const who = identity("time-operator");
  try {
    await seedProjectSynthetic(runtime.db, tenant, true);
    await assert.rejects(sync.daily(tenant), /setup required/);
    await assert.rejects(sync.verifyCustomer(tenant, true), /does not match/);
    validName = true;
    assert.deepEqual(await sync.verifyCustomer(tenant), {
      verified: true,
      applied: false,
      workOrders: 4,
      verifiedProjects: 4,
    });
    assert.equal((await root.collection("timeRuns").get()).size, 0);
    await sync.verifyCustomer(tenant, true);
    const initial = await sync.daily(tenant);
    assert.deepEqual(initial, {
      skipped: false,
      changed: 4,
      registered: 4,
      failed: 0,
    });
    const beforeRetry = requests;
    assert.equal((await sync.daily(tenant)).skipped, true);
    assert.equal(requests, beforeRetry);
    const mappings = (await sync.status(tenant, who, "2026-11")).mappings;
    assert.equal(mappings.length, 4);
    assert.equal(
      mappings.find((entry) => entry.jobcodeId === "102")?.sourceState,
      "inactive",
    );
    for (const entry of mappings) {
      const p = (
        await root.collection("projects").doc(entry.projectId).get()
      ).data()!;
      assert.equal(p.published, false);
    }
    const m = (await map("105").get()).data()!;
    const source = root
      .collection("rawTime")
      .doc(sourceRecordId("quickbooks-time", account, "705"));
    const imported = (await source.get()).data()!;
    assert.equal(imported.record.seconds, 61);
    assert.equal(imported.approval, "unknown");
    assert.equal((await source.collection("versions").get()).size, 1);
    const status = await sync.status(tenant, who, "2026-11");
    assert.equal(status.recordedSeconds, 244);
    assert.equal(status.unallocatedSeconds, 244);
    assert.deepEqual(status.running, {
      count: 1,
      seconds: 600,
      observedAt: "2026-11-06T12:00:00.000Z",
    });
    const existingProject = "synthetic-planning";
    const parentProject = root.collection("projects").doc(existingProject);
    await parentProject.update({ delivery: { kind: "engagement", structure: 3, type: "hourly", managerIds: [], teamIds: [] } });
    const scopedMapping = mappings.find(entry => entry.jobcodeId === "101")!;
    assert.equal(status.verifiedCustomerId, parent);
    assert.equal(scopedMapping.canReview, true);
    const review = { targetKind: "engagement" as const, previousProjectId: scopedMapping.projectId,
      recordedSeconds: 61, allocatedSeconds: 0 };
    const source101 = root.collection("rawTime").doc(sourceRecordId("quickbooks-time", account, "701"));
    const immutableSource = (await source101.get()).data();
    const immutableCheckpoint = (await checkpoint("101").get()).data();
    const immutableAllocation = (await root.collection("allocationHeads").doc(source101.id).get()).data();
    await assert.rejects(sync.confirmMapping(tenant, identity("other-staff"), "101", existingProject, review), /Forbidden/);
    await assert.rejects(sync.confirmMapping(tenant, who, "101", existingProject, { ...review, recordedSeconds: 60 }), /Time mapping conflict/);
    await assert.rejects(sync.confirmMapping(tenant, who, "101", existingProject, { ...review, targetKind: "project" }), /Invalid Time mapping target/);
    await assert.rejects(sync.confirmMapping(tenant, who, "102", existingProject, {
      ...review, previousProjectId: mappings.find(entry => entry.jobcodeId === "102")!.projectId,
    }), /Time mapping conflict/);
    const confirmation = await Promise.all([
      sync.confirmMapping(tenant, who, "101", existingProject, review),
      sync.confirmMapping(tenant, who, "101", existingProject, review),
    ]);
    assert.equal(confirmation.filter(result => result.changed).length, 1);
    assert.deepEqual((await source101.get()).data(), immutableSource);
    assert.deepEqual((await checkpoint("101").get()).data(), immutableCheckpoint);
    assert.deepEqual((await root.collection("allocationHeads").doc(source101.id).get()).data(), immutableAllocation);
    const attribution = await runtime.db.runTransaction(tx => readWorkOrderEffort(tx, root, [existingProject, scopedMapping.projectId], "2026-11", [0, 0]));
    assert.deepEqual(attribution.map(item => item.recordedSeconds), [61, 0]);
    const reviewedAudit = (await root.collection("audits").where("action", "==", "time-work-order-mapping-reviewed").get()).docs;
    assert.equal(reviewedAudit.length, 1);
    assert.equal((await sync.status(tenant, who, "2026-11")).recordedSeconds, 244);
    await assert.rejects(
      sync.approve(tenant, identity("other-staff"), "105", existingProject),
      /Forbidden/,
    );
    await assert.rejects(
      sync.approve(tenant, who, "999", existingProject),
      /Forbidden/,
    );
    await assert.rejects(sync.sync("synthetic-other", who, "105"), /Forbidden/);
    await assert.rejects(
      sync.status(tenant, { ...who, staffTenantId: undefined }, "2026-11"),
      /Forbidden/,
    );
    assert.equal(
      (await sync.approve(tenant, who, "105", existingProject)).changed,
      true,
    );
    assert.equal(
      (await sync.approve(tenant, who, "105", existingProject)).changed,
      false,
    );
    assert.equal(
      (await sync.status(tenant, who, "2026-11", existingProject))
        .lifetimeRecordedSeconds,
      122,
    );
    assert.deepEqual((await source.get()).data(), imported);
    await root
      .collection("projects")
      .doc(m.scopeProjectId)
      .update({ internalNotes: "Morris owned" });
    const anchor = (
      await root.collection("projects").doc(m.scopeProjectId).get()
    ).data();
    now = Date.parse("2026-11-07T12:00:00Z");
    jobs = [
      ...originalJobs
        .filter((row) => row.id !== 102)
        .map((row) =>
          row.id === 105 ? { ...row, name: "Renamed HR review" } : row,
        ),
      { id: 104, parent_id: 71, name: "Future work order", active: true },
    ];
    mode = "outside";
    assert.equal((await sync.daily(tenant)).failed, 1);
    assert.equal((await map("104").get()).exists, false);
    mode = "provider-failure";
    const previous = (await checkpoint("103").get()).data()!.through;
    const partially = await sync.daily(tenant);
    assert.equal(partially.failed, 1);
    assert.equal(partially.registered, 1);
    assert.equal((await checkpoint("103").get()).data()!.through, previous);
    assert.equal(
      (await sync.status(tenant, who, "2026-11")).dailyState,
      "failed",
    );
    const tombstone = root
      .collection("rawTime")
      .doc(sourceRecordId("quickbooks-time", account, "701"));
    assert.equal((await tombstone.get()).data()!.deleted, true);
    assert.equal((await tombstone.collection("versions").get()).size, 2);
    assert.equal((await map("102").get()).data()!.sourceJob.missing, true);
    assert.equal(
      (await map("105").get()).data()!.sourceJob.name,
      "Renamed HR review",
    );
    mode = "recovered";
    assert.deepEqual(await sync.daily(tenant), {
      skipped: false,
      changed: 0,
      registered: 0,
      failed: 0,
    });
    assert.deepEqual(
      (await root.collection("projects").doc(m.scopeProjectId).get()).data(),
      anchor,
    );
    assert.equal(
      (await sync.status(tenant, who, "2026-11")).recordedSeconds,
      244,
    );
    assert.equal(
      (await sync.status(tenant, who, "2026-11")).lifetimeRecordedSeconds,
      244,
    );
    assert.equal((await root.collection("projects").get()).size, 7);
    const deliveryId = "synthetic-delivery";
    const deliveryProject = root.collection("projects").doc(deliveryId);
    await deliveryProject.update({ delivery: {
      kind: "project", structure: 3, type: "hourly", parentId: existingProject, areaId: "hr", managerIds: [], teamIds: [],
    } });
    const pending = (await sync.status(tenant, who, "2026-11")).mappings.find(entry => entry.jobcodeId === "104")!;
    const deliveryReview = {
      targetKind: "project" as const, previousProjectId: pending.projectId,
      recordedSeconds: pending.lifetimeRecordedSeconds!, allocatedSeconds: pending.lifetimeAllocatedSeconds!,
      parentId: existingProject, areaId: "hr",
    };
    await assert.rejects(sync.confirmMapping(tenant, who, "104", deliveryId, { ...deliveryReview, areaId: "training" }), /Time mapping conflict/);
    const historicalId = sourceRecordId("quickbooks-time", account, "704");
    const rawRef = root.collection("rawTime").doc(historicalId);
    const rawBefore = (await rawRef.get()).data()!;
    const checkpointBefore = (await checkpoint("104").get()).data();
    const mapped = await sync.confirmMapping(tenant, who, "104", deliveryId, deliveryReview);
    assert.equal(mapped.changed, true);
    assert.equal(mapped.historical?.classified, 1);
    const classification = (await root.collection("automaticTimeAllocations").doc(historicalId).get()).data()!;
    assert.equal(classification.seconds, 61);
    assert.equal(classification.projectId, deliveryId);
    assert.equal(classification.parentId, existingProject);
    assert.equal(classification.areaId, "hr");
    assert.equal(classification.sourceRevision, rawBefore.record.revision);
    assert.equal((await sync.applyHistoricalMapping(tenant, who, "104")).classified, 0);
    assert.deepEqual((await rawRef.get()).data(), rawBefore);
    assert.deepEqual((await checkpoint("104").get()).data(), checkpointBefore);
    assert.equal((await root.collection("allocationHeads").doc(historicalId).get()).exists, false);
    assert.equal((await root.collection("projectViews").doc(deliveryId).get()).get("lifetimeSeconds"), 0);
    await assert.rejects(sync.confirmMapping(tenant, who, "104", existingProject, { ...deliveryReview, targetKind: "engagement" }), /Time mapping conflict/);
    assert.equal((await map("104").get()).get("scopeProjectId"), pending.projectId);
    assert.equal((await sync.status(tenant, who, "2026-11")).recordedSeconds, 244);
    const audits = await root.collection("audits").get();
    assert.equal(
      audits.docs.filter(
        (doc) => doc.data().action === "time-work-order-discovered",
      ).length,
      5,
    );
    assert.equal(
      audits.docs.filter(
        (doc) => doc.data().action === "time-work-order-linked",
      ).length,
      1,
    );
  } finally {
    await runtime.close();
  }
});
