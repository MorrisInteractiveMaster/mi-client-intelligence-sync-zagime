import { createHash } from "node:crypto";
export const CREATE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Timestamped random keys cannot become new operations after retention cleanup. */
export function creationKey(
  value: string,
  subject: string,
  now: number,
  input: unknown,
) {
  const match =
    /^(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
      value,
    );
  if (
    !match ||
    Number(match[1]) > now + 300000 ||
    now - Number(match[1]) > CREATE_WINDOW_MS
  )
    throw Error("Invalid or expired idempotency key");
  const hash = (v: unknown) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return {
    id: hash([subject, "create-project", value]),
    payloadHash: hash(input),
    now,
  };
}
