// Evidence triage, NOT a CEL evaluator or a Google authorization simulator.
const fs = require("node:fs");
const path = require("node:path");
const PROJECT = "morris-client-dash-zagime";
const PRINCIPAL =
  "serviceAccount:mi-client-staging-api@" +
  PROJECT +
  ".iam.gserviceaccount.com";
const DATA = [
  "datastore.databases.get",
  "datastore.databases.getMetadata",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.create",
  "datastore.entities.update",
];
const AUTH = "firebaseauth.users.get";
const CONDITION =
  'resource.name == "projects/' + PROJECT + '/databases/mi-client-staging"';
function isExactStagingCondition(expression) {
  if (typeof expression !== "string") return false;
  // Recognize only this complete equality grammar, never rewrite/evaluate CEL.
  // Whitespace is permitted between tokens, never inside the literal or identifier.
  const match = expression.match(
    /^[ \t\r\n]*resource\.name[ \t\r\n]*==[ \t\r\n]*(["'])([^"'\\\r\n]*)\1[ \t\r\n]*$/,
  );
  return !!match && match[2] === "projects/" + PROJECT + "/databases/mi-client-staging";
}
function classifyFailure(message = "") {
  if (/INVALID_RESOURCE_NAME|INVALID_ARGUMENT/i.test(message))
    return "UNSUPPORTED_RESOURCE";
  if (
    /SERVICE_DISABLED|API.+not.+enabled|UNIMPLEMENTED|not supported/i.test(
      message,
    )
  )
    return "UNSUPPORTED_API";
  if (/PERMISSION_DENIED|permission|forbidden|403/i.test(message))
    return "MISSING_VISIBILITY";
  return "INCONCLUSIVE";
}
function numericId(value) {
  return (typeof value === "string" && /^[1-9][0-9]*$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}
function validAncestor(a, project) {
  if (!a || typeof a !== "object") return false;
  if (a.type === "project")
    return a.id === PROJECT || (numericId(a.id) && numericId(project?.projectNumber) &&
      String(a.id) === String(project.projectNumber));
  return ["folder", "organization"].includes(a.type) && numericId(a.id);
}
function ancestryErrors(project, ancestors) {
  const errors = [];
  if (!project || (project.projectId !== undefined && project.projectId !== PROJECT) ||
      (project.projectId !== PROJECT && !numericId(project.projectNumber)))
    errors.push("Missing or mismatched project metadata");
  if (!Array.isArray(ancestors) || !ancestors.length)
    return [...errors, "Complete authoritative ancestry unavailable"];
  if (ancestors.some((a) => !validAncestor(a, project)))
    errors.push("Unsupported, malformed or mismatched ancestor");
  if (ancestors.filter((a) => a?.type === "project").length !== 1)
    errors.push("Exactly one configured project ancestor required");
  const keys = ancestors.map((a) => a?.type + "/" + a?.id);
  if (new Set(keys).size !== keys.length) errors.push("Duplicate ancestor");
  const parent = project?.parent;
  if (parent && (!validAncestor(parent, project) || parent.type === "project" ||
      !ancestors.some((a) => a?.type === parent.type && String(a.id) === String(parent.id))))
    errors.push("Known parent missing or unsupported");
  return errors;
}
function assess(snapshot) {
  const findings = [],
    violations = [];
  const data = new Set(),
    auth = new Set();
  const unknown = (code, detail) => findings.push({ code, detail });
  if (!snapshot || snapshot.projectId !== PROJECT)
    return {
      status: "INCONCLUSIVE",
      findings: [{ code: "WRONG_PROJECT" }],
      activationAuthorized: false,
    };
  for (const failure of snapshot.failures ?? [])
    unknown(classifyFailure(failure.message), failure.command);
  for (const error of ancestryErrors(snapshot.project, snapshot.ancestors))
    unknown("MISSING_ANCESTRY", error);
  const ancestors = Array.isArray(snapshot.ancestors) ? snapshot.ancestors : [];
  const policies = Array.isArray(snapshot.policies) ? snapshot.policies : [];
  if (!Array.isArray(snapshot.policies))
    unknown("MISSING_POLICY", "Policy list unavailable");
  for (const a of ancestors)
    if (
      !validAncestor(a, snapshot.project) ||
      !policies.some(
        (p) => p.type === a.type && String(p.id) === String(a.id) && p.policy,
      )
    )
      unknown("MISSING_POLICY", a?.type + "/" + a?.id);
  if (
    !snapshot.serviceAccountPolicy ||
    Array.isArray(snapshot.serviceAccountPolicy) ||
    snapshot.serviceAccountPolicy.error ||
    !Array.isArray(snapshot.serviceAccountPolicy.bindings ?? [])
  )
    unknown(
      "MISSING_SERVICE_ACCOUNT_POLICY",
      "Impersonation policy visibility required",
    );
  if (
    !snapshot.serviceAccount ||
    snapshot.serviceAccount.email !== PRINCIPAL.slice(15) ||
    snapshot.serviceAccount.disabled === true
  )
    unknown(
      "WRONG_SERVICE_ACCOUNT",
      "Existing enabled staging identity required",
    );
  for (const p of policies) {
    if (
      !p.policy ||
      Array.isArray(p.policy) ||
      p.policy.error ||
      !Array.isArray(p.policy.bindings ?? [])
    ) {
      unknown("MALFORMED_POLICY", p.type + "/" + p.id);
      continue;
    }
    for (const b of p.policy.bindings ?? []) {
      if (!Array.isArray(b.members) || typeof b.role !== "string") {
        unknown("MALFORMED_BINDING", p.type + "/" + p.id);
        continue;
      }
      const role = snapshot.roles?.[b.role];
      if (
        !role ||
        role.deleted ||
        role.stage === "DISABLED" ||
        !Array.isArray(role.includedPermissions) ||
        role.name !== b.role
      ) {
        unknown("MISSING_ROLE_DEFINITION", b.role);
        continue;
      }
      const direct = b.members.includes(PRINCIPAL),
        publicMember = b.members.some((m) =>
          ["allUsers", "allAuthenticatedUsers"].includes(m),
        );
      if (
        b.members.some(
          (m) =>
            !["allUsers", "allAuthenticatedUsers"].includes(m) &&
            !/^(user:|serviceAccount:|deleted:user:|deleted:serviceAccount:)/.test(
              m,
            ),
        )
      )
        unknown("UNRESOLVED_MEMBERSHIP", b.role + " at " + p.type + "/" + p.id);
      if (!direct && !publicMember) continue;
      if (
        b.role.includes("_withcond_") ||
        (b.condition && p.policy.version !== 3)
      ) {
        unknown("CONDITION_NOT_VISIBLE", b.role);
        continue;
      }
      const exact = isExactStagingCondition(b.condition?.expression);
      if (b.condition && !exact) {
        unknown("UNSUPPORTED_CONDITION", b.role);
        continue;
      }
      for (const permission of role.includedPermissions) {
        if (DATA.includes(permission)) {
          if (!exact || publicMember)
            violations.push({
              code: "BROAD_DATA_GRANT",
              permission,
              role: b.role,
              scope: p.type + "/" + p.id,
            });
          else data.add(permission);
        } else if (permission === AUTH && !b.condition && !publicMember)
          auth.add(permission);
        else
          violations.push({
            code: "UNINTENDED_PERMISSION",
            permission,
            role: b.role,
            scope: p.type + "/" + p.id,
          });
      }
    }
  }
  for (const permission of DATA)
    if (!data.has(permission))
      unknown("MISSING_REQUIRED_STAGING_PERMISSION", permission);
  if (!auth.has(AUTH)) unknown("MISSING_READ_ONLY_AUTH_PERMISSION", AUTH);
  for (const b of snapshot.serviceAccountPolicy?.bindings ?? []) {
    const role = snapshot.roles?.[b.role];
    if (!role || !Array.isArray(role.includedPermissions)) {
      unknown("MISSING_ROLE_DEFINITION", b.role);
      continue;
    }
    if (
      role.includedPermissions.some((p) =>
        /^iam\.serviceAccounts\.(getAccessToken|signBlob|signJwt|actAs|implicitDelegation)$/.test(
          p,
        ),
      )
    )
      unknown("IMPERSONATION_REVIEW_REQUIRED", b.role);
  }
  return {
    status: violations.length
      ? "VIOLATION"
      : findings.length
        ? "INCONCLUSIVE"
        : "PROFILE_MATCH_REQUIRES_REVIEW",
    principal: PRINCIPAL,
    findings,
    violations,
    stagingCreateUpdate:
      "policy declarations only; approved named runtime checks pending",
    defaultWriteDenial:
      "requires complete authorized inheritance/group/role/impersonation review; no default write test",
    activationAuthorized: false,
  };
}
function readSnapshot(dir) {
  const failures = [];
  const read = (file, command) => {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
      if (value?.error) {
        failures.push({ command, message: JSON.stringify(value.error) });
        return undefined;
      }
      return value;
    } catch {
      failures.push({ command, message: "missing/invalid JSON; inconclusive" });
      return undefined;
    }
  };
  const project = read("project.json", "projects describe"),
    ancestors = read("ancestors.json", "projects get-ancestors");
  // Invalid ancestors remain in the snapshot for explicit findings, but never
  // become filesystem paths or Cloud Shell command arguments.
  const policies = (Array.isArray(ancestors) ? ancestors : [])
    .filter((a) => validAncestor(a, project)).map((a) => ({
    type: a.type,
    id: String(a.id),
    policy: read(
      `${a.type}-${a.id}.policy.json`,
      "get-iam-policy " + a.type + "/" + a.id,
    ),
  }));
  const serviceAccountPolicy = read(
    "service-account.policy.json",
    "service-accounts get-iam-policy",
  );
  const serviceAccount = read(
    "service-account.json",
    "service-accounts describe",
  );
  const roles = {};
  for (const p of [...policies, { policy: serviceAccountPolicy }])
    for (const b of p.policy?.bindings ?? [])
      if (typeof b.role === "string")
        roles[b.role] = read(
          "role-" + b.role.replaceAll("/", "__") + ".json",
          "roles describe " + b.role,
        );
  try {
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".error.txt")))
      failures.push({
        command: f,
        message: fs.readFileSync(path.join(dir, f), "utf8"),
      });
  } catch {}
  return {
    projectId: PROJECT,
    project,
    ancestors,
    policies,
    serviceAccount,
    serviceAccountPolicy,
    roles,
    failures,
  };
}
function roleNames(snapshot) {
  const names = [
    ...new Set(
      [
        ...(snapshot.policies ?? []),
        { policy: snapshot.serviceAccountPolicy },
      ].flatMap((p) => (p.policy?.bindings ?? []).map((b) => b.role)),
    ),
  ];
  if (
    names.length > 200 ||
    names.some(
      (r) =>
        typeof r !== "string" ||
        !/^(roles\/[A-Za-z0-9_.]+|projects\/[a-z0-9-]+\/roles\/[A-Za-z0-9_.]+|organizations\/[0-9]+\/roles\/[A-Za-z0-9_.]+)$/.test(
          r,
        ),
    )
  )
    throw Error("INCONCLUSIVE: invalid or excessive referenced roles");
  return names;
}
module.exports = {
  assess,
  classifyFailure,
  readSnapshot,
  roleNames,
  DATA,
  AUTH,
  CONDITION,
};
if (require.main === module) {
  const [mode, dir] = process.argv.slice(2);
  if (!dir || !["--roles", "--review", "--ancestors"].includes(mode))
    throw Error("Use --roles/--review/--ancestors EVIDENCE_DIRECTORY");
  const snapshot = readSnapshot(dir);
  if (mode === "--roles") process.stdout.write(roleNames(snapshot).join("\n"));
  else if (mode === "--ancestors") {
    const errors = ancestryErrors(snapshot.project, snapshot.ancestors);
    if (errors.length) throw Error("INCONCLUSIVE: " + errors.join("; "));
    // Validate the entire response before emitting any rows; never partially
    // collect a hierarchy after an unsupported or foreign ancestor.
    for (const a of snapshot.ancestors) {
      process.stdout.write(a.type + " " + a.id + "\n");
    }
  } else {
    const report = assess(snapshot);
    fs.writeFileSync(
      path.join(dir, "review.json"),
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: report.status,
        activationAuthorized: false,
        report: path.join(dir, "review.json"),
      }),
    );
    process.exitCode = 2;
  }
}
