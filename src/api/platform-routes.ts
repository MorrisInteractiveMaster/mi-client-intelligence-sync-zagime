export const clientBase = "/clients/zagime";
export const staffSegments = {
  overview: "", clients: "clients", projects: "projects", hours: "time", directory: "team",
  milestones: "milestones", health: "delivery-health", preview: "preview", integrations: "integrations",
  time: "integrations/time", portfolio: "portfolio", activity: "audit",
} as const;
export type StaffSection = keyof typeof staffSegments;

export const controlSections = {
  access: "Client access", staff: "Staff permissions", branding: "Branding",
  team: "WordPress team", "employee-mapping": "Employee mapping", time: "QuickBooks Time",
  "work-orders": "Work orders", publication: "Publication", presentation: "Presentation",
  audit: "Audit history", onboarding: "Client onboarding",
} as const;
export type ControlSection = keyof typeof controlSections;
type Destination = { kind: "home" } | { kind: "staff"; section: StaffSection; id?: string; item?: string } |
  { kind: "control"; section?: ControlSection } | { kind: "client"; slug: string; view?: string; presenting?: true };
const id = (value: string | undefined): value is string => Boolean(value && /^[a-zA-Z0-9_-]{1,128}$/.test(value));
const clientSections: Record<string, string> = {
  overview: "", engagements: "engagements", areas: "service-areas", projects: "projects",
  milestones: "milestones", directory: "team", history: "reports", notes: "updates",
};
const staffSections = new Map<string, StaffSection>(Object.entries(staffSegments).map(([section, segment]) => [segment, section as StaffSection]));
const reportSections = new Map<string, string>(Object.entries(clientSections).map(([view, segment]) => [segment, view]));
const detailSections = new Map([["project", "projects"], ["area", "service-areas"], ["contact", "team"], ["group", "engagements"]]);
const detailKinds = new Map([...detailSections].map(([kind, section]) => [section, kind]));

export function parsePlatformPath(path: string): Destination | undefined {
  if (!path.startsWith("/") || path.includes("//") || path.includes("\\")) return undefined;
  if (path === "/") return { kind: "home" };
  const parts = path.replace(/\/$/, "").split("/").slice(1);
  const [area, segment, detail, branch, item] = parts;
  if (area === "workspace") {
    const section = staffSections.get(parts.slice(1).join("/"));
    if (section) return { kind: "staff", section };
    if (segment === "milestones" && parts.length === 4 && id(detail) && id(branch))
      return { kind: "staff", section: "milestones", id: detail, item: branch };
    if (parts.length === 3 && id(detail)) {
      const parent = staffSections.get(segment);
      if (parent === "projects" || parent === "directory" || parent === "milestones" || parent === "hours")
        return { kind: "staff", section: parent, id: detail };
    }
  }
  if (area === "control") {
    if (parts.length === 1) return { kind: "control" };
    if (parts.length === 2 && Object.hasOwn(controlSections, segment))
      return { kind: "control", section: segment as ControlSection };
  }
  if (area === "clients" && /^[a-z][a-z0-9-]{0,62}$/.test(segment ?? "")) {
    if (parts.length === 2) return { kind: "client", slug: segment, view: "overview" };
    if (parts.length === 3 && detail === "present") return { kind: "client", slug: segment, presenting: true };
    if (parts.length === 3 && reportSections.has(detail))
      return { kind: "client", slug: segment, view: reportSections.get(detail) };
    if (id(branch)) {
      const type = detailKinds.get(detail);
      if (parts.length === 4 && type) return { kind: "client", slug: segment, view: type + ":" + branch };
      if (detail === "projects" && item === "timeline" && parts.length === 5)
        return { kind: "client", slug: segment, view: "timeline:" + branch };
      if (detail === "projects" && item === "milestones" && parts.length === 6 && id(parts[5]))
        return { kind: "client", slug: segment, view: "milestone:" + branch + ":" + parts[5] };
    }
  }
}

export function staffPath(section: StaffSection, detail?: string | null, item?: string) {
  const prefix = "/workspace" + (staffSegments[section] ? "/" + staffSegments[section] : "");
  return prefix + (detail && id(detail) ? "/" + detail + (item && id(item) ? "/" + item : "") : "");
}

export function clientPath(slug: string, view = "overview") {
  const root = "/clients/" + slug;
  if (Object.hasOwn(clientSections, view)) return root + (clientSections[view] ? "/" + clientSections[view] : "");
  const [kind, key, item] = view.split(":");
  if (!id(key)) return root;
  if (kind === "timeline") return root + "/projects/" + key + "/timeline";
  if (kind === "milestone" && id(item)) return root + "/projects/" + key + "/milestones/" + item;
  const segment = detailSections.get(kind);
  return segment ? root + "/" + segment + "/" + key : root;
}

const staffDetailKey = { projects: "editor", directory: "person", milestones: "milestone", hours: "source" } as const;

export function routeParameters(url: URL) {
  const params = new URLSearchParams(url.search);
  const route = url.hash.startsWith("#/") ? undefined : parsePlatformPath(url.pathname);
  if (route?.kind === "staff") {
    params.set("staff", route.section);
    const key = staffDetailKey[route.section as keyof typeof staffDetailKey];
    if (key && route.id) params.set(key, route.item ? route.id + ":" + route.item : route.id);
    if (key && !route.id) params.delete(key);
  }
  if (route?.kind === "client") {
    if (route.presenting) params.set("present", "1");
    else {
      params.delete("present");
      params.set("view", route.view ?? "overview");
    }
  }
  return params;
}

export function routeHref(url: URL, fields: Record<string, string | null>) {
  const route = url.hash.startsWith("#/") ? undefined : parsePlatformPath(url.pathname);
  const params = new URLSearchParams(url.search);
  for (const [key, value] of Object.entries(fields)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  let path = url.pathname;
  if (route?.kind === "staff") {
    const candidate = fields.staff ?? route.section;
    if (Object.hasOwn(staffSegments, candidate)) {
      const section = candidate as StaffSection;
      const key = staffDetailKey[section as keyof typeof staffDetailKey];
      const detail = key && Object.hasOwn(fields, key) ? fields[key] : section === route.section && route.id ?
        route.id + (route.item ? ":" + route.item : "") : undefined;
      const [record, item] = (detail ?? "").split(":");
      path = staffPath(section, record, item);
    }
    params.delete("staff");
    for (const key of Object.values(staffDetailKey)) params.delete(key);
  }
  if (route?.kind === "client") {
    const view = Object.hasOwn(fields, "view") ? fields.view : routeParameters(url).get("view");
    const presentation = Object.hasOwn(fields, "present") ? fields.present === "1" : route.presenting;
    if (presentation) {
      path = "/clients/" + route.slug + "/present";
      if (view && view !== "overview") params.set("view", view);
      else params.delete("view");
    } else {
      path = clientPath(route.slug, view ?? "overview");
      params.delete("view");
      params.delete("chapter");
    }
    params.delete("present");
  }
  const query = params.toString();
  return path + (query ? "?" + query : "") + url.hash;
}
