import { ArrowUpRight } from "lucide-react";
import { DottedTrack } from "./EffortVisuals";
import { ContextHelp } from "./ContextHelp";
import type { OpenClientView } from "./ClientIntelligence";
import type { clientDelivery, ProjectFilter } from "./client-delivery";
import { portfolioStatuses, segmentCount } from "./ClientProjectExplorer";
import { compareValues } from "../projects/sort";
import { percentText } from "./insight-metrics";
import { portalNavigate, usePortalLocation } from "./portal-location";

const dimensions = { department: "Departments", parent: "Parent projects", status: "Delivery status" } as const;
type Dimension = keyof typeof dimensions;
const orders = { most: "Most projects", least: "Fewest projects", name: "Name A–Z", configured: "Configured order" } as const;
type Order = keyof typeof orders;

export function ProjectPortfolioDistribution({ delivery, onLink }: { delivery: ReturnType<typeof clientDelivery>; onLink: OpenClientView }) {
  const location = usePortalLocation();
  const group = (Object.keys(dimensions) as Dimension[]).find(key => key === location.get("portfolio-group")) ?? "department";
  const order = (Object.keys(orders) as Order[]).find(key => key === location.get("portfolio-order") && (key !== "configured" || group === "department"));
  const total = delivery.counts.all;
  const rows = group === "status" ? portfolioStatuses.map(([key, label]) => ({
    key, label, count: segmentCount(delivery.counts, key), open: () => onLink("projects", undefined, key),
  })) : group === "parent" ? [
    ...delivery.parentRows.map(row => ({ key: row.id, label: row.name, count: row.counts.all, open: () => onLink("projects", undefined, "all", { parent: row.id }) })),
    { key: "", label: "Independent projects", count: delivery.unaffiliated.length, open: () => onLink("projects", undefined, "unaffiliated") },
  ] : [
    ...[...delivery.departmentRows].sort((a, b) => a.order - b.order || compareValues(a.name, b.name)).map(row => ({
      key: row.id, label: row.name, count: row.counts.all, open: () => onLink("projects", undefined, "all", { department: row.id }),
    })),
    { key: "", label: "No department", count: delivery.projects.filter(row => !row.department).length, open: () => onLink("projects", undefined, "unassigned" as ProjectFilter) },
  ];
  const selectedOrder = order ?? (group === "department" && rows.length <= 8 ? "configured" : "most");
  if (selectedOrder !== "configured") rows.sort((a, b) =>
    (selectedOrder === "most" ? b.count - a.count : selectedOrder === "least" ? a.count - b.count : 0) || compareValues(a.label, b.label));
  return <section className="mi-exec-panel mi-portfolio-distribution" aria-labelledby="portfolio-distribution-heading">
    <div className="mi-exec-heading"><div><h3 id="portfolio-distribution-heading">Project Portfolio Distribution</h3>
      <p>How approved delivery projects are distributed across the organization.</p></div><b>{total} approved projects</b></div>
    <div className="mi-portfolio-controls">
      <div role="group" aria-label="Group approved projects" className="mi-insight-segments">
        {(Object.keys(dimensions) as Dimension[]).map(value => <button className="mi-v4-segment-control" key={value} type="button"
          aria-pressed={group === value} onClick={() => portalNavigate({ "portfolio-group": value, "portfolio-order": null }, true)}>{dimensions[value]}</button>)}
      </div>
      <label>Sort groups<select value={selectedOrder} onChange={e => portalNavigate({ "portfolio-order": e.target.value }, true)}>
        {(Object.keys(orders) as Order[]).filter(key => key !== "configured" || group === "department").map(key => <option key={key} value={key}>{orders[key]}</option>)}
      </select></label>
    </div>
    <ul className="mi-portfolio-distribution-rows">
      {rows.map(row => {
        const share = total ? row.count / total * 100 : undefined;
        const explanation = row.label + " — " + row.count + " of " + total + " approved delivery projects" +
          (share === undefined ? ". Portfolio share is unavailable." : " — " + percentText(share) + " of the authorized portfolio.") +
          " Grouped by " + dimensions[group].toLowerCase() + ". Open the filtered Project Explorer.";
        return <li key={row.key}>
          <button type="button" className="exec-text-button mi-distribution-label" onClick={row.open}
            >{row.label}<ArrowUpRight size={14} aria-hidden="true" /></button>
          <DottedTrack label={row.label + " portfolio share"} value={share} tone="teal" />
          <div className="mi-distribution-count"><b>{row.count} · {share === undefined ? "—" : percentText(share)}</b><small>{row.count} of {total} projects</small></div>
          <ContextHelp watch=".mi-distribution-label" label={"Explain " + row.label + " distribution"}>{explanation}</ContextHelp>
        </li>;
      })}
    </ul>
  </section>;
}
