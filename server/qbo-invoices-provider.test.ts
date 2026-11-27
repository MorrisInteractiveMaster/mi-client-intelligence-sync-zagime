import assert from "node:assert/strict";
import test from "node:test";
import { invoiceState } from "../src/projects/invoices";
import { projectInvoice, qboConfig, QboInvoicesProvider } from "./qbo-invoices-provider";

const env = {
  QBO_INVOICES_ENABLED: "true", QBO_INVOICES_TENANT: "demo", QBO_INVOICES_REALM: "123",
  QBO_INVOICES_CUSTOMER_IDS: "400,401", QBO_INVOICES_CURRENCY: "CAD", QBO_INVOICES_SANDBOX: "true",
  QBO_INVOICES_CLIENT_ID: "synthetic", QBO_INVOICES_CLIENT_SECRET: "synthetic",
  QBO_INVOICES_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"), ALLOWED_ORIGIN: "https://example.test",
  QBO_INVOICES_PROJECT_MAP: JSON.stringify([
    { projectId: "parent", workOrder: "WO1267" },
    { projectId: "delivery", workOrder: "WO1267.1" },
    { projectId: "finance", qboProjectId: "351" },
  ]),
};
const config = qboConfig(env, "staging")!;
const row = { Id: "700", DocNumber: "INV-001", CustomerRef: { value: "400", name: "Fixture customer" },
  TxnDate: "2026-11-26", DueDate: "2026-12-04", TotalAmt: 120.18, Balance: 95.11,
  PrivateNote: "Private billing details", ProjectRef: { value: "351" },
  Line: [{ GroupLineDetail: { Line: [{ Description: "Delivery (WO1267.1). A second reference is WO12670." }] } }],
};

test("invoice configuration is explicit, scope-bound and safe to disable", () => {
  assert.equal(qboConfig({}, "production"), undefined);
  assert.throws(() => qboConfig(env, "production"));
  assert.throws(() => qboConfig({ ...env, QBO_INVOICES_CUSTOMER_IDS: "400,400' or 1=1" }, "staging"));
  assert.throws(() => qboConfig({ ...env, QBO_INVOICES_PROJECT_MAP: JSON.stringify([
    { projectId: "a", workOrder: "WO1" }, { projectId: "b", workOrder: "wo1" },
  ]) }, "staging"));
});
test("normalizes invoices without alias collisions, converting money to currency-specific minor units", () => {
  const projected = projectInvoice(row, config)!;
  assert.deepEqual(projected.projectIds, ["delivery", "finance"]);
  assert.equal(projected.total, 12018);
  assert.equal(projected.balance, 9511);
  assert.equal(projected.currency, "CAD");
  assert.equal(projectInvoice({ ...row, CurrencyRef: { value: "JPY" }, TotalAmt: 250, Balance: 100 }, config)?.balance, 100);
  assert.equal(projectInvoice({ ...row, PrivateNote: "Voided — old memo", TotalAmt: 0, Balance: 0 }, config), undefined);
  assert.throws(() => projectInvoice({ ...row, CustomerRef: { value: "999" } }, config), /scope mismatch/);
  assert.throws(() => projectInvoice({ ...row, TotalAmt: 120.182 }, config), /precision/);
  assert.throws(() => projectInvoice({ ...row, TxnDate: "2026-02-30" }, config));
});
test("payment and urgency use independent flags and exact calendar boundaries", () => {
  const date = "2026-11-27";
  const partial = { balance: 9511, total: 12018 };
  assert.equal(invoiceState({ ...partial, dueDate: "2026-11-26" }, date).overdue, true);
  assert.equal(invoiceState({ ...partial, dueDate: "2026-11-26" }, date).partiallyPaid, true);
  assert.equal(invoiceState({ ...partial, dueDate: date }, date).dueToday, true);
  assert.equal(invoiceState({ ...partial, dueDate: "2026-12-04" }, date).dueSoon, true);
  assert.equal(invoiceState({ ...partial, dueDate: "2026-12-05" }, date).dueSoon, false);
  assert.equal(invoiceState({ balance: 100, total: 100, dueDate: date }, date).unpaid, true);
  assert.equal(invoiceState({ balance: 100, total: 100 }, date).outstanding, true);
  assert.equal(invoiceState({ balance: 100, total: 100 }, date).dueSoon, false);
  assert.equal(invoiceState({ balance: -1, total: 100, dueDate: "2026-01-01" }, date).paid, true);
  assert.equal(invoiceState({ balance: 0, total: 100, dueDate: "2026-01-01" }, date).overdue, false);
});
test("queries Invoice only, pages exact verified customer IDs and rejects unrelated rows or entity payloads", async () => {
  const requests: string[] = [];
  const mock = new QboInvoicesProvider(config, async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "sandbox-quickbooks.api.intuit.com");
    assert.equal(url.pathname, "/v3/company/123/query");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic");
    const query = url.searchParams.get("query")!;
    requests.push(query);
    const page = query.includes("'400'") && query.includes("startposition 1 ") ?
      Array.from({ length: 100 }, (_, i) => ({ ...row, Id: String(i + 1) })) :
      query.includes("'400'") ? [{ ...row, Id: "101" }] : [{ ...row, Id: "102", CustomerRef: { value: "401" } }];
    return Response.json({ QueryResponse: { Invoice: page, startPosition: 1, maxResults: page.length } });
  });
  assert.equal((await mock.invoices("synthetic")).length, 102);
  assert.deepEqual(requests, [
    "select * from Invoice where CustomerRef = '400' startposition 1 maxresults 100",
    "select * from Invoice where CustomerRef = '400' startposition 101 maxresults 100",
    "select * from Invoice where CustomerRef = '401' startposition 1 maxresults 100",
  ]);
  await assert.rejects(new QboInvoicesProvider(config, async () => Response.json({ QueryResponse: { Payment: [] } })).invoices("x"), /response/);
  await assert.rejects(new QboInvoicesProvider(config, async () => Response.json({ QueryResponse: { Invoice: [
    { ...row, CustomerRef: { value: "401" } },
  ] } })).invoices("x"), /scope mismatch/);
  await assert.rejects(new QboInvoicesProvider(config, async () => Response.json({ QueryResponse: { Invoice: [row, row] } })).invoices("x"), /paging/);
});
