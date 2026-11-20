import { useEffect, useRef } from "react";
import type { BulkAllocationOutcome, BulkAllocationResponse } from "../projects/bulk-allocation";

const outcomeText: Record<BulkAllocationOutcome["status"], string> = {
  saved: "Saved.",
  already_saved: "Saved on an earlier attempt.",
  source_changed: "Source changed. Reload and review this entry before assigning.",
  allocation_changed: "Allocation changed. Reload and review this entry before assigning.",
  request_changed: "The retry no longer matches the saved request. Reload to see the current allocation.",
  not_eligible: "This entry needs review or no longer has eligible unallocated time.",
  unavailable: "This entry or delivery project is unavailable.",
  retryable: "The save could not be confirmed. Retry this entry.",
};

export function BulkAllocationResults({ result, describeEntry, onRetry, busy }: {
  result: BulkAllocationResponse;
  describeEntry: (id: string) => string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [result]);
  const saved = result.outcomes.filter(row => row.status === "saved" || row.status === "already_saved").length;
  return <section className="delivery-details delivery-bulk-results" aria-label="Bulk allocation results">
    <h3 ref={heading} tabIndex={-1}>Bulk allocation results</h3>
    <p role="status">{saved} of {result.outcomes.length} entries saved.</p>
    <ul>
      {result.outcomes.map(row => <li key={row.sourceId}><b>{describeEntry(row.sourceId)}</b> {outcomeText[row.status]}</li>)}
    </ul>
    <details><summary>Entry identifiers</summary>
      <ul>{result.outcomes.map(row => <li key={row.sourceId}>{describeEntry(row.sourceId)} · <code>{row.sourceId}</code></li>)}</ul>
    </details>
    {onRetry && result.outcomes.some(row => row.status === "retryable") &&
      <button type="button" className="secure-secondary" disabled={busy} onClick={onRetry}>Retry unsaved entries</button>}
  </section>;
}
