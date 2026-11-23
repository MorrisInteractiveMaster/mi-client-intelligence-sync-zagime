import assert from "node:assert/strict";
import test from "node:test";
import { applyDeliveryCapChange, canEditMonthlyCap, deliveryCaps, MAX_CAP_SECONDS, parseDeliveryCapChange } from "./caps";
import { deliveryDefaults } from "./delivery";
import { hoursToSeconds } from "./duration";

test("a cap change has exact-second values and preserves an omitted cap and other delivery settings", () => {
  const before = { ...deliveryDefaults, monthlyCap: 2_700, lifetimeCap: 15_000, workOrderIds: ["123"], parentId: "parent" };
  const change = parseDeliveryCapChange({ monthlyCap: hoursToSeconds("5.25") });
  const next = applyDeliveryCapChange(before, change);
  assert.deepEqual(next, { ...before, monthlyCap: 18_900 });
  assert.equal(before.monthlyCap, 2_700);
  assert.deepEqual(deliveryCaps(applyDeliveryCapChange(next, { monthlyCap: null, lifetimeCap: 0 })), { lifetimeCap: 0 });
});

test("cap changes have a bounded shape and respect delivery compatibility", () => {
  for (const change of [null, [], {}, { description: "Forged" }, { monthlyCap: false }, { monthlyCap: "1200" },
    { monthlyCap: -1 }, { monthlyCap: 1.2 }, { lifetimeCap: MAX_CAP_SECONDS + 1 }])
    assert.throws(() => parseDeliveryCapChange(change), /Invalid cap change/);
  const fixed = { ...deliveryDefaults, structure: 3 as const, type: "fixed-fee" as const };
  assert.equal(canEditMonthlyCap(fixed), false);
  assert.throws(() => applyDeliveryCapChange(fixed, { monthlyCap: 3_600 }), /Invalid monthly cap/);
  assert.deepEqual(deliveryCaps(applyDeliveryCapChange(fixed, { lifetimeCap: MAX_CAP_SECONDS })), { lifetimeCap: MAX_CAP_SECONDS });
});
