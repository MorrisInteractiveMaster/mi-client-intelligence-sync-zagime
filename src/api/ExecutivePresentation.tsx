import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Pause, Play, RotateCcw, X } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { areaHours } from "../projects/portfolio";
import { brandAsset } from "../config/branding";
import { reportHours, reportMonth } from "./dashboard-format";

const dotCount = 84;
function dotPosition(index: number, chapter: number) {
  const column = index % 12;
  const row = Math.floor(index / 12);
  if (chapter === 0 || chapter === 8) {
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const radius = 45 * Math.sqrt((index + .5) / dotCount);
    return { left: (50 + Math.cos(angle) * radius * .92) + "%", top: (50 + Math.sin(angle) * radius) + "%" };
  }
  const offset = (chapter === 4 || chapter === 5 || chapter === 7) ? Math.sin(column * .62 + chapter) * 6 : 0;
  return { left: (6 + column * 8) + "%", top: (14 + row * 12 + offset) + "%" };
}

export default function ExecutivePresentation({ report, onClose }: { report: ProjectReport; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const period = reportMonth(report.month);
  const projects = report.projects;
  const archived = new Set(report.portfolio?.placements.filter(p => p.archived).map(p => p.id));
  const active = projects.filter(p => p.status === "active" && !archived.has(p.id));
  const completed = projects.filter(p => p.status === "completed");
  const upcoming = projects.filter(p => p.status === "planned" && !archived.has(p.id));
  const milestones = [...active, ...upcoming].flatMap(p => p.milestones ?? [])
    .filter(m => !m.completed && m.date >= report.month + "-01").sort((a, b) => a.date.localeCompare(b.date));
  const lines = (p: typeof projects) => p.length ? p.slice(0, 4).map(x => x.name) : ["No published projects in this category."];
  const scenes = [
    { label: "Partnership", title: report.tenant.name, value: "At a glance", rows: ["Morris Interactive"] },
    { label: "Reporting period", title: "Reporting period", value: period, rows: ["Monthly allocations for published projects"] },
    { label: "Delivery hours", title: "Published delivery", value: reportHours(report.totalSeconds) + " h", rows: ["Approved allocations for " + period] },
    { label: "Service areas", title: "Work across service areas", value: "", rows: areaHours(projects, report.portfolio).map(x => x.name + " · " + reportHours(x.seconds) + " h") },
    { label: "Active work", title: "Active work", value: String(active.length), rows: lines(active) },
    { label: "Milestones", title: "Progress and milestones", value: String(milestones.length), rows: milestones.slice(0, 4).map(m => m.title) },
    { label: "Completed work", title: "Completed work", value: String(completed.length), rows: lines(completed) },
    { label: "Upcoming priorities", title: "Upcoming priorities", value: String(upcoming.length), rows: lines(upcoming) },
    { label: "Executive summary", title: "Executive summary", value: "", rows: [report.portfolio?.narrative || "No executive narrative has been published for this period.", report.portfolio?.action ?? ""].filter(Boolean) },
  ];
  const scene = scenes[index], end = scenes.length - 1;
  const groups = areaHours(projects, report.portfolio).filter(row => row.seconds > 0);
  const markers = groups.map((row, i) => groups.slice(0, i + 1).reduce((sum, value) => sum + value.seconds, 0) / Math.max(1, report.totalSeconds));
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (document.fullscreenElement && el.contains(document.fullscreenElement))
        void document.exitFullscreen().catch(() => {});
      el.close();
      document.body.style.overflow = previous;
    };
  }, []);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (index < end) setIndex(index + 1);
      else setPlaying(false);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [playing, index, end]);
  function go(next: number) { setIndex(Math.min(end, Math.max(0, next))); }
  return <dialog ref={dialog} className="exec-presentation" aria-labelledby="presentation-title"
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault(); go(index + (event.key === "ArrowRight" ? 1 : -1));
      }
    }}>
    <div className="exec-presentation-stage" ref={stage}>
    <header className="exec-presentation-top">
      <img src={brandAsset("branding/zagime/zagime-main-logo.png")} alt="Zagimē Anishinabēk" />
      <button className="exec-icon" type="button" aria-label="Close presentation" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="exec-presentation-body">
      <div className="exec-dot-field" aria-hidden="true">
        {Array.from({ length: dotCount }, (_, i) => <i key={i} data-tone={index === 3 && markers.length ? markers.findIndex(marker => i / dotCount < marker) % 5 : undefined}
          data-lit={(i * 7 + index * 11) % 29 < 12}
          style={dotPosition(i, index)} />)}
      </div>
      <div className="exec-scene" key={index} aria-live={playing ? "off" : "polite"}>
        <span className="exec-kicker">{period} · {index + 1} / {scenes.length}</span>
        <h2 id="presentation-title">{scene.title}</h2>
        {scene.value && <p className="exec-scene-value">{scene.value}</p>}
        {scene.rows.length ? <ul>{scene.rows.map((row, i) => <li key={i}>{row}</li>)}</ul> : <p>No published allocations for this chapter.</p>}
      </div>
    </div>
    <footer className="exec-presentation-controls">
      <button className="exec-icon" type="button" aria-label="Previous chapter" disabled={!index} onClick={() => go(index - 1)}><ChevronLeft size={20} /></button>
      <button className="exec-icon" type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && index === end) go(0); setPlaying(!playing); }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button className="exec-icon" type="button" aria-label="Next chapter" disabled={index === end} onClick={() => go(index + 1)}><ChevronRight size={20} /></button>
      <button className="exec-icon" type="button" aria-label="Restart presentation" onClick={() => { go(0); setPlaying(false); }}><RotateCcw size={17} /></button>
      <select aria-label="Presentation chapter" value={index} onChange={event => go(Number(event.target.value))}>
        {scenes.map(({label}, i) => <option key={label} value={i}>{label}</option>)}
      </select>
      {typeof document !== "undefined" && document.fullscreenEnabled && <button className="exec-icon" type="button" aria-label="Toggle fullscreen" onClick={() => {
        const operation = document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen();
        void operation?.catch(() => setFullscreenError(true));
      }}><Maximize size={17} /></button>}
    </footer>
    {fullscreenError && <p role="status" className="exec-presentation-message">Fullscreen is unavailable. The presentation is still open.</p>}
    </div>
  </dialog>;
}
