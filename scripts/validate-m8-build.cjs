// Offline only. No Cloud SDK, network calls or build submission.
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { parseDocument } = require("yaml");
const configPath = resolve(__dirname, "../deployment/cloudbuild-m8.yaml");
function validateM8Build(source) {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length) throw Error("Invalid M8 Cloud Build YAML");
  const config = doc.toJS({ maxAliasCount: 0 });
  if (!config || config.options?.logging !== "GCS_ONLY")
    throw Error("M8 Cloud Build requires options.logging: GCS_ONLY");
  return config;
}
module.exports = { validateM8Build, configPath };
if (require.main === module) {
  try {
    validateM8Build(readFileSync(configPath, "utf8"));
    console.log("M8 YAML valid; explicit GCS_ONLY logging verified offline.");
  } catch {
    // Do not echo config contents, substitutions or credentials on failure.
    console.error("STOP: M8 build config must be valid YAML with explicit GCS_ONLY logging. Run npm ci --ignore-scripts if dependencies are missing.");
    process.exitCode = 2;
  }
}
