import test from "node:test";
import assert from "node:assert/strict";
import {
  approvedProjectContent,
  managedProject,
  projectView,
  publicProject,
} from "../src/projects/model";
import { hoursToSeconds } from "../src/projects/duration";
import { ProjectStore } from "./project-workspace";
import { spawnSync } from "node:child_process";
const managed = {
  name: "Example",
  status: "planned",
  progress: 0,
  description: "Published description",
  internalNotes: "private",
  plan: { basis: "fixed", targetSeconds: 3600 },
};
test("project-only validation has no hierarchy and refuses source/publication/role injection", () => {
  assert.equal(managedProject(managed).name, "Example");
  assert.equal(
    managedProject({ ...managed, workOrderReference: " Synthetic reference " })
      .workOrderReference,
    "Synthetic reference",
  );
  assert.ok(
    !(
      "workOrderReference" in
      managedProject({ ...managed, workOrderReference: " " })
    ),
  );
  for (const injected of [
    { agreementId: "x" },
    { departmentId: "x" },
    { source: {} },
    { published: true },
    { role: "administrator" },
  ])
    assert.throws(() => managedProject({ ...managed, ...injected }));
  for (const n of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER])
    assert.throws(() =>
      managedProject({
        ...managed,
        plan: { basis: "fixed", targetSeconds: n },
      }),
    );
});
test("client projection is an explicit allowlist including nested plans", () => {
  const view = projectView(
    {
      ...managed,
      schemaVersion: 2,
      id: "p",
      published: true,
      source: { secret: "no" },
      tenantId: "no",
      plan: { ...managed.plan, internalNotes: "nested-private" },
    } as any,
    3600,
  );
  const p = publicProject(
    { ...view, internalNotes: "no", source: { secret: "no" } } as any,
    60,
  );
  assert.equal(p.seconds, 60);
  assert.equal(p.lifetimeSeconds, 3600);
  assert.ok(!JSON.stringify(p).includes("private"));
  assert.ok(!("source" in p));
  assert.ok(!("published" in p));
});
test("decimal-hour conversion preserves integer seconds and rejects silent rounding", () => {
  assert.equal(hoursToSeconds("0.07"), 252);
  assert.equal(hoursToSeconds("1.25"), 4500);
  assert.equal(hoursToSeconds("0"), 0);
  for (const v of [
    "-1",
    "0.0001",
    "Infinity",
    "1e5",
    "100000000000",
    "1.000000001",
  ])
    assert.throws(() => hoursToSeconds(v));
});
test("project store cannot be constructed against default or an unverified named SDK", () => {
  assert.throws(
    () => new ProjectStore({ databaseId: "(default)" } as any),
    /named staging/,
  );
  assert.throws(
    () => new ProjectStore({ databaseId: "mi-client-staging" } as any),
    /Verified staging/,
  );
});
test("executable refuses production and unnamed emulator startup before database initialization", () => {
  for (const mode of ["production", "emulator"]) {
    const env: NodeJS.ProcessEnv = { ...process.env, BACKEND_MODE: mode };
    delete env.FIRESTORE_DATABASE_ID;
    delete env.STAGING_PREVIEW_ONLY;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "server/start.ts"],
      { env, encoding: "utf8", timeout: 10000 },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      mode === "production"
        ? /production access is blocked/
        : /Explicit named project-workspace database required/,
    );
  }
  for (const [project, uid] of [
    ["unapproved-project", "6d09ea71-f495-44a5-94a6-732ed1c47d88"],
    ["morris-client-dash-zagime", "00000000-0000-4000-8000-000000000000"],
  ]) {
    const env = {
      ...process.env,
      BACKEND_MODE: "staging",
      STAGING_PREVIEW_ONLY: "false",
      FIRESTORE_DATABASE_ID: "mi-client-staging",
      STAGING_FIREBASE_PROJECT_ID: project,
      STAGING_DATABASE_UID: uid,
    };
    for (const args of [
      ["server/start.ts"],
      ["server/operator.ts", "seed-project-synthetic", "synthetic-guard"],
    ]) {
      const result = spawnSync(process.execPath, ["--import", "tsx", ...args], {
        env,
        encoding: "utf8",
        timeout: 10000,
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Explicit company staging identity required/);
    }
  }
});

test("bounded project updates and milestones use explicit visibility and nested allowlists", () => {
  const one = { id: "u1", title: "Synthetic update", body: "Public text", date: "2026-11-19", visible: true };
  const two = { id: "m1", title: "Synthetic milestone", date: "2026-12-01", visible: true, completed: false };
  const normalized = managedProject({ ...managed, updates: [one, { ...one, id: "u2", body: "private draft", visible: false }], milestones: [two] });
  for (const updates of [
    [one, one],
    [{ ...one, visible: "true" }],
    [{ ...one, date: "2026-11-31" }],
    [{ ...one, privateNote: "injected" }],
    Array.from({ length: 9 }, (_, n) => ({ ...one, id: String(n) })),
  ])
    assert.throws(() => managedProject({ ...managed, updates }), /Invalid project timeline/);

  const p = { ...normalized, schemaVersion: 2, tenantId: "tenant", id: "project", published: true } as const;
  const content = approvedProjectContent({ ...p, source: null, createdAt: "", updatedAt: "", createdBy: "", updatedBy: "" });
  const report = publicProject({
    ...projectView(p, 0),
    ...content,
    updates: [
      { ...content.updates[0], internal: "private extra field" },
      { ...one, id: "unexpected", visible: false, body: "private draft" },
    ] as unknown as typeof content.updates,
  }, 0);
  assert.deepEqual(report.updates, [{ id: "u1", title: "Synthetic update", date: "2026-11-19", body: "Public text" }]);
  assert.deepEqual(report.milestones, [{ id: "m1", title: "Synthetic milestone", date: "2026-12-01", completed: false }]);
  assert.ok(!JSON.stringify(report).includes("private"));
});
