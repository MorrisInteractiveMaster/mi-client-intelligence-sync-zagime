import { isProgramType, type Delivery } from "./delivery";

export const MAX_CAP_SECONDS = 3_600_000_000;
export type DeliveryCaps = Pick<Delivery, "monthlyCap" | "lifetimeCap">;
export type DeliveryCapChange = { [K in keyof DeliveryCaps]?: number | null };

export const canEditMonthlyCap = (delivery: Delivery) => !isProgramType(delivery.type) && (delivery.structure !== 3 || delivery.type === "hourly");

export function deliveryCaps(delivery: Delivery): DeliveryCaps {
  const { monthlyCap, lifetimeCap } = delivery;
  return { ...(monthlyCap !== undefined && { monthlyCap }), ...(lifetimeCap !== undefined && { lifetimeCap }) };
}

export function parseDeliveryCapChange(value: unknown): DeliveryCapChange {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Invalid cap change");
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([key, cap]) =>
    key !== "monthlyCap" && key !== "lifetimeCap" ||
    cap !== null && (typeof cap !== "number" || !Number.isSafeInteger(cap) || cap < 0 || cap > MAX_CAP_SECONDS)))
    throw Error("Invalid cap change");
  return Object.fromEntries(entries);
}

export function applyDeliveryCapChange(delivery: Delivery, change: DeliveryCapChange): Delivery {
  if (isProgramType(delivery.type) && (change.monthlyCap != null || change.lifetimeCap != null))
    throw Error("Invalid cap change for Training & Workshops");
  if (change.monthlyCap != null && !canEditMonthlyCap(delivery))
    throw Error("Invalid monthly cap for this arrangement");
  const updated = { ...delivery };
  for (const cap of ["monthlyCap", "lifetimeCap"] as const) {
    const value = change[cap];
    if (value === null) delete updated[cap];
    else if (value !== undefined) updated[cap] = value;
  }
  return updated;
}
