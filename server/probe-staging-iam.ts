import { applicationDefault } from "firebase-admin/app";
import { readFile } from "node:fs/promises";
import { firebaseRuntime } from "./firebase";
import { assertIamEvidence, probeDatabaseReads } from "./staging-iam";
// Operator-only, read-only gate. No token, approval content or document response is printed.
const [flag, file] = process.argv.slice(2);
if (
  flag !== "--approved-read-only-probe" ||
  !file ||
  process.argv.length !== 4 ||
  process.env.BACKEND_MODE !== "staging" ||
  process.env.STAGING_FIREBASE_PROJECT_ID !== "morris-client-dash-zagime"
)
  throw Error(
    "Explicit approved same-project read-only probe and protected IAM evidence file required",
  );
const evidence = JSON.parse(
  (file === "-"
    ? (process.env.STAGING_IAM_EVIDENCE_JSON ?? "")
    : await readFile(file, "utf8")
  ).replace(/^\uFEFF/, ""),
);
const expectedIdentity = process.env.STAGING_SERVICE_ACCOUNT_EMAIL;
if (
  !expectedIdentity ||
  !/^[a-z][a-z0-9-]{5,29}@morris-client-dash-zagime\.iam\.gserviceaccount\.com$/.test(
    expectedIdentity,
  ) ||
  evidence.principal !== expectedIdentity ||
  evidence.projectId !== "morris-client-dash-zagime" ||
  evidence.databaseId !== "mi-client-staging" ||
  evidence.allowStagingDelete !== false ||
  !Number.isFinite(Date.parse(evidence.at)) ||
  Date.now() - Date.parse(evidence.at) > 3600000 ||
  Date.parse(evidence.at) > Date.now() + 60000
)
  throw Error("Current runtime identity IAM evidence required");
assertIamEvidence(evidence.checks);
const runtime = firebaseRuntime("staging", "morris-client-dash-zagime");
try {
  await runtime.verify();
  console.log(
    JSON.stringify(
      await probeDatabaseReads(
        runtime.target,
        runtime.app.options.credential ?? applicationDefault(),
      ),
    ),
  );
} finally {
  await runtime.close();
}
