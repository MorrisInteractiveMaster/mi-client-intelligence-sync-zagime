import type { TimeProjectMetadata } from "../src/projects/time";
import { setTimeout as sleep } from "node:timers/promises";
import { timeName, timeNotes, timePersonId, type TimeEntryDetails } from "./time-details";

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
export const timeCatalogLimit = 100;
export const timeDetailsBatch = 20;

export interface TimeJobcode {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
}

function jobcode(key: string, value: unknown): TimeJobcode {
  const row = object(value);
  const id = timeId(row.id);
  if (
    id !== key ||
    row.type !== "regular" ||
    typeof row.active !== "boolean" ||
    typeof row.name !== "string" ||
    !row.name.trim() ||
    row.name.length > 200
  )
    throw Error("Invalid Time jobcode");
  return {
    id,
    parentId:
      row.parent_id === 0 || row.parent_id === "0"
        ? null
        : timeId(row.parent_id),
    name: row.name.trim(),
    active: row.active,
  };
}

export class TimePageCapacityError extends Error {
  constructor() {
    super("Time page capacity exceeded");
  }
}

class TimeResponseSizeError extends Error {
  constructor() {
    super("Time response too large");
  }
}

export interface TimeRow {
  id: string;
  jobcodeId: string;
  date: string;
  seconds: number;
  modifiedAt: string;
  deleted: boolean;
  details?: TimeEntryDetails;
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
export async function readTimeJson(
  response: Response,
  maxBytes = 2 * 1024 * 1024,
) {
  const reader = response.body?.getReader();
  if (!reader) throw Error("Invalid Time response");
  const parts: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new TimeResponseSizeError();
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

function entryDetails(row: JsonObject, reply?: JsonObject, account?: string): TimeEntryDetails | undefined {
  const personId = timePersonId(row.user_id);
  const notes = timeNotes(row.notes);
  let consultantName: string | undefined;
  if (personId && account) {
    const supplemental = optionalObject(reply?.supplemental_data);
    const users = optionalObject(supplemental?.users);
    const user = users && Object.hasOwn(users, personId) ? optionalObject(users[personId]) : undefined;
    if (user && timePersonId(user.id) === personId &&
        (user.company_id === undefined || timePersonId(user.company_id) === account))
      consultantName = timeName(user.display_name) ??
        timeName([timeName(user.first_name), timeName(user.last_name)].filter(Boolean).join(" "));
  }
  const notesState = notes === undefined ? "unavailable" : "empty";
  return {
    ...(personId && { personId }),
    ...(consultantName && { consultantName }),
    ...(notes?.trim() ? { notes } : { notesState }),
  };
}

const optionalObject = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;

function recordedSeconds(row: JsonObject, deleted: boolean) {
  if (!Number.isSafeInteger(row.duration) || Number(row.duration) < 0 ||
    (!deleted && row.type !== "manual" && !(row.type === "regular" &&
      typeof row.end === "string" && row.end && Number.isFinite(Date.parse(row.end)))))
    throw Error("Invalid Time duration or entry");
  return Number(row.duration);
}

export class TimeClient {
  constructor(
    private token: TimeToken,
    private request = fetch,
    private wait: (ms: number, signal?: AbortSignal) => Promise<unknown> = (
      ms,
      signal,
    ) => sleep(ms, undefined, { signal }),
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
    path:
      | "jobcodes"
      | "timesheets"
      | "timesheets_deleted"
      | "current_user"
      | "users"
      | "projects",
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
            signal: this.signal
              ? AbortSignal.any([this.signal, timeout])
              : timeout,
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
        } catch (error) {
          if (error instanceof TimeResponseSizeError) throw error;
          throw Error("Invalid Time response");
        }
      }
      const status = response?.status;
      const retry = response?.headers.get("Retry-After");
      await response?.body?.cancel();
      if ((path === "projects" || path === "users") && (status === 403 || status === 404))
        return null;
      if (status === 401 || status === 403)
        throw Error("Time authorization unavailable");
      if (status === 413) throw new TimeResponseSizeError();
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
    if (users.length !== 1 || id !== userId)
      throw Error("Time account mismatch");
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
  async customerJobcode(id: string) {
    const reply = (await this.get("jobcodes", {
      ids: timeId(id),
      type: "regular",
      active: "both",
      supplemental_data: "no",
      limit: "1",
    }))!;
    const jobs = rows(reply, "jobcodes");
    if (reply.more !== false || jobs.length !== 1 || jobs[0][0] !== id)
      throw Error("Time customer ID unavailable");
    return jobcode(...jobs[0]);
  }

  async customerTree(rootId: string) {
    const root = await this.customerJobcode(rootId);
    const seen = new Set([rootId]);
    const jobs: TimeJobcode[] = [];
    let parents = [rootId];
    for (let depth = 0; parents.length; depth++) {
      if (depth > 8) throw Error("Time catalog depth exceeded");
      const children: string[] = [];
      for (let start = 0; start < parents.length; start += 20) {
        const group = new Set(parents.slice(start, start + 20));
        for (let page = 1; ; page++) {
          const reply = (await this.get("jobcodes", {
            parent_ids: [...group].join(","),
            type: "regular",
            active: "both",
            supplemental_data: "no",
            limit: "50",
            page: String(page),
          }))!;
          const batch = rows(reply, "jobcodes");
          if (
            typeof reply.more !== "boolean" ||
            batch.length > 50 ||
            (reply.more && !batch.length)
          )
            throw Error("Invalid Time pagination");
          for (const pair of batch) {
            const job = jobcode(...pair);
            if (!job.parentId || !group.has(job.parentId) || seen.has(job.id))
              throw Error("Time catalog scope mismatch");
            if (jobs.length >= timeCatalogLimit)
              throw Error("Time catalog capacity exceeded");
            seen.add(job.id);
            jobs.push(job);
            children.push(job.id);
          }
          if (!reply.more) break;
          if (page >= 5) throw new TimePageCapacityError();
        }
      }
      parents = children;
    }
    return { root, jobs };
  }

  async running(
    parentId: string,
    jobs: ReadonlySet<string>,
    from: string,
    now: number,
  ) {
    const counts: Record<string, { count: number; seconds: number }> = {};
    const seen = new Set<string>();
    for (let page = 1; page <= 5; page++) {
      const reply = (await this.get("timesheets", {
        jobcode_ids: timeId(parentId),
        jobcode_type: "regular",
        on_the_clock: "yes",
        modified_since: vendorTimestamp(from),
        supplemental_data: "no",
        limit: "50",
        page: String(page),
      }))!;
      const batch = rows(reply, "timesheets");
      if (
        typeof reply.more !== "boolean" ||
        batch.length > 50 ||
        (reply.more && !batch.length)
      )
        throw Error("Invalid Time pagination");
      for (const [key, value] of batch) {
        const row = object(value);
        const id = timeId(row.id);
        const job = timeId(row.jobcode_id);
        if (id !== key || (!jobs.has(job) && job !== parentId) || seen.has(id))
          throw Error("Time timer scope mismatch");
        seen.add(id);
        if (job === parentId) continue;
        const seconds = Math.floor(
          (now - Date.parse(timestamp(row.start))) / 1000,
        );
        if (row.type !== "regular" || row.end !== "" || seconds < 0)
          throw Error("Invalid Time timer");
        const total = (counts[job] ??= { count: 0, seconds: 0 });
        total.count++;
        total.seconds += seconds;
      }
      if (!reply.more)
        return { observedAt: new Date(now).toISOString(), jobs: counts };
    }
    throw new TimePageCapacityError();
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
      (project.status !== "not_started" &&
        project.status !== "in_progress" &&
        project.status !== "complete")
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
  /** Fetch only the requested existing source IDs under their verified jobcode. */
  async detailsById(jobcodeId: string, ids: string[], account: string, descendants: ReadonlySet<string> = new Set()): Promise<TimeRow[]> {
    const requested = new Set(ids.map(timeId));
    if (!requested.size || requested.size !== ids.length || requested.size > timeDetailsBatch)
      throw Error("Invalid Time detail batch");
    const job = timeId(jobcodeId);
    const company = timeId(account);
    const reply = (await this.get("timesheets", {
      ids: [...requested].join(","),
      jobcode_ids: job,
      jobcode_type: "regular",
      on_the_clock: "no",
      supplemental_data: "yes",
      limit: String(requested.size),
    }))!;
    if (reply.more !== false || (reply.company_id !== undefined && timeId(reply.company_id) !== company))
      throw Error("Time detail scope mismatch");
    const entries = rows(reply, "timesheets").map(([key, value]) => {
      const row = object(value);
      const id = timeId(row.id);
      const rowJob = timeId(row.jobcode_id);
      if (id !== key || !requested.has(id) || (rowJob !== job && !descendants.has(rowJob)) || row.on_the_clock === true ||
        (row.company_id !== undefined && timeId(row.company_id) !== company))
        throw Error("Time detail scope mismatch");
      // The provider also returns child jobcodes when filtering by parent. Keep the
      // material facts so the caller can detect a move, without keeping its details.
      const details = rowJob === job ? entryDetails(row, reply, company) : undefined;
      return {
        id,
        jobcodeId: rowJob,
        date: workDate(row.date),
        seconds: recordedSeconds(row, false),
        modifiedAt: timestamp(row.last_modified),
        deleted: false,
        ...(details && { details }),
      };
    });
    const users = optionalObject(optionalObject(reply.supplemental_data)?.users);
    const missing = new Set(entries.flatMap(({ details }) => details?.personId && !details.consultantName &&
      !(users && Object.hasOwn(users, details.personId)) ? [details.personId] : []));
    if (!missing.size) return entries;
    // An exact identifier filter also permits lookup of historical, archived staff.
    const fallback = await this.get("users", { ids: [...missing].join(","), active: "both",
      supplemental_data: "no", limit: String(missing.size) });
    if (!fallback) return entries;
    if (fallback.more !== false || (fallback.company_id !== undefined && timeId(fallback.company_id) !== company))
      throw Error("Time employee scope mismatch");
    const names = new Map<string, string>();
    for (const [key, value] of rows(fallback, "users")) {
      const user = object(value);
      if (!missing.has(key) || timePersonId(user.id) !== key ||
        (user.company_id !== undefined && timePersonId(user.company_id) !== company))
        throw Error("Time employee scope mismatch");
      const name = timeName(user.display_name) ?? timeName([timeName(user.first_name), timeName(user.last_name)].filter(Boolean).join(" "));
      if (name) names.set(key, name);
    }
    return entries.map(entry => {
      const details = entry.details;
      const name = details?.personId ? names.get(details.personId) : undefined;
      return name ? { ...entry, details: { ...details, consultantName: name } } : entry;
    });
  }

  async read(
    jobcodeId: string,
    since: string,
    before: string,
    deleted: boolean,
    descendants: ReadonlySet<string> = new Set(),
    detailsAccount?: string,
  ): Promise<TimeRow[]> {
    const path = deleted ? "timesheets_deleted" : "timesheets";
    const result: TimeRow[] = [];
    let supplemental = detailsAccount;
    for (let page = 1; page <= 5; page++) {
      const query = {
        jobcode_ids: timeId(jobcodeId),
        jobcode_type: "regular",
        modified_since: vendorTimestamp(since),
        modified_before: vendorTimestamp(before),
        limit: "50",
        page: String(page),
        ...(deleted ? {} : { on_the_clock: "no", supplemental_data: supplemental ? "yes" : "no" }),
      };
      let reply: JsonObject;
      try {
        reply = (await this.get(path, query))!;
      } catch (error) {
        if (deleted || !supplemental || !(error instanceof TimeResponseSizeError)) throw error;
        supplemental = undefined;
        reply = (await this.get(path, { ...query, supplemental_data: "no" }))!;
      }
      if (typeof reply.more !== "boolean")
        throw Error("Invalid Time pagination");
      const batch = rows(reply, path);
      if (batch.length > 50 || (reply.more && !batch.length))
        throw Error("Invalid Time pagination");
      for (const [key, value] of batch) {
        const row = object(value);
        const id = timeId(row.id);
        const job = timeId(row.jobcode_id);
        if (id !== key || (job !== jobcodeId && !descendants.has(job)))
          throw Error("Time scope mismatch");
        if (job !== jobcodeId) continue;
        const seconds = recordedSeconds(row, deleted);
        const modifiedAt = timestamp(row.last_modified);
        if (modifiedAt < since || modifiedAt > before)
          throw Error("Time window mismatch");
        const verifiedAccount = detailsAccount === undefined ||
          ((row.company_id === undefined || timePersonId(row.company_id) === detailsAccount) &&
           (reply.company_id === undefined || timePersonId(reply.company_id) === detailsAccount));
        const details = deleted || !verifiedAccount ? undefined : entryDetails(row, reply, supplemental);
        result.push({
          id,
          jobcodeId,
          date: workDate(row.date),
          seconds,
          modifiedAt,
          deleted,
          ...(details && { details }),
        });
      }
      if (!reply.more) return result;
    }
    throw new TimePageCapacityError();
  }
}
