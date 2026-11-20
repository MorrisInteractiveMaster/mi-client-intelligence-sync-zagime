import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { allocateTimeBatch } from "./bulk-allocation";
import type { FirestoreTenantStore } from "./firestore-store";

test("a transient bulk failure can be retried alone with the same operation identity", async () => {
  const calls: { sourceId: string; receipt: { id: string; hash: string } }[] = [];
  let failNext = true;
  const store: Pick<FirestoreTenantStore, "allocateBulkEntry"> = {
    async allocateBulkEntry(_tenant, _subject, _project, entry, receipt) {
      calls.push({ sourceId: entry.sourceId, receipt });
      if (entry.sourceId === "middle" && failNext) {
        failNext = false;
        throw new Error("Transient read failure");
      }
      return { revision: 2, changed: true };
    },
  };
  const now = Date.now();
  const key = now + "-" + randomUUID();
  const entries = ["first", "middle", "last"].map(sourceId => ({
    sourceId, expectedSourceRevision: "v1", expectedAllocationRevision: 0,
  }));
  const run = (rows = entries, signal?: AbortSignal) =>
    allocateTimeBatch(store, "test-tenant", "test-staff", { projectId: "destination", entries: rows }, key, now, signal);
  assert.deepEqual((await run()).outcomes.map(({status}) => status), ["saved", "retryable", "saved"]);
  assert.deepEqual((await run([entries[1]])).outcomes, [{ sourceId: "middle", status: "saved" }]);
  assert.deepEqual(calls[3], calls[1]);
  assert.deepEqual((await run(entries, AbortSignal.abort())).outcomes, []);
  await assert.rejects(run([entries[0], entries[0]]), /bulk allocation entry/);
  assert.equal(calls.length, 4);
});
