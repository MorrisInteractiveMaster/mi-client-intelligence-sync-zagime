import type { ProjectReport } from "./model";

export interface ServiceArea {
  id: string;
  name: string;
  description: string;
  order: number;
  visible: boolean;
  monthlyCap?: number;
  lifetimeCap?: number;
}
export interface Engagement {
  id: string;
  name: string;
  reference: string;
  monthlySeconds: number;
  areaPlans: { areaId: string; seconds: number }[];
  order: number;
  visible: boolean;
  monthlyCap?: number;
  lifetimeCap?: number;
}
export interface DirectoryEntry {
  id: string;
  name: string;
  role: string;
  responsibility: string;
  internalContact: string;
  publicContact: string;
  areaId: string;
  projectIds: string[];
  order: number;
  active: boolean;
  visible: boolean;
  email?: string;
  phone?: string;
  staffNotes?: string;
  internalRole?: string;
  shareEmail?: boolean;
  sharePhone?: boolean;
  profile?: WordPressProfile;
}
export interface WordPressProfile {
  id: number;
  name: string;
  title?: string;
  photo?: string;
  alt?: string;
  url: string;
  modified?: string;
}
export interface ProjectPlacement {
  id: string;
  areaId: string;
  engagementId: string;
  leadId: string;
  teamIds: string[];
  start: string;
  target: string;
  attention: string;
  publishDates: boolean;
  archived: boolean;
}
export interface ExecutiveNote {
  id: string;
  month: string;
  narrative: string;
  action: string;
  visible: boolean;
}
export interface Portfolio {
  areas: ServiceArea[];
  engagements: Engagement[];
  directory: DirectoryEntry[];
  placements: ProjectPlacement[];
  notes: ExecutiveNote[];
}
export interface PortfolioTotals {
  engagementId: string;
  areaId: string;
  projects: number;
  monthlyPlanSeconds: number;
  lifetimePlanSeconds: number;
  allocatedSeconds: number;
}
export type PortfolioSection = keyof Portfolio;
export type PortfolioRecord = Portfolio[PortfolioSection][number];
export const portfolioLimits: Record<PortfolioSection, number> = {
  areas: 20, engagements: 24, directory: 160, placements: 160, notes: 24,
};
export const newPortfolio = (): Portfolio => ({
  areas: ["Finance", "HR", "CFW", "Health", "Miscellaneous", "Training"].map((name, order) => ({
    id: name.toLowerCase(), name, description: "", order, visible: true,
  })),
  engagements: [], directory: [], placements: [], notes: [],
});
export const byOrder = <T extends { order: number; name: string }>(a: T, b: T) =>
  a.order - b.order || a.name.localeCompare(b.name, "en-CA");
export interface PublishedPortfolio {
  areas: ServiceArea[];
  engagements: { id: string; name: string }[];
  placements: (Pick<ProjectPlacement, "id" | "areaId" | "engagementId" | "start" | "target" | "archived"> & { leadId?: string; managerIds?: string[] })[];
  directory: (Pick<DirectoryEntry, "id" | "name" | "role" | "responsibility" | "publicContact" | "projectIds" | "areaId" | "order"> & { photo?: string; photoAlt?: string; profileUrl?: string; email?: string; phone?: string })[];
  narrative: string;
  action: string;
  history: { month: string; seconds: number }[];
}

export function previousReportingMonth(month: string) {
  const [year, period] = month.split("-").map(Number);
  if (year === 0 && period === 1) return "";
  return period === 1 ? String(year - 1).padStart(4, "0") + "-12" :
    String(year).padStart(4, "0") + "-" + String(period - 1).padStart(2, "0");
}

/** Counts each authorized delivery project once, independently of its parent plan. */
export function areaHours(projects: ProjectReport["projects"], publication?: PublishedPortfolio) {
  const assigned = new Map(publication?.placements.map(x => [x.id, x.areaId]));
  const totals = new Map<string, number>();
  for (const project of projects) {
    const id = assigned.get(project.id) ?? "";
    totals.set(id, (totals.get(id) ?? 0) + project.seconds);
  }
  const rows = (publication?.areas ?? []).filter(x => totals.has(x.id)).map(x => ({
    id: x.id, name: x.name, seconds: totals.get(x.id) ?? 0,
  }));
  if (totals.has("")) rows.push({ id: "", name: "Unassigned", seconds: totals.get("") ?? 0 });
  return rows;
}
