"""Four extra synthetic QuickBooks Online scenarios for testing the "At a glance" animation.

Each scenario is written as QuickBooks-shaped JSON (customers, employees, items, timeActivity),
then converted to the dashboard data shape the same way as the baseline. All data is synthetic.
Run: python3 variants.py   (seeded, identical output every run)
"""
import datetime as dt
import json
import random
from pathlib import Path

OUT = Path(__file__).parent / "variants"
TZ = "-06:00"
CLIENT = "Zagimē Anishinabēk"
HOLIDAYS = {dt.date(2025, 11, 11), dt.date(2025, 12, 25), dt.date(2026, 1, 1), dt.date(2026, 2, 16),
            dt.date(2026, 4, 3), dt.date(2026, 5, 18), dt.date(2026, 7, 1), dt.date(2026, 8, 3),
            dt.date(2026, 9, 7), dt.date(2026, 9, 30), dt.date(2026, 10, 12)}
CATS = ["Learning Services", "Consulting", "Governance & Strategy", "Prevention", "HR Services",
        "Financial Services", "Proposals & Applications", "Health", "Public Courses", "Career Transformation"]
ITEM_NAMES = ["Learning Services", "LINK - Consulting", "LINK - Governance & Strategy", "LINK - Prevention",
              "LINK - HR Services", "LINK - Financial Services", "LINK - Proposals & Applications", "LINK - Health",
              "Public Courses (Conferences & Workshops)", "Career Transformation"]
PEOPLE = [("Maya", "Sinclair", "Client Partnership Lead"), ("Daniel", "Cardinal", "Governance & Strategy Lead"),
          ("Elena", "Brooks", "HR Consultant"), ("Noah", "Bennett", "Financial Consultant"),
          ("Avery", "Thomas", "Learning Facilitator"), ("Sophie", "Martin", "Project Coordinator")]
MILESTONES = ["Discovery & alignment", "Draft & develop", "Review & validate", "Deliver & hand over"]
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
        "November", "December"]
DESC = {0: ["Facilitated learning session", "Session design and materials", "Participant follow-up"],
        1: ["Advisory meeting with leadership", "Workplan coordination", "Briefing note for leadership"],
        2: ["Governance framework drafting", "Decision-rights mapping", "Board orientation session"],
        3: ["Prevention service mapping", "Community input session prep", "Roadmap drafting"],
        4: ["Policy drafting", "Policy review with HR lead", "Job description review"],
        5: ["Monthly reporting package", "Budget assumptions workshop", "Finance team coaching"],
        6: ["Proposal writing", "Evidence gathering for application", "Budget narrative drafting"],
        7: ["Community engagement session", "Wellness plan drafting", "Health leadership coordination"],
        9: ["Career pathway mapping", "Employer outreach call", "Program design session"]}

# Project row: wo, name, parent, cat, status, cap, progress, manager, start, end, total hours, risk, next step
# Upcoming row: name, cat, cap, manager, start, end, next step
SCENARIOS = [
    {"key": "earlyDays", "label": "Early days", "asOf": "2026-10-23", "first": (2026, 9), "months": 2,
     "curve": [1, 1.35],
     "about": "Two months into a new partnership. One agreement, small numbers, nothing behind schedule.",
     "projects": [
         ("WO1401", "Governance review", None, 2, "On track", 300, 30, 1, "2026-09-01", "2027-02-26", 44, "", "Present the governance gaps summary to council."),
         ("WO1401.1", "Board orientation", "WO1401", 0, "On track", 80, 55, 4, "2026-09-08", "2026-12-11", 42, "", "Deliver the second orientation session."),
         ("WO1401.2", "Policy inventory", "WO1401", 4, "On track", 120, 20, 2, "2026-10-01", "2027-01-29", 24, "", "Finish collecting existing policies from departments.")],
     "upcoming": [("Strategic plan refresh", 2, 200, 0, "2027-01-18", "2027-06-30", "Agree the planning timeline with council.")]},
    {"key": "busyYear", "label": "Busy year", "asOf": "2026-10-23", "first": (2025, 11), "months": 12,
     "curve": [0.95, 0.6, 0.9, 1.05, 1.1, 1.0, 1.15, 1.2, 0.8, 0.85, 1.25, 1.35],
     "about": "A full year of work across five agreements. Large numbers, one project over its agreed hours.",
     "projects": [
         ("WO1180", "Community leadership & advisory", None, 1, "On track", 1600, 70, 0, "2025-11-03", "2027-03-31", 310, "", "Confirm the 2027 leadership priorities session."),
         ("WO1180.1", "HR policy renewal", "WO1180", 4, "Attention", 400, 88, 2, "2025-11-10", "2026-12-18", 428, "Hours are over the agreed 400. A change request is needed to finish.", "Approve additional hours for final policy review."),
         ("WO1180.2", "Governance framework", "WO1180", 2, "On track", 500, 76, 1, "2026-01-05", "2027-01-29", 362, "", "Validate the committee responsibilities matrix."),
         ("WO1180.3", "Leadership capacity building", "WO1180", 0, "On track", 300, 64, 4, "2026-03-02", "2027-02-26", 188, "", "Deliver the fourth coaching session."),
         ("WO1192", "Financial resilience", None, 5, "On track", 900, 72, 3, "2025-11-03", "2027-01-29", 214, "", "Review the year-end planning assumptions."),
         ("WO1192.1", "Budget planning & reporting", "WO1192", 5, "On track", 350, 80, 3, "2026-01-05", "2026-12-18", 276, "", "Complete the budget assumptions workshop."),
         ("WO1192.2", "Finance team development", "WO1192", 0, "On track", 250, 58, 4, "2026-04-06", "2027-01-29", 142, "", "Walk through the month-end checklist with the team."),
         ("WO1215", "Community-led emergency preparedness and response planning", None, 7, "Delayed", 700, 41, 0, "2026-02-02", "2026-12-11", 168, "Community sessions were postponed after the spring flooding.", "Agree revised session dates with the emergency committee."),
         ("WO1215.1", "Prevention service roadmap", "WO1215", 3, "On track", 300, 52, 1, "2026-04-06", "2027-01-29", 154, "", "Complete the remaining service mapping workshop."),
         ("WO1215.2", "Community engagement sessions", "WO1215", 7, "On track", 200, 66, 5, "2026-05-04", "2026-12-18", 131, "", "Validate the engagement themes with participants."),
         ("WO1240", "Education & training partnership", None, 0, "On track", 500, 62, 4, "2026-01-12", "2027-03-31", 296, "", "Launch the winter course schedule."),
         ("WO1198", "Proposal development sprint", None, 6, "Completed", 120, 100, 1, "2025-11-03", "2026-02-27", 117, "", "Monitor the funding decision through the client lead.")],
     "upcoming": [("Workforce pathways 2027", 9, 240, 4, "2027-01-11", "2027-04-30", "Hold a discovery conversation in December."),
                  ("Health leadership retreat", 7, 100, 0, "2027-02-08", "2027-03-12", "Prepare an initial scope and facilitation plan."),
                  ("Housing needs assessment", 2, 320, 1, "2027-03-01", "2027-08-27", "Confirm data sources with the housing department.")]},
    {"key": "toughQuarter", "label": "Tough quarter", "asOf": "2026-10-23", "first": (2026, 5), "months": 6,
     "curve": [1.0, 1.45, 1.7, 1.55, 1.2, 0.85],
     "about": "Hours are falling since July, three projects are delayed and one is over its agreed hours.",
     "projects": [
         ("WO1267", "Community leadership & advisory", None, 1, "Attention", 800, 58, 0, "2026-05-01", "2027-01-29", 96, "Leadership availability has slowed decisions since August.", "Book a reset meeting with leadership in November."),
         ("WO1267.1", "HR policy renewal", "WO1267", 4, "Delayed", 240, 81, 2, "2026-05-15", "2026-11-27", 262, "Over agreed hours and waiting on leadership review.", "Decide whether to extend hours or reduce scope."),
         ("WO1267.2", "Governance framework", "WO1267", 2, "On track", 280, 63, 1, "2026-06-01", "2026-12-18", 151, "", "Validate the committee responsibilities matrix."),
         ("WO1268", "Financial resilience", None, 5, "On track", 460, 55, 3, "2026-05-01", "2026-12-18", 64, "", "Review the draft year-end planning assumptions."),
         ("WO1268.1", "Budget planning & reporting", "WO1268", 5, "On track", 220, 61, 3, "2026-06-01", "2026-11-30", 128, "", "Complete the budget assumptions workshop."),
         ("WO1268.2", "Finance team development", "WO1268", 0, "Attention", 160, 30, 4, "2026-08-01", "2026-12-18", 37, "Two team members have been unavailable for coaching.", "Reschedule the October coaching sessions."),
         ("WO1372", "Community wellness planning", None, 7, "Delayed", 340, 31, 0, "2026-07-01", "2026-12-11", 58, "Two workshops were cancelled and not yet rebooked.", "Agree a recovery plan and new workshop dates."),
         ("WO1372.1", "Prevention service roadmap", "WO1372", 3, "Delayed", 200, 24, 1, "2026-08-01", "2026-12-11", 61, "Waiting on community input that has not been scheduled.", "Confirm community representatives for the next session."),
         ("WO1198", "Proposal development sprint", None, 6, "Completed", 120, 100, 1, "2026-05-01", "2026-07-31", 104, "", "Monitor the funding decision through the client lead.")],
     "upcoming": [("Workforce pathways 2027", 9, 240, 4, "2027-01-11", "2027-04-30", "Hold a discovery conversation in December.")]},
    {"key": "wrappingUp", "label": "Wrapping up", "asOf": "2026-10-23", "first": (2026, 5), "months": 6,
     "curve": [1.4, 1.5, 1.25, 0.95, 0.55, 0.25],
     "about": "Most work is finished, hours are winding down and nothing new is planned yet.",
     "projects": [
         ("WO1267", "Community leadership & advisory", None, 1, "Completed", 580, 100, 0, "2026-05-01", "2026-09-30", 130, "", "Share the final partnership summary with council."),
         ("WO1267.1", "HR policy renewal", "WO1267", 4, "Completed", 240, 100, 2, "2026-05-04", "2026-08-28", 228, "", "Policies approved. No further action."),
         ("WO1267.2", "Governance framework", "WO1267", 2, "Completed", 200, 100, 1, "2026-05-04", "2026-09-25", 186, "", "Framework adopted by council."),
         ("WO1268", "Financial resilience", None, 5, "Completed", 300, 100, 3, "2026-05-01", "2026-08-31", 152, "", "Hand over reporting templates to the finance team."),
         ("WO1268.1", "Budget planning & reporting", "WO1268", 5, "Completed", 160, 100, 3, "2026-05-04", "2026-08-31", 148, "", "Budget framework in use."),
         ("WO1372", "Community wellness planning", None, 7, "On track", 160, 92, 0, "2026-06-01", "2026-11-13", 96, "", "Present the final wellness plan on November 12.")],
     "upcoming": []},
]


def workdays(y, m, start, end):
    d, out = dt.date(y, m, 1), []
    while d.month == m:
        if d.weekday() < 5 and d not in HOLIDAYS and start <= d <= end:
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def month_list(first, n):
    y, m = first
    out = []
    for _ in range(n):
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def q(x):
    return round(x * 4) / 4


def build(sc, seed):
    rnd = random.Random(seed)
    as_of = dt.date.fromisoformat(sc["asOf"]) - dt.timedelta(days=1)
    months = month_list(sc["first"], sc["months"])
    t0 = f"{months[0][0]}-{months[0][1]:02d}-01T09:00:00{TZ}"
    meta = lambda c: {"CreateTime": c, "LastUpdatedTime": c}
    customers = [{"Id": "101", "SyncToken": "0", "domain": "QBO", "DisplayName": CLIENT, "FullyQualifiedName": CLIENT,
                  "CompanyName": CLIENT, "Job": False, "Level": 0, "Active": True, "MetaData": meta(t0)}]
    cid = {}
    for i, p in enumerate(sc["projects"]):
        cid[p[0]] = str(102 + i)
        parent = customers[0] if p[2] is None else next(c for c in customers if c["Id"] == cid[p[2]])
        name = f"{p[0]} {p[1]}"
        customers.append({"Id": cid[p[0]], "SyncToken": "0", "domain": "QBO", "DisplayName": name,
                          "FullyQualifiedName": f"{parent['FullyQualifiedName']}:{name}", "Job": True,
                          "BillWithParent": True, "ParentRef": {"value": parent["Id"]},
                          "Level": parent["Level"] + 1, "Active": p[4] != "Completed",
                          "MetaData": meta(p[8] + f"T09:00:00{TZ}")})
    employees = [{"Id": str(55 + i), "SyncToken": "0", "domain": "QBO", "DisplayName": f"{g} {f}", "GivenName": g,
                  "FamilyName": f, "Active": True, "PrimaryEmailAddr": {"Address": f"{g.lower()}.{f.lower()}@example.com"},
                  "MetaData": meta(t0)} for i, (g, f, _) in enumerate(PEOPLE)]
    items = [{"Id": str(20 + i), "SyncToken": "0", "domain": "QBO", "Name": n, "FullyQualifiedName": n,
              "Type": "Service", "Active": True, "MetaData": meta(t0)} for i, n in enumerate(ITEM_NAMES)]
    load, acts, expected = {}, [], {}
    for p in sc["projects"]:
        start, end = dt.date.fromisoformat(p[8]), min(dt.date.fromisoformat(p[9]), as_of)
        active = [(k, ym) for k, ym in enumerate(months) if workdays(ym[0], ym[1], start, end)]
        weights = [sc["curve"][k] for k, _ in active]
        split, used = [], 0
        for j, (k, ym) in enumerate(active):
            h = p[10] - used if j == len(active) - 1 else q(p[10] * weights[j] / sum(weights))
            used += h
            split.append((ym, h))
        team = list(dict.fromkeys([p[7], (p[7] + 1) % 6, 5]))
        shares = [0.55, 0.30, 0.15][:len(team)]
        shares[0] += 1 - sum(shares)
        for (y, m), total in split:
            expected[(p[0], y, m)] = total
            days = workdays(y, m, start, end)
            parts = [q(total * s) for s in shares[1:]]
            parts = [total - sum(parts)] + parts
            for who, hours in zip(team, parts):
                remaining = hours
                while remaining > 0:
                    chunk = min(rnd.choice([0.5, 1, 1, 1.5, 2, 2, 2.5, 3, 3.5, 4]), remaining)
                    for _ in range(40):
                        d = rnd.choice(days)
                        if load.get((who, d), 0) + chunk <= 7.5:
                            break
                    load[(who, d)] = load.get((who, d), 0) + chunk
                    c = dt.datetime.combine(min(d + dt.timedelta(days=rnd.choice([0, 0, 1, 2])), as_of),
                                            dt.time(rnd.randint(15, 18), rnd.choice([0, 15, 30, 45])))
                    stamp = c.strftime("%Y-%m-%dT%H:%M:%S") + TZ
                    acts.append({"Id": "", "SyncToken": "0", "domain": "QBO", "TxnDate": d.isoformat(),
                                 "NameOf": "Employee", "EmployeeRef": {"value": str(55 + who), "name": employees[who]["DisplayName"]},
                                 "CustomerRef": {"value": cid[p[0]], "name": next(x for x in customers if x["Id"] == cid[p[0]])["FullyQualifiedName"]},
                                 "ItemRef": {"value": str(20 + p[3]), "name": ITEM_NAMES[p[3]]},
                                 "BillableStatus": "HasBeenBilled" if p[4] == "Completed" else "Billable", "Taxable": False,
                                 "Hours": int(chunk), "Minutes": int(round((chunk - int(chunk)) * 60)),
                                 "Description": rnd.choice(DESC.get(p[3], DESC[1])), "MetaData": meta(stamp)})
                    remaining = round(remaining - chunk, 2)
    acts.sort(key=lambda a: (a["MetaData"]["CreateTime"], a["TxnDate"]))
    for n, a in enumerate(acts):
        a["Id"] = str(1001 + n)
    acts.sort(key=lambda a: (a["TxnDate"], int(a["Id"])))
    return months, customers, employees, items, acts, expected


def to_dashboard(sc, months, customers, employees, acts):
    """Same conversion rules as the baseline: work-order jobs only, hours by month and by person."""
    wo_of = {c["Id"]: c["DisplayName"].split(" ")[0] for c in customers if c.get("Job")}
    idx = {(y, m): k for k, (y, m) in enumerate(months)}
    emp = {e["Id"]: i for i, e in enumerate(employees)}
    projects = []
    for p in sc["projects"]:
        projects.append({"id": p[0], "wo": p[0], "name": p[1], "parent": p[2], "category": CATS[p[3]], "status": p[4],
                         "cap": p[5], "progress": p[6], "manager": p[7], "team": list(dict.fromkeys([p[7], (p[7] + 1) % 6, 5])),
                         "start": p[8], "end": p[9], "summary": p[1], "description": "", "value": "", "risk": p[11],
                         "nextStep": p[12], "milestones": [{"name": m, "done": p[6] >= 25 * (j + 1)} for j, m in enumerate(MILESTONES)],
                         "months": [0] * len(months), "people": [0] * len(PEOPLE)})
    for u in sc["upcoming"]:
        projects.append({"id": "UP-" + u[0].split()[0].lower(), "wo": None, "name": u[0], "parent": None,
                         "category": CATS[u[1]], "status": "Upcoming", "cap": u[2], "progress": 0, "manager": u[3],
                         "team": [u[3]], "start": u[4], "end": u[5], "summary": u[0], "description": "", "value": "",
                         "risk": "", "nextStep": u[6], "milestones": [], "months": [0] * len(months), "people": [0] * len(PEOPLE)})
    by = {p["wo"]: p for p in projects if p["wo"]}
    for a in acts:
        wo = wo_of.get(a["CustomerRef"]["value"])
        if not wo:
            continue
        y, m = int(a["TxnDate"][:4]), int(a["TxnDate"][5:7])
        h = a["Hours"] + a["Minutes"] / 60
        by[wo]["months"][idx[(y, m)]] += h
        by[wo]["people"][emp[a["EmployeeRef"]["value"]]] += h
    for p in projects:
        p["months"] = [round(x, 2) for x in p["months"]]
        p["people"] = [round(x, 2) for x in p["people"]]
    return {"scenario": sc["key"], "label": sc["label"], "about": sc["about"], "client": CLIENT,
            "partner": "Morris Interactive", "asOf": sc["asOf"], "syncedAt": sc["asOf"] + "T09:00",
            "months": [MON[m - 1] for _, m in months], "monthsLong": [f"{MONL[m - 1]} {y}" for y, m in months],
            "projects": projects,
            "people": [{"id": i, "name": f"{g} {f}", "role": r, "initials": g[0] + f[0],
                        "email": f"{g.lower()}.{f.lower()}@example.com", "phone": f"306-555-01{10 + i}"}
                       for i, (g, f, r) in enumerate(PEOPLE)]}


def query(entity, rows, at):
    return {"QueryResponse": {entity: rows, "startPosition": 1, "maxResults": len(rows)}, "time": at}


# Busy year runs at about 1.45 times the listed sizes, so it lands near 4,000 hours (over-cap project stays over cap).
for sc in SCENARIOS:
    if sc["key"] == "busyYear":
        sc["projects"] = [p[:5] + (int(round(p[5] * 1.45, -1)),) + p[6:10] + (int(round(p[10] * 1.45)),) + p[11:]
                          for p in sc["projects"]]

summary = []
dash = []
for n, sc in enumerate(SCENARIOS):
    months, customers, employees, items, acts, expected = build(sc, 100 + n)
    folder = OUT / sc["key"]
    folder.mkdir(parents=True, exist_ok=True)
    at = sc["asOf"] + "T09:00:00" + TZ
    for name, ent, rows in [("customers", "Customer", customers), ("employees", "Employee", employees),
                            ("items", "Item", items), ("timeActivity", "TimeActivity", acts)]:
        (folder / f"{name}.json").write_text(json.dumps(query(ent, rows, at), ensure_ascii=False, indent=2))
    d = to_dashboard(sc, months, customers, employees, acts)
    # Self-check: QuickBooks entries add back up to the designed hours for every project and month.
    for p in d["projects"]:
        for k, (y, m) in enumerate(months):
            assert abs(p["months"][k] - expected.get((p["wo"], y, m), 0)) < 1e-6, (sc["key"], p["wo"], y, m)
    total = sum(sum(p["months"]) for p in d["projects"])
    monthly = [round(sum(p["months"][k] for p in d["projects"]), 2) for k in range(len(months))]
    status = {s: sum(1 for p in d["projects"] if p["status"] == s) for s in ["On track", "Attention", "Delayed", "Completed", "Upcoming"]}
    summary.append((sc["label"], len(acts), total, monthly, status))
    dash.append(d)
(OUT / "dashboardScenarios.json").write_text(json.dumps(dash, ensure_ascii=False))
for s in summary:
    print(s)
