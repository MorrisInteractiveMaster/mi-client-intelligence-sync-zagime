import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectReport } from "../projects/model";
import { allAuthorizedRows, csvFilename, csvText, publishedProjectCsv, sourceCsv } from "./report-csv";
import type { SourceSummary, StaffSource } from "./types";

const source = (id: string): StaffSource => ({
  id, date: "2026-10-11", seconds: 2700, description: 'Review,"scope"\nMeeting',
  sourceWorkOrderId: "132160684", workOrderName: "Regular Consulting",
  sourcePersonId: "71", consultantName: "Áine LeBlanc", sourceRevision: "revision-1", allocationRevision: 0,
  portions: [], unallocatedSeconds: 2700, conflict: false,
  originalNotesState: "populated", annotations: { reportingDescription: "=PRIVATE", internalNote: "Never include internal note" },
});

test("CSV preserves Unicode, ISO dates, decimal hours and multiline text, and neutralizes formulas", () => {
  const csv = csvText(sourceCsv([source("source-1")]));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"2026-10-11","Regular Consulting","132160684","source-1","Áine LeBlanc","71",0\.75,0\.75/);
  assert.match(csv, /"'=PRIVATE","Review,""scope""\nMeeting"\r\n/);
  assert.doesNotMatch(csv, /Never include|revision-1/);
  assert.match(csvText({ headers: ["value"], rows: [[" \t@SUM(1,2)"], ["\u0000+1"], [-1]] }), /"' \t@SUM\(1,2\)"\r\n"'\u0000\+1"\r\n-1/);
  assert.throws(() => csvText({ headers: ["value"], rows: [[NaN]] }), /invalid numeric/);
  assert.throws(() => csvText({ headers: ["value"], rows: [[1, 2]] }), /columns/);
  assert.equal(csvFilename("Morris Zagimē, 2026-10"), "Morris_Zagime_2026-10.csv");
});

test("export follows every authorized page using the exact filters", async () => {
  const urls: URLSearchParams[] = [];
  const filter = new URLSearchParams({ month: "2026-10", consultant: "71", workOrder: "132160684", cursor: "old", limit: "4" });
  const controller = new AbortController();
  const rows = await allAuthorizedRows("sources", filter, controller.signal, async (url, signal) => {
    assert.equal(signal, controller.signal);
    urls.push(new URL(url, "https://fixture.example").searchParams);
    const sourceSummary = { matched: 2 } as SourceSummary;
    return urls.length === 1 ? { revision: 1, sourceSummary, sources: [source("first")], nextCursor: "page-2" }
      : { revision: 1, sourceSummary, sources: [source("second")] };
  });
  assert.deepEqual(rows.map(row => row.id), ["first", "second"]);
  assert.equal(urls[0].get("cursor"), null);
  assert.equal(urls[1].get("cursor"), "page-2");
  for (const params of urls) {
    assert.equal(params.get("consultant"), "71");
    assert.equal(params.get("workOrder"), "132160684");
    assert.equal(params.get("month"), "2026-10");
    assert.equal(params.get("download"), "csv");
    assert.equal(params.get("limit"), "500");
  }
});

test("export rejects incomplete pages, repeated records and stale revisions", async () => {
  const signal = new AbortController().signal;
  const sourceSummary = { matched: 2 } as SourceSummary;
  const query = new URLSearchParams();
  await assert.rejects(allAuthorizedRows("sources", query, signal, async () => ({
    revision: 1, sourceSummary, sources: [source("one")],
  })), /incomplete/);
  let calls = 0;
  await assert.rejects(allAuthorizedRows("sources", query, signal, async () => ({
    revision: 1, sourceSummary, sources: [source("duplicate")], nextCursor: ++calls === 1 ? "two" : undefined,
  })), /repeated/);
  calls = 0;
  await assert.rejects(allAuthorizedRows("sources", query, signal, async () => ({
    revision: ++calls, sourceSummary, sources: [source(String(calls))], nextCursor: calls === 1 ? "two" : undefined,
  })), /report changed/);
});

test("approved project CSV uses an allowlist and the latest approved projections", () => {
  const project = {
    id: "internal-source-key", name: "Approved delivery", schemaVersion: 2, status: "active", progress: 58,
    description: "", seconds: 4500, lifetimeSeconds: 9900, plan: { basis: "monthly", targetSeconds: 7200 },
    internalNotes: "PRIVATE NOTE",
  } satisfies ProjectReport["projects"][number] & { internalNotes: string };
  const report: ProjectReport = { month: "2026-10", tenant: { id: "synthetic", name: "Zagimē" }, totalSeconds: 4500, projects: [project] };
  const csv = csvText(publishedProjectCsv(report, [{ ...project, name: "Unapproved edit" }, { ...project, id: "unknown", name: "Unpublished project" }]));
  assert.match(csv, /"2026-10","Approved delivery"/);
  assert.match(csv, /"In progress",58,1\.25,2\.75/);
  assert.doesNotMatch(csv, /PRIVATE|internal-source-key|Unapproved edit|Unpublished project/);
});

test("approved CSV shows opted-in schedule status without exporting private dates", () => {
  const project: ProjectReport["projects"][number] = {
    id: "scheduled", name: "Approved delivery", schemaVersion: 2, status: "planned", progress: 0,
    description: "", seconds: 0, lifetimeSeconds: 0, plan: { basis: "fixed", targetSeconds: 0 },
  };
  const report: ProjectReport = {
    month: "2026-11", tenant: { id: "synthetic", name: "Fixture" }, totalSeconds: 0, projects: [project],
  };
  assert.equal(publishedProjectCsv(report, [project]).rows[0][4], "Planned");
  for (const [schedulePhase, status] of [["upcoming", "Upcoming"], ["current", "In progress"]] as const) {
    const [row] = publishedProjectCsv({ ...report, hierarchy: { scheduled: { schedulePhase } } }, [project]).rows;
    assert.equal(row[4], status);
    assert.deepEqual(row.slice(8), Array(6).fill(undefined));
  }
});

test("a search can span empty scanned project pages without dropping later matches", async () => {
  const fixture = { id: "matching", name: "Matching project" } as NonNullable<import("../projects/model").ProjectPage["projects"]>[number];
  let calls = 0;
  const rows = await allAuthorizedRows("projects", new URLSearchParams({ month: "2026-10", search: "matching" }),
    new AbortController().signal, async url => {
      const params = new URL(url, "https://fixture.example").searchParams;
      assert.equal(params.get("search"), "matching");
      assert.equal(params.get("download"), null);
      return ++calls === 1 ? { revision: 1, projects: [], nextCursor: "later" } : { revision: 1, projects: [fixture] };
    });
  assert.deepEqual(rows, [fixture]);
});
