export const directions = ["asc", "desc"] as const;
export type SortDirection = typeof directions[number];
export type SortValue = string | number | null | undefined;
const collator = new Intl.Collator("en-CA", { numeric: true, sensitivity: "base" });

export function compareValues(a: SortValue, b: SortValue, direction: SortDirection = "asc") {
  const missingA = a == null || a === "";
  const missingB = b == null || b === "";
  if (missingA || missingB) return Number(missingA) - Number(missingB);
  const result = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return direction === "asc" ? result : -result;
}
