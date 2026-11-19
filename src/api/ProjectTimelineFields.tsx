import {
  MAX_PROJECT_TIMELINE_ITEMS,
  MAX_PROJECT_UPDATE_TEXT,
  type ProjectMilestone,
  type ProjectUpdate,
} from "../projects/model";
import { today } from "./dashboard-format";

export function ProjectTimelineFields({
  updates,
  milestones,
  setUpdates,
  setMilestones,
  disabled,
}: {
  updates: ProjectUpdate[];
  milestones: ProjectMilestone[];
  setUpdates: (items: ProjectUpdate[]) => void;
  setMilestones: (items: ProjectMilestone[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="secure-timeline-editor">
      <div>
        <h4>Project updates</h4>
        <p>
          Updates start as drafts. Mark an update visible to include it when the
          project is published.
        </p>
        {updates.map((item, index) => {
          const change = (patch: Partial<ProjectUpdate>) =>
            setUpdates(
              updates.map((entry) =>
                entry.id === item.id ? { ...entry, ...patch } : entry,
              ),
            );
          return (
            <fieldset key={item.id} disabled={disabled}>
              <legend>
                Update {index + 1} · {item.visible ? "Client-visible" : "Draft"}
              </legend>
              <label>
                Update title
                <input
                  required
                  maxLength={120}
                  value={item.title}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <label>
                Update date
                <input
                  required
                  type="date"
                  value={item.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
              <label className="secure-field-wide">
                Update text
                <textarea
                  required
                  maxLength={MAX_PROJECT_UPDATE_TEXT}
                  rows={3}
                  value={item.body}
                  onChange={(e) => change({ body: e.target.value })}
                />
              </label>
              <label className="secure-check">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(e) => change({ visible: e.target.checked })}
                />{" "}
                Show this update to clients
              </label>
              <button
                className="secure-secondary"
                type="button"
                onClick={() =>
                  setUpdates(updates.filter((entry) => entry.id !== item.id))
                }
              >
                Remove update {index + 1}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          disabled={disabled || updates.length >= MAX_PROJECT_TIMELINE_ITEMS}
          onClick={() =>
            setUpdates([
              ...updates,
              {
                id: crypto.randomUUID(),
                title: "",
                body: "",
                date: today(),
                visible: false,
              },
            ])
          }
        >
          Add update
        </button>
      </div>
      <div>
        <h4>Project milestones</h4>
        <p>
          Set milestone dates and mark completed work. Choose which milestones
          the client can see.
        </p>
        {milestones.map((item, index) => {
          const change = (patch: Partial<ProjectMilestone>) =>
            setMilestones(
              milestones.map((entry) =>
                entry.id === item.id ? { ...entry, ...patch } : entry,
              ),
            );
          return (
            <fieldset key={item.id} disabled={disabled}>
              <legend>Milestone {index + 1}</legend>
              <label>
                Milestone title
                <input
                  required
                  maxLength={120}
                  value={item.title}
                  onChange={(e) => change({ title: e.target.value })}
                />
              </label>
              <label>
                Milestone date
                <input
                  required
                  type="date"
                  value={item.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
              <label className="secure-check">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={(e) => change({ completed: e.target.checked })}
                />{" "}
                Milestone completed
              </label>
              <label className="secure-check">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(e) => change({ visible: e.target.checked })}
                />{" "}
                Show this milestone to clients
              </label>
              <button
                className="secure-secondary"
                type="button"
                onClick={() =>
                  setMilestones(
                    milestones.filter((entry) => entry.id !== item.id),
                  )
                }
              >
                Remove milestone {index + 1}
              </button>
            </fieldset>
          );
        })}
        <button
          type="button"
          disabled={disabled || milestones.length >= MAX_PROJECT_TIMELINE_ITEMS}
          onClick={() =>
            setMilestones([
              ...milestones,
              {
                id: crypto.randomUUID(),
                title: "",
                date: today(),
                completed: false,
                visible: false,
              },
            ])
          }
        >
          Add milestone
        </button>
      </div>
    </div>
  );
}
