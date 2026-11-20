import assert from "node:assert/strict";
import test from "node:test";
import { sourceRecordId } from "../server/contracts";
import { firebaseRuntime } from "../server/firebase";
import { key } from "../server/firestore-store";
import { ProjectStore } from "../server/project-workspace";
import { timeMapping, timeRun } from "../server/time-catalog";
import { TimeClient, type TimeRow } from "../server/time-client";
import { readTimeDetails, timeDetailsRef } from "../server/time-details";
import { timeSourceRevision } from "../server/time-enrichment";
import { TimeSync } from "../server/time-sync";

test("Time detail enrichment preserves the named database ledger, even for corrected, moved and deleted entries", async () => {
  const runtime = firebaseRuntime("emulator", "demo-mi-security", "mi-client-staging");
  const tenant = "synthetic-time-enrichment";
  const root = runtime.db.doc("tenants/" + tenant);
  const account = "9944";
  const parent = "71";
  const catalog = key("quickbooks-time-customer", account, parent);
  const month = "2026-11";
  const date = month + "-12";
  const importedAt = month + "-13T18:00:00.000Z";
  const checkedAt = month + "-20T18:00:00.000Z";
  const project = "regular-consulting";
  const originalJob = "101";
  const amendedJob = "102";
  const ids = ["501", "502", "503", "504", "505", "506"];
  const source = (id: string) => root.collection("rawTime").doc(sourceRecordId("quickbooks-time", account, id));
  const baseline = new Map(ids.map(id => {
    const row: TimeRow = { id, jobcodeId: id === "506" ? "999" : originalJob, date, seconds: 3600, modifiedAt: importedAt, deleted: id === "503" };
    const document = {
      schemaVersion: 2, source: "quickbooks-time", sourceCompanyId: account, externalId: id, scopeProjectId: project,
      modifiedAt: row.modifiedAt, deleted: row.deleted, approval: "unknown",
      record: {
        id: source(id).id, tenantId: tenant, sourceWorkOrderId: row.jobcodeId, sourcePersonId: "",
        date, seconds: row.seconds, description: "QuickBooks Time", revision: timeSourceRevision(row),
      },
    };
    return [id, document];
  }));
  const historicalVersion = (id: string) => source(id).collection("versions").doc(baseline.get(id)!.record.revision);
  const details = (id: string) => timeDetailsRef(source(id), baseline.get(id)!.record.revision);
  const moment = Date.parse(checkedAt);
  let replaceOnRead = false;
  let verifiedAccount = true;
  const requested: string[][] = [];
  const provider = new TimeClient(async () => "fixture", async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.method, "GET");
    const reply = (collection: string, rows: object, supplemental_data?: object) =>
      Response.json({ results: { [collection]: rows }, more: false, supplemental_data });
    if (url.pathname.endsWith("/current_user"))
      return reply("users", { 7: { id: 7, active: true, client_url: "fixture-company", company_id: verifiedAccount ? 9944 : 9911 } });
    if (url.pathname.endsWith("/jobcodes")) {
      if (url.searchParams.get("ids") === parent)
        return reply("jobcodes", { 71: { id: 71, parent_id: 0, name: "Zagimē Anishinabēk Nation", active: true, type: "regular" } });
      const jobs: Record<string, object> = {
        71: { 101: { id: 101, parent_id: 71, name: "WO1267", active: true, type: "regular" } },
        101: { 102: { id: 102, parent_id: 101, name: "WO1267.1", active: true, type: "regular" } },
        102: {},
      };
      const parents = url.searchParams.get("parent_ids")!.split(",");
      return reply("jobcodes", Object.assign({}, ...parents.map(id => jobs[id])));
    }
    assert.equal(url.pathname, "/api/v1/timesheets");
    assert.equal(url.searchParams.get("jobcode_ids"), originalJob);
    assert.equal(url.searchParams.get("supplemental_data"), "yes");
    const queriedIds = url.searchParams.get("ids")!.split(",").sort();
    requested.push(queriedIds);
    assert.deepEqual(queriedIds, ["501", "502", "504", "505"]);
    if (replaceOnRead) await source("501").update({ deleted: true });
    const timesheet = {
      id: 501, jobcode_id: 101, date, duration: 3600, last_modified: importedAt,
      type: "manual", notes: "Original private provider note", user_id: 11, created_by_user_id: 12,
    };
    return reply("timesheets", {
      501: timesheet,
      502: { ...timesheet, id: 502, duration: 3900, last_modified: checkedAt },
      504: { ...timesheet, id: 504, jobcode_id: 102, last_modified: checkedAt },
    }, { users: { 11: { id: 11, display_name: "Avery Fixture", email: "private@example.test" } } });
  }, async () => {});
  const sync = new TimeSync(new ProjectStore(runtime.db), {
    tenant, account, customerParentId: parent, admin: "fixture-admin", userId: "7",
    clientUrl: "fixture-company", from: "2026-10-01",
  }, provider, () => moment);
  try {
    await runtime.verify();
    const batch = runtime.db.batch();
    const protectedDocs = new Map([
      [root, { schemaVersion: 2, revision: 12 }],
      [timeRun(root, catalog), { customerBound: true, lastSuccess: importedAt, expires: 0 }],
      [timeMapping(root, account, originalJob), {
        account, jobcodeId: originalJob, projectId: project, scopeProjectId: project, catalog,
        sourceJob: { id: originalJob, missing: false, name: "WO1267", parentId: parent, active: true },
      }],
      [root.collection("syncCheckpoints").doc(key("quickbooks-time", account, originalJob)), { through: importedAt }],
      [root.collection("allocationHeads").doc(source("501").id), {
        revision: 2, sourceRevision: baseline.get("501")!.record.revision, portions: [{ projectId: project, seconds: 1591 }],
      }],
      [root.collection("allocationRevisions").doc("history"), { sourceId: source("501").id, seconds: 1591, revision: 2 }],
      [root.collection("timeMonthlyTotals").doc(month), { recorded: 10800, allocated: 1591 }],
    ] as const);
    for (const [ref, value] of protectedDocs) batch.set(ref, value);
    for (const [id, value] of baseline) {
      batch.set(source(id), value);
      batch.set(historicalVersion(id), value);
    }
    await batch.commit();
    const inventory = await sync.inventoryDetails(tenant);
    assert.deepEqual(inventory, { scanned: 6, outsideAccount: 0, months: [{ month, recordedSeconds: 18000, active: 5,
      deleted: 1, outsideCurrentMapping: 1, missingCurrentDetails: 4, missingConsultantId: 4,
      missingConsultantName: 4, missingOriginalNotes: 4 }] });
    assert.deepEqual(requested, []);
    await assert.rejects(sync.inventoryDetails(tenant, "invalid"), /Invalid Time details cursor/);

    const dryRun = await sync.enrichDetails(tenant, { month });
    assert.deepEqual(dryRun, { month, applied: false, scanned: 6, deleted: 1, outsideScope: 1, eligible: 4, unchanged: 0, unavailable: 1, notCurrent: 2, conflicts: 0, wouldWrite: 1, written: 0 });
    assert.equal((await details("501").get()).exists, false);
    const apply = await sync.enrichDetails(tenant, { month, apply: true });
    assert.equal(apply.written, 1);
    const saved = (await details("501").get()).data();
    assert.deepEqual(readTimeDetails(saved, baseline.get("501")!.record.revision, importedAt), {
      personId: "11", consultantName: "Avery Fixture", notes: "Original private provider note",
    });
    assert.equal(saved?.observedAt, checkedAt);
    assert.equal(saved?.retrievedVia, "exact-id-lookup");
    assert.equal(saved?.email, undefined);
    const afterInventory = (await sync.inventoryDetails(tenant)).months[0];
    assert.equal(afterInventory.recordedSeconds, inventory.months[0].recordedSeconds);
    assert.equal(afterInventory.missingCurrentDetails, inventory.months[0].missingCurrentDetails - 1);
    assert.equal(afterInventory.missingConsultantName, inventory.months[0].missingConsultantName - 1);
    const after = await sync.enrichDetails(tenant, { month, apply: true });
    assert.equal(after.unchanged, 1);
    assert.equal(after.written, 0);
    for (const [ref, value] of protectedDocs) assert.deepEqual((await ref.get()).data(), value);
    for (const [id, value] of baseline) {
      assert.deepEqual((await source(id).get()).data(), value);
      assert.deepEqual((await historicalVersion(id).get()).data(), value);
      if (id !== "501") assert.equal((await details(id).get()).exists, false);
    }

    await details("501").delete();
    replaceOnRead = true;
    const race = await sync.enrichDetails(tenant, { month, apply: true });
    assert.equal(race.notCurrent, 3);
    assert.equal(race.written, 0);
    assert.equal((await details("501").get()).exists, false);
    assert.equal(requested.length, 4);
    verifiedAccount = false;
    await assert.rejects(sync.enrichDetails(tenant, { month, apply: true }), /account mismatch/i);
    assert.equal(requested.length, 4);
  } finally {
    await runtime.close();
  }
});
