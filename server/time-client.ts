import type { TimeProjectMetadata } from "../src/projects/time";
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
export type TimeToken = (signal?: AbortSignal) => Promise<string>;
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
function rows(reply: JsonObject, collection: string): [string, unknown][] {
  const value = object(reply.results)[collection];
  if (Array.isArray(value) && value.length === 0) return [];
  return Object.entries(object(value));
}
export async function readTimeJson(response: Response, maxBytes = 2 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Invalid Time response");
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error("Time response too large");
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
    private wait: (ms: number, signal?: AbortSignal) => Promise<unknown> =
      (ms, signal) => sleep(ms, undefined, { signal }),
    private pacing = { next: 0 },
    private signal?: AbortSignal,
  ) {}
  async session(signal: AbortSignal) {
    const token = await this.token(signal);
    signal.throwIfAborted();
    return new TimeClient(
      async () => token,
      this.request,
      this.wait,
      this.pacing,
      signal,
    );
  }
  private async get(
    path: "jobcodes" | "timesheets" | "timesheets_deleted" | "current_user" | "projects",
    query: Record<string, string>,
  ) {
    const token = await this.token(this.signal);
    if (!/^[\x21-\x7e]{1,4096}$/.test(token))
      throw Error("Invalid Time credential");
    for (let attempt = 0; attempt < 3; attempt++) {
      this.signal?.throwIfAborted();
      const now = Date.now();
      const start = Math.max(now, this.pacing.next);
      this.pacing.next = start + 1000;
      if (start > now) await this.wait(start - now, this.signal);
      this.signal?.throwIfAborted();
      const timeout = AbortSignal.timeout(5000);
      let response: Response | undefined;
      try {
        response = await this.request(
          base + path + "?" + new URLSearchParams(query),
          {
            method: "GET",
            redirect: "error",
            signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
            headers: {
              Authorization: "Bearer " + token,
              Accept: "application/json",
            },
          },
        );
      } catch {
        /* bounded transport retry, without vendor details */
      }
      if (this.signal?.aborted) {
        await response?.body?.cancel();
        this.signal.throwIfAborted();
      }
      if (response?.ok) {
        try {
          const reply = await readTimeJson(response);
          this.signal?.throwIfAborted();
          return reply;
        } catch {
          throw Error("Invalid Time response");
        }
      }
      const status = response?.status;
      const retry = response?.headers.get("Retry-After");
      await response?.body?.cancel();
      if (path === "projects" && (status === 403 || status === 404))
        return null;
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
      await this.wait(delay, this.signal);
    }
    throw Error("Time temporarily unavailable");
  }
  async verifyActor(clientUrl: string, userId: string, account: string) {
    const reply = (await this.get("current_user", {}))!;
    const users = rows(reply, "users");
    const [id, value] = users[0] ?? [];
    if (users.length !== 1 || id !== userId) throw Error("Time account mismatch");
    const user = object(value);
    if (
      timeId(user.id) !== userId ||
      user.client_url !== clientUrl ||
      user.active !== true ||
      (user.company_id !== undefined && timeId(user.company_id) !== account) ||
      (reply.company_id !== undefined && timeId(reply.company_id) !== account)
    )
      throw Error("Time account mismatch");
  }
  async verifyJobcode(id: string) {
    const r = (await this.get("jobcodes", {
      ids: timeId(id),
      active: "both",
      supplemental_data: "no",
      limit: "1",
    }))!;
    const jobs = rows(r, "jobcodes");
    if (
      r.more !== false ||
      jobs.length !== 1 ||
      jobs[0][0] !== id ||
      timeId(object(jobs[0][1]).id) !== id ||
      object(jobs[0][1]).type !== "regular" ||
      object(jobs[0][1]).has_children !== false
    )
      throw Error("Time jobcode must be a verified leaf");
    const children = (await this.get("jobcodes", {
      parent_ids: id,
      active: "both",
      supplemental_data: "no",
      limit: "1",
    }))!;
    if (children.more !== false || rows(children, "jobcodes").length)
      throw Error("Time jobcode must be a verified leaf");
  }
  async projectMetadata(jobcodeId: string): Promise<TimeProjectMetadata> {
    const reply = await this.get("projects", {
      jobcode_ids: timeId(jobcodeId),
      active: "both",
      supplemental_data: "no",
    });
    if (!reply) return { state: "unavailable" };
    const projects = rows(reply, "projects");
    if (reply.more !== false || projects.length > 1)
      throw Error("Ambiguous Time project association");
    if (!projects.length) return { state: "no-match" };
    const [key, value] = projects[0];
    const project = object(value);
    const id = timeId(project.id);
    if (key !== id || timeId(project.jobcode_id) !== jobcodeId)
      throw Error("Time project scope mismatch");
    if (
      typeof project.active !== "boolean" ||
      typeof project.name !== "string" ||
      !project.name.trim() ||
      project.name.length > 512 ||
      (project.status !== "not_started" && project.status !== "in_progress" && project.status !== "complete")
    )
      throw Error("Invalid Time project metadata");
    return {
      state: "verified",
      id,
      parentJobcodeId:
        project.parent_jobcode_id === 0 || project.parent_jobcode_id === "0"
          ? null
          : timeId(project.parent_jobcode_id),
      name: project.name,
      status: project.status,
      active: project.active,
    };
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
      const reply = (await this.get(path, {
        jobcode_ids: timeId(jobcodeId),
        jobcode_type: "regular",
        modified_since: vendorTimestamp(since),
        modified_before: vendorTimestamp(before),
        limit: "50",
        page: String(page),
        ...(deleted ? {} : { on_the_clock: "no", supplemental_data: "no" }),
      }))!;
      if (typeof reply.more !== "boolean")
        throw Error("Invalid Time pagination");
      const batch = rows(reply, path);
      if (batch.length > 50 || (reply.more && !batch.length))
        throw Error("Invalid Time pagination");
      for (const [key, value] of batch) {
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
