import { useEffect, useRef, useState } from "react";
import { hours, project, type ReportingState } from "./model";
// The approved renderer is a plain-JavaScript canvas module. Keep the boundary local.
type Pulse = {
  story: (d: unknown) => any;
  styles: Record<string, { draw: (...args: any[]) => void }>;
  sceneAt: (t: number) => any;
  DURATION: number;
};
declare global {
  interface Window {
    PULSE: Pulse;
    PULSE_SOUND: {
      init: () => void;
      cuesFor: (style: string, story: any) => { t: number }[];
      fire: (cue: any) => void;
    };
  }
}
let ready: Promise<void> | undefined;
function load() {
  return (ready ??= (async () => {
    for (const file of ["engine.js", "style4Dots.js", "sound.js"])
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = `${import.meta.env.BASE_URL}recap/${file}`;
        script.onload = () => resolve();
        script.onerror = () => reject(Error("Unable to load recap"));
        document.head.append(script);
      });
  })());
}
export function Dots({ state }: { state: ReportingState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const view = project(state);
  useEffect(() => {
    let active = true;
    load()
      .then(() => {
        if (active) setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const P = window.PULSE;
    const story = P.story({
      client: view.tenant.name,
      partner: "Morris Interactive",
      asOf: "2026-10-23",
      months: ["Oct"],
      monthsLong: ["October 2026"],
      projects: state.agreements.map((a) => ({
        name: a.name,
        wo: a.id,
        parent: null,
        status: "On track",
        cap:
          a.caps
            .filter((c) => c.month === "2026-10")
            .sort((a, b) => b.revision - a.revision)[0]?.minutes / 60 || 0,
        end: "2026-10-31",
        months: [
          view.projects
            .filter((p) => p.agreementId === a.id)
            .reduce((n, p) => n + p.seconds, 0) / 3600,
        ],
      })),
    });
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    P.styles.dots.draw(ctx, story, P.sceneAt(time), time, {});
  }, [loaded, time, state, view.totalSeconds]);
  useEffect(() => {
    if (!playing || !loaded) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTime(4);
      setPlaying(false);
      return;
    }
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      setTime((t) => {
        const next = t + (now - previous) / 1000;
        previous = now;
        if (next >= window.PULSE.DURATION) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 50);
    return () => clearInterval(timer);
  }, [playing, loaded]);
  useEffect(() => {
    if (sound && playing) window.PULSE_SOUND.fire({ type: "ping", p: 0 });
  }, [sound, playing]);
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        width="1280"
        height="720"
        style={{ width: "100%" }}
        aria-label={`${hours(view.totalSeconds)} synthetic delivered hours`}
      />
      <p>
        Exact delivered hours: {hours(view.totalSeconds)}.{" "}
        {view.projects
          .map((p) => `${p.name}: ${hours(p.seconds)} h`)
          .join(" · ")}
        . Dots represent hours in groups; recorded hours do not imply completed
        outcomes.
      </p>
      <button onClick={() => setPlaying((p) => !p)} disabled={!loaded}>
        {playing ? "Pause" : "Play"}
      </button>
      <button
        onClick={() => {
          setTime(0);
          setPlaying(true);
        }}
      >
        Replay
      </button>
      <button
        aria-pressed={sound}
        onClick={() => {
          window.PULSE_SOUND.init();
          setSound((s) => !s);
        }}
      >
        Sound {sound ? "on" : "off"}
      </button>
    </div>
  );
}
