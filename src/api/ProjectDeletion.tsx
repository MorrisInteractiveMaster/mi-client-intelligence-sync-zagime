import { useEffect, useState } from "react";
import { deliveryKindNames } from "../projects/delivery";
import type { ProjectDeletionReview } from "../projects/model";
import type { SecuredApiClient } from "./client";
import { ManagementDialog } from "./ManagementDialog";

export function ProjectDeletion({ id, client, tenant, close, onDeleted }: {
  id: string;
  client: SecuredApiClient;
  tenant: string;
  close: () => void;
  onDeleted: () => void;
}) {
  const [review, setReview] = useState<ProjectDeletionReview>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const path = "projects/" + id + "/deletion";
  useEffect(() => {
    const controller = new AbortController();
    client.call<ProjectDeletionReview>(tenant, path, { signal: controller.signal }).then(setReview, () => {
      if (!controller.signal.aborted) setProblem("The project could not be reviewed. Refresh the workspace and try again.");
    });
    return () => controller.abort();
  }, [client, tenant, path]);

  async function remove() {
    if (!review || name !== review.name || busy || review.blockers.length) return;
    setBusy(true);
    setProblem("");
    try {
      await client.call(tenant, path, { method: "POST", body: { expectedRevision: review.revision, name } });
      onDeleted();
    } catch {
      setProblem("The project was not deleted. Close this review and reopen it to check for changed dependencies.");
      setBusy(false);
    }
  }

  return <ManagementDialog title="Review permanent project deletion" close={() => { if (!busy) close(); }}>
    {!review && !problem && <p role="status">Checking project dependencies…</p>}
    {problem && <p role="alert">{problem}</p>}
    {review && <form onSubmit={event => { event.preventDefault(); void remove(); }}>
      <h4>{review.name}</h4>
      <p>{[deliveryKindNames[review.kind], review.parent, review.department].filter(Boolean).join(" / ")}</p>
      <p>{review.published ? "Published" : "Private"} · {review.milestones} milestones · {review.activeBlocker ? "Active blocker" : "No active blocker"}</p>
      {review.blockers.length ? <>
        <p>These dependencies prevent permanent deletion.</p>
        <ul>{review.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
      </> : <>
        <p>This permanently removes the project, including its milestones and updates.</p>
        <label>Type the exact project name<input autoComplete="off" value={name} onChange={event => setName(event.target.value)} /></label>
      </>}
      <div className="secure-actions">
        <button type="button" className="secure-secondary" onClick={close} disabled={busy}>{review.blockers.length ? "Close" : "Cancel"}</button>
        {review.blockers.length === 0 && <button type="submit" disabled={busy || name !== review.name}>{busy ? "Deleting…" : "Delete permanently"}</button>}
      </div>
    </form>}
  </ManagementDialog>;
}
