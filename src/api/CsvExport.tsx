import { useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { csvFilename, csvText, type CsvData } from "./report-csv";
import "./report-csv.css";

type Props = { filename: string; label?: string; scope?: string; disabled?: boolean; onDenied?: () => void } &
  ({ data: CsvData; load?: never } | { data?: never; load: (signal: AbortSignal) => Promise<CsvData> });

export function CsvExport({ filename, label = "Export CSV", scope, disabled, data, load, onDenied }: Props) {
  const pending = useRef<AbortController>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    setBusy(false);
    setMessage("");
    setError(false);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [filename, scope]);
  async function download() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      const result = load ? await load(controller.signal) : data;
      if (controller.signal.aborted) return;
      if (!result?.rows.length) {
        setMessage("No records match this export.");
        return;
      }
      const url = URL.createObjectURL(new Blob([csvText(result)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFilename(filename);
      document.body.append(link);
      try { link.click(); }
      finally {
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage(result.rows.length + (result.rows.length === 1 ? " row exported." : " rows exported."));
    } catch (failure) {
      if (controller.signal.aborted) return;
      if (failure && typeof failure === "object" && "status" in failure && [401, 403].includes(Number(failure.status))) onDenied?.();
      setError(true);
      setMessage(failure instanceof Error ? failure.message : "The report could not be exported.");
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  return <span className="report-export">
    <button type="button" className="platform-primary-action report-export-button" disabled={disabled || busy || data?.rows.length === 0}
      aria-busy={busy} onClick={() => void download()}>
      <Download size={16} aria-hidden="true" />
      <span>{busy ? "Preparing CSV…" : label}</span>
    </button>
    {message && <small role={error ? "alert" : "status"} className={error ? "report-export-error" : undefined}>{message}</small>}
  </span>;
}
