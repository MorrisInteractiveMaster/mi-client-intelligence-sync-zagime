import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { COMPANY_PROJECT, REGION } from "./database-target";

test("daily Time schedule uses Regina time and authenticated invocation of the Montréal job only", () => {
  const config = JSON.parse(
    readFileSync("deployment/time-sync-scheduler.example.json", "utf8"),
  );
  assert.equal(
    config.name,
    `projects/${COMPANY_PROJECT}/locations/${REGION}/jobs/mi-client-time-daily`,
  );
  assert.equal(config.schedule, "0 6 * * *");
  assert.equal(config.timeZone, "America/Regina");
  const hours = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const date of ["2026-01-01", "2026-07-01"])
    assert.equal(hours.format(new Date(date + "T12:00:00Z")), "06");
  assert.deepEqual(config.httpTarget, {
    uri: `https://run.googleapis.com/v2/projects/${COMPANY_PROJECT}/locations/${REGION}/jobs/mi-client-time-sync:run`,
    httpMethod: "POST",
    oauthToken: {
      serviceAccountEmail: "OWNER_APPROVED_INVOKER_EMAIL",
      scope: "https://www.googleapis.com/auth/cloud-platform",
    },
  });
  assert.equal(config.retryConfig.retryCount, 1);
});

test("scheduled operator refuses an ordinary service or unapproved runtime before provider access", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "server/operator.ts",
      "sync-time-customer",
      "synthetic",
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        BACKEND_MODE: "staging",
        CLOUD_RUN_JOB: "",
        FIRESTORE_DATABASE_ID: "mi-client-staging",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Approved named Time job configuration required/);
});
