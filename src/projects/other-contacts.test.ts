import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isOtherContact, otherContacts } from "./other-contacts";

test("public contacts keep approved Morris identities and deduplicate by stable ID or canonical profile", () => {
  assert.deepEqual(otherContacts.map(contact => contact.name), ["Chris Cey", "Steve Atkinson", "Monica Pollard"]);
  for (const contact of otherContacts) {
    assert.equal(contact.photo, `branding/morris/contacts/${contact.slug}.png`);
    const png = readFileSync(new URL(`../../public/${contact.photo}`, import.meta.url));
    assert.equal(png.subarray(12, 16).toString(), "IHDR");
    assert.equal(png.readUInt32BE(16), 300);
    assert.equal(png.readUInt32BE(20), 300);
    assert.equal(isOtherContact({ id: contact.id }), true);
    assert.equal(isOtherContact({ url: contact.url + "?tracking=example" }), true);
    assert.equal(isOtherContact({ url: contact.url.replace("morrisinteractive.ca", "example.invalid") }), false);
    assert.equal("email" in contact || "phone" in contact, false);
  }
  assert.equal(isOtherContact({ id: 12345, url: "https://morrisinteractive.ca/team/another-person/" }), false);
  assert.equal(isOtherContact(), false);
});
