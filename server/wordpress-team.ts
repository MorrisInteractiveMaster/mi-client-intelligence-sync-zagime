import { parse, parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { DirectoryEntry, WordPressProfile } from "../src/projects/portfolio";

const site = "https://morrisinteractive.ca";
type Node = DefaultTreeAdapterMap["node"];
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const text = (node: Node): string => "value" in node && typeof node.value === "string" ? node.value : children(node).map(text).join("");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const plain = (value: string) => normalize(text(parseFragment(value)));

function walk(node: Node, visit: (node: Node) => void) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}
function classes(node: Node) {
  return "attrs" in node ? (node.attrs.find(a => a.name === "class")?.value ?? "").split(/\s+/) : [];
}
function titles(html: string) {
  const byId = new Map<number, string>();
  walk(parse(html), node => {
    const match = classes(node).find(value => /^e-loop-item-\d+$/.test(value));
    if (!match) return;
    const id = Number(match.slice(12));
    walk(node, item => {
      if (classes(item).includes("elementor-post-info__item--type-custom") && !byId.has(id)) {
        const title = normalize(text(item));
        if (title) byId.set(id, title.slice(0, 120));
      }
    });
  });
  return byId;
}
function siteUrl(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || value.length > 700) return;
  try {
    const url = new URL(value);
    if (url.origin === site && !url.username && !url.password && !url.search && !url.hash && pattern.test(url.pathname)) return url.href;
  } catch { /* invalid public profile URL */ }
}
async function resource(path: string, fetcher: typeof fetch, kind: "json" | "html") {
  const result = await fetcher(site + path, { redirect: "error", signal: AbortSignal.timeout(8000), headers: { accept: kind === "json" ? "application/json" : "text/html" } });
  if (!result.ok || !result.headers.get("content-type")?.includes(kind === "json" ? "application/json" : "text/html")) throw Error("WordPress team source unavailable");
  const stream = result.body?.getReader();
  if (!stream) throw Error("WordPress team source unavailable");
  const decoder = new TextDecoder();
  let body = "", size = 0;
  for (;;) {
    const { value, done } = await stream.read();
    if (done) break;
    size += value.byteLength;
    if (size > 6_000_000) { await stream.cancel(); throw Error("WordPress team response too large"); }
    body += decoder.decode(value, { stream: true });
  }
  return { result, body: body + decoder.decode() };
}

let cached: { at: number; profiles: WordPressProfile[] } | undefined;
let pending: Promise<WordPressProfile[]> | undefined;
export async function wordpressProfiles(fetcher: typeof fetch = fetch): Promise<WordPressProfile[]> {
  if (fetcher !== fetch) return load(fetcher);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.profiles;
  pending ??= load(fetch).then(profiles => {
    cached = { at: Date.now(), profiles };
    return profiles;
  }).finally(() => { pending = undefined; });
  return pending;
}
async function load(fetcher: typeof fetch) {
  const route = "/wp-json/wp/v2/team?per_page=100&_embed=wp:featuredmedia&_fields=id,type,status,link,modified_gmt,title,featured_media,_links,_embedded&page=";
  const [first, publicTeam] = await Promise.all([resource(route + "1", fetcher, "json"), resource("/our-team/", fetcher, "html")]);
  const listingTitles = titles(publicTeam.body);
  const pageCount = Number(first.result.headers.get("x-wp-totalpages") ?? 1);
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 2) throw Error("WordPress team exceeds the supported directory size");
  const pages = pageCount === 1 ? [first] : [first, await resource(route + "2", fetcher, "json")];
  const profiles = new Map<number, WordPressProfile>();
  for (const page of pages) {
    const rows: unknown = JSON.parse(page.body);
    if (!Array.isArray(rows)) throw Error("Invalid WordPress team response");
    for (const row of rows) {
      if (!row || row.type !== "team" || row.status !== "publish" || !Number.isSafeInteger(row.id) || row.id < 1 ||
        typeof row.title?.rendered !== "string" || profiles.has(row.id)) throw Error("Invalid WordPress team record");
      const url = siteUrl(row.link, /^\/team\/[a-z0-9-]+\/$/);
      const name = plain(row.title.rendered);
      if (!url || !name || name.length > 120) throw Error("Invalid WordPress team record");
      const media = row._embedded?.["wp:featuredmedia"]?.[0];
      const photo = media?.id === row.featured_media ? siteUrl(media?.source_url, /^\/wp-content\/uploads\/.+\.(?:png|jpe?g|webp|avif)$/i) : undefined;
      const title = listingTitles.get(row.id);
      const modified = typeof row.modified_gmt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.modified_gmt) ? row.modified_gmt + "Z" : undefined;
      profiles.set(row.id, { id: row.id, name, url, ...(title && { title }), ...(modified && { modified }),
        ...(photo && { photo, alt: typeof media.alt_text === "string" ? plain(media.alt_text).slice(0, 180) : "" }) });
    }
  }
  if (!profiles.size) throw Error("WordPress team source returned no profiles");
  return [...profiles.values()];
}

export function mergeDirectory(existing: DirectoryEntry[], profiles: WordPressProfile[]): DirectoryEntry[] {
  const imports = new Map(profiles.map(profile => [profile.id, profile]));
  const next = existing.map(person => {
    const profile = person.profile && imports.get(person.profile.id);
    if (!profile) return person;
    imports.delete(profile.id);
    return { ...person, name: profile.name, profile: { ...person.profile, ...profile } };
  });
  const ids = new Set(next.map(person => person.id));
  for (const profile of imports.values()) {
    const id = "wordpress-" + profile.id;
    if (ids.has(id)) throw Error("WordPress profile identity conflict");
    next.push({ id, name: profile.name, role: "", responsibility: "", internalContact: "", publicContact: "", areaId: "",
      projectIds: [], order: next.length, active: true, visible: false, profile });
  }
  return next;
}
