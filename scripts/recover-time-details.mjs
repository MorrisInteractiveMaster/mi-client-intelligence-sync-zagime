import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const project = "morris-client-dash-zagime";
const region = "northamerica-northeast1";
const job = "mi-client-prod-time-sync";
const tenant = "zagime-production";
const operation = "enrich-time-details";
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const cursorPattern = /^[A-Za-z0-9_-]{1,400}$/;
const totals = ["recordedSeconds", "active", "deleted", "outsideCurrentMapping"];
const metadata = ["consultantIds", "consultantNames", "verifiedNotes", "emptyNotes", "unavailableNotes",
  "missingCurrentDetails", "missingConsultantId", "missingConsultantName", "missingOriginalNotes"];
const outcomes = ["eligible", "unchanged", "unavailable", "notCurrent", "conflicts", "wouldWrite", "written",
  "scanned", "deleted", "outsideScope"];
const counters = [...totals, ...metadata];
const cloud = (parts) => JSON.parse(execFileSync("gcloud", parts, { encoding: "utf8", stderr: "inherit" }));
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const initial = () => ({ version: 1, stage: "inventory", before: {}, after: {}, dryRun: {}, apply: {} });

function verifyCursor(cursor) {
  if (cursor !== undefined && (typeof cursor !== "string" || !cursorPattern.test(cursor))) throw Error("Invalid worker cursor");
}
function addCounts(target, fields, source) {
  for (const field of fields) {
    if (!isCount(source[field])) throw Error("Worker result missing " + field);
    const next = (target[field] ?? 0) + source[field];
    if (!isCount(next)) throw Error("Worker count overflow");
    target[field] = next;
  }
}

export function nextPage(state) {
  verifyCursor(state.cursor);
  if (state.stage === "done") return;
  if (state.stage === "inventory" || state.stage === "coverage")
    return { operation: "inventory-time-details", cursor: state.cursor };
  if (state.stage !== "dry-run" && state.stage !== "apply") throw Error("Invalid recovery state");
  const month = Object.keys(state.before).sort()[state.monthIndex ?? 0];
  if (!month || !monthPattern.test(month)) throw Error("Invalid recovery month");
  return { operation, month, cursor: state.cursor, apply: state.stage === "apply" };
}

export function advance(state, page, receipt) {
  if (!receipt || !isCount(receipt.scanned)) throw Error("Invalid worker receipt");
  verifyCursor(receipt.nextCursor);
  if (receipt.nextCursor && receipt.nextCursor === page.cursor) throw Error("Worker cursor did not advance");
  const next = structuredClone(state);
  next.cursor = receipt.nextCursor;
  if (page.operation === "inventory-time-details") {
    if (!Array.isArray(receipt.months) || !isCount(receipt.outsideAccount)) throw Error("Invalid inventory receipt");
    if (receipt.outsideAccount) throw Error("Unexpected account in the ledger. Review the inventory before proceeding.");
    const inventory = state.stage === "inventory" ? next.before : next.after;
    for (const row of receipt.months) {
      if (!monthPattern.test(row?.month)) throw Error("Invalid inventory month");
      addCounts(inventory[row.month] ??= {}, counters, row);
    }
    if (!next.cursor) {
      if (state.stage === "coverage") {
        const months = Object.keys(next.before).sort();
        if (months.join(",") !== Object.keys(next.after).sort().join(",") ||
          months.some(month => totals.some(field => next.before[month][field] !== next.after[month][field])))
          throw Error("Source inventory changed. Reconcile the same-checkpoint snapshots before accepting coverage.");
        next.stage = "done";
      } else {
        next.stage = Object.keys(next.before).length ? "dry-run" : "done";
        next.monthIndex = 0;
      }
    }
  } else {
    if (receipt.month !== page.month || receipt.applied !== page.apply || (!page.apply && receipt.written !== 0))
      throw Error("Receipt does not match the requested month and operation");
    const report = page.apply ? next.apply : next.dryRun;
    addCounts(report[page.month] ??= {}, outcomes, receipt);
    if (!next.cursor) {
      next.monthIndex = (next.monthIndex ?? 0) + 1;
      if (next.monthIndex === Object.keys(next.before).length) {
        next.monthIndex = 0;
        next.stage = page.apply ? "coverage" : "awaiting-approval";
      }
    }
  }
  return next;
}

async function readReceipt(execution, matches) {
  const filter = [
    'resource.type="cloud_run_job"', 'resource.labels.job_name="' + job + '"',
    'resource.labels.location="' + region + '"', 'labels."run.googleapis.com/execution_name"="' + execution + '"',
    'log_id("run.googleapis.com/stdout")',
  ].join(" AND ");
  for (let attempt = 0; attempt < 10; attempt++) {
    const entries = cloud(["logging", "read", filter, "--project=" + project, "--limit=25", "--format=json"]);
    const receipts = entries.flatMap(entry => {
      if (entry.jsonPayload) return [entry.jsonPayload];
      try { return [JSON.parse(entry.textPayload)]; } catch { return []; }
    }).filter(matches);
    const unique = [...new Map(receipts.map(receipt => [JSON.stringify(receipt), receipt])).values()];
    if (unique.length === 1) return unique[0];
    if (unique.length > 1) throw Error("Multiple recovery results for " + execution);
    await sleep(2500);
  }
  throw Error("Worker receipt unavailable for " + execution + ". The cursor remains unchanged.");
}

async function execute(page) {
  const args = ["dist-server/operator.mjs", page.operation, tenant];
  if (page.month) args.push("--month=" + page.month);
  if (page.cursor) args.push("--after=" + page.cursor);
  if (page.apply) args.push("--apply");
  const launched = cloud(["run", "jobs", "execute", job, "--project=" + project, "--region=" + region,
    "--wait", "--args=" + args.join(","), "--format=json"]);
  const execution = launched.metadata?.name ?? launched.name?.split("/").at(-1);
  if (typeof execution !== "string" || !/^mi-client-prod-time-sync-[a-z0-9]+$/.test(execution))
    throw Error("Unexpected Cloud Run execution. Cursor remains unchanged.");
  return readReceipt(execution, row => page.month ? row.month === page.month && row.applied === page.apply : Array.isArray(row.months));
}

async function main() {
  const [command, path, limit = "1", ...extra] = process.argv.slice(2);
  if (!["review", "apply", "report"].includes(command) || !path || extra.length || !/^[1-5]$/.test(limit))
    throw Error("Use recover-time-details.mjs review|apply|report STATE.json [1-5 pages]");
  let state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : initial();
  if (state.version !== 1) throw Error("Unknown recovery state version");
  const save = () => {
    const temporary = path + "." + process.pid + ".tmp";
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
    renameSync(temporary, path);
  };
  if (command === "apply" && state.stage === "awaiting-approval") {
    state.stage = "apply";
    save();
  }
  if (command === "apply" && !["apply", "coverage", "done"].includes(state.stage))
    throw Error("Complete and review the dry run before applying.");
  for (let pageNumber = 0; command !== "report" && pageNumber < Number(limit); pageNumber++) {
    if (state.stage === "done" || state.stage === "awaiting-approval" ||
      command === "review" && (state.stage === "apply" || state.stage === "coverage")) break;
    const page = nextPage(state);
    state = advance(state, page, await execute(page));
    save();
  }
  console.log(JSON.stringify(state, null, 2));
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href)
  await main();
