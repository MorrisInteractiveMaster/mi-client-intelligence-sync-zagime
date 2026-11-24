import test from "node:test";
import assert from "node:assert/strict";
import { mergeDirectory, wordpressProfiles } from "./wordpress-team";
import { newPortfolio } from "../src/projects/portfolio";
import { deliveryDefaults, type Delivery } from "../src/projects/delivery";
import { publishedPortfolio } from "./portfolio";

const host = "https://morrisinteractive.ca";
const description = '<div class="e-loop-item e-loop-item-41"><span class="elementor-post-info__item--type-custom">Senior &amp; Principal Consultant</span></div>';
const endpoint = {
  id: 41, status: "publish", type: "team", link: host + "/team/sample-person/",
  title: { rendered: "Example &amp; Partner" }, modified_gmt: "2026-11-20T10:00:00", featured_media: 73,
  _embedded: { "wp:featuredmedia": [{ id: 73, source_url: host + "/wp-content/uploads/photo.jpg", alt_text: "Portrait" }] },
};
function source(profile = endpoint, html = description): typeof fetch {
  return async (input, options) => {
    const url = new URL(String(input));
    assert.equal(url.origin, host);
    assert.equal(options?.redirect, "error");
    const listing = url.pathname === "/our-team/";
    return new Response(listing ? html : JSON.stringify([profile]), { headers: { "content-type": listing ? "text/html" : "application/json" } });
  };
}

test("public WordPress post IDs join to professional titles and approved photos", async () => {
  const [profile] = await wordpressProfiles(source());
  assert.deepEqual(profile, { id: 41, name: "Example & Partner", title: "Senior & Principal Consultant", photo: host + "/wp-content/uploads/photo.jpg",
    alt: "Portrait", modified: "2026-11-20T10:00:00Z", url: host + "/team/sample-person/" });
  const directory = mergeDirectory([], [profile]);
  assert.equal(directory[0].visible, false);
  directory[0] = { ...directory[0], email: "staff@example.com", phone: "555-0100", staffNotes: "private", visible: true, projectIds: ["approved", "hidden"], sharePhone: true };
  const refreshed = mergeDirectory(directory, [{ ...profile, name: "Updated name" }]);
  assert.equal(refreshed.length, 1);
  assert.equal(refreshed[0].email, directory[0].email);
  assert.equal(refreshed[0].phone, directory[0].phone);
  assert.deepEqual(mergeDirectory(refreshed, []), refreshed);
  const invisible = { ...refreshed[0], id: "private-facilitator", visible: false };
  const config = { ...newPortfolio(), directory: [...refreshed, invisible] };
  const row = { id: "approved", schemaVersion: 2 as const, name: "Example project", status: "active" as const, progress: 0,
    description: "", plan: { basis: "fixed" as const, targetSeconds: 0 }, seconds: 0, lifetimeSeconds: 0 };
  const role: Delivery = { ...deliveryDefaults, type: "training",
    training: { days: 1, dates: ["2026-11-20"], facilitatorIds: [refreshed[0].id, invisible.id] } };
  const report = publishedPortfolio(config, [row], "2026-11", [], new Map([[row.id, role], ["hidden", role]]));
  assert.deepEqual(report.placements.map(item => [item.id, item.facilitatorIds]), [["approved", [refreshed[0].id]]]);
  assert.deepEqual(report.directory[0].projectIds, ["approved"]);
  assert.equal(report.directory[0].phone, "555-0100");
  assert.equal(report.directory[0].email, undefined);
  assert.doesNotMatch(JSON.stringify(report), /staffNotes|staff@example|hidden|private-facilitator/);
});

test("WordPress outage and off-origin media are handled without trusting remote links", async () => {
  await assert.rejects(wordpressProfiles(async () => new Response("error", { status: 503 })), /unavailable/);
  const [profile] = await wordpressProfiles(source({ ...endpoint, _embedded: { "wp:featuredmedia": [
    { id: 73, source_url: "https://example.invalid/photo.jpg", alt_text: "untrusted" },
  ] } }));
  assert.equal(profile.photo, undefined);
  await assert.rejects(wordpressProfiles(source({ ...endpoint, status: "draft" })), /Invalid/);
});
