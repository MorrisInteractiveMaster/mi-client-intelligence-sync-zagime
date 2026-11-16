import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
