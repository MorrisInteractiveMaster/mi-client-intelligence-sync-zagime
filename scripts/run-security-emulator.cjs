const { spawnSync } = require("node:child_process");
const env = {
  ...process.env,
  GCLOUD_PROJECT: "demo-mi-security",
  GOOGLE_CLOUD_PROJECT: "demo-mi-security",
  CI: "true",
  FIREBASE_CLI_DISABLE_UPDATE_CHECK: "true",
};
delete env.GOOGLE_APPLICATION_CREDENTIALS;
delete env.FIREBASE_TOKEN;
// Only emulator startup for a demo-* project; no login/deploy command is reachable here.
const result = spawnSync(
  process.execPath,
  [
    "node_modules/firebase-tools/lib/bin/firebase.js",
    "emulators:exec",
    "--project",
    "demo-mi-security",
    "--only",
    "firestore",
    "node --import tsx --test security-tests/*.test.ts",
  ],
  { env, stdio: "inherit" },
);
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
