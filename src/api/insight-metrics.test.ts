import { test } from "node:test";
import assert from "node:assert/strict";
import { metricPercent, percentText } from "./insight-metrics";

test("allocation coverage treats a positive recorded denominator and zero allocation as measurable", () => {
  const hours = 138 * 3600;
  assert.equal(metricPercent(0, hours), 0);
  assert.equal(percentText(metricPercent(0, hours)!), "0%");
  assert.equal(metricPercent(0, 0), undefined);
});

test("shares use exact seconds and show over-cap utilization without clamping", () => {
  assert.equal(metricPercent(72, 100), 72);
  assert.equal(metricPercent(5400, 3600), 150);
  assert.equal(percentText(metricPercent(5400, 3600)!), "150%");
  assert.equal(percentText(metricPercent(30, 61)!), "49.2%");
  assert.equal(percentText(metricPercent(1, 10_000)!), "<0.1%");
  assert.equal(percentText(metricPercent(9_999, 10_000)!), "<100%");
  assert.equal(percentText(metricPercent(10_001, 10_000)!), ">100%");
});

test("a negative net correction or invalid denominator does not produce a misleading percentage", () => {
  assert.equal(metricPercent(-60, 3600), undefined);
  assert.equal(metricPercent(30, -1), undefined);
  assert.equal(metricPercent(2, Infinity), undefined);
  assert.equal(metricPercent(NaN, 3600), undefined);
});
