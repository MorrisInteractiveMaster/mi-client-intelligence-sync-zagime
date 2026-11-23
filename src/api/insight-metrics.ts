/** Base 100 shares. A missing/zero denominator and negative net corrections have no meaningful track. */
export function metricPercent(numerator: number, denominator: number): number | undefined {
  if (!Number.isFinite(numerator) || numerator < 0 || !Number.isFinite(denominator) || denominator <= 0) return;
  const result = numerator / denominator * 100;
  return Number.isFinite(result) ? result : undefined;
}

const percent = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

/** Keep a nonzero share and an over-cap result distinguishable from their rounded boundary. */
export function percentText(value: number): string {
  if (value > 0 && value < .05) return "<0.1%";
  if (value > 99.95 && value < 100) return "<100%";
  if (value > 100 && value < 100.05) return ">100%";
  return percent.format(value) + "%";
}
