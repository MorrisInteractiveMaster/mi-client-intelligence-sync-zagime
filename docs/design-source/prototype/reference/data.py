"""Build the dashboard data object from SyntheticQbo (hours) + Dev's seed.ts (project details)."""
import json
from pathlib import Path

Q = Path(__file__).resolve().parents[2] / "fixtures" / "synthetic-qbo"
load = lambda f, k: json.loads((Q / f).read_text())["QueryResponse"][k]
customers, employees, acts = load("customers.json", "Customer"), load("employees.json", "Employee"), load("timeActivity.json", "TimeActivity")

CATS = ["Learning Services", "Consulting", "Governance & Strategy", "Prevention", "HR Services",
        "Financial Services", "Proposals & Applications", "Health", "Public Courses", "Career Transformation"]
PEOPLE = [("Maya Sinclair", "Client Partnership Lead"), ("Daniel Cardinal", "Governance & Strategy Lead"),
          ("Elena Brooks", "HR Consultant"), ("Noah Bennett", "Financial Consultant"),
          ("Avery Thomas", "Learning Facilitator"), ("Sophie Martin", "Project Coordinator")]
# name, wo, parent wo, category, status, cap, progress, manager, start, end
ROWS = [
    ("Community leadership & advisory", "WO1267", None, 1, "On track", 800, 66, 0, "2026-05-01", "2027-01-29"),
    ("HR policy renewal", "WO1267.1", "WO1267", 4, "Attention", 240, 74, 2, "2026-05-15", "2026-11-27"),
    ("Governance framework", "WO1267.2", "WO1267", 2, "On track", 280, 72, 1, "2026-06-01", "2026-12-18"),
    ("Leadership capacity building", "WO1267.3", "WO1267", 0, "On track", 180, 52, 4, "2026-07-01", "2027-01-29"),
    ("Financial resilience", "WO1268", None, 5, "On track", 460, 62, 3, "2026-05-01", "2026-12-18"),
    ("Budget planning & reporting", "WO1268.1", "WO1268", 5, "On track", 220, 70, 3, "2026-06-01", "2026-11-30"),
    ("Finance team development", "WO1268.2", "WO1268", 0, "On track", 160, 42, 4, "2026-08-01", "2026-12-18"),
    ("Community wellness planning", "WO1372", None, 7, "Delayed", 340, 38, 0, "2026-07-01", "2026-12-11"),
    ("Prevention service roadmap", "WO1372.1", "WO1372", 3, "Delayed", 200, 35, 1, "2026-08-01", "2026-12-11"),
    ("Community engagement sessions", "WO1372.2", "WO1372", 7, "On track", 100, 55, 5, "2026-08-15", "2026-11-20"),
    ("Proposal development sprint", "WO1198", None, 6, "Completed", 120, 100, 1, "2026-05-01", "2026-07-31"),
]
UPCOMING = [("Workforce pathways 2027", 9, 240, 4, "2027-01-11", "2027-04-30",
             "An early concept for a community-focused workforce pathways program, pending scope confirmation.",
             "Hold a discovery conversation in December."),
            ("Health leadership retreat", 7, 100, 0, "2027-02-08", "2027-03-12",
             "A proposed retreat to bring health leadership together around shared priorities.",
             "Prepare an initial scope and facilitation plan.")]
NARR = [  # summary, description, value, risk, next step (from seed.ts)
    ("A strong foundation for the next chapter.", "Ongoing advisory support is connecting leadership priorities with practical work across governance, people and learning.", "Three service streams aligned to one shared workplan.", "", "Confirm the November leadership discussion agenda."),
    ("Policy renewal is moving into leadership review.", "The first policy package is ready. A decision on the review schedule will keep the final approval milestone within reach.", "18 draft policies prepared for a consistent employee experience.", "Leadership review availability may affect the approval date.", "Schedule the policy review and consolidate feedback."),
    ("Turning priorities into a clear governance framework.", "The draft accountability framework reflects the priorities gathered in leadership sessions. Validation is the next milestone.", "A shared decision-rights framework is ready for validation.", "", "Validate the committee responsibilities matrix."),
    ("Building confidence across the leadership team.", "Two learning sessions are complete with practical tools now being applied between sessions.", "Two facilitated sessions completed, with action plans in use.", "", "Deliver the third coaching and accountability session."),
    ("Clearer financial visibility, stronger planning.", "Monthly reporting has been standardized. The finance team is now developing the next planning cycle together.", "A consistent monthly reporting rhythm established.", "", "Review the draft year-end planning assumptions."),
    ("A practical budget framework is taking shape.", "Department inputs have been consolidated into the first draft budget framework.", "Department assumptions consolidated into one review pack.", "", "Complete the budget assumptions workshop."),
    ("Skills that stay with the team.", "Hands-on coaching is helping the finance team own repeatable month-end processes.", "Four team members supported through practical coaching.", "", "Walk through the month-end checklist with the team."),
    ("Community input remains the priority.", "Engagement has begun, but the prevention workshop was moved. The delivery sequence is being revised with the client.", "Community priorities captured in an initial themes summary.", "Rescheduled workshop puts the December target at risk.", "Agree a revised workshop date and recovery plan."),
    ("A roadmap grounded in community priorities.", "The first service-mapping exercise is complete. Additional input is needed before recommendations can be finalized.", "Existing prevention services mapped for discussion.", "Workshop dependency is holding the recommendations milestone.", "Complete the remaining service mapping workshop."),
    ("Listening first, planning together.", "Initial sessions surfaced consistent priorities for accessible, coordinated support.", "Three listening sessions completed and themes documented.", "", "Validate the engagement themes with participants."),
    ("A complete submission, ready for the next stage.", "The proposal package was delivered and the handover completed in July.", "One complete funding application and supporting evidence package.", "", "Monitor the funding decision through the client lead."),
]
MILESTONES = ["Discovery & alignment", "Draft & develop", "Review & validate", "Deliver & hand over"]

wo_of = {c["Id"]: c["DisplayName"].split(" ")[0] for c in customers if c.get("Job") and c["FullyQualifiedName"].startswith("Zagimē")}
emp_idx = {e["Id"]: i for i, e in enumerate(employees)}

projects = []
for i, r in enumerate(ROWS):
    team = list(dict.fromkeys([r[7], (r[7] + 1) % 6, 5]))
    projects.append({"id": r[1], "wo": r[1], "name": r[0], "parent": r[2], "category": CATS[r[3]], "status": r[4],
                     "cap": r[5], "progress": r[6], "manager": r[7], "team": team, "start": r[8], "end": r[9],
                     "summary": NARR[i][0], "description": NARR[i][1], "value": NARR[i][2], "risk": NARR[i][3],
                     "nextStep": NARR[i][4],
                     "milestones": [{"name": m, "done": r[6] >= 25 * (j + 1)} for j, m in enumerate(MILESTONES)],
                     "months": [0] * 6, "people": [0] * 6})
for u in UPCOMING:
    projects.append({"id": "UP-" + u[0].split()[0].lower(), "wo": None, "name": u[0], "parent": None,
                     "category": CATS[u[1]], "status": "Upcoming", "cap": u[2], "progress": 0, "manager": u[3],
                     "team": [u[3]], "start": u[4], "end": u[5], "summary": u[0], "description": u[6], "value": "",
                     "risk": "", "nextStep": u[7], "milestones": [], "months": [0] * 6, "people": [0] * 6})
by_wo = {p["wo"]: p for p in projects if p["wo"]}

used = 0
for a in acts:
    wo = wo_of.get(a["CustomerRef"]["value"])
    if not wo:
        continue  # client-level entries without a work order, and other clients, stay out of the client view
    h = a["Hours"] + a["Minutes"] / 60
    m = int(a["TxnDate"][5:7]) - 5
    p = by_wo[wo]
    p["months"][m] += h
    p["people"][emp_idx[a["EmployeeRef"]["value"]]] += h
    used += h
assert round(used, 2) == 1054, used
for p in projects:
    p["months"] = [round(x, 2) for x in p["months"]]
    p["people"] = [round(x, 2) for x in p["people"]]

people = [{"id": i, "name": n, "role": r, "initials": "".join(w[0] for w in n.split()),
           "email": n.lower().replace(" ", ".") + "@example.com", "phone": f"306-555-01{10 + i}"}
          for i, (n, r) in enumerate(PEOPLE)]
DATA = {"client": "Zagimē Anishinabēk", "partner": "Morris Interactive", "asOf": "2026-10-23",
        "syncedAt": "2026-10-23T09:00", "months": ["May", "Jun", "Jul", "Aug", "Sep", "Oct"],
        "monthsLong": ["May 2026", "June 2026", "July 2026", "August 2026", "September 2026", "October 2026"],
        "projects": projects, "people": people}
(Q / "dashboardCurrent.json").write_text(json.dumps(DATA, ensure_ascii=False))
print("ok", used, [round(sum(p["months"][k] for p in projects), 2) for k in range(6)])
