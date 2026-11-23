const morrisSite = "https://morrisinteractive.ca";

// Published profiles from the Morris WordPress team collection. This catalog
// is deliberately independent of synced staff profiles and project membership.
export const otherContacts = [
  { id: 1113, slug: "chris-cey", name: "Chris Cey", role: "Director, Business Development",
    image: "/wp-content/uploads/2026/05/Chris-Cey-300x300.png" },
  { id: 1115, slug: "steve-atkinson", name: "Steve Atkinson", role: "Director, Strategic Partnerships",
    image: "/wp-content/uploads/2026/05/Steve-Atkinson-300x300.png" },
  { id: 2350, slug: "monica-pollard", name: "Monica Pollard", role: "Director, Client Services",
    image: "/wp-content/uploads/2026/08/Monica-300x300.png" },
].map(contact => ({ ...contact, url: morrisSite + "/team/" + contact.slug + "/", photo: morrisSite + contact.image }));

export function isOtherContact(profile?: { id?: number; url?: string }) {
  if (!profile) return false;
  if (otherContacts.some(contact => contact.id === profile.id)) return true;
  if (!profile.url) return false;
  try {
    const url = new URL(profile.url);
    return url.origin === morrisSite && otherContacts.some(contact => url.pathname.replace(/\/$/, "") === "/team/" + contact.slug);
  } catch {
    return false;
  }
}
