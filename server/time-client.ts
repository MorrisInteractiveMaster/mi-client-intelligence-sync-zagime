import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

const base = "https://rest.tsheets.com/api/v1/";
export function timeId(value: unknown): string {
  if (typeof value !== "string" && !Number.isSafeInteger(value))
    throw Error("Invalid Time ID");
  const id = String(value);
  if (!/^[1-9][0-9]{0,19}$/.test(id)) throw Error("Invalid Time ID");
  return id;
}
export function workDate(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw Error("Invalid Time date");
  return value;
}
export type TimeToken = () => Promise<string>;
export function mountedTimeToken(path: string): TimeToken {
  if (!/^\/var\/secrets\/quickbooks-time\/[a-zA-Z0-9_-]+$/.test(path))
    throw Error("Invalid Time secret mount");
  return async () => {
    try {
      return (await readFile(path, "utf8")).trim();
    } catch {
      throw Error("Time credential unavailable");
    }
  };
}
export interface TimeRow {
  id: string;
  jobcodeId: string;
  date: string;
  seconds: number;
  modifiedAt: string;
  deleted: boolean;
}
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid Time response");
  return value as JsonObject;
}
async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Invalid Time response");
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw Error("Time response too large");
      parts.push(Buffer.from(value));
    }
    return object(JSON.parse(Buffer.concat(parts).toString("utf8")));
  } finally {
    await reader.cancel().catch(() => {});
  }
}
function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw Error("Invalid Time timestamp");
  workDate(value.slice(0, 10));
  return new Date(value).toISOString();
}
const vendorTimestamp = (value: string) =>
  timestamp(value).replace(/\.000Z$/, "+00:00");
export class TimeClient {
  constructor(
    private token: TimeToken,
    private request = fetch,
    private wait = sleep as (ms: number) => Promise<unknown>,
    private pacing = { next: 0 },
  ) {}
  async session() {
    const token = await this.token();
    return new TimeClient(
      async () => token,
      this.request,
      this.wait,
      this.pacing,
    );
  }
  private async get(
    path: "jobcodes" | "timesheets" | "timesheets_deleted" | "current_user",
    query: Record<string, string>,
  ) {
    const token = await this.token();
    if (!/^[\x21-\x7e]{1,4096}$/.test(token))
      throw Error("Invalid Time credential");
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = Math.max(Date.now(), this.pacing.next);
      this.pacing.next = start + 1000;
      if (start > Date.now()) await this.wait(start - Date.now());
      let response: Response | undefined;
      try {
        response = await this.request(
          base + path + "?" + new URLSearchParams(query),
          {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(5000),
            headers: {
              Authorization: "Bearer " + token,
              Accept: "application/json",
            },
          },
        );
      } catch {
        /* bounded transport retry, without vendor details */
      }
      if (response?.ok) {
        try {
          return await readJson(response);
        } catch {
          throw Error("Invalid Time response");
        }
      }
      const status = response?.status;
      const retry = response?.headers.get("Retry-After");
      await response?.body?.cancel();
      if (status === 401 || status === 403)
        throw Error("Time authorization unavailable");
      if (status && status !== 429 && status < 500)
        throw Error("Time request rejected");
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 1000 * (attempt + 1);
      if (attempt === 2 || !Number.isFinite(delay) || delay > 5000)
        throw Error("Time temporarily unavailable");
      await this.wait(delay);
    }
    throw Error("Time temporarily unavailable");
  }
  async verifyActor(clientUrl: string, userId: string) {
    const users = Object.entries(
      object(object((await this.get("current_user", {})).results).users),
    );
    const [id, value] = users[0] ?? [];
    if (
      users.length !== 1 ||
      id !== userId ||
      timeId(object(value).id) !== userId ||
      object(value).client_url !== clientUrl ||
      object(value).active !== true
    )
      throw Error("Time account mismatch");
  }
  async verifyJobcode(id: string) {
    const r = await this.get("jobcodes", {
      ids: timeId(id),
      active: "both",
      supplemental_data: "no",
      limit: "1",
    });
    const jobs = Object.entries(object(object(r.results).jobcodes));
    if (
      r.more !== false ||
      jobs.length !== 1 ||
      jobs[0][0] !== id ||
      timeId(object(jobs[0][1]).id) !== id ||
      object(jobs[0][1]).type !== "regular" ||
      object(jobs[0][1]).has_children !== false
    )
      throw Error("Time jobcode must be a verified leaf");
    const children = await this.get("jobcodes", {
      parent_ids: id,
      active: "both",
      supplemental_data: "no",
      limit: "1",
    });
    if (
      children.more !== false ||
      Object.keys(object(object(children.results).jobcodes)).length
    )
      throw Error("Time jobcode must be a verified leaf");
  }
  async read(
    jobcodeId: string,
    since: string,
    before: string,
    deleted: boolean,
  ): Promise<TimeRow[]> {
    const path = deleted ? "timesheets_deleted" : "timesheets";
    const result: TimeRow[] = [];
    for (let page = 1; page <= 5; page++) {
      const reply = await this.get(path, {
        jobcode_ids: timeId(jobcodeId),
        jobcode_type: "regular",
        modified_since: vendorTimestamp(since),
        modified_before: vendorTimestamp(before),
        limit: "50",
        page: String(page),
        ...(deleted ? {} : { on_the_clock: "no", supplemental_data: "no" }),
      });
      if (typeof reply.more !== "boolean")
        throw Error("Invalid Time pagination");
      const rows = Object.entries(object(object(reply.results)[path]));
      if (rows.length > 50 || (reply.more && !rows.length))
        throw Error("Invalid Time pagination");
      for (const [key, value] of rows) {
        const row = object(value);
        const id = timeId(row.id);
        if (id !== key || timeId(row.jobcode_id) !== jobcodeId)
          throw Error("Time scope mismatch");
        if (
          !Number.isSafeInteger(row.duration) ||
          Number(row.duration) < 0 ||
          (!deleted &&
            row.type !== "manual" &&
            !(
              row.type === "regular" &&
              typeof row.end === "string" &&
              row.end &&
              Number.isFinite(Date.parse(row.end))
            ))
        )
          throw Error("Invalid Time duration or entry");
        const modifiedAt = timestamp(row.last_modified);
        if (modifiedAt < since || modifiedAt > before)
          throw Error("Time window mismatch");
        result.push({
          id,
          jobcodeId,
          date: workDate(row.date),
          seconds: Number(row.duration),
          modifiedAt,
          deleted,
        });
      }
      if (!reply.more) return result;
    }
    throw Error("Time page capacity exceeded");
  }
}
