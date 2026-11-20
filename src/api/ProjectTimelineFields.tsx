import { useState } from "react";
import {
  MAX_PROJECT_TIMELINE_ITEMS,
  MAX_PROJECT_MILESTONES,
  MAX_PROJECT_UPDATE_TEXT,
  type ProjectMilestone,
  type ProjectUpdate,
} from "../projects/model";
import { milestoneStatuses, type MilestoneStatus } from "../projects/delivery";
import { milestoneTemplates } from "../projects/milestone-templates";
import type { DirectoryEntry } from "../projects/portfolio";
import { today } from "./dashboard-format";

export function ProjectTimelineFields({
  updates,
  milestones,
  setUpdates,
  setMilestones,
  disabled,
  people = [],
}: {
  updates: ProjectUpdate[];
  milestones: ProjectMilestone[];
  setUpdates: (items: ProjectUpdate[]) => void;
  setMilestones: (items: ProjectMilestone[]) => void;
  disabled: boolean;
  people?: DirectoryEntry[];
}) {
  const [template, setTemplate] = useState<keyof typeof milestoneTemplates>("General delivery");
  const [selected, setSelected] = useState<string[]>([]);
  const templateItems = milestoneTemplates[template].filter(item => !milestones.some(m => m.title === item));
  const newMilestone = (title: string): ProjectMilestone => ({ id: crypto.randomUUID(), title, date: "", completed: false, status: "not-started", visible: false });
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
        <details className="delivery-details"><summary>Add milestones from a template</summary>
          <label>Template<select value={template} onChange={event => { setTemplate(event.target.value as typeof template); setSelected([]); }}>
            {Object.keys(milestoneTemplates).map(name => <option key={name}>{name}</option>)}</select></label>
          <div className="delivery-template-options">{templateItems.map(title => <label className="secure-check" key={title}>
            <input type="checkbox" checked={selected.includes(title)} onChange={event => setSelected(items => event.target.checked ? [...items, title] : items.filter(item => item !== title))} /> {title}</label>)}</div>
          <div className="secure-actions">
            <button type="button" className="secure-secondary" onClick={() => setSelected(templateItems)}>Select all</button>
            <button type="button" className="secure-secondary" onClick={() => setSelected([])}>Clear</button>
            <button type="button" disabled={disabled || !selected.length || milestones.length + selected.length > MAX_PROJECT_MILESTONES}
              onClick={() => { setMilestones([...milestones, ...selected.map(newMilestone)]); setSelected([]); }}>Add selected milestones</button></div>
        </details>
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
                  type="date"
                  value={item.date}
                  onChange={(e) => change({ date: e.target.value })}
                />
              </label>
              <label className="secure-check">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={(e) => {
                    const completed = e.target.checked;
                    change({ completed, status: completed ? "completed" : "not-started", completedAt: completed ? today() : undefined });
                  }}
                />{" "}
                Milestone completed
              </label>
              <label>Status<select value={item.status ?? (item.completed ? "completed" : "not-started")} onChange={event => {
                const status = event.target.value as MilestoneStatus;
                change({ status, completed: status === "completed", completedAt: status === "completed" ? item.completedAt ?? today() : undefined });
              }}>{milestoneStatuses.map(status => <option key={status} value={status}>{status.replaceAll("-", " ")}</option>)}</select></label>
              <label>Owner<select value={item.ownerId ?? ""} onChange={event => change({ ownerId: event.target.value || undefined })}><option value="">Unassigned</option>
                {people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label>Weight<input type="number" min={1} max={1000} step={1} value={item.weight ?? ""} placeholder="1" onChange={event => change({ weight: event.target.value ? Number(event.target.value) : undefined })} /></label>
              {item.completed && <label>Completion date<input type="date" value={item.completedAt ?? ""} onChange={event => change({ completedAt: event.target.value || undefined })} /></label>}
              <label className="secure-field-wide">Milestone description<textarea maxLength={MAX_PROJECT_UPDATE_TEXT} value={item.body ?? ""} onChange={event => change({ body: event.target.value || undefined })} /></label>
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
          disabled={disabled || milestones.length >= MAX_PROJECT_MILESTONES}
          onClick={() =>
            setMilestones([
              ...milestones,
              newMilestone(""),
            ])
          }
        >
          Add milestone
        </button>
      </div>
    </div>
  );
}
