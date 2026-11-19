#!/usr/bin/env python3
"""Owner-operated activation for the existing Zagimē production dashboard."""
import argparse
import csv
import getpass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import warnings
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler

PROJECT = "morris-client-dash-zagime"
REGION = "northamerica-northeast1"
DB = "mi-client-production"
UID = "b2cc12b3-7284-4a7f-a779-e20e5e4c5cbd"
TENANT = "zagime-production"
SA = f"mi-client-production-api@{PROJECT}.iam.gserviceaccount.com"
SERVICE = "mi-client-prod-dashboard"
ORIGIN = "https://mi-client-prod-dashboard-u3xjh6xfkq-nn.a.run.app"
JOB = "mi-client-prod-time-sync"
SCHEDULE = "mi-client-prod-time-daily"
SECRET = "mi-client-prod-time"
TAG = "time-candidate"
JOB_URI = f"https://run.googleapis.com/v2/projects/{PROJECT}/locations/{REGION}/jobs/{JOB}:run"
DATABASE = f"projects/{PROJECT}/databases/{DB}"
BASE = {
    "BACKEND_MODE": "production", "ENABLE_PRODUCTION": "true", "ENABLE_LIVE_FIREBASE": "true",
    "PRODUCTION_IAM_VERIFIED": "true", "FIRESTORE_RULES_VERIFIED": "true",
    "PRODUCTION_FIREBASE_PROJECT_ID": PROJECT, "FIRESTORE_DATABASE_ID": DB,
    "PRODUCTION_DATABASE_UID": UID, "PRODUCTION_SERVICE_ACCOUNT_EMAIL": SA,
    "MORRIS_DASHBOARD_TENANT_ID": TENANT,
}
NUMBER = re.compile(r"[1-9][0-9]{0,19}")
DIGEST = re.compile(r"sha256:[a-f0-9]{64}")
IMAGE = re.compile(rf"{REGION}-docker\.pkg\.dev/{PROJECT}/mi-client-build/[a-z0-9-]+@{DIGEST.pattern}")
PHASES = ("preflight", "configure", "credential", "secret-iam", "job", "verify", "enroll", "sync",
          "reconcile", "candidate", "cutover", "scheduler-iam", "scheduler", "pause", "resume", "rollback", "monitor", "report")


class Stop(ValueError):
    pass


def require(value, message):
    if not value:
        raise Stop(message)


def now():
    return datetime.now(timezone.utc)


def iso(date):
    return date.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def approve(phase):
    require(os.isatty(0), "Approvals require an interactive Cloud Shell terminal.")
    require(input(f"Review the gate, then type {phase} to continue: ") == phase, "Approval was not given.")


def cloud(*args, payload=None, output="json", regional=False):
    command = ["gcloud", *args, "--project=" + PROJECT, "--quiet"]
    if output == "json":
        command.append("--format=json")
    env = {**os.environ, "CLOUDSDK_CORE_LOG_HTTP": "false", "CLOUDSDK_CORE_VERBOSITY": "error"}
    if regional:
        env["CLOUDSDK_API_ENDPOINT_OVERRIDES_SECRETMANAGER"] = f"https://secretmanager.{REGION}.rep.googleapis.com/"
    try:
        result = subprocess.run(command, input=payload, capture_output=True, env=env, timeout=2200)
    except (OSError, subprocess.TimeoutExpired):
        raise Stop("Google Cloud CLI unavailable or timed out. Inspect resource state before retrying.") from None
    require(result.returncode == 0, f"Cloud command failed in {' '.join(args[:3])}. Check permissions and resource state before retrying.")
    if output == "json":
        return json.loads(result.stdout)
    if output == "text":
        return result.stdout.decode().strip()
    return None


def run(*args, **kw):
    return cloud("run", *args, "--region=" + REGION, **kw)


def secret(*args, **kw):
    return cloud("secrets", *args, "--location=" + REGION, regional=True, **kw)


def scheduler(*args, **kw):
    return cloud("scheduler", "jobs", *args, "--location=" + REGION, **kw)


def exists(items, name):
    return any((i.get("metadata", {}).get("name") or i.get("name", "")).split("/")[-1] == name for i in items or [])


def database():
    item = cloud("firestore", "databases", "describe", "--database=" + DB)
    expected = {"name": DATABASE, "uid": UID, "locationId": REGION, "type": "FIRESTORE_NATIVE", "databaseEdition": "STANDARD"}
    require(all(item.get(k) == v for k, v in expected.items()), "Named database metadata or UID mismatch.")
    indexes = cloud("firestore", "indexes", "composite", "list", "--database=" + DB)
    require(all(any(f"/collectionGroups/{name}/" in i["name"] and i["state"] == "READY" for i in indexes or [])
                for name in ("rawTime", "allocationRevisions")), "Named production indexes are not READY.")


def serving(service):
    require(service.get("status", {}).get("url") == ORIGIN, "Cloud Run origin differs.")
    rows = [row for row in service["status"]["traffic"] if row.get("percent", 0)]
    require(len(rows) == 1 and rows[0]["percent"] == 100, "Expected a single production revision at 100 percent.")
    return rows[0]["revisionName"]


def env_map(container):
    entries = container.get("env", [])
    result = {e["name"]: e.get("value", e.get("valueFrom")) for e in entries}
    require(len(result) == len(entries), "Duplicate environment keys.")
    return result


def revision(name):
    require(re.fullmatch(SERVICE + r"-[a-z0-9-]+", name), "Invalid production revision.")
    item = run("revisions", "describe", name)
    spec = item["spec"]
    require(spec["serviceAccountName"] == SA and len(spec["containers"]) == 1, "Unexpected production runtime identity or container count.")
    require(any(c.get("type") == "Ready" and c.get("status") == "True" for c in item["status"]["conditions"]), "Production revision is not Ready.")
    container = spec["containers"][0]
    image = item["status"]["imageDigest"]
    if DIGEST.fullmatch(image):
        image = container["image"].split("@")[0].split(":")[0] + "@" + image
    require(IMAGE.fullmatch(image), "Expected an immutable image in the approved regional registry.")
    env = env_map(container)
    require(all(env.get(k) == v for k, v in {**BASE, "ALLOWED_ORIGIN": ORIGIN}.items()), "Production runtime guards or origin mismatch.")
    require(all(isinstance(env.get(k), str) and re.fullmatch(r"[a-f0-9A-F-]{36}", env[k])
                for k in ("MORRIS_ENTRA_TENANT_ID", "MORRIS_ENTRA_CLIENT_ID")), "Microsoft runtime configuration is missing.")
    runtime_profile = {k: v for k, v in spec.items() if k not in ("containers", "timeoutSeconds")}
    runtime_profile["container"] = {k: v for k, v in container.items() if k not in ("env", "image")}
    return image, env, int(spec["timeoutSeconds"]), runtime_profile


def baseline(state):
    service = run("services", "describe", SERVICE)
    require(serving(service) == state.get("baseline"), "Serving revision changed. Review active configuration and traffic.")
    return service


def time_env(s):
    return {
        "ENABLE_QUICKBOOKS_TIME": "true", "PRODUCTION_TIME_APPROVED": "true",
        "QUICKBOOKS_TIME_ACCOUNT_ID": s["company"], "QUICKBOOKS_TIME_CREDENTIAL_USER_ID": s["actor"],
        "QUICKBOOKS_TIME_CUSTOMER_PARENT_ID": s["parent"], "QUICKBOOKS_TIME_CLIENT_URL": s["slug"],
        "QUICKBOOKS_TIME_MODIFIED_FROM": s["floor"], "QUICKBOOKS_TIME_ADMIN_UID": s["operator"],
        "QUICKBOOKS_TIME_SECRET_ID": SECRET, "QUICKBOOKS_TIME_SECRET_VERSION": s["version"],
        "QUICKBOOKS_TIME_CREDENTIAL_SHA256": s["digest"], "QUICKBOOKS_TIME_ON_CLOCK_SNAPSHOT": "false",
    }


def version(s):
    item = secret("versions", "describe", s["version"], "--secret=" + SECRET)
    name = rf"projects/(?:{PROJECT}|[0-9]+)/locations/{REGION}/secrets/{SECRET}/versions/{s['version']}"
    require(item.get("state") == "ENABLED" and re.fullmatch(name, item.get("name", "")), "Pinned regional secret version is missing, different or disabled.")
    require(datetime.fromisoformat(s["expires"]) > now(), "The approved token expiration has passed.")


def validate_job(item, s):
    spec = item["spec"]["template"]["spec"]
    task = spec["template"]["spec"]
    containers = task.get("containers", [])
    require(len(containers) == 1, "Unexpected production job container count.")
    c = containers[0]
    require(spec.get("taskCount", 1) == 1 and spec.get("parallelism", 1) == 1
            and task.get("maxRetries", 0) == 0 and str(task.get("timeoutSeconds")) == "1800"
            and task.get("serviceAccountName") == SA and not task.get("volumes")
            and c.get("image") == s["image"] and c.get("command") == ["node"]
            and c.get("args") == ["dist-server/operator.mjs", "sync-time-customer", TENANT]
            and not c.get("volumeMounts") and env_map(c) == {**BASE, **time_env(s)}, "Production job configuration differs.")


def idle():
    require(not any(not x.get("status", {}).get("completionTime")
                    for x in run("jobs", "executions", "list", "--job=" + JOB) or []),
            "An execution is active or has inconclusive status.")


def schedule(s):
    item = scheduler("describe", SCHEDULE)
    target = item["httpTarget"]
    require(item["schedule"] == "0 6 * * *" and item["timeZone"] == "America/Regina"
            and target["uri"] == JOB_URI and target["httpMethod"] == "POST"
            and item.get("attemptDeadline") == "30s" and item.get("retryConfig", {}).get("retryCount") == 1
            and target["oauthToken"] == {"serviceAccountEmail": s["invoker"],
                                        "scope": "https://www.googleapis.com/auth/cloud-platform"},
            "Existing schedule has an unexpected target, cadence or invocation identity.")
    return item["state"]


def key(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def decoded(document):
    values = {}
    for name, entry in document.get("fields", {}).items():
        kind, raw = next(iter(entry.items()))
        values[name] = int(raw) if kind == "integerValue" else decoded(raw) if kind == "mapValue" else raw
    return values


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReadOnly:
    path = f"https://firestore.{REGION}.rep.googleapis.com/v1/{DATABASE}/documents/tenants/{TENANT}"

    def __init__(self):
        self.token = cloud("auth", "print-access-token", output="text")
        require(bool(self.token), "An authenticated Cloud Shell owner session is required.")
        self.opener = build_opener(NoRedirect())

    def get(self, url, *, query=None, missing=False):
        headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json"}
        request = Request(url, headers=headers, data=json.dumps(query).encode() if query else None)
        try:
            with self.opener.open(request, timeout=20) as response:
                data = response.read(1048577)
                require(len(data) <= 1048576, "Audit response is too large.")
                return json.loads(data)
        except HTTPError as error:
            if error.code == 404 and missing:
                return None
            raise Stop(f"Named production metadata or audit read failed with HTTP {error.code}.") from None

    def rules(self):
        root = "https://firebaserules.googleapis.com/v1/"
        release = self.get(root + f"projects/{PROJECT}/releases/cloud.firestore/{DB}")
        ruleset = release["rulesetName"]
        project = cloud("projects", "describe", PROJECT)
        number = str(project["projectNumber"])
        require(NUMBER.fullmatch(number) and project["projectId"] == PROJECT
                and re.fullmatch(rf"projects/(?:{PROJECT}|{number})/rulesets/[a-zA-Z0-9_-]+", ruleset),
                "Unexpected named ruleset reference.")
        live = self.get(root + ruleset)["source"]["files"]
        reviewed = (Path(__file__).resolve().parents[1] / "firestore.rules").read_text()
        require(len(live) == 1 and "".join(live[0]["content"].split()) == "".join(reviewed.split()),
                "Live named browser rules differ from the reviewed deny-all rules.")

    def doc(self, path, *, missing=False):
        item = self.get(self.path + "/" + path, missing=missing)
        return decoded(item) if item else None

    def mappings(self, catalog):
        query = {"structuredQuery": {"from": [{"collectionId": "timeMappings"}], "limit": 101,
                 "where": {"fieldFilter": {"field": {"fieldPath": "catalog"},
                           "op": "EQUAL", "value": {"stringValue": catalog}}}}}
        return [decoded(row["document"]) for row in self.get(self.path + ":runQuery", query=query) if "document" in row]


def read_report(path, work_orders):
    require(stat.S_IMODE(Path(path).stat().st_mode) == 0o600, "The private totals CSV must have mode 0600.")
    values = {}
    with open(path, encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file)
        require(reader.fieldnames == ["jobcode_id", "month", "recorded_seconds"], "CSV header must be jobcode_id,month,recorded_seconds.")
        for row in reader:
            job, month, seconds = (row[k] for k in reader.fieldnames)
            require(job in work_orders and re.fullmatch(r"[0-9]{4}-(0[1-9]|1[0-2])", month)
                    and re.fullmatch(r"[0-9]{1,15}", seconds) and (job, month) not in values and len(values) < 1200,
                    "CSV contains duplicate, unapproved or invalid totals.")
            values[job, month] = int(seconds)
    require(set(job for job, _ in values) == set(work_orders), "Include each approved work order in the CSV, even when it has zero hours.")
    return values


def reconciliation(s, values, audit):
    company, parent = s["company"], s["parent"]
    catalog = key("quickbooks-time-customer", company, parent)
    status = audit.doc("timeRuns/" + catalog)
    require(status and status["customerBound"] is True and status["status"] == "complete"
            and status["failedCount"] == 0 and status["lastSuccess"] >= s["cutoff"],
            "Time history is incomplete or stale. Inspect the worker and rerun after the lease clears.")
    mappings = audit.mappings(catalog)
    orders = s["work_orders"]
    require(len(mappings) == len(orders) and {m["jobcodeId"] for m in mappings} == set(orders),
            "Imported catalog differs from the approved first-import inventory.")
    for mapping in mappings:
        job = mapping["jobcodeId"]
        source, meta = mapping["sourceJob"], mapping["sourceProject"]
        anchor = "time-" + key(company, job)
        require(job != parent and mapping["account"] == company and mapping["scopeProjectId"] == anchor
                and source["id"] == job and source["parentId"] == parent and source["active"] is True and source["missing"] is False
                and meta["state"] == "verified" and meta["id"] == orders[job] and meta["parentJobcodeId"] == parent,
                "Source project identity, scope or metadata did not reconcile.")
        project = audit.doc("projects/" + anchor)
        view = audit.doc("projectViews/" + anchor)
        require(project["published"] is False and project["name"] == source["name"] and view["published"] is False,
                "Imported project and projection must both remain unpublished.")
        cp = audit.doc("syncCheckpoints/" + key("quickbooks-time", company, job))
        require(cp["failed"] is False and cp["through"] >= s["cutoff"], "A work-order checkpoint has not covered the pilot window.")
        months = {month: seconds for (jid, month), seconds in values.items() if jid == job}
        months["lifetime"] = sum(months.values())
        for month, seconds in months.items():
            period = audit.doc(f"timeProjectTotals/{anchor}/periods/{month}", missing=True)
            recorded, allocated = (period["recorded"], period["allocated"]) if period else (0, 0)
            require(type(recorded) is int and type(allocated) is int and 0 <= allocated <= recorded and recorded == seconds,
                    "Recorded or allocated totals did not reconcile with the private Time report.")
    return {"work_orders": len(mappings), "report_rows": len(values), "checkpoint_coverage": "passed"}


def candidate(s):
    service = baseline(s)
    targets = [x for x in service["status"]["traffic"] if x.get("tag") == TAG]
    require(len(targets) == 1 and not targets[0].get("percent", 0), "Expected one candidate tag at zero normal traffic.")
    name = targets[0]["revisionName"]
    require(name != s["baseline"] and (not s.get("candidate") or s["candidate"] == name), "Candidate revision changed.")
    image, env, timeout, hardware = revision(name)
    _, old, old_timeout, old_hardware = revision(s["baseline"])
    require(image == s["image"] and env == {**old, **time_env(s)} and hardware == old_hardware
            and timeout >= max(210, old_timeout),
            "Candidate image, environment or timeout differs from the reviewed settings.")
    url = targets[0]["url"]
    require(url.startswith("https://" + TAG + "---") and url.endswith(".run.app"), "Unexpected candidate URL.")
    return name, url


def configure(s, args):
    require(s.get("baseline") and not s.get("version"), "Run preflight first. A pinned setup must be changed through reviewed rotation.")
    require(all(NUMBER.fullmatch(v or "") for v in (args.company, args.actor, args.parent)), "Numeric company, user and parent IDs are required.")
    require(re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", args.slug or "") and re.fullmatch(r"[-a-zA-Z0-9_]{1,128}", args.operator or ""),
            "Supply the approved account slug and Morris Firebase UID.")
    require(args.identity_evidence and args.iam_evidence, "Independent company verification and effective IAM review references are required.")
    orders = dict(x.split(":", 1) for x in args.work_order or [])
    require(len(orders) == 4 and all(NUMBER.fullmatch(k) and NUMBER.fullmatch(v) and k != args.parent for k, v in orders.items())
            and len(set(orders.values())) == 4, "Supply the four approved jobcode and project ID pairs.")
    floor = datetime.strptime(args.floor, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    expires = datetime.fromisoformat(args.expires)
    require(floor.strftime("%Y-%m-%d") == args.floor and floor < now() - timedelta(minutes=1)
            and iso(expires) == args.expires and expires.utcoffset() == timedelta(0) and expires > now(),
            "Supply the approved past UTC date and future UTC ISO token expiration with milliseconds.")
    approve("configure")
    s.update(company=args.company, actor=args.actor, parent=args.parent, slug=args.slug, operator=args.operator,
             work_orders=orders, floor=args.floor, expires=args.expires, scope_approved=True)


def pin(s):
    require(s.get("scope_approved") and not s.get("version"), "Complete scope review first or follow credential rotation.")
    require(datetime.fromisoformat(s["expires"]) > now(), "Approved token expiration has passed.")
    approve("credential")
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        token = getpass.getpass("Paste the existing QuickBooks Time token (input hidden): ")
    require(re.fullmatch(r"[!-~]{1,4096}", token), "Invalid token input. No version was uploaded.")
    data = json.dumps({
        "environment": "production", "databaseUid": UID, "modifiedFrom": s["floor"], "tenant": TENANT,
        "companyId": s["company"], "userId": s["actor"], "customerParentId": s["parent"],
        "clientUrl": s["slug"], "expiresAt": s["expires"], "accessToken": token,
    }, separators=(",", ":")).encode()
    del token
    if not exists(secret("list"), SECRET):
        secret("create", SECRET, output=None)
    digest = hashlib.sha256(data).hexdigest()
    item = secret("versions", "add", SECRET, "--data-file=-", payload=data)
    del data
    version_id = item["name"].rsplit("/", 1)[-1]
    require(NUMBER.fullmatch(version_id), "A version may have uploaded. Inspect its metadata before retrying.")
    s.update(version=version_id, digest=digest)
    print("Regional version pinned. No credential material was written to disk.")


def create_job(s, replace):
    baseline(s)
    updating = exists(run("jobs", "list"), JOB)
    if updating:
        item = run("jobs", "describe", JOB)
        try:
            validate_job(item, s)
        except Stop:
            require(replace and not s.get("enrolled"), "Existing job differs. Review it before approving a dormant-job update.")
            task = item["spec"]["template"]["spec"]["template"]["spec"]
            require(task["serviceAccountName"] == SA and len(task["containers"]) == 1
                    and task["containers"][0].get("command") == ["node"]
                    and task["containers"][0].get("args") == ["dist-server/operator.mjs", "sync-time-customer", TENANT]
                    and not task.get("volumes") and not task["containers"][0].get("volumeMounts"),
                    "Existing job has unrelated settings. Stop for review.")
            idle()
        else:
            print("Existing Time job matches the reviewed configuration.")
            return
    require(not exists(scheduler("list"), SCHEDULE), "A scheduler already exists. Review before creating the worker.")
    approve("job")
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", suffix=".json") as config:
        json.dump({**BASE, **time_env(s)}, config)
        config.flush()
        run("jobs", "update" if updating else "create", JOB, "--image=" + s["image"], "--service-account=" + SA, "--env-vars-file=" + config.name,
            "--command=node", "--args=dist-server/operator.mjs,sync-time-customer," + TENANT,
            "--tasks=1", "--parallelism=1", "--max-retries=0", "--task-timeout=1800s", output=None)
    validate_job(run("jobs", "describe", JOB), s)
    s.pop("verified", None)


def pilot(s, phase, save):
    if phase != "sync" or not s.get("cutover"):
        baseline(s)
    if phase == "enroll":
        require(s.get("verified"), "Complete read-only provider verification before enrollment.")
    if phase == "sync":
        require(s.get("enrolled"), "Complete customer enrollment first.")
    if exists(scheduler("list"), SCHEDULE):
        require(s.get("invoker") and schedule(s) == "PAUSED", "Pause the schedule before any manual worker execution.")
    idle()
    approve(phase)
    overrides = []
    if phase != "sync":
        overrides = ["--args=dist-server/operator.mjs,verify-time-customer," + TENANT + (",--apply" if phase == "enroll" else "")]
    elif not s.get("cutover"):
        s["cutoff"] = s.get("cutoff") or iso(now() - timedelta(seconds=62))
        s.pop("reconciliation", None)
        save()
    run("jobs", "execute", JOB, "--wait", *overrides, output=None)
    if phase == "verify":
        s["verified"] = True
    if phase == "enroll":
        s["enrolled"] = True
    print("Execution completed. Inspect the sanitized result in Cloud Run Jobs.")


def open_scheduler(s, phase, args):
    require(s.get("cutover") and serving(run("services", "describe", SERVICE)) == s.get("candidate"),
            "A separately approved dashboard cutover is required.")
    require(args.accept_browser, "After successful main-origin staff and client smoke checks, supply --accept-browser.")
    if phase == "scheduler-iam":
        invoker = args.invoker or ""
        require(re.fullmatch(r"[a-z][a-z0-9-]{5,29}@" + re.escape(PROJECT) + r"\.iam\.gserviceaccount\.com", invoker)
                and invoker != SA and s.get("invoker", invoker) == invoker, "Supply the approved dedicated same-project Scheduler service account.")
        cloud("iam", "service-accounts", "describe", invoker, output=None)
        approve(phase)
        run("jobs", "add-iam-policy-binding", JOB, "--member=serviceAccount:" + invoker,
            "--role=roles/run.invoker", output=None)
        s["invoker"] = invoker
        return
    require(s.get("invoker"), "Complete the job-only invocation approval first.")
    require(datetime.fromisoformat(s["expires"]) > now() + timedelta(days=1), "Less than one day of credential validity remains. Rotate first.")
    idle()
    if exists(scheduler("list"), SCHEDULE):
        current = schedule(s)
        if phase == "resume" and current == "PAUSED":
            approve(phase)
            scheduler("resume", SCHEDULE, output=None)
        else:
            require(current == "ENABLED", "Existing schedule is paused or disabled. Review before resuming.")
    else:
        require(phase == "scheduler", "The schedule does not exist.")
        approve(phase)
        scheduler("create", "http", SCHEDULE, "--schedule=0 6 * * *", "--time-zone=America/Regina",
                  "--uri=" + JOB_URI, "--http-method=POST", "--oauth-service-account-email=" + s["invoker"],
                  "--oauth-token-scope=https://www.googleapis.com/auth/cloud-platform", "--attempt-deadline=30s",
                  "--max-retry-attempts=1", "--min-backoff=60s", "--max-backoff=60s", output=None)
    require(schedule(s) == "ENABLED", "Schedule did not become enabled.")
    s["scheduled"] = True


def execute(s, args, save):
    phase = args.phase
    if phase == "preflight":
        database()
        ReadOnly().rules()
        name = serving(run("services", "describe", SERVICE))
        image, env, _, _ = revision(name)
        require(not s.get("baseline") or s["baseline"] == name, "The baseline already recorded is different.")
        require(env.get("ENABLE_QUICKBOOKS_TIME", "false") == "false" and env.get("PRODUCTION_TIME_APPROVED", "false") == "false",
                "Expected the existing Time-disabled production dashboard.")
        cloud("artifacts", "docker", "images", "describe", image, output=None)
        s.update(baseline=name, image=image)
        print(json.dumps({"serving_revision": name, "image": image, "database": DB, "uid": UID, "region": REGION,
                          "job_exists": exists(run("jobs", "list"), JOB), "schedule_exists": exists(scheduler("list"), SCHEDULE)}))
        return
    require(s.get("baseline"), "Run preflight first.")
    if phase == "report":
        result = {k: s[k] for k in ("baseline", "candidate", "verified", "enrolled", "reconciliation", "cutover", "scheduled") if k in s}
        if s.get("expires"):
            result.update(expires_at=s["expires"], renew_within_seven_days=datetime.fromisoformat(s["expires"]) <= now() + timedelta(days=7))
        print(json.dumps(result, indent=2))
        return
    if phase == "monitor":
        require(s.get("enrolled"), "No enrolled customer is recorded.")
        run_status = ReadOnly().doc("timeRuns/" + key("quickbooks-time-customer", s["company"], s["parent"])) or {}
        status = run_status.get("status")
        if status == "running" and run_status.get("expires", 0) <= now().timestamp() * 1000:
            status = "expired lease"
        last_success = run_status.get("lastSuccess")
        stale = not last_success or now() - datetime.fromisoformat(last_success) > timedelta(hours=26)
        print(json.dumps({"status": status, "last_success": last_success, "failed_count": run_status.get("failedCount"),
                          "error_stage": run_status.get("errorStage"), "stale": stale,
                          "renew_within_seven_days": datetime.fromisoformat(s["expires"]) <= now() + timedelta(days=7),
                          "schedule_state": schedule(s) if s.get("invoker") and exists(scheduler("list"), SCHEDULE) else "absent"}))
        return
    if phase == "configure":
        configure(s, args)
        return
    if phase == "rollback":
        require(serving(run("services", "describe", SERVICE)) in (s["baseline"], s.get("candidate")),
                "The serving revision is neither recorded revision. Review traffic manually.")
        revision(s["baseline"])
        approve(phase)
        if exists(scheduler("list"), SCHEDULE):
            schedule(s)
            scheduler("pause", SCHEDULE, output=None)
        run("services", "update-traffic", SERVICE, "--to-revisions=" + s["baseline"] + "=100",
            "--remove-tags=" + TAG, output=None)
        baseline(s)
        for field in ("candidate", "scheduled", "cutover", "reconciliation"):
            s.pop(field, None)
        print("Production baseline restored. Inspect in-flight executions separately.")
        return
    if phase == "pause":
        schedule(s)
        approve(phase)
        scheduler("pause", SCHEDULE, output=None)
        require(schedule(s) == "PAUSED", "Schedule is not paused.")
        s["scheduled"] = False
        return
    database()
    if phase == "credential":
        baseline(s)
        pin(s)
        return
    require(s.get("version"), "Pin an approved credential first.")
    version(s)
    if phase == "secret-iam":
        baseline(s)
        approve(phase)
        secret("add-iam-policy-binding", SECRET, "--member=serviceAccount:" + SA,
               "--role=roles/secretmanager.secretAccessor", "--condition=None", output=None)
        s["secret_access_reviewed"] = True
        return
    if phase == "job":
        require(s.get("secret_access_reviewed"), "Complete the separately approved secret-access gate first.")
        create_job(s, args.replace_reviewed_job)
        return
    validate_job(run("jobs", "describe", JOB), s)
    if phase in ("verify", "enroll", "sync"):
        if phase == "enroll":
            require(args.accept_verify, "Review the dry-run counts and independently approved scope, then supply --accept-verify.")
        pilot(s, phase, save)
        return
    if phase == "reconcile":
        require(s.get("cutoff") and args.totals, "Run the initial import and provide the reviewed CSV.")
        idle()
        s["reconciliation"] = reconciliation(s, read_report(args.totals, s["work_orders"]), ReadOnly())
        print(json.dumps(s["reconciliation"]))
        return
    require(s.get("reconciliation"), "Reconcile the first import before enabling the dashboard or schedule.")
    if phase in ("candidate", "cutover") and exists(scheduler("list"), SCHEDULE):
        require(s.get("invoker") and schedule(s) == "PAUSED", "The existing schedule must be reviewed and paused during dashboard rollout.")
    if phase == "candidate":
        service = baseline(s)
        if not any(t.get("tag") == TAG for t in service["status"]["traffic"]):
            require(service["status"].get("latestCreatedRevisionName") == s["baseline"],
                    "The service template differs from the baseline. Review the current template before updating.")
            _, _, timeout, _ = revision(s["baseline"])
            approve(phase)
            updates = ",".join(k + "=" + v for k, v in time_env(s).items())
            run("services", "update", SERVICE, "--image=" + s["image"], "--no-traffic", "--tag=" + TAG,
                "--timeout=" + str(max(210, timeout)) + "s", "--update-env-vars=" + updates, output=None)
        s["candidate"], tag = candidate(s)
        print(f"Verified zero-traffic candidate: {tag}")
        return
    if phase == "cutover":
        require(s.get("candidate") and args.accept_candidate, "Review candidate smoke and supply --accept-candidate.")
        name, _ = candidate(s)
        approve(phase)
        run("services", "update-traffic", SERVICE, "--to-revisions=" + name + "=100", output=None)
        require(serving(run("services", "describe", SERVICE)) == name, "Traffic differs after cutover. Review rollback.")
        s["cutover"] = True
        return
    open_scheduler(s, phase, args)


def main():
    import fcntl  # The entry point runs in Linux Cloud Shell. Tests import the pure checks on Windows.
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=PHASES)
    for option in ("company", "actor", "parent", "slug", "operator", "identity-evidence", "iam-evidence", "floor", "expires", "totals", "invoker"):
        parser.add_argument("--" + option)
    parser.add_argument("--work-order", action="append")
    for gate in ("accept-verify", "accept-candidate", "accept-browser", "replace-reviewed-job"):
        parser.add_argument("--" + gate, action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    folder = Path.home() / ".mi-zagime-time-production"
    folder.mkdir(mode=0o700, exist_ok=True)
    require(not folder.is_symlink() and folder.stat().st_uid == os.getuid()
            and stat.S_IMODE(folder.stat().st_mode) == 0o700, "Activation directory must be private and owner-controlled.")
    path = folder / "state.json"
    with open(folder / "lock", "a", encoding="utf8") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(not path.is_symlink() and (not path.exists() or stat.S_IMODE(path.stat().st_mode) == 0o600),
                "Activation state file must be private.")
        state = json.loads(path.read_text()) if path.exists() else {}

        def save():
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf8", dir=folder, delete=False) as file:
                json.dump(state, file, indent=2)
            os.replace(file.name, path)

        execute(state, args, save)
        if args.phase not in ("report", "monitor"):
            save()
        print(f"{args.phase}: complete")


if __name__ == "__main__":
    try:
        main()
    except Stop as error:
        raise SystemExit("STOP: " + str(error)) from None
    except (OSError, ValueError, KeyError, TypeError, AttributeError, KeyboardInterrupt, EOFError, getpass.GetPassWarning):
        raise SystemExit("STOP: Input, Cloud Shell prerequisites or cloud metadata could not be verified. Inspect the phase before retrying.") from None
