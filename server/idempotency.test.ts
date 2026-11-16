import test from "node:test";
import assert from "node:assert/strict";
import { creationKey, CREATE_WINDOW_MS } from "./idempotency";
test("creation keys bind actor/operation/payload, reject expiration and cannot restart after cleanup", () => {
  const now = Date.now(),
    k = `${now}-${crypto.randomUUID()}`;
  const a = creationKey(k, "actor-a", now, { name: "Same" });
  assert.deepEqual(creationKey(k, "actor-a", now, { name: "Same" }), a);
  assert.notEqual(creationKey(k, "actor-b", now, { name: "Same" }).id, a.id);
  assert.notEqual(
    creationKey(k, "actor-a", now, { name: "Different" }).payloadHash,
    a.payloadHash,
  );
  for (const v of ["", "guessed", `${now + 600000}-${crypto.randomUUID()}`])
    assert.throws(() => creationKey(v, "actor-a", now, {}));
  assert.throws(() =>
    creationKey(k, "actor-a", now + CREATE_WINDOW_MS + 1, {}),
  );
  assert.throws(() => creationKey(k, "actor-a", now + 31 * 86400000, {}));
});
