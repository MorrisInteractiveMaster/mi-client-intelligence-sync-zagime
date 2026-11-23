import { ZAGIME_CLIENT_DISPLAY_NAME } from "../config/client-identity";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Pause, Play, Printer, RotateCcw, X } from "lucide-react";
import type { ProjectReport } from "../projects/model";
import { brandAsset } from "../config/branding";
import { reportHours, reportMonth } from "./dashboard-format";
import { chartRows } from "./DotAnalytics";
import { Sparkline } from "./ReportingPlots";
import { portalNavigate, usePortalLocation } from "./portal-location";
import { PresentationContent, publishedChapters } from "./PresentationChapters";
import { clientDelivery } from "./client-delivery";

export default function ExecutivePresentation({ report, onClose, scope = "overview", scopeTitle, onLink, draft, linked }: {
  report: ProjectReport; onClose: () => void; scope?: string; scopeTitle?: string;
  onLink?: (view: string, month?: string) => void; draft?: boolean; linked?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const location = usePortalLocation();
  const requestedChapter = Number(location.get("chapter") ?? "1") - 1;
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number } | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const period = reportMonth(report.month);
  const projects = report.projects;
  const items = clientDelivery(report).projects;
  const active = items.filter(item => item.active).map(item => item.project);
  const completed = items.filter(item => item.completed).map(item => item.project);
  const upcoming = items.filter(item => item.upcoming).map(item => item.project);
  const milestones = [...active, ...upcoming].flatMap(p => p.milestones ?? [])
    .filter(m => !m.completed && m.date >= report.month + "-01").sort((a, b) => a.date.localeCompare(b.date));
  const lines = (p: typeof projects) => p.length ? p.slice(0, 4).map(x => x.name) : ["No published projects in this category."];
  const leadership = [
    { label: "Partnership", title: report.tenant.name, value: "At a glance", rows: ["Morris Interactive"] },
    { label: "Reporting period", title: "Reporting period", value: period, rows: ["Monthly reported effort for published projects"] },
    { label: "Delivery hours", title: "Published delivery", value: reportHours(report.totalSeconds) + " h", rows: ["Approved reported effort for " + period] },
    { label: "Service areas", title: "Work across service areas", value: "", rows: chartRows(report, "distribution").map(x => x.label + " · " + reportHours(x.seconds) + " h") },
    { label: "Active work", title: "Active work", value: String(active.length), rows: lines(active) },
    { label: "Milestones", title: "Progress and milestones", value: String(milestones.length), rows: milestones.slice(0, 4).map(m => m.title) },
    { label: "Completed work", title: "Completed work", value: String(completed.length), rows: lines(completed) },
    { label: "Upcoming priorities", title: "Upcoming priorities", value: String(upcoming.length), rows: lines(upcoming) },
    { label: "Executive summary", title: "Executive summary", value: "", rows: [report.portfolio?.narrative || "No executive narrative has been published for this period.", report.portfolio?.action ?? ""].filter(Boolean) },
  ];
  const single = projects.length === 1 ? projects[0] : undefined;
  const scopedNote = scope === "notes" ? [report.portfolio?.narrative, report.portfolio?.action].filter((value): value is string => Boolean(value)) : [];
  const scenes = scope === "overview" ? leadership : [
    { label: "Overview", title: scopeTitle || report.tenant.name, value: period,
      rows: scopedNote.length ? scopedNote : single?.description ? [single.description] : [projects.length + " approved projects"] },
    { label: "Delivery hours", title: "Published delivery", value: reportHours(report.totalSeconds) + " h",
      rows: scope === "history" ? chartRows(report, "trend").map(row => row.label + " · " + reportHours(row.seconds) + " h")
        : single ? [single.progress + "% progress", reportHours(single.lifetimeSeconds) + " h lifetime reported"] : lines(projects) },
    { label: "Progress & plans", title: "Progress and plans", value: "",
      rows: projects.filter(p => p.plan.targetSeconds > 0).map(p => p.name + " · " + reportHours(p.plan.targetSeconds) + " h " + (p.plan.basis === "monthly" ? "monthly" : "lifetime") + " target") },
    { label: "Timeline", title: "Delivery timeline", value: "",
      rows: projects.flatMap(p => [...(p.milestones ?? []), ...(p.updates ?? [])]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).map(m => m.date + " · " + m.title) },
    { label: "Team", title: "Project team", value: "",
      rows: (report.portfolio?.directory ?? []).filter(person => person.projectIds.some(id => projects.some(p => p.id === id))).map(person => person.name + " · " + person.role) },
  ];
  const chapters = linked ? publishedChapters(report) : undefined;
  const end = (chapters?.length ?? scenes.length) - 1;
  const current = linked && Number.isSafeInteger(requestedChapter) ? Math.min(end, Math.max(0, requestedChapter)) : Math.min(index, end);
  const scene = scenes[Math.min(current, scenes.length - 1)];
  const chapter = chapters?.[current];
  const history = chartRows(report, "trend").map(row => ({ ...row, value: row.seconds }));
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
      if (current < end) go(current + 1);
      else setPlaying(false);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [playing, current, end, linked]);
  function go(next: number) {
    const target = Math.min(end, Math.max(0, next));
    if (linked) portalNavigate({ chapter: String(target + 1) }, true);
    else setIndex(target);
  }
  return <dialog ref={dialog} className={"exec-presentation mi-live-presentation" + (linked ? " platform-presentation" : "")} aria-labelledby="presentation-title"
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest("select, input, textarea, [contenteditable]")) return;
      if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        go(event.key === "Home" ? 0 : event.key === "End" ? end : current + (event.key === "ArrowRight" ? 1 : -1));
      }
    }}>
    <div className="exec-presentation-stage intel-presentation-stage" data-chapter={current} ref={stage}>
    <header className="exec-presentation-top">
      <img src={brandAsset("branding/zagime/zagime-main-logo.png")} alt={ZAGIME_CLIENT_DISPLAY_NAME} />
      {draft && <strong className="mi-presentation-draft">Draft · Morris staff only</strong>}
      <button className="exec-icon" type="button" aria-label="Close presentation" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="exec-presentation-body mi-presentation-body" onTouchStart={event => {
      gesture.current = undefined;
      if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest("button, select, summary, .mi-trend-viewport"))) return;
      gesture.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }} onTouchEnd={event => {
      const start = gesture.current, endTouch = event.changedTouches[0];
      gesture.current = undefined;
      if (!start || !endTouch) return;
      const dx = endTouch.clientX - start.x, dy = endTouch.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(current + (dx < 0 ? 1 : -1)); setPlaying(false); }
    }} onTouchCancel={() => { gesture.current = undefined; }}>
      {chapter ? <div className="platform-chapter mi-presentation-chapter" data-layout={chapter.timeline ? "trend" : chapter.people ? "team" : chapter.data ? "chart" : current === 0 ? "opening" : "narrative"} key={current} aria-live={playing ? "off" : "polite"}>
        <span className="exec-kicker">{period} · {current + 1} / {chapters?.length}</span>
        <h2 id="presentation-title">{chapter.title}</h2>
        {chapter.text && <p>{chapter.text}</p>}
        <PresentationContent chapter={chapter} onLink={onLink} month={report.month} draft={draft} />
        {onLink && <button className="mi-presentation-link mi-presentation-return" type="button" onClick={() => onLink(chapter.link)}>Open live report</button>}
      </div> : <>
      <div className="exec-scene mi-presentation-chapter" data-layout={current === 0 ? "opening" : "legacy"} key={current} aria-live={playing ? "off" : "polite"}>
        <span className="exec-kicker">{period} · {current + 1} / {scenes.length}</span>
        <h2 id="presentation-title">{scene.title}</h2>
        {scene.value && <p className="exec-scene-value">{scene.value}</p>}
        {((scope === "overview" && current === 2) || (scope !== "overview" && current === 1)) && <Sparkline rows={history} />}
        {scene.rows.length ? <ul>{scene.rows.map((row, i) => <li key={i}>{row}</li>)}</ul> : <p>No published allocations for this chapter.</p>}
        {onLink && <button className="intel-report-link" type="button"
          onClick={() => onLink(scope === "overview" ? (["overview", "history", "projects", "history", "projects:active", "milestones", "projects:completed", "projects:planned", "notes"][current] ?? "overview") : scope)}>
          Open live report
        </button>}
      </div>
      </>}
    </div>
    <footer className="exec-presentation-controls" aria-label="Presentation controls">
      <button className="exec-icon" type="button" aria-label="Previous chapter" disabled={!current} onClick={() => go(current - 1)}><ChevronLeft size={20} /></button>
      <button className="exec-icon" type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { if (!playing && current === end) go(0); setPlaying(!playing); }}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
      <button className="exec-icon" type="button" aria-label="Next chapter" disabled={current === end} onClick={() => go(current + 1)}><ChevronRight size={20} /></button>
      <button className="exec-icon" type="button" aria-label="Restart presentation" onClick={() => { go(0); setPlaying(false); }}><RotateCcw size={17} /></button>
      <select aria-label="Presentation chapter" value={current} onChange={event => go(Number(event.target.value))}>
        {(chapters?.map(item => item.title) ?? scenes.map(item => item.label)).map((label, i) => <option key={label} value={i}>{label}</option>)}
      </select>
      {typeof document !== "undefined" && document.fullscreenEnabled && <button className="exec-icon" type="button" aria-label="Toggle fullscreen" onClick={() => {
        const operation = document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen();
        void operation?.catch(() => setFullscreenError(true));
      }}><Maximize size={17} /></button>}
      {linked && <button className="exec-icon" type="button" aria-label={draft ? "Print draft preview" : "Print approved report"} onClick={() => window.print()}><Printer size={17} /></button>}
    </footer>
    {fullscreenError && <p role="status" className="exec-presentation-message">Fullscreen is unavailable. The presentation is still open.</p>}
    </div>
    {chapters && <article className="platform-print-deck">
      <h1>{report.tenant.name} · {period}</h1>
      {draft && <p>Draft preview · Morris staff only</p>}
      {chapters.map((item, i) => <section key={item.title + i}><h2>{item.title}</h2><PresentationContent chapter={item} /></section>)}
    </article>}
  </dialog>;
}
