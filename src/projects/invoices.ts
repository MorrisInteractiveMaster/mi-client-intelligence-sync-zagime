export type InvoiceStatus = "paid" | "partiallyPaid" | "unpaid" | "dueSoon" | "overdue";
export const invoiceStatuses: Record<InvoiceStatus, string> = {
  paid: "Paid", partiallyPaid: "Partially paid", unpaid: "Unpaid", dueSoon: "Due soon", overdue: "Overdue",
};

export type Invoice = {
  id: string;
  number: string;
  txnDate: string;
  dueDate?: string;
  currency: string;
  total: number;
  balance: number;
  projects: { id: string; name: string }[];
  customer?: string;
  note?: string;
  approval?: { approved: boolean; revision: string; audience?: string[] };
};

export type InvoiceView = {
  invoices: Invoice[];
  today: string;
  configured?: boolean;
  connected?: boolean;
  canManage?: boolean;
  syncedAt?: string;
  freshness: InvoiceFreshness;
};

export type InvoiceFreshness = "unavailable" | "current" | "stale";

export function invoiceFreshness(now: number, syncedAt?: string, failedAt?: string): InvoiceFreshness {
  const success = Date.parse(syncedAt ?? "");
  if (!Number.isFinite(success)) return "unavailable";
  const failed = Date.parse(failedAt ?? "");
  return now - success >= 26 * 60 * 60 * 1000 || failed >= success ? "stale" : "current";
}

export function invoiceState(invoice: Pick<Invoice, "balance" | "total" | "dueDate">, today: string) {
  const days = invoice.dueDate
    ? Math.round((Date.parse(invoice.dueDate) - Date.parse(today)) / 86_400_000)
    : undefined;
  const outstanding = invoice.balance > 0;
  const paid = !outstanding;
  const partiallyPaid = outstanding && invoice.balance < invoice.total;
  const overdue = outstanding && days !== undefined && days < 0;
  const dueSoon = outstanding && days !== undefined && days >= 0 && days <= 7;
  const unpaid = outstanding && invoice.balance === invoice.total && days !== undefined && days >= 0;
  return { outstanding, paid, partiallyPaid, unpaid, overdue, dueSoon, dueToday: outstanding && days === 0 };
}

export function invoiceFraction(currency: string) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
