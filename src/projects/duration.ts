/** Decimal hours must represent an exact integer number of seconds. No rounding. */
export function hoursToSeconds(value: string) {
  if (!/^\d{1,7}(\.\d{1,8})?$/.test(value))
    throw Error("Enter nonnegative hours with exact second precision.");
  const [whole, fraction = ""] = value.split(".");
  const scale = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(whole) * scale + BigInt(fraction || "0")) * 3600n;
  if (numerator % scale !== 0n || numerator / scale > 3_600_000_000n)
    throw Error("Enter hours that equal a whole number of seconds.");
  return Number(numerator / scale);
}
