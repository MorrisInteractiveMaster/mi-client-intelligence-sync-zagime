import { useState } from "react";
import type { StaffProjectSummary } from "../projects/model";
import type { SecuredApiClient } from "./client";

export function PublicationReview({ projects, client, tenant, revision, onClose, onSaved }: {
  projects: StaffProjectSummary[]; client: SecuredApiClient; tenant: string; revision: number;
  onClose: () => void; onSaved: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const candidates = projects.filter(p => !p.published && !["closed", "cancelled"].includes(p.status));
  async function publish() {
    if (!selected.length || !window.confirm("Publish the selected projects to authorized clients?")) return;
    setError(""); setBusy(true);
    let next = revision;
    const published: string[] = [];
    try {
      for (const projectId of selected) {
        const result = await client.call<{ revision: number }>(tenant, "projects/" + projectId + "/publication",
          { method: "PATCH", body: { expectedRevision: next, published: true } });
        next = result.revision;
        published.push(projectId);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Publication could not continue.");
    } finally {
      setBusy(false);
      setSaved(published);
      setSelected([]);
      if (published.length) onSaved();
    }
  }
  return <section className="secure-card" aria-label="Review projects for publication">
    <h3>Review projects for publication</h3>
    <p>Select projects after reviewing their client descriptions. Only clients with existing project access can see the result.</p>
    {!candidates.length && <p>No private projects are ready for review.</p>}
    {candidates.map(p => <label className="secure-check" key={p.id}>
      <input type="checkbox" disabled={busy} checked={selected.includes(p.id)}
        onChange={e => setSelected(current => e.target.checked ? [...current, p.id] : current.filter(id => id !== p.id))} />
      <span><b>{p.name}</b><br />{p.description || "No client description"}</span>
    </label>)}
    {error && <p role="alert">{error}</p>}
    {!!saved.length && <p role="status">{saved.length} projects published.</p>}
    <div className="secure-actions">
      <button type="button" disabled={busy || !selected.length} onClick={() => void publish()}>Publish selected projects</button>
      <button type="button" className="secure-secondary" disabled={busy} onClick={onClose}>Close review</button>
    </div>
  </section>;
}
