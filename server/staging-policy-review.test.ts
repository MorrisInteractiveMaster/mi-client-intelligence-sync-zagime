import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const {
  assess,
  classifyFailure,
  DATA,
  AUTH,
  CONDITION,
} = require("../scripts/staging-iam-review.cjs");
const member =
  "serviceAccount:mi-client-staging-api@morris-client-dash-zagime.iam.gserviceaccount.com";
function fixture(): any {
  return {
    projectId: "morris-client-dash-zagime",
    project: { projectNumber: "1000", parent: { type: "folder", id: "2000" } },
    ancestors: [
      { type: "project", id: "1000" },
      { type: "folder", id: "2000" },
      { type: "organization", id: "3000" },
    ],
    policies: [
      {
        type: "project",
        id: "1000",
        policy: {
          version: 3,
          bindings: [
            {
              role: "projects/morris-client-dash-zagime/roles/stagingData",
              members: [member],
              condition: { expression: CONDITION },
            },
            {
              role: "projects/morris-client-dash-zagime/roles/authRead",
              members: [member],
            },
          ],
        },
      },
      { type: "folder", id: "2000", policy: { bindings: [] } },
      { type: "organization", id: "3000", policy: { bindings: [] } },
    ],
    serviceAccount: { email: member.slice(15), disabled: false },
    serviceAccountPolicy: { bindings: [] },
    roles: {
      "projects/morris-client-dash-zagime/roles/stagingData": {
        name: "projects/morris-client-dash-zagime/roles/stagingData",
        includedPermissions: [...DATA],
      },
      "projects/morris-client-dash-zagime/roles/authRead": {
        name: "projects/morris-client-dash-zagime/roles/authRead",
        includedPermissions: [AUTH],
      },
    },
    failures: [],
  };
}
function liveFixture(): any {
  const f = fixture();
  f.project = { projectId: "morris-client-dash-zagime" };
  f.ancestors = [{ type: "project", id: "morris-client-dash-zagime" }];
  f.policies = [f.policies[0]];
  f.policies[0].id = "morris-client-dash-zagime";
  const data = "projects/morris-client-dash-zagime/roles/miClientStagingData";
  const auth = "projects/morris-client-dash-zagime/roles/miClientStagingAuthRead";
  f.policies[0].policy.bindings[0].role = data;
  f.policies[0].policy.bindings[0].condition.expression =
    'resource.name=="projects/morris-client-dash-zagime/databases/mi-client-staging"';
  f.policies[0].policy.bindings[1].role = auth;
  f.roles = {
    [data]: { name: data, includedPermissions: [
      "datastore.databases.get", "datastore.databases.getMetadata",
      "datastore.entities.create", "datastore.entities.get",
      "datastore.entities.list", "datastore.entities.update",
    ] },
    [auth]: { name: auth, includedPermissions: ["firebaseauth.users.get"] },
  };
  f.serviceAccountPolicy = { bindings: [] };
  return f;
}
test("exact owner live project-ID-only ancestry and IAM values match the review-required profile", () => {
  const r = assess(liveFixture());
  assert.equal(r.status, "PROFILE_MATCH_REQUIRES_REVIEW");
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.violations, []);
  assert.equal(r.activationAuthorized, false);
});
test("project ID and verified numeric ancestry retain all inherited policy requirements", () => {
  for (const id of ["morris-client-dash-zagime", "1000", 1000]) {
    const f = fixture();
    f.project.projectId = "morris-client-dash-zagime";
    f.ancestors[0].id = id;
    f.policies[0].id = String(id);
    assert.equal(assess(f).status, "PROFILE_MATCH_REQUIRES_REVIEW");
    for (const ancestorIndex of [1, 2]) {
      const missing = structuredClone(f);
      missing.policies.splice(ancestorIndex, 1);
      const r = assess(missing);
      assert.equal(r.status, "INCONCLUSIVE");
      assert.ok(r.findings.some((x: any) => x.code === "MISSING_POLICY"));
      assert.equal(r.activationAuthorized, false);
      const broad = structuredClone(f);
      broad.policies[ancestorIndex].policy.bindings.push({
        role: "projects/morris-client-dash-zagime/roles/stagingData", members: [member],
      });
      const inherited = assess(broad);
      assert.equal(inherited.status, "VIOLATION");
      assert.equal(inherited.activationAuthorized, false);
    }
  }
});
test("foreign, malformed, unsupported, incomplete and duplicate ancestry never silently matches", () => {
  for (const mutate of [
    (f: any) => { f.ancestors[0].id = "other-project"; },
    (f: any) => { f.ancestors[0].id = "9999"; },
    (f: any) => { f.ancestors[0].id = "1000"; }, // No metadata number to verify.
    (f: any) => { f.ancestors.push({ type: "billingAccount", id: "2000" }); },
    (f: any) => { f.ancestors.push({ type: "folder", id: "not-numeric" }); },
    (f: any) => { f.ancestors.push({ type: "folder", id: "../2000" }); },
    (f: any) => { f.ancestors.push(null); },
    (f: any) => { f.ancestors.push(f.ancestors[0]); },
    (f: any) => { f.project.parent = { type: "folder", id: "2000" }; },
    (f: any) => { f.project.projectId = "other-project"; },
    (f: any) => { f.project = {}; },
  ]) {
    const f = liveFixture(); mutate(f);
    const r = assess(f);
    assert.equal(r.status, "INCONCLUSIVE");
    assert.ok(r.findings.some((x: any) => x.code === "MISSING_ANCESTRY"));
    assert.equal(r.activationAuthorized, false);
  }
});
test("ancestry CLI emits exact project-ID and numeric rows, and no partial output for unsupported ancestors", () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-policy-test-"));
  try {
    for (const f of [liveFixture(), fixture()]) {
      writeFileSync(join(dir, "project.json"), JSON.stringify(f.project));
      writeFileSync(join(dir, "ancestors.json"), JSON.stringify(f.ancestors));
      const run = () => spawnSync(process.execPath,
        ["scripts/staging-iam-review.cjs", "--ancestors", dir], { encoding: "utf8" });
      const r = run();
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, f.ancestors.map((a: any) => `${a.type} ${a.id}\n`).join(""));
      f.ancestors.push({ type: "unsupported", id: "3000" });
      writeFileSync(join(dir, "ancestors.json"), JSON.stringify(f.ancestors));
      const invalid = run();
      assert.notEqual(invalid.status, 0);
      assert.equal(invalid.stdout, "");
      assert.match(invalid.stderr, /INCONCLUSIVE/);
    }
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("mi-policy-test-"));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("complete direct policy declarations never become operational IAM proof or an activation grant", () => {
  const r = assess(fixture());
  assert.equal(r.status, "PROFILE_MATCH_REQUIRES_REVIEW");
  assert.equal(r.activationAuthorized, false);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.violations, []);
  assert.ok(!JSON.stringify(r).includes("NOT_GRANTED")); // No fake effective-permission matrix.
});
test("owner's exact live condition and supported whitespace/quotes match only the review-required profile", () => {
  for (const expression of [
    'resource.name=="projects/morris-client-dash-zagime/databases/mi-client-staging"',
    CONDITION,
    "resource.name=='projects/morris-client-dash-zagime/databases/mi-client-staging'",
    " \tresource.name\t==\n'projects/morris-client-dash-zagime/databases/mi-client-staging'\r\n",
    'resource.name =="projects/morris-client-dash-zagime/databases/mi-client-staging"',
    'resource.name== "projects/morris-client-dash-zagime/databases/mi-client-staging"',
  ]) {
    const f = fixture();
    f.policies[0].policy.bindings[0].condition.expression = expression;
    const r = assess(f);
    assert.equal(r.status, "PROFILE_MATCH_REQUIRES_REVIEW", expression);
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.violations, []);
    assert.equal(r.activationAuthorized, false);
    assert.match(r.stagingCreateUpdate, /policy declarations only/);
  }
});
test("condition whitespace support cannot accept broader, compound, alternate or unsafe expressions", () => {
  const path = "projects/morris-client-dash-zagime/databases/mi-client-staging";
  for (const expression of [
    CONDITION + " || true", CONDITION + " && true", "true || " + CONDITION,
    "(" + CONDITION + ")", "!" + CONDITION,
    `resource.name.startsWith("${path}")`,
    `resource.name=="${path}/documents"`,
    `resource.name=="${path}-other"`,
    'resource.name=="projects/morris-client-dash-zagime/databases/(default)"',
    'resource.name=="projects/other-project/databases/mi-client-staging"',
    `resource.name=="${path} "`, `resource.name==" ${path}"`,
    `resource.name=="${path}'`, `resource.name=="${path}""`,
    `resource.name==r"${path}"`, `resource.name=="""${path}"""`,
    `resource.name=="${path.replace("staging", "\\u0073taging")}"`,
    `resource.name=="${path}" // comment`, `resource.name=="${path}"; true`,
    `resource.name= ="${path}"`, `resource.name==="${path}"`,
    `resource . name=="${path}"`, "", null, 42,
  ]) {
    const f = fixture();
    f.policies[0].policy.bindings[0].condition.expression = expression;
    const r = assess(f);
    assert.equal(r.status, "INCONCLUSIVE", String(expression));
    assert.ok(r.findings.some((x: any) => x.code === "UNSUPPORTED_CONDITION"));
    assert.equal(r.activationAuthorized, false);
  }
  const f = fixture();
  f.policies[0].policy.bindings[0].condition.expression = `resource.name=="${path}"`;
  f.roles["projects/morris-client-dash-zagime/roles/stagingData"].includedPermissions.push("datastore.entities.delete");
  const r = assess(f);
  assert.equal(r.status, "VIOLATION");
  assert.equal(r.activationAuthorized, false);
});
test("owner-observed INVALID_ARGUMENT/INVALID_RESOURCE_NAME and unsupported APIs are inconclusive, never denial", () => {
  for (const [message, code] of [
    [
      "INVALID_ARGUMENT: INVALID_RESOURCE_NAME: //firestore.googleapis.com/projects/morris-client-dash-zagime/databases/mi-client-staging",
      "UNSUPPORTED_RESOURCE",
    ],
    ["API is not enabled: SERVICE_DISABLED", "UNSUPPORTED_API"],
    ["UNIMPLEMENTED: not supported", "UNSUPPORTED_API"],
    [
      "PERMISSION_DENIED: caller lacks getIamPolicy permission",
      "MISSING_VISIBILITY",
    ],
    ["UNKNOWN_INFO_DENIED", "INCONCLUSIVE"],
  ]) {
    assert.equal(classifyFailure(message), code);
    const f = fixture();
    f.failures.push({ command: "read-only inspection", message });
    const r = assess(f);
    assert.equal(r.status, "INCONCLUSIVE");
    assert.equal(r.activationAuthorized, false);
    assert.ok(r.findings.some((x: any) => x.code === code));
  }
});
test("missing ancestry, ancestor policy, role permissions, conditional policy version and required create/update are inconclusive", () => {
  for (const mutate of [
    (f: any) => {
      f.ancestors = [];
    },
    (f: any) => {
      f.policies.pop();
    },
    (f: any) => {
      delete f.roles["projects/morris-client-dash-zagime/roles/stagingData"];
    },
    (f: any) => {
      f.policies[0].policy.version = 1;
    },
    (f: any) => {
      f.roles[
        "projects/morris-client-dash-zagime/roles/stagingData"
      ].includedPermissions = DATA.filter(
        (p: string) =>
          p !== "datastore.entities.create" &&
          p !== "datastore.entities.update",
      );
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(assess(f).status, "INCONCLUSIVE");
  }
});
test("inherited broad Firestore access, deletion and Auth mutations are explicit profile violations", () => {
  const f = fixture();
  f.roles["roles/unexpected"] = {
    name: "roles/unexpected",
    includedPermissions: [
      "datastore.entities.create",
      "datastore.entities.update",
      "datastore.entities.delete",
      "firebaseauth.users.update",
      "iam.serviceAccounts.getAccessToken",
    ],
  };
  f.policies[2].policy.bindings.push({
    role: "roles/unexpected",
    members: [member],
  });
  const r = assess(f);
  assert.equal(r.status, "VIOLATION");
  assert.ok(r.violations.some((x: any) => x.code === "BROAD_DATA_GRANT"));
  assert.ok(
    r.violations.some((x: any) => x.permission === "firebaseauth.users.update"),
  );
  assert.equal(r.activationAuthorized, false);
});
test("groups, custom conditions, deleted roles and impersonation routes cannot be silently ignored", () => {
  for (const mutate of [
    (f: any) =>
      f.policies[1].policy.bindings.push({
        role: "projects/morris-client-dash-zagime/roles/stagingData",
        members: ["group:unresolved@example.com"],
        condition: { expression: CONDITION },
      }),
    (f: any) => {
      f.policies[0].policy.bindings[0].condition.expression =
        'resource.name.startsWith("projects/morris-client-dash-zagime")';
    },
    (f: any) => {
      f.roles["projects/morris-client-dash-zagime/roles/stagingData"].deleted =
        true;
    },
    (f: any) => {
      f.roles["roles/tokenCreator"] = {
        name: "roles/tokenCreator",
        includedPermissions: ["iam.serviceAccounts.getAccessToken"],
      };
      f.serviceAccountPolicy.bindings.push({
        role: "roles/tokenCreator",
        members: ["user:synthetic@example.com"],
      });
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.equal(assess(f).status, "INCONCLUSIVE");
  }
});
test("missing evidence files produce structured inconclusive output and nonzero exit", () => {
  const dir = mkdtempSync(join(tmpdir(), "mi-policy-test-"));
  try {
    const r = spawnSync(
      process.execPath,
      ["scripts/staging-iam-review.cjs", "--review", dir],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 2);
    assert.equal(JSON.parse(r.stdout).status, "INCONCLUSIVE");
    assert.equal(
      JSON.parse(readFileSync(join(dir, "review.json"), "utf8"))
        .activationAuthorized,
      false,
    );
  } finally {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(basename(dir).startsWith("mi-policy-test-"));
    rmSync(dir, { recursive: true, force: true });
  }
});
test("retired checker and replacement contain no active Troubleshooter call or database mutation command", () => {
  const ps = readFileSync("scripts/verify-staging-iam.ps1", "utf8");
  assert.ok(ps.includes("throw 'UNSUPPORTED / INCONCLUSIVE"));
  assert.ok(!/gcloud\s+policy-troubleshoot/.test(ps));
  const sh = readFileSync("scripts/verify-staging-iam.sh", "utf8");
  assert.ok(
    !/policy-troubleshoot|add-iam-policy-binding|set-iam-policy|firestore.*(?:write|delete)|run.*deploy/.test(
      sh,
    ),
  );
  assert.ok(sh.includes("get-iam-policy"));
  assert.ok(sh.includes("iam roles describe"));
});
