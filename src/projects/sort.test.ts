import assert from "node:assert/strict";
import test from "node:test";
import { compareValues } from "./sort";

test("report sorting uses integer magnitude, natural text and missing values last", () => {
  assert.deepEqual([36000, 3600, 900].sort((a, b) => compareValues(a, b)), [900, 3600, 36000]);
  assert.deepEqual(["Project 10", "Project 2", "Project 1"].sort((a, b) => compareValues(a, b)), ["Project 1", "Project 2", "Project 10"]);
  assert.ok(compareValues(undefined, "Task", "desc") > 0);
  assert.ok(compareValues("", "Task", "asc") > 0);
  assert.equal(compareValues("évaluation", "Evaluation"), 0);
});
