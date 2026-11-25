import { SearchableCombobox } from "./SearchableCombobox";

type Choice = { id: string; label: string; profile?: { id: number; name: string } };

export function TimeConsultantFilter({ choices, selected, disabled, onChange }: {
  choices: Choice[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  const groups = new Map<string, { label: string; ids: string[]; aliases: string[] }>();
  for (const choice of choices) {
    const key = choice.profile ? "profile-" + choice.profile.id : "source-" + choice.id;
    const group = groups.get(key) ?? { label: choice.profile?.name ?? choice.label, ids: [], aliases: [] };
    group.ids.push(choice.id);
    group.aliases.push(choice.label);
    groups.set(key, group);
  }
  const covered = new Set(choices.map(choice => choice.id));
  for (const id of selected) {
    if (!covered.has(id)) groups.set("source-" + id, { label: id === "unavailable" ? "Unavailable" : id, ids: [id], aliases: [] });
  }
  const options = [...groups].filter(([, group]) => group.ids.some(id => !selected.includes(id))).map(([value, group]) => ({
    value, label: group.label, detail: group.ids.length > 1 ? group.ids.length + " verified source identities" : "Source ID " + group.ids[0],
    search: [...group.ids, ...group.aliases].join(" "),
  }));
  return <div className="time-consultants" aria-label="Consultant filter">
    <SearchableCombobox label="Consultant" value="" options={options} disabled={disabled}
      placeholder="Search consultants by name" onChange={id => {
        const group = groups.get(id);
        if (group) onChange([...new Set([...selected.filter(value => value !== "unavailable"), ...group.ids])]);
      }} />
    {!!selected.length && <div className="time-consultant-chips" aria-label="Selected consultants">
      {[...groups].filter(([, group]) => group.ids.some(id => selected.includes(id))).map(([id, group]) =>
        <button key={id} className="secure-secondary" type="button" disabled={disabled} aria-label={"Remove " + group.label}
          onClick={() => onChange(selected.filter(value => !group.ids.includes(value)))}>{group.label} <span aria-hidden="true">×</span></button>)}
      <button type="button" className="exec-text-button" disabled={disabled} onClick={() => onChange([])}>Clear consultants</button>
    </div>}
  </div>;
}
