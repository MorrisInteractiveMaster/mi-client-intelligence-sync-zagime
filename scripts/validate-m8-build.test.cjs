const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { validateM8Build, configPath } = require("./validate-m8-build.cjs");
test("actual M8 config parses and explicitly selects GCS_ONLY", () => {
  const config = validateM8Build(readFileSync(configPath, "utf8"));
  assert.equal(config.options.logging, "GCS_ONLY");
});
test("missing, implicit legacy, alternate and comment-only logging fail closed", () => {
  for (const source of ["steps: []", "options: {}", "# logging: GCS_ONLY\nsteps: []", ...["LEGACY", "CLOUD_LOGGING_ONLY", "NONE", "null"].map(mode=>`options:\n  logging: ${mode}\n`)])
    assert.throws(() => validateM8Build(source));
});
test("malformed YAML and duplicate keys cannot bypass the logging check", () => {
  for (const source of ["options: [", "options:\n  logging: !unsupported GCS_ONLY", "options:\n  logging: GCS_ONLY\n  logging: LEGACY", "options: {logging: GCS_ONLY}\noptions: {}"])
    assert.throws(() => validateM8Build(source));
});
