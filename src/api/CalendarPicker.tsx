import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { reportDay, today } from "./dashboard-format";
import "./workspace-pickers.css";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthLabel = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric" });

function dateObject(value: string) {
  return new Date(value + "T12:00:00");
}

function dateKey(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].map(part => String(part).padStart(2, "0")).join("-");
}

function moveMonth(value: Date, amount: number) {
  const lastDay = new Date(value.getFullYear(), value.getMonth() + amount + 1, 0).getDate();
  return new Date(value.getFullYear(), value.getMonth() + amount, Math.min(value.getDate(), lastDay), 12);
}

type CalendarProps = { label: string; disabled?: boolean; min?: string; max?: string };

export function CalendarPicker({ value, onChange, required, ...props }: CalendarProps & {
  value: string; onChange: (value: string) => void; required?: boolean;
}) {
  return <DateChooser {...props} values={value ? [value] : []} choose={values => onChange(values[0] ?? "")} required={required} />;
}

export function CalendarMultiPicker({ values, onChange, limit, ...props }: CalendarProps & {
  values: string[]; onChange: (values: string[]) => void; limit: number;
}) {
  return <DateChooser {...props} values={values} choose={onChange} limit={limit} />;
}

function DateChooser({ label, values, choose, disabled, min, max, required, limit }: CalendarProps & {
  values: string[]; choose: (values: string[]) => void; required?: boolean; limit?: number;
}) {
  const id = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const queuedFocus = useRef(false);
  const current = values[0] || today();
  const [cursor, setCursor] = useState(current);
  const [working, setWorking] = useState(values);
  const [open, setOpen] = useState(false);
  const month = dateObject(cursor);
  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0, 12);
  const cells = Array.from({ length: Math.ceil((last.getDate() + first.getDay()) / 7) * 7 },
    (_, i) => new Date(month.getFullYear(), month.getMonth(), 1 + i - first.getDay(), 12));
  const permissible = (key: string) => (!min || key >= min) && (!max || key <= max);
  const previous = new Date(first.getFullYear(), first.getMonth(), 0, 12);
  const next = new Date(first.getFullYear(), first.getMonth() + 1, 1, 12);

  useEffect(() => {
    const element = dialog.current;
    if (!open || !element) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [open]);
  useEffect(() => {
    if (open && queuedFocus.current) {
      queuedFocus.current = false;
      document.getElementById(id + cursor)?.focus();
    }
  }, [cursor, id, open]);

  function openCalendar() {
    setWorking(values);
    setCursor(min && current < min ? min : max && current > max ? max : current);
    queuedFocus.current = true;
    setOpen(true);
  }
  function dismiss() {
    dialog.current?.close();
    setOpen(false);
    opener.current?.focus();
  }
  function pick(key: string) {
    if (!permissible(key)) return;
    setCursor(key);
    if (limit === undefined) {
      choose([key]);
      dismiss();
    } else if (working.includes(key)) setWorking(working.filter(value => value !== key));
    else if (working.length < limit) setWorking([...working, key].sort());
  }
  function gridKey(event: KeyboardEvent<HTMLButtonElement>, date: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -date.getDay(), End: 6 - date.getDay() };
    let nextDate = dateObject(dateKey(date));
    if (event.key in offsets) nextDate.setDate(date.getDate() + offsets[event.key]);
    else if (event.key === "PageDown" || event.key === "PageUp") {
      nextDate = moveMonth(date, (event.key === "PageDown" ? 1 : -1) * (event.shiftKey ? 12 : 1));
    } else return;
    event.preventDefault();
    const key = dateKey(nextDate);
    if (permissible(key) && key !== cursor) {
      queuedFocus.current = true;
      setCursor(key);
    }
  }
  const description = values.length ? (limit === undefined ? reportDay(values[0]) : `${values.length} date${values.length === 1 ? "" : "s"} selected`) : "Choose date" + (limit === undefined ? "" : "s");

  return <div className="mi-calendar-field">
    <label id={id + "-label"}>{label}{required && " *"}</label>
    <button type="button" ref={opener} className="mi-calendar-toggle secure-secondary" disabled={disabled} aria-haspopup="dialog"
      aria-labelledby={id + "-label " + id + "-value"} onClick={openCalendar}>
      <CalendarDays size={17} aria-hidden="true" /><span id={id + "-value"}>{description}</span>
    </button>
    {limit !== undefined && !!values.length && <ul className="mi-calendar-selected">{values.map(value => <li key={value}>{reportDay(value)}</li>)}</ul>}
    <dialog ref={dialog} className="mi-picker-dialog" aria-labelledby={id + "-heading"} onCancel={event => {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    }}>
      {open && <>
        <header><h3 id={id + "-heading"}>{label}</h3><button type="button" className="secure-secondary" onClick={dismiss} aria-label="Close calendar"><X size={18} /></button></header>
        <div className="mi-calendar-navigation">
          <button type="button" className="secure-secondary" aria-label="Previous month" disabled={!!min && dateKey(previous) < min}
            onClick={() => setCursor(dateKey(moveMonth(month, -1)) < (min ?? "") ? min! : dateKey(moveMonth(month, -1)))}><ChevronLeft size={18} /></button>
          <strong aria-live="polite" id={id + "-month"}>{monthLabel.format(month)}</strong>
          <button type="button" className="secure-secondary" aria-label="Next month" disabled={!!max && dateKey(next) > max}
            onClick={() => setCursor(max && dateKey(moveMonth(month, 1)) > max ? max : dateKey(moveMonth(month, 1)))}><ChevronRight size={18} /></button>
        </div>
        <div className="mi-calendar-grid" role="grid" aria-labelledby={id + "-month"} aria-multiselectable={limit !== undefined || undefined}>
          <div role="row">{weekdays.map(day => <span key={day} role="columnheader">{day}</span>)}</div>
          {Array.from({ length: cells.length / 7 }, (_, row) => <div role="row" key={row}>
            {cells.slice(row * 7, row * 7 + 7).map(date => {
              const key = dateKey(date);
              return <div role="gridcell" key={key} aria-selected={working.includes(key)}>
                <button type="button" className="secure-secondary" id={id + key} disabled={!permissible(key)} tabIndex={key === cursor ? 0 : -1}
                  data-other-month={date.getMonth() !== month.getMonth()} aria-current={key === today() ? "date" : undefined}
                  aria-label={reportDay(key)} onKeyDown={event => gridKey(event, date)} onClick={() => pick(key)}>{date.getDate()}</button>
              </div>;
            })}
          </div>)}
        </div>
        {limit !== undefined && <p role="status">{working.length} of {limit} dates selected</p>}
        <footer>
          {!required && <button type="button" className="secure-secondary" onClick={() => {
            if (limit !== undefined) setWorking([]);
            else { choose([]); dismiss(); }
          }}>Clear</button>}
          <button type="button" className="secure-secondary" onClick={dismiss}>Cancel</button>
          {limit !== undefined && <button type="button" className="secure-secondary mi-picker-primary" onClick={() => { choose(working); dismiss(); }}>Apply dates</button>}
        </footer>
      </>}
    </dialog>
  </div>;
}
