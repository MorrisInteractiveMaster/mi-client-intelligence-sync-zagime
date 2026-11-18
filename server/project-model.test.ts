import test from "node:test";
import assert from "node:assert/strict";
import {
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
  assert.equal(managedProject({ ...managed, workOrderReference: " Synthetic reference " }).workOrderReference, "Synthetic reference");
  assert.ok(!("workOrderReference" in managedProject({ ...managed, workOrderReference: " " })));
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
});
