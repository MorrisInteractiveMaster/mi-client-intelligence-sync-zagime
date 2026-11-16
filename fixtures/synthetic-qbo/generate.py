"""Synthetic QuickBooks Online data for the Zagime dashboard.

All people, projects, hours and descriptions are synthetic. Hours per project per
month reproduce Dev's prototype seed (ZagimeGithub/src/data/seed.ts) so the totals
match the demo (1,054 hours, May to October 2026). Run: python3 generate.py
"""
import json, random, datetime as dt
from pathlib import Path

random.seed(20261023)
OUT = Path(__file__).parent
TZ = "-06:00"  # Saskatchewan time, no daylight saving
PULL1 = "2026-10-23T09:00:00" + TZ
PULL2 = "2026-10-23T10:00:00" + TZ
AS_OF = dt.date(2026, 10, 22)  # last day included in pull 1
HOLIDAYS = {dt.date(2026, 5, 18), dt.date(2026, 7, 1), dt.date(2026, 8, 3), dt.date(2026, 9, 7),
            dt.date(2026, 9, 30), dt.date(2026, 10, 12)}

CLIENT = "Zagimē Anishinabēk"

# ---- From Dev's seed.ts -------------------------------------------------------
CATEGORIES = ["Learning Services", "LINK - Consulting", "LINK - Governance & Strategy",
              "LINK - Prevention", "LINK - HR Services", "LINK - Financial Services",
              "LINK - Proposals & Applications", "LINK - Health",
              "Public Courses (Conferences & Workshops)", "Career Transformation"]
PEOPLE = [("Maya", "Sinclair"), ("Daniel", "Cardinal"), ("Elena", "Brooks"),
          ("Noah", "Bennett"), ("Avery", "Thomas"), ("Sophie", "Martin")]
# name, workOrder, parent index, category, status, cap, manager, start
ROWS = [
    ("Community leadership & advisory", "WO1267", None, 1, "On track", 800, 0, "2026-05-01"),
    ("HR policy renewal", "WO1267.1", 0, 4, "Attention", 240, 2, "2026-05-15"),
    ("Governance framework", "WO1267.2", 0, 2, "On track", 280, 1, "2026-06-01"),
    ("Leadership capacity building", "WO1267.3", 0, 0, "On track", 180, 4, "2026-07-01"),
    ("Financial resilience", "WO1268", None, 5, "On track", 460, 3, "2026-05-01"),
    ("Budget planning & reporting", "WO1268.1", 4, 5, "On track", 220, 3, "2026-06-01"),
    ("Finance team development", "WO1268.2", 4, 0, "On track", 160, 4, "2026-08-01"),
    ("Community wellness planning", "WO1372", None, 7, "Delayed", 340, 0, "2026-07-01"),
    ("Prevention service roadmap", "WO1372.1", 7, 3, "Delayed", 200, 1, "2026-08-01"),
    ("Community engagement sessions", "WO1372.2", 7, 7, "On track", 100, 5, "2026-08-15"),
    ("Proposal development sprint", "WO1198", None, 6, "Completed", 120, 1, "2026-05-01"),
]
TARGETS = [74, 190, 168, 88, 52, 140, 58, 24, 102, 46, 112]


def dev_monthly(i):
    """Dev's exact month split from seed.ts."""
    total = TARGETS[i]
    start = int(ROWS[i][7][5:7])
    end = 7 if ROWS[i][4] == "Completed" else 10
    count = end - start + 1
    used, out = 0, {}
    for m in range(start, end + 1):
        h = total - used if m == end else round((total / count) * (0.8 + (m - start) * 0.09) + 1e-9)
        used += h
        out[m] = h
    return out


DESCRIPTIONS = {
    0: ["Session design and facilitation materials", "Facilitated learning session", "Participant follow-up and action plans",
        "Coaching session preparation", "Learning session debrief"],
    1: ["Advisory meeting with leadership", "Workplan coordination", "Priority-setting follow-up",
        "Briefing note for leadership", "Partnership check-in"],
    2: ["Governance framework drafting", "Decision-rights mapping", "Committee terms of reference review",
        "Leadership interview for governance input", "Framework validation prep"],
    3: ["Prevention service mapping", "Community input session prep", "Roadmap recommendations drafting",
        "Service inventory review"],
    4: ["Policy drafting", "Policy review with HR lead", "Employee handbook alignment", "Consolidating policy feedback",
        "Job description review"],
    5: ["Monthly reporting package", "Budget assumptions workshop prep", "Finance team coaching",
        "Month-end process walkthrough", "Year-end planning draft"],
    6: ["Proposal writing", "Evidence and data gathering for application", "Budget narrative drafting",
        "Final proposal review and submission"],
    7: ["Community engagement session", "Wellness plan drafting", "Health leadership coordination",
        "Engagement themes summary", "Listening session notes and follow-up"],
}
INTERNAL = ["Internal prep and planning", "Internal team sync"]

# ---- IDs ----------------------------------------------------------------------
def meta(created, updated=None):
    return {"CreateTime": created, "LastUpdatedTime": updated or created}

T0 = "2026-04-28T10:15:00" + TZ
customers, wo_ids = [], {}
customers.append({"Id": "101", "SyncToken": "0", "domain": "QBO", "sparse": False, "DisplayName": CLIENT,
                  "FullyQualifiedName": CLIENT, "CompanyName": CLIENT, "Job": False, "BillWithParent": False,
                  "Level": 0, "Active": True, "PrimaryEmailAddr": {"Address": "admin@zagime.example.com"},
                  "MetaData": meta(T0)})
for i, r in enumerate(ROWS):
    cid = str(102 + i)
    wo_ids[i] = cid
    parent = "101" if r[2] is None else wo_ids[r[2]]
    parent_fqn = CLIENT if r[2] is None else customers[int(wo_ids[r[2]]) - 101]["FullyQualifiedName"]
    name = f"{r[1]} {r[0]}"
    customers.append({"Id": cid, "SyncToken": "0", "domain": "QBO", "sparse": False, "DisplayName": name,
                      "FullyQualifiedName": f"{parent_fqn}:{name}", "Job": True, "BillWithParent": True,
                      "ParentRef": {"value": parent}, "Level": 1 if r[2] is None else 2,
                      "Active": r[4] != "Completed", "MetaData": meta(r[7] + "T09:00:00" + TZ)})
# Second, unrelated synthetic client: its hours must never reach Zagime's view.
customers.append({"Id": "150", "SyncToken": "0", "domain": "QBO", "sparse": False, "DisplayName": "Test Client B",
                  "FullyQualifiedName": "Test Client B", "CompanyName": "Test Client B", "Job": False,
                  "BillWithParent": False, "Level": 0, "Active": True, "MetaData": meta(T0)})
customers.append({"Id": "151", "SyncToken": "0", "domain": "QBO", "sparse": False,
                  "DisplayName": "WO9001 Payroll process review",
                  "FullyQualifiedName": "Test Client B:WO9001 Payroll process review", "Job": True,
                  "BillWithParent": True, "ParentRef": {"value": "150"}, "Level": 1, "Active": True,
                  "MetaData": meta("2026-09-01T09:00:00" + TZ)})
CUST = {c["Id"]: c for c in customers}

employees = []
for i, (g, f) in enumerate(PEOPLE):
    employees.append({"Id": str(55 + i), "SyncToken": "0", "domain": "QBO", "sparse": False,
                      "DisplayName": f"{g} {f}", "GivenName": g, "FamilyName": f, "Active": True,
                      "PrimaryEmailAddr": {"Address": f"{g.lower()}.{f.lower()}@example.com"},
                      "MetaData": meta(T0)})
vendors = [{"Id": "77", "SyncToken": "0", "domain": "QBO", "sparse": False, "DisplayName": "Jordan Reyes",
            "GivenName": "Jordan", "FamilyName": "Reyes", "Vendor1099": True, "Active": True,
            "MetaData": meta("2026-10-01T11:00:00" + TZ)}]
items = [{"Id": str(20 + i), "SyncToken": "0", "domain": "QBO", "sparse": False, "Name": n,
          "FullyQualifiedName": n, "Type": "Service", "Active": True, "MetaData": meta(T0)}
         for i, n in enumerate(CATEGORIES)]
items.append({"Id": "40", "SyncToken": "0", "domain": "QBO", "sparse": False, "Name": "Internal (non-billable)",
              "FullyQualifiedName": "Internal (non-billable)", "Type": "Service", "Active": True, "MetaData": meta(T0)})
ITEM = {it["Id"]: it for it in items}

# ---- Time entries -------------------------------------------------------------
def workdays(year, month, start, end):
    d = dt.date(year, month, 1)
    out = []
    while d.month == month:
        if d.weekday() < 5 and d not in HOLIDAYS and start <= d <= end:
            out.append(d)
        d += dt.timedelta(days=1)
    return out

load = {}  # (person, date) -> hours, keeps days realistic
acts, next_id = [], [1001]
CHUNKS = [0.5, 0.75, 1, 1, 1.5, 1.5, 2, 2, 2.5, 3, 3, 3.5, 4]


def stamp(d):
    lag = random.choice([0, 0, 1, 1, 2, 3])
    c = dt.datetime.combine(d + dt.timedelta(days=lag), dt.time(random.randint(15, 18), random.choice([0, 15, 30, 45])))
    if c.date() > AS_OF:
        c = dt.datetime.combine(AS_OF, dt.time(17, 30))
    return c.strftime("%Y-%m-%dT%H:%M:%S") + TZ


def add(person, cust, item, d, hours, desc, billable="Billable", name_of="Employee", case=""):
    h = int(hours)
    m = int(round((hours - h) * 60))
    ref = ({"EmployeeRef": {"value": person, "name": next(e["DisplayName"] for e in employees if e["Id"] == person)}}
           if name_of == "Employee" else {"VendorRef": {"value": person, "name": vendors[0]["DisplayName"]}})
    created = stamp(d)
    act = {"Id": str(next_id[0]), "SyncToken": "0", "domain": "QBO", "sparse": False, "TxnDate": d.isoformat(),
           "NameOf": name_of, **ref,
           "CustomerRef": {"value": cust, "name": CUST[cust]["FullyQualifiedName"]},
           "ItemRef": {"value": item, "name": ITEM[item]["Name"]},
           "BillableStatus": billable, "Taxable": False, "Hours": h, "Minutes": m,
           "Description": desc, "MetaData": meta(created)}
    if case:
        act["_testCase"] = case  # not a QuickBooks field; strip before treating as API output
    next_id[0] += 1
    acts.append(act)
    load[(person, d)] = load.get((person, d), 0) + hours
    return act


def q(x):
    return round(x * 4) / 4

forced_quarter = False
for i, r in enumerate(ROWS):
    mgr = r[6]
    team = [mgr, (mgr + 1) % 6, 5]
    team = list(dict.fromkeys(team))
    shares = [0.55, 0.30, 0.15][:len(team)]
    shares[0] += 1 - sum(shares)
    start = dt.date.fromisoformat(r[7])
    end = dt.date(2026, 7, 31) if r[4] == "Completed" else AS_OF
    for month, total in dev_monthly(i).items():
        days = workdays(2026, month, start, end)
        split = [q(total * s) for s in shares[1:]]
        split = [total - sum(split)] + split
        for p_idx, hours in zip(team, split):
            pid = str(55 + p_idx)
            remaining = hours
            while remaining > 0:
                if not forced_quarter and i == 9 and remaining >= 1:
                    chunk, forced_quarter = 0.25, True
                else:
                    chunk = min(random.choice(CHUNKS), remaining)
                for _ in range(40):
                    d = random.choice(days)
                    if load.get((pid, d), 0) + chunk <= 7.5:
                        break
                cat = r[3]
                internal = random.random() < 0.06 and r[4] != "Completed"
                desc = random.choice(INTERNAL) if internal else random.choice(DESCRIPTIONS[cat])
                item = "40" if internal else str(20 + cat)
                billable = "NotBillable" if internal else ("HasBeenBilled" if r[4] == "Completed" else "Billable")
                case = "15-minute entry" if chunk == 0.25 else ""
                add(pid, wo_ids[i], item, d, chunk, desc, billable, case=case)
                remaining = round(remaining - chunk, 2)

# Identical-looking twin: same person, date, hours and text, different Id. Both are real.
src = next(a for a in acts if a["CustomerRef"]["value"] == wo_ids[1] and a["TxnDate"].startswith("2026-09")
           and a["Hours"] == 2 and a["Minutes"] == 0 and "_testCase" not in a)
src["Hours"] = 1  # split one 2 h entry into two identical 1 h entries, so totals are unchanged
src["_testCase"] = "Twin entry (part 1 of 2)"
add(src["EmployeeRef"]["value"], src["CustomerRef"]["value"], src["ItemRef"]["value"],
    dt.date.fromisoformat(src["TxnDate"]), 1, src["Description"], src["BillableStatus"],
    case="Twin entry (part 2 of 2)")

# Dev's two unallocated review entries: client-level, no work order.
add("55", "101", "21", dt.date(2026, 10, 20), 6, "Leadership planning follow-up", case="No work order")
add("77", "101", "27", dt.date(2026, 10, 21), 3.5, "Community workshop preparation", name_of="Vendor",
    case="No work order; contractor not on the team list")

# Second client, separate work order.
for d, p, h, desc in [(dt.date(2026, 9, 8), "58", 2, "Payroll process interviews"),
                      (dt.date(2026, 9, 15), "58", 3, "Payroll workflow mapping"),
                      (dt.date(2026, 9, 22), "57", 2.5, "Policy cross-check"),
                      (dt.date(2026, 10, 6), "58", 4, "Recommendations drafting"),
                      (dt.date(2026, 10, 14), "57", 1.5, "Review meeting"),
                      (dt.date(2026, 10, 20), "58", 2, "Final report edits")]:
    add(p, "151", "25", d, h, desc, case="Other client: must never appear for Zagimē")

# QuickBooks Ids rise with creation time, so renumber in CreateTime order, then list by date.
acts.sort(key=lambda a: (a["MetaData"]["CreateTime"], a["TxnDate"], int(a["Id"])))
for n, a in enumerate(acts):
    a["Id"] = str(1001 + n)
next_id[0] = 1001 + len(acts)
acts.sort(key=lambda a: (a["TxnDate"], int(a["Id"])))

# ---- Pull 2: change data capture an hour later -----------------------------------
edited_src = next(a for a in reversed(acts) if a["TxnDate"].startswith("2026-10") and a["Hours"] == 3
                  and a["Minutes"] == 0 and a["CustomerRef"]["value"] in wo_ids.values())
edited = json.loads(json.dumps(edited_src))
edited["SyncToken"] = "1"
edited["Hours"] = 4
edited["Description"] += " (corrected)"
edited["MetaData"]["LastUpdatedTime"] = "2026-10-23T09:20:00" + TZ
edited["_testCase"] = "Edited after pull 1: 3 h to 4 h"
deleted_src = next(a for a in reversed(acts) if a["TxnDate"].startswith("2026-10") and a["Hours"] == 2
                   and a["Minutes"] == 0 and a["CustomerRef"]["value"] in wo_ids.values() and a is not edited_src
                   and "_testCase" not in a)
deleted = {"domain": "QBO", "status": "Deleted", "Id": deleted_src["Id"],
           "MetaData": {"LastUpdatedTime": "2026-10-23T09:35:00" + TZ},
           "_testCase": "Deleted after pull 1 (2 h entered in error)"}
n_before = len(acts)
new1 = add("55", wo_ids[0], "21", dt.date(2026, 10, 23), 1.5, "Advisory meeting with leadership",
           case="New after pull 1")
new2 = add("60", wo_ids[9], "27", dt.date(2026, 10, 23), 2, "Community engagement session", case="New after pull 1")
for a in (new1, new2):
    a["MetaData"] = meta("2026-10-23T09:45:00" + TZ)
new_acts = acts[n_before:]
acts = acts[:n_before]

# ---- Write JSON ---------------------------------------------------------------
def query(entity, rows, at=PULL1):
    return {"QueryResponse": {entity: rows, "startPosition": 1, "maxResults": len(rows)}, "time": at}

(OUT / "customers.json").write_text(json.dumps(query("Customer", customers), ensure_ascii=False, indent=2))
(OUT / "employees.json").write_text(json.dumps(query("Employee", employees), ensure_ascii=False, indent=2))
(OUT / "vendors.json").write_text(json.dumps(query("Vendor", vendors), ensure_ascii=False, indent=2))
(OUT / "items.json").write_text(json.dumps(query("Item", items), ensure_ascii=False, indent=2))
(OUT / "timeActivity.json").write_text(json.dumps(query("TimeActivity", acts), ensure_ascii=False, indent=2))
cdc = {"CDCResponse": [{"QueryResponse": [{"TimeActivity": [edited, deleted] + new_acts,
                                           "startPosition": 1, "maxResults": 2 + len(new_acts)}]}],
       "time": PULL2, "_changedSince": PULL1}
(OUT / "cdcChanges.json").write_text(json.dumps(cdc, ensure_ascii=False, indent=2))

# ---- Self-check against Dev's seed ---------------------------------------------
hrs = lambda a: a["Hours"] + a["Minutes"] / 60
for i in range(len(ROWS)):
    got = {}
    for a in acts:
        if a["CustomerRef"]["value"] == wo_ids[i]:
            m = int(a["TxnDate"][5:7]); got[m] = got.get(m, 0) + hrs(a)
    exp = dev_monthly(i)
    assert all(abs(got.get(m, 0) - v) < 1e-9 for m, v in exp.items()) and sum(got.values()) == TARGETS[i], (i, got, exp)
assert len({a["Id"] for a in acts + new_acts}) == len(acts) + len(new_acts)
print("entries", len(acts), "zagime WO hours", sum(hrs(a) for a in acts if a["CustomerRef"]["value"] in wo_ids.values()),
      "client-level", sum(hrs(a) for a in acts if a["CustomerRef"]["value"] == "101"),
      "test client B", sum(hrs(a) for a in acts if a["CustomerRef"]["value"] == "151"),
      "max day", max(load.values()))

# ---- Excel copy ------------------------------------------------------------------
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

F = Font(name="Arial", size=10)
FB = Font(name="Arial", size=10, bold=True, color="FFFFFF")
FBLUE = Font(name="Arial", size=10, color="0000FF")
FT = Font(name="Arial", size=14, bold=True)
HEAD = PatternFill("solid", fgColor="01264F")

wb = Workbook()
readme = wb.active
readme.title = "README"


def sheet(title, headers, rows, widths):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for c in ws[1]:
        c.font, c.fill = FB, HEAD
    for r in rows:
        ws.append(r)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            if c.font != FBLUE:
                c.font = F
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    return ws

wo_of = lambda c: c["DisplayName"].split(" ")[0] if c["Job"] else "(none)"
top = lambda c: c["FullyQualifiedName"].split(":")[0]
sheet("Customers", ["Id", "DisplayName", "FullyQualifiedName", "WorkOrder (from DisplayName)", "ParentId",
                    "Level", "Job", "Active", "Client"],
      [[c["Id"], c["DisplayName"], c["FullyQualifiedName"], wo_of(c), c.get("ParentRef", {}).get("value", ""),
        c["Level"], c["Job"], c["Active"], top(c)] for c in customers], [8, 42, 70, 16, 10, 7, 7, 8, 22])
sheet("People", ["Id", "Type", "DisplayName", "Email", "On Dev's team list"],
      [[e["Id"], "Employee", e["DisplayName"], e["PrimaryEmailAddr"]["Address"], "Yes"] for e in employees]
      + [[v["Id"], "Vendor", v["DisplayName"], "", "No"] for v in vendors], [8, 11, 18, 30, 18])
sheet("Items", ["Id", "Name", "Type"], [[i["Id"], i["Name"], i["Type"]] for i in items], [8, 42, 10])

who = lambda a: a.get("EmployeeRef") or a.get("VendorRef")
n = len(acts)
ta_rows = []
for k, a in enumerate(acts, start=2):
    ta_rows.append([a["Id"], a["SyncToken"], dt.date.fromisoformat(a["TxnDate"]), a["NameOf"], who(a)["value"],
                    who(a)["name"], a["CustomerRef"]["value"], a["CustomerRef"]["name"],
                    f'=INDEX(Customers!$D:$D,MATCH(G{k},Customers!$A:$A,0))',
                    f'=INDEX(Customers!$I:$I,MATCH(G{k},Customers!$A:$A,0))',
                    a["ItemRef"]["name"], a["BillableStatus"], a["Hours"], a["Minutes"], f"=M{k}+N{k}/60",
                    a["Description"], a["MetaData"]["CreateTime"], a["MetaData"]["LastUpdatedTime"],
                    a.get("_testCase", "")])
ta = sheet("TimeActivity", ["Id", "SyncToken", "TxnDate", "NameOf", "PersonId", "PersonName", "CustomerId",
                            "CustomerName", "WorkOrder", "Client", "Item", "BillableStatus", "Hours", "Minutes",
                            "DecimalHours", "Description", "CreateTime", "LastUpdatedTime", "Test case"],
           ta_rows, [7, 10, 11, 10, 9, 16, 11, 60, 11, 20, 34, 14, 7, 8, 12, 44, 26, 26, 40])
for r in range(2, n + 2):
    ta[f"C{r}"].number_format = "yyyy-mm-dd"
    ta[f"O{r}"].number_format = "0.00"

ch_rows = []
for a in cdc["CDCResponse"][0]["QueryResponse"][0]["TimeActivity"]:
    if a.get("status") == "Deleted":
        ch_rows.append(["Deleted", a["Id"], "", "", "", "", "", "", "", a["MetaData"]["LastUpdatedTime"], a["_testCase"]])
    else:
        kind = "Edited" if a["SyncToken"] != "0" else "New"
        ch_rows.append([kind, a["Id"], a["SyncToken"], a["TxnDate"], who(a)["name"], a["CustomerRef"]["name"],
                        a["Hours"], a["Minutes"], a["Description"], a["MetaData"]["LastUpdatedTime"], a["_testCase"]])
sheet("Changes", ["Change", "Id", "SyncToken", "TxnDate", "Person", "Customer", "Hours", "Minutes", "Description",
                  "LastUpdatedTime", "Test case"], ch_rows, [10, 7, 10, 11, 16, 60, 7, 8, 44, 26, 40])

# Checks: formulas against Dev's expected totals (blue = hardcoded from seed.ts).
ck = wb.create_sheet("Checks")
last = n + 1
rng = lambda col: f"TimeActivity!${col}$2:${col}${last}"
ck["A1"] = "Hours by work order (pull 1) against Dev's seed.ts"
ck["A1"].font = Font(name="Arial", size=12, bold=True)
ck.append(["WorkOrder", "Project", "Expected (seed.ts)", "Actual", "Difference"])
for c in ck[2]:
    c.font, c.fill = FB, HEAD
for i, r in enumerate(ROWS):
    row = 3 + i
    ck.append([r[1], r[0], TARGETS[i], f'=SUMIFS({rng("O")},{rng("I")},A{row})', f"=D{row}-C{row}"])
    ck[f"C{row}"].font = FBLUE
end = 3 + len(ROWS) - 1
ck.append(["Total", "Zagimē work orders", f"=SUM(C3:C{end})", f"=SUM(D3:D{end})", f"=D{end+1}-C{end+1}"])
ck[f"C3"].comment = Comment("Hardcoded from TARGETS in ZagimeGithub/src/data/seed.ts (Dev's prototype).", "Claude")
mrow = end + 3
ck[f"A{mrow}"] = "Zagimē work-order hours by month"
ck[f"A{mrow}"].font = Font(name="Arial", size=12, bold=True)
ck.append(["Month", "Month number", "Expected (seed.ts)", "Actual", "Difference"])
for c in ck[mrow + 1]:
    c.font, c.fill = FB, HEAD
exp_month = {}
for i in range(len(ROWS)):
    for m, h in dev_monthly(i).items():
        exp_month[m] = exp_month.get(m, 0) + h
for j, (name, m) in enumerate(zip(["May", "Jun", "Jul", "Aug", "Sep", "Oct"], range(5, 11))):
    row = mrow + 2 + j
    ck.append([name, m, exp_month[m],
               f'=SUMPRODUCT((MONTH({rng("C")})=B{row})*({rng("I")}<>"(none)")*({rng("J")}="{CLIENT}")*{rng("O")})',
               f"=D{row}-C{row}"])
    ck[f"C{row}"].font = FBLUE
orow = mrow + 9
ck[f"A{orow}"] = "Other hours in pull 1 (should be excluded from Zagimē work-order totals)"
ck[f"A{orow}"].font = Font(name="Arial", size=12, bold=True)
ck.append(["Group", "", "", "Hours"])
for c in ck[orow + 1]:
    c.font, c.fill = FB, HEAD
ck.append(["Zagimē, no work order", "", "", f'=SUMIFS({rng("O")},{rng("J")},"{CLIENT}",{rng("I")},"(none)")'])
ck.append(["Test Client B", "", "", f'=SUMIFS({rng("O")},{rng("J")},"Test Client B")'])
ck.append(["Non-billable (inside Zagimē work orders)", "", "",
           f'=SUMIFS({rng("O")},{rng("L")},"NotBillable",{rng("J")},"{CLIENT}",{rng("I")},"<>(none)")'])
for row in ck.iter_rows(min_row=3):
    for c in row:
        if c.font != FBLUE and not (c.font and c.font.bold):
            c.font = F
for col, w in zip("ABCDE", [40, 34, 18, 12, 12]):
    ck.column_dimensions[col].width = w

lines = [
    ("Synthetic QuickBooks Online data: Zagimē dashboard", FT),
    ("Every person, project, hour and description here is made up. Do not mix with real QuickBooks data.", F),
    ("", F),
    ("What it is", Font(name="Arial", size=11, bold=True)),
    ("A stand-in for what an hourly sync would pull from the QuickBooks Online API: customers and work-order jobs, "
     "employees, a contractor, service items and TimeActivity entries, May 1 to October 22, 2026.", F),
    ("Hours per work order per month match Dev's prototype (seed.ts): 1,054 hours in total. See the Checks sheet.", F),
    ("The JSON files in this folder are the API-shaped version. This workbook holds the same rows for reading.", F),
    ("", F),
    ("Sheets", Font(name="Arial", size=11, bold=True)),
    ("TimeActivity: pull 1 at 9:00 am, October 23. WorkOrder, Client and DecimalHours are formulas.", F),
    ("Changes: pull 2 an hour later (change data capture): one edit, one delete, two new entries.", F),
    ("Customers, People, Items: reference lists. Checks: totals against Dev's seed.ts.", F),
    ("", F),
    ("Test cases (see the Test case column)", Font(name="Arial", size=11, bold=True)),
    ("Run pull 1 twice: the second run should write nothing.", F),
    ("Twin entries: same person, date, hours and text, different Ids. Both are real and both count.", F),
    ("No work order: 9.5 hours booked to Zagimē itself, including a contractor not on the team list.", F),
    ("Test Client B: 15 hours that must never appear in Zagimē's view.", F),
    ("Pull 2: an edited entry (3 to 4 hours), a deleted entry, and two new entries dated October 23.", F),
    ("15-minute entries and non-billable internal time are mixed in.", F),
    ("", F),
    ("Notes on this first version (pretend data, not MI's real QuickBooks setup)", Font(name="Arial", size=11, bold=True)),
    ("Work orders are modelled as sub-customer jobs, with child work orders (WO1267.1) under their parent job.", F),
    ("Service items reuse Dev's category names. Hourly rates are left out on purpose.", F),
    ("Entries carry no approved/pending flag.", F),
    ("Times use Saskatchewan time (UTC-6). Weekends and stat holidays are skipped.", F),
    ("", F),
    ("Rebuild: python3 generate.py (seeded, so the output is identical every run).", F),
]
for text, font in lines:
    readme.append([text])
    readme.cell(readme.max_row, 1).font = font
readme.column_dimensions["A"].width = 120
for row in readme.iter_rows():
    row[0].alignment = Alignment(wrap_text=True, vertical="top")
wb.move_sheet("Checks", offset=-(len(wb.sheetnames) - 2))
wb.save(OUT / "qboSynthetic.xlsx")
print("xlsx saved", wb.sheetnames)
