import { ArrowDownRight, CalendarClock, CircleCheck, CircleDollarSign, ReceiptText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoiceFraction, invoiceState, invoiceStatuses, type Invoice, type InvoiceStatus, type InvoiceView } from "../projects/invoices";
import { ApiError, type SecuredApiClient } from "./client";
import { reportMonth } from "./dashboard-format";
import { portalNavigate, usePortalLocation } from "./portal-location";
import "./invoices.css";

export function useInvoices(client: SecuredApiClient, tenant: string, preview?: { mode: string; scope?: string }) {
  const endpoint = preview ? "invoices?" + new URLSearchParams({ preview: "published", ...(preview.scope && { scope: preview.scope }) }) : "invoices";
  const [epoch, setEpoch] = useState(0);
  const [result, setResult] = useState<{ key: string; client: SecuredApiClient; view?: InvoiceView; error?: string }>();
  const key = tenant + "/" + endpoint;
  useEffect(() => {
    const controller = new AbortController();
    client.call<InvoiceView>(tenant, endpoint, { signal: controller.signal }).then(view => {
      if (!controller.signal.aborted) setResult({ key, client, view });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ key, client, error: "Invoices are temporarily unavailable. Please try again." });
    });
    return () => controller.abort();
  }, [client, tenant, endpoint, epoch, key]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === "visible") setEpoch(value => value + 1); };
    const timer = window.setInterval(refresh, 300_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const current = result?.key === key && result.client === client ? result : undefined;
  return { view: current?.view, error: current?.error, reload: () => setEpoch(value => value + 1) };
}

export function invoiceNavNotice(view: InvoiceView | undefined, staff: boolean) {
  if (!view) return;
  const flagged = view.invoices.filter(invoice => {
    const state = invoiceState(invoice, view.today);
    return staff ? state.outstanding : state.overdue || state.dueToday;
  }).length;
  if (flagged) return staff ? flagged + " outstanding" : flagged + " overdue or due today";
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, currencyDisplay: "code" }).format(amount / 10 ** invoiceFraction(currency));
}
function totals(rows: Invoice[], field: "balance" | "total") {
  const result = new Map<string, number>();
  for (const row of rows) result.set(row.currency, (result.get(row.currency) ?? 0) + row[field]);
  return [...result].sort(([a], [b]) => a.localeCompare(b)).map(([currency, value]) => money(value, currency));
}
function shortDate(value?: string) {
  return value ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(value)) : "No due date";
}
const pageSize = 12;

export function Invoices({ client, tenant, staff, model }: {
  client: SecuredApiClient; tenant: string; staff?: boolean; model: ReturnType<typeof useInvoices>;
}) {
  const location = usePortalLocation();
  const { view, error, reload } = model;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const cancelConnection = useRef<() => void>(undefined);
  useEffect(() => () => cancelConnection.current?.(), []);
  async function connect() {
    setNotice("");
    setFailure("");
    const popup = typeof BroadcastChannel === "function" ? window.open("", "_blank", "popup,width=660,height=760") : null;
    if (!popup) { setFailure("Allow pop-ups for this dashboard and try connecting again."); return; }
    popup.opener = null;
    setBusy(true);
    let channel: BroadcastChannel | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const cleanup = () => {
      cancelled = true;
      channel?.close();
      clearTimeout(timer);
      popup.close();
    };
    cancelConnection.current = cleanup;
    const fail = () => {
      cleanup();
      setFailure("QuickBooks Online did not verify the connection. Try again and select the approved company.");
      setBusy(false);
    };
    try {
      const { url } = await client.call<{ url: string }>(tenant, "invoices/connect", { method: "POST", body: {} });
      if (cancelled) return;
      const destination = new URL(url);
      const state = destination.searchParams.get("state");
      if (destination.origin !== "https://appcenter.intuit.com" || !state || !/^[a-zA-Z0-9_-]{43}$/.test(state)) throw Error();
      channel = new BroadcastChannel("mi-qbo-invoice-" + state);
      channel.onmessage = event => {
        if (event.data?.state !== state || cancelled) return;
        if (event.data.failed) { fail(); return; }
        const { code, realm } = event.data;
        cleanup();
        void client.call(tenant, "invoices/callback", { method: "POST", body: { state, realm, code } }).then(() => {
          setNotice("QuickBooks Online connected. Sync invoices to review them.");
          setBusy(false);
          reload();
        }).catch(fail);
      };
      timer = setTimeout(fail, 600_000);
      popup.location.href = url;
    } catch { if (!cancelled) fail(); }
  }

  const invoices = view?.invoices;
  const months = useMemo(() => [...new Set(invoices?.map(invoice => invoice.txnDate.slice(0, 7)))].sort().reverse(), [invoices]);
  const availableProjects = useMemo(() => [...new Map(invoices?.flatMap(i => i.projects.map(p => [p.id, p] as const))).values()]
    .sort((a, b) => a.name.localeCompare(b.name)), [invoices]);
  const status = (Object.keys(invoiceStatuses) as InvoiceStatus[]).find(key => key === location.get("invoice-status")) ?? "all";
  const project = availableProjects.find(item => item.id === location.get("invoice-project"))?.id ?? "";
  const currentMonth = view?.today.slice(0, 7) ?? "";
  const requestedMonth = location.get("invoice-month");
  const invoiceMonth = requestedMonth === "all" ? "all" : requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth
    : months.includes(currentMonth) ? currentMonth : months[0] ?? currentMonth;
  const all = invoices ?? [];
  const dated = all.filter(row => invoiceMonth === "all" || row.txnDate.startsWith(invoiceMonth));
  const matches = dated.filter(row => (!project || row.projects.some(link => link.id === project)) &&
    (status === "all" || invoiceState(row, view!.today)[status]));
  const requestedPage = Number(location.get("invoice-page"));
  const pages = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, pages) : 1;
  const outstanding = all.filter(row => row.balance > 0);
  const overdue = outstanding.filter(row => invoiceState(row, view!.today).overdue);
  const paidIssued = all.filter(row => row.txnDate.startsWith(currentMonth) && row.balance <= 0);
  const dueMonth = outstanding.filter(row => row.dueDate?.startsWith(currentMonth) && row.dueDate >= view!.today);
  const urgent = outstanding.filter(row => invoiceState(row, view!.today).dueSoon);
  const monthOptions = [...new Set([invoiceMonth, ...months].filter(value => value && value !== "all"))].sort().reverse();

  async function manage(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setNotice("");
    setFailure("");
    try {
      const result = await client.call<{ count?: number }>(tenant, "invoices/" + action, { method: "POST", body });
      setNotice(action === "sync" ? result.count + " invoices synced from QuickBooks Online." : action === "disconnect" ?
        "QuickBooks Online disconnected. The invoice mirror has been removed." : body.approved ? "Invoice approved for eligible client members." : "Client invoice approval withdrawn.");
      reload();
    } catch (problem) {
      reload();
      setFailure(problem instanceof ApiError && problem.status === 409 ? "The invoice or connection changed. Review the refreshed information and try again."
        : problem instanceof ApiError && problem.status === 400 ? "Check that each linked project is published before approving this invoice."
        : "This action could not be completed. Check the QuickBooks Online connection and retry.");
    } finally { setBusy(false); }
  }
  const summary = [
    { label: "Outstanding balance", rows: outstanding, field: "balance", hint: outstanding.length + " outstanding", icon: CircleDollarSign },
    { label: "Overdue balance", rows: overdue, field: "balance", hint: overdue.length + " overdue", icon: CalendarClock },
    { label: "Due this month", rows: dueMonth, field: "balance", hint: reportMonth(currentMonth || "2000-01"), icon: ArrowDownRight },
    { label: "Paid · issued this month", rows: paidIssued, field: "total", hint: paidIssued.length + " fully paid", icon: CircleCheck },
  ] as const;
  return <section className="mi-invoices" aria-label="Invoices" aria-busy={busy}>
    <header className="mi-invoice-hero">
      <div><div className="mi-kicker"><ReceiptText size={15} aria-hidden="true" /> Billing</div>
        <h2 id={staff ? "staff-page-title" : undefined} tabIndex={-1}>Invoices</h2><p>{staff ? "Review balances and control which invoices are visible to the client." : "See approved invoices, upcoming due dates, and what remains to be paid."}</p></div>
      {view?.syncedAt && <p className="mi-invoice-freshness">Last synced <time dateTime={view.syncedAt}>{shortDate(view.syncedAt.slice(0, 10))}</time></p>}
    </header>
    {(notice || busy) && <p role="status" className="mi-invoice-feedback">{busy ? "Working with QuickBooks Online…" : notice}</p>}
    {(error || failure) && <p role="alert" className="mi-invoice-feedback">{failure || error} {error && <button type="button" onClick={reload}>Retry</button>}</p>}
    {!view && !error && <p role="status" className="mi-invoice-empty">Loading invoices…</p>}
    {view?.canManage && view.configured && <div className="mi-invoice-operator">
      <span><strong>QuickBooks Online</strong> · {view.connected ? "Connected" : "Disconnected"}</span>
      <div>{view.connected ? <>
        <button type="button" disabled={busy} onClick={() => void manage("sync")}>Sync invoices</button>
        <button type="button" className="secure-secondary" disabled={busy} onClick={() => void connect()}>Reconnect</button>
        <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
          if (window.confirm("Disconnect QuickBooks Online and remove this invoice mirror from both workspaces?")) void manage("disconnect");
        }}>Disconnect</button>
      </> : <button type="button" disabled={busy} onClick={() => void connect()}>Connect QuickBooks Online</button>}</div>
    </div>}
    {view && !all.length && <div className="mi-invoice-empty"><ReceiptText size={28} aria-hidden="true" /><h3>{staff ? "No invoices synced" : "No approved invoices yet"}</h3>
      <p>{staff ? view.configured ? "An administrator can connect the approved company and sync its invoices." : "Invoice visibility has not been configured for this workspace." :
        "Invoices will appear here once Morris Interactive has approved them for your workspace."}</p></div>}
    {all.length > 0 && <>
      <div className="mi-invoice-summary" aria-label="Invoice balances across all approved dates">
        {summary.map(({ label, rows, field, hint, icon: Icon }) => <article key={label}><Icon size={19} aria-hidden="true" />
          <h3>{label}</h3><strong>{totals(rows, field).join(" · ") || "—"}</strong><small>{hint}</small></article>)}
      </div>
      {(urgent.length > 0 || overdue.length > 0) && <aside className="mi-invoice-attention" aria-label="Payment attention">
        <CalendarClock size={20} aria-hidden="true" />
        <strong>Payment attention</strong>
        {overdue.length > 0 && <button type="button" className="secure-secondary" onClick={() => portalNavigate({ "invoice-status": "overdue", "invoice-month": "all", "invoice-project": null, "invoice-page": null })}>{overdue.length} overdue</button>}
        {urgent.length > 0 && <button type="button" className="secure-secondary" onClick={() => portalNavigate({ "invoice-status": "dueSoon", "invoice-month": "all", "invoice-project": null, "invoice-page": null })}>{urgent.length} due within 7 days</button>}
      </aside>}
      <section className="mi-invoice-register" aria-labelledby="invoice-register-heading">
        <div className="mi-invoice-register-head"><div><h3 id="invoice-register-heading">Invoice register</h3>
          <p>{matches.length} matching {matches.length === 1 ? "invoice" : "invoices"} · {all.length} total</p></div>
          <div className="mi-invoice-filters">
            <label>Payment status<select value={status} onChange={e => portalNavigate({ "invoice-status": e.target.value === "all" ? null : e.target.value, "invoice-page": null })}>
              <option value="all">All statuses</option>{Object.entries(invoiceStatuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label>Invoice month<select value={invoiceMonth} onChange={e => portalNavigate({ "invoice-month": e.target.value, "invoice-page": null })}>
              <option value="all">All months</option>{monthOptions.map(value => <option value={value} key={value}>{reportMonth(value)}</option>)}</select></label>
            <label>Project<select value={project} onChange={e => portalNavigate({ "invoice-project": e.target.value || null, "invoice-page": null })}>
              <option value="">All projects</option>{availableProjects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          </div>
        </div>
        {matches.length === 0 && <p className="mi-invoice-empty">No invoices match these filters.</p>}
        {matches.slice((page - 1) * pageSize, page * pageSize).map(invoice => {
          const state = invoiceState(invoice, view!.today);
          const attention = state.overdue ? "Overdue" : state.dueToday ? "Due today" : state.dueSoon ? "Due soon" : undefined;
          const cents = Math.max(0, invoice.balance);
          const percent = invoice.total > 0 ? Math.round(Math.min(1, Math.max(0, 1 - cents / invoice.total)) * 100) : undefined;
          return <article className="mi-invoice-row" key={invoice.id} aria-label={invoice.number ? "Invoice " + invoice.number : "Invoice without a number"}>
            <div className="mi-invoice-identity"><ReceiptText aria-hidden="true" size={20} /><div><h4>{invoice.number ? "Invoice " + invoice.number : "Invoice number unavailable"}</h4>
              <p>{invoice.projects.map(item => item.name).join(" · ") || "No linked project"}</p>
              {staff && invoice.customer && <small>{invoice.customer}</small>}</div></div>
            <dl className="mi-invoice-details"><div><dt>Issued</dt><dd>{shortDate(invoice.txnDate)}</dd></div>
              <div><dt>Due</dt><dd>{shortDate(invoice.dueDate)}</dd></div><div><dt>Total</dt><dd>{money(invoice.total, invoice.currency)}</dd></div></dl>
            <div className="mi-invoice-balance"><small>Balance remaining</small><strong>{money(cents, invoice.currency)}</strong>
              {percent !== undefined && <progress max={100} value={percent} aria-label={percent + "% of invoice value no longer outstanding"} />}
              <div className="mi-invoice-chips"><span data-tone={state.paid ? "paid" : "neutral"}>{state.paid ? "Paid" : state.partiallyPaid ? "Partially paid" : invoice.dueDate ? "Unpaid" : "Outstanding"}</span>
              {attention && <span data-tone={state.overdue || state.dueToday ? "urgent" : "soon"}>{attention}</span>}</div>
            </div>
            {staff && invoice.approval && <div className="mi-invoice-approval">
              <small>{invoice.approval.approved ? "Approved for client" : "Staff only"}</small>
              {invoice.note && <details><summary>Private memo</summary><p>{invoice.note}</p></details>}
              {view?.canManage && <button type="button" className="secure-secondary" disabled={busy} onClick={() => {
                if (!invoice.approval!.approved && !window.confirm("Approve this invoice for eligible client members?" +
                  (invoice.projects.length ? " Members need access to every linked project." : " This invoice has no project links. Every approved client member can see it."))) return;
                void manage("approval", { id: invoice.id, revision: invoice.approval!.revision, approved: !invoice.approval!.approved });
              }}>{invoice.approval.approved ? "Withdraw approval" : "Approve for client"}</button>}
            </div>}
          </article>;
        })}
        {pages > 1 && <nav className="mi-invoice-pagination" aria-label="Invoice pages">
          <button className="secure-secondary" disabled={page === 1} onClick={() => portalNavigate({ "invoice-page": String(page - 1) })}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="secure-secondary" disabled={page === pages} onClick={() => portalNavigate({ "invoice-page": String(page + 1) })}>Next</button>
        </nav>}
      </section>
    </>}
  </section>;
}
