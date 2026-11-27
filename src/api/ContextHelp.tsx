import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";

const eventName = "portfolio-help-open";
export function ContextHelp({ label, children, watch, avoid }: { label: string; children: string; watch?: string; avoid?: string }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const delay = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pinned, pin] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const [positionAnchor, setPositionAnchor] = useState<Element>();
  const close = () => { window.clearTimeout(delay.current); setOpen(false); pin(false); setPosition(undefined); setPositionAnchor(undefined); };
  const show = () => { window.clearTimeout(delay.current); window.dispatchEvent(new CustomEvent(eventName, { detail: id })); setOpen(true); };
  useEffect(() => {
    const trigger = watch && anchor.current?.parentElement?.querySelector(watch);
    if (!trigger) return;
    const enter = (event: Event) => {
      if (event.type === "pointerenter" && (event as PointerEvent).pointerType === "touch") return;
      window.clearTimeout(delay.current);
      delay.current = window.setTimeout(() => { setPositionAnchor(trigger); show(); }, event.type === "focus" ? 0 : 180);
    };
    const leave = () => {
      window.clearTimeout(delay.current);
      delay.current = window.setTimeout(close, 160);
    };
    if (open) trigger.setAttribute("aria-describedby", id);
    trigger.addEventListener("pointerenter", enter);
    trigger.addEventListener("pointerleave", leave);
    trigger.addEventListener("focus", enter);
    trigger.addEventListener("blur", leave);
    return () => {
      trigger.removeEventListener("pointerenter", enter);
      trigger.removeEventListener("pointerleave", leave);
      trigger.removeEventListener("focus", enter);
      trigger.removeEventListener("blur", leave);
      if (trigger.getAttribute("aria-describedby") === id) trigger.removeAttribute("aria-describedby");
    };
  }, [id, watch, open]);
  useEffect(() => {
    const another = (event: Event) => { if ((event as CustomEvent).detail !== id) close(); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !tip.current?.contains(event.target)) close();
    };
    window.addEventListener(eventName, another);
    window.addEventListener("keydown", keyboard);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.clearTimeout(delay.current);
      window.removeEventListener(eventName, another);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("pointerdown", outside);
    };
  }, [id]);
  useEffect(() => {
    if (!open) return;
    function update() {
      const a = (positionAnchor ?? anchor.current)?.getBoundingClientRect();
      const panel = tip.current?.getBoundingClientRect();
      if (!a || !panel || a.bottom < 0 || a.top > window.innerHeight) { close(); return; }
      const edge = 8;
      const left = Math.max(edge, Math.min(a.left + a.width / 2 - panel.width / 2, window.innerWidth - panel.width - edge));
      const region = avoid ? anchor.current?.closest(avoid)?.getBoundingClientRect() ?? a : a;
      const below = region.bottom + edge;
      const y = below + panel.height <= window.innerHeight - edge ? below : region.top - panel.height - edge;
      setPosition({ left, top: Math.max(edge, Math.min(y, window.innerHeight - panel.height - edge)) });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, positionAnchor, avoid]);
  const scheduleClose = () => { if (!pinned) delay.current = window.setTimeout(close, 160); };
  return <>
    <button ref={anchor} type="button" className="exec-help" aria-label={label} aria-describedby={open ? id : undefined}
      onMouseEnter={() => { delay.current = window.setTimeout(() => { setPositionAnchor(undefined); show(); }, 220); }}
      onMouseLeave={() => { window.clearTimeout(delay.current); scheduleClose(); }}
      onFocus={() => { setPositionAnchor(undefined); show(); }} onBlur={close}
      onClick={() => { if (pinned) close(); else { setPositionAnchor(undefined); pin(true); show(); } }}><CircleHelp size={16} aria-hidden="true" /></button>
    {open && createPortal(<div role="tooltip" ref={tip} id={id} className="exec-tooltip"
      onMouseEnter={() => window.clearTimeout(delay.current)} onMouseLeave={scheduleClose}
      style={position ? position : { visibility: "hidden", top: 0, left: 0 }}>{children}</div>, document.body)}
  </>;
}
