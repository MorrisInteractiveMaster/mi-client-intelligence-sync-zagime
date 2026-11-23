import { useId, useState, type ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { precedingTimeMonth, reportingTimeMonth } from "../projects/time-history";
import { reportMonth } from "./dashboard-format";
import { validMonth } from "./portal-location";
import { followingTimeMonth, historyRange, reportingMonthOptions, type ReportingMonthRange } from "./reporting-period";
import "./reporting-period.css";

export function ReportingPeriod({ month, currentMonth = reportingTimeMonth(), availableMonths = [], latestMonth, empty,
  onMonth, range, onRange, pending, action }: {
  month: string;
  currentMonth?: string;
  availableMonths?: readonly string[];
  latestMonth?: string;
  empty?: boolean;
  pending?: boolean;
  action?: ReactNode;
  onMonth: (month: string) => void;
  range?: ReportingMonthRange;
  onRange?: (range: ReportingMonthRange) => void;
}) {
  const control = useId();
  const [custom, setCustom] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [rangeError, setRangeError] = useState("");
  const options = reportingMonthOptions(month, currentMonth, availableMonths);
  const previous = precedingTimeMonth(month);
  const next = followingTimeMonth(month);
  const latest = latestMonth ?? currentMonth;
  const selectMonth = (value: string) => {
    if (validMonth(value) && value <= currentMonth) {
      setCustom(false);
      setOptionsOpen(false);
      setRangeError("");
      onMonth(value);
    }
  };

  return <section className="reporting-period" aria-label="Reporting period">
    <div className="reporting-period__main">
      <span className="reporting-period__label"><CalendarDays size={16} aria-hidden="true" /> Reporting period</span>
      <div className="reporting-period__stepper">
        <button type="button" className="secure-secondary" aria-label="Previous reporting month"
          title={previous >= options[0] ? reportMonth(previous) : undefined}
          disabled={!validMonth(previous) || previous < options[0]} onClick={() => selectMonth(previous)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <label className="reporting-period__month" htmlFor={control}>
          <span className="reporting-period__sr">Reporting month</span>
          <select id={control} value={month} onChange={event => selectMonth(event.currentTarget.value)}>
            {[...options].reverse().map(option => <option key={option} value={option}>{reportMonth(option)}</option>)}
          </select>
        </label>
        <button type="button" className="secure-secondary" aria-label="Next reporting month"
          title={next <= currentMonth ? reportMonth(next) : undefined}
          disabled={!validMonth(next) || next > currentMonth} onClick={() => selectMonth(next)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      {latest !== month && <button className="secure-secondary reporting-period__latest" type="button"
        onClick={() => selectMonth(latest)}>Latest available month</button>}
      <div className="reporting-period__presets" data-open={optionsOpen}>
        <button type="button" className="secure-secondary reporting-period__options" aria-expanded={optionsOpen}
          aria-controls={control + "-options"} disabled={pending} onClick={() => setOptionsOpen(value => !value)}>Period options</button>
        {optionsOpen && <div className="reporting-period__choices" id={control + "-options"}>
          <button className="secure-secondary" type="button" onClick={() => selectMonth(currentMonth)}>This Month</button>
          <button className="secure-secondary" type="button" onClick={() => selectMonth(precedingTimeMonth(currentMonth))}>Previous Month</button>
          {onRange && <>
            {([["year", "This Year"], ["last-year", "Last Year"], ["all", "All History"]] as const).map(([preset, label]) =>
              <button className="secure-secondary" type="button" key={preset} aria-pressed={range?.preset === preset} onClick={() => {
                setCustom(false);
                setOptionsOpen(false);
                onRange(historyRange(preset, currentMonth));
              }}>{label}</button>)}
            <button className="secure-secondary" type="button" aria-pressed={custom || range?.preset === "custom"}
              onClick={() => { setCustom(value => !value); setRangeError(""); }}>Custom Range</button>
          </>}
        </div>}
      </div>
      {action}
    </div>
    {range && <p className="reporting-period__hint">{range.from && range.through ?
      "Trend range: " + reportMonth(range.from) + " to " + reportMonth(range.through) : "Trend range: All available history"}</p>}
    {empty && <p className="reporting-period__hint">No approved hours were reported for {reportMonth(month)}.</p>}
    {custom && onRange && <form className="reporting-period__range" onSubmit={event => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const from = String(data.get("from") ?? "");
      const through = String(data.get("through") ?? "");
      if (!validMonth(from) || !validMonth(through) || from > through || through > currentMonth) {
        setRangeError("Enter a start month on or before the end month. The end cannot be in the future.");
        return;
      }
      setRangeError("");
      setCustom(false);
      setOptionsOpen(false);
      onRange({ preset: "custom", from, through });
    }}>
      <label>From month<input name="from" type="month" required max={currentMonth} defaultValue={range?.from ?? month} /></label>
      <label>Through month<input name="through" type="month" required max={currentMonth} defaultValue={range?.through ?? currentMonth} /></label>
      <button type="submit">Apply range</button>
      <button type="button" className="secure-secondary" onClick={() => { setCustom(false); setRangeError(""); }}>Cancel</button>
      {rangeError && <p role="alert">{rangeError}</p>}
    </form>}
  </section>;
}
