import { useEffect, useId, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { reportHours } from "./dashboard-format";
import { axisMaximum, type PlotUnit } from "./reporting-chart-data";
export type { PlotUnit } from "./reporting-chart-data";
import "./premium-reporting.css";

export type PlotRow = { id: string; label: string; value: number; month?: string };
const monthLabel = new Intl.DateTimeFormat("en-CA", {
  month: "short", year: "2-digit", timeZone: "UTC",
});
const shortMonth = (month?: string) => month ? monthLabel.format(new Date(month + "-01")) : undefined;

export const plotValue = (value: number, unit: PlotUnit) => unit === "percent" ? value + "%" : reportHours(value) + " h";

function TrendShape({ rows, maximum, compact }: { rows: PlotRow[]; maximum: number; compact?: boolean }) {
  const gradient = useId();
  const width = 1000;
  const height = 200;
  const gutter = compact ? 16 : 0;
  const points = rows.map((row, index) => ({
    x: rows.length === 1 ? width / 2 : compact
      ? gutter + index * (width - gutter * 2) / (rows.length - 1) : (index + .5) / rows.length * width,
    y: (1 - row.value / maximum) * (height - gutter * 2) + gutter,
  }));
  const series = points.map(({ x, y }) => x + "," + y).join(" ");
  return <svg className="mi-trend-shape" viewBox="0 0 1000 200" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stopColor="currentColor" stopOpacity=".28" />
      <stop offset="1" stopColor="currentColor" stopOpacity=".018" />
    </linearGradient></defs>
    {points.length > 1 && <>
      <polygon points={points[0].x + ",200 " + series + " " + points.at(-1)!.x + ",200"} fill={"url(#" + gradient + ")"} />
      <polyline points={series} fill="none" stroke="currentColor" strokeWidth={compact ? 2 : 2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </>}
  </svg>;
}

export function Sparkline({ rows }: { rows: PlotRow[] }) {
  if (rows.length < 2) return null;
  return <div className="mi-sparkline" aria-hidden="true">
    <TrendShape rows={rows} maximum={Math.max(1, ...rows.map(row => row.value))} compact />
  </div>;
}

type SeriesProps = {
  rows: PlotRow[];
  label: string;
  active?: string;
  unit: PlotUnit;
  onSelect: (id: string) => void;
  onInspect?: (id?: string) => void;
  spokenValue?: (value: number) => string;
};

export function TrendPlot({ rows, label, active, unit, onSelect, onInspect, spokenValue }: SeriesProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const controls = useRef<(HTMLButtonElement | null)[]>([]);
  const maximum = axisMaximum(Math.max(...rows.map(row => row.value), 0), unit);
  const fullWidth = rows.length * 44;
  const plot = active ?? rows.at(-1)?.id;
  const labels = [maximum, maximum / 2, 0];
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const activeControl = controls.current[rows.findIndex(row => row.id === plot)];
      const pane = viewport.current;
      if (!activeControl || !pane) return;
      const controlBounds = activeControl.getBoundingClientRect();
      const paneBounds = pane.getBoundingClientRect();
      if (controlBounds.left < paneBounds.left || controlBounds.right > paneBounds.right) {
        pane.scrollLeft += controlBounds.left - paneBounds.left - (pane.clientWidth - activeControl.clientWidth) / 2;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [plot, rows.length]);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 :
      event.key === "ArrowRight" ? Math.min(rows.length - 1, index + 1) :
      event.key === "ArrowLeft" ? Math.max(0, index - 1) : undefined;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(rows[next].id);
    controls.current[next]?.focus();
  }
  return <div className="mi-trend">
    <div className="mi-trend-axis" aria-hidden="true">{labels.map(value => <span key={value}>{plotValue(value, unit)}</span>)}</div>
    <div ref={viewport} className="mi-trend-viewport">
      <div className="mi-trend-canvas" style={{ minInlineSize: fullWidth }}>
        <div className="mi-trend-graph" role="img" aria-label={label}>
          <TrendShape rows={rows} maximum={maximum} />
        </div>
        <div className="mi-trend-controls" role="group" aria-label="Timeline points by month">
          {rows.map((row, index) => <button key={row.id} ref={node => { controls.current[index] = node; }}
            type="button" tabIndex={row.id === plot ? 0 : -1} aria-pressed={row.id === plot}
            aria-label={row.label + ", " + (spokenValue ? spokenValue(row.value) : plotValue(row.value, unit))}
            onClick={() => onSelect(row.id)} onKeyDown={event => move(event, index)}
            onPointerEnter={() => onInspect?.(row.id)} onPointerLeave={() => onInspect?.()}
            onFocus={() => onInspect?.(row.id)} onBlur={() => onInspect?.()}
            style={{ "--mi-point": (row.value / maximum * 100) + "%" } as CSSProperties}>
            <span className="mi-trend-marker" aria-hidden="true" />
            <span className="mi-trend-label">{shortMonth(row.month) ?? row.label}</span>
          </button>)}
        </div>
      </div>
    </div>
  </div>;
}

export function BarPlot({ rows, label, active, unit, onSelect, onInspect, spokenValue }: SeriesProps) {
  const maximum = axisMaximum(Math.max(...rows.map(row => row.value), 0), unit);
  return <div className="mi-bar-series" role="group" aria-label={label}>
    <div className="mi-bar-axis" aria-hidden="true"><span>0 {unit === "hours" ? "h" : "%"}</span><span>{plotValue(maximum, unit)}</span></div>
    {rows.map(row => <button key={row.id} type="button" aria-pressed={row.id === active}
      aria-label={row.label + ", " + (spokenValue ? spokenValue(row.value) : plotValue(row.value, unit))}
      onClick={() => onSelect(row.id)} onPointerEnter={() => onInspect?.(row.id)} onPointerLeave={() => onInspect?.()}
      onFocus={() => onInspect?.(row.id)} onBlur={() => onInspect?.()}>
      <span>{row.label}</span><b>{plotValue(row.value, unit)}</b>
      <span className="mi-bar-track" aria-hidden="true">
        <i style={{ inlineSize: row.value / maximum * 100 + "%" }} data-positive={row.value > 0} />
      </span>
    </button>)}
  </div>;
}
