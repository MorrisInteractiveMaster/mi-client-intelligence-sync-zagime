import assert from "node:assert/strict";
import test from "node:test";
import { parsePlatformPath, routeHref, routeParameters } from "./platform-routes";

const visit = (path: string) => new URL(path, "https://intelligence.invalid");

test("addressable client and staff routes decode only declared resources and safe IDs", () => {
  assert.deepEqual(parsePlatformPath("/"), { kind: "home" });
  assert.deepEqual(parsePlatformPath("/workspace"), { kind: "staff", section: "overview" });
  assert.deepEqual(parsePlatformPath("/workspace/projects/stable_project-1"), { kind: "staff", section: "projects", id: "stable_project-1" });
  assert.deepEqual(parsePlatformPath("/workspace/project-management/stable_project-1"), { kind: "staff", section: "management", id: "stable_project-1" });
  assert.deepEqual(parsePlatformPath("/workspace/time/time-1"), { kind: "staff", section: "hours", id: "time-1" });
  assert.deepEqual(parsePlatformPath("/workspace/milestones/project-1/ms-01"), { kind: "staff", section: "milestones", id: "project-1", item: "ms-01" });
  assert.deepEqual(parsePlatformPath("/clients/zagime/projects/stable_project-1/milestones/ms-01"),
    { kind: "client", slug: "zagime", view: "milestone:stable_project-1:ms-01" });
  for (const path of ["departments", "service-areas"]) {
    assert.deepEqual(parsePlatformPath("/clients/zagime/" + path), { kind: "client", slug: "zagime", view: "areas" });
    assert.deepEqual(parsePlatformPath("/clients/zagime/" + path + "/health"), { kind: "client", slug: "zagime", view: "area:health" });
  }
  for (const route of ["/assets/package.json", "/workspace/projects/a.b", "/control/create-anything", "/clients/zagime/projects/%2fetc", "/clients/zagime/__proto__/p", "/api/v2/tenants/x", "/workspace//"]) {
    assert.equal(parsePlatformPath(route), undefined, route);
  }
});

test("native routes keep selection, scope and period while legacy URLs stay valid", () => {
  const old = visit("/?month=2026-11&staff=projects&editor=p#/secure");
  assert.equal(routeParameters(old).get("editor"), "p");
  assert.equal(routeHref(old, { staff: "hours", editor: null }), "/?month=2026-11&staff=hours#/secure");
  const report = visit("/clients/zagime/projects/p?month=2026-11&previewMode=draft");
  assert.equal(routeParameters(report).get("view"), "project:p");
  const deep = routeHref(report, { present: "1" });
  assert.equal(deep, "/clients/zagime/present?month=2026-11&previewMode=draft&view=project%3Ap");
  const slide = visit(deep + "&chapter=4");
  assert.equal(routeParameters(slide).get("present"), "1");
  assert.equal(routeParameters(slide).get("chapter"), "4");
  assert.equal(routeHref(slide, { present: null }), "/clients/zagime/projects/p?month=2026-11&previewMode=draft");
  assert.equal(routeHref(visit("/workspace/milestones?month=2026-11"), { milestone: "p:ms" }), "/workspace/milestones/p/ms?month=2026-11");
  assert.equal(routeParameters(visit("/workspace/milestones/p/ms?milestone=forged")).get("milestone"), "p:ms");
  assert.equal(routeHref(visit("/workspace/project-management?month=2026-10"), { managed: "id-1" }), "/workspace/project-management/id-1?month=2026-10");
  assert.equal(routeHref(visit("/clients/zagime?month=2026-10"), { view: "area:health", status: "upcoming" }),
    "/clients/zagime/departments/health?month=2026-10&status=upcoming");
});
