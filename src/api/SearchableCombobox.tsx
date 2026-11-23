import { ChevronDown, Search } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import "./workspace-pickers.css";

export type ComboboxOption = { value: string; label: string; detail?: string; search?: string };

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();
}

export function SearchableCombobox({ label, value, options, onChange, required, disabled, placeholder = "Search options" }: {
  label: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const selected = options.find(option => option.value === value);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const results = options.filter(option => {
    const searchable = normalize([option.label, option.detail, option.search].join(" "));
    return terms.every(term => searchable.includes(term));
  });

  function show() {
    if (open) return;
    setQuery("");
    setOpen(true);
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
  }
  function hide() {
    setQuery("");
    setOpen(false);
    setActive(-1);
  }
  function select(option: ComboboxOption) {
    onChange(option.value);
    hide();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      event.preventDefault();
      hide();
      return;
    }
    if (event.key === "Enter" && open) {
      event.preventDefault();
      if (results[active]) select(results[active]);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (!open) {
      show();
      return;
    }
    if (!results.length) return;
    const next = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
    setActive(next);
    document.getElementById(id + "-option-" + next)?.scrollIntoView({ block: "nearest" });
  }

  return <div className="mi-combobox" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
  }}>
    <label htmlFor={id}>{label}</label>
    <div className="mi-combobox-input">
      <Search aria-hidden="true" size={17} />
      <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-required={required}
        aria-controls={id + "-list"} aria-expanded={open} autoComplete="off" disabled={disabled}
        aria-activedescendant={open && results[active] ? id + "-option-" + active : undefined}
        placeholder={placeholder} value={open ? query : selected?.label ?? ""}
        onClick={show} onFocus={show} onKeyDown={onKeyDown}
        onChange={event => { setOpen(true); setQuery(event.target.value); setActive(0); }} />
      <button type="button" tabIndex={-1} className="mi-combobox-toggle secure-secondary" aria-label={open ? "Close options" : "Open options"}
        disabled={disabled} onMouseDown={event => event.preventDefault()} onClick={() => {
          if (open) hide();
          else { input.current?.focus(); show(); }
        }}><ChevronDown aria-hidden="true" size={17} /></button>
    </div>
    <div className="mi-combobox-popover" hidden={!open}>
      <ul id={id + "-list"} role="listbox" aria-label={label}>
        {results.map((option, index) => <li key={option.value} id={id + "-option-" + index} role="option"
          aria-label={option.label} aria-describedby={option.detail ? id + "-detail-" + index : undefined}
          aria-selected={option.value === value} data-active={index === active}
          onMouseDown={event => event.preventDefault()} onClick={() => select(option)}>
          <strong>{option.label}</strong>{option.detail && <span id={id + "-detail-" + index}>{option.detail}</span>}
        </li>)}
      </ul>
      {!results.length && <p role="status">No matching options.</p>}
    </div>
  </div>;
}
