import type { StaffProjectSummary } from "../projects/model";

export type PulseStatus = "active" | "upcoming" | "blocked" | "completed" | "other";

/** One chart bucket per staff project. A blocker takes precedence over current/planned status. */
export function staffPulseStatus(project: StaffProjectSummary, day: string): PulseStatus {
  if (project.status === "completed") return "completed";
  if (project.status === "closed" || project.status === "cancelled") return "other";
  if (project.delivery?.blocker?.active || project.deliveryMilestones?.some(item => item.status === "blocked")) return "blocked";
  if (project.status === "paused") return "other";
  if (project.delivery?.start && project.delivery.start > day) return "upcoming";
  if (project.status === "active" || (project.status === "planned" && project.delivery?.start && project.delivery.start <= day)) return "active";
  return "other";
}
