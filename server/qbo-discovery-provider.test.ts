import assert from "node:assert/strict";
import test from "node:test";
import { customerHierarchy, customerQueryTerm, QboDiscoveryProvider } from "./qbo-discovery-provider";
import { qboConfig, QboInvoicesProvider } from "./qbo-invoices-provider";

const env = {
  QBO_INVOICES_ENABLED: "true", QBO_INVOICES_TENANT: "fixture", ALLOWED_ORIGIN: "https://portal.example.test",
  QBO_INVOICES_CLIENT_ID: "synthetic", QBO_INVOICES_CLIENT_SECRET: "synthetic",
  QBO_INVOICES_TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"),
};
const cfg = qboConfig(env, "production")!;
const root = { id: "1", name: "Zagimē Nation", active: true };
const moved = { id: "3", name: "WO300", parentId: "90", active: true };
const historical = { id: "2", name: "WO200.1", parentId: "1", active: false };

test("discovery configuration needs neither a realm nor customer IDs and refuses an unrestricted invoice request", async () => {
  assert.deepEqual([cfg.realm, cfg.customerIds, cfg.currency], ["", [], ""]);
  const client = new QboInvoicesProvider(cfg, async () => { throw Error("Unexpected provider call"); });
  await assert.rejects(client.invoices("token"), /scope unavailable/);
  assert.throws(() => qboConfig({ ...env, QBO_INVOICES_CUSTOMER_IDS: "1" }, "production"));
});
test("customer queries preserve accents and escape punctuation without expanding the search", async () => {
  assert.equal(customerQueryTerm("Zagimē O'Brien 50%"), "Zagimē O\\'Brien 50");
  const who = "Zagimē O'Brien";
  const provider = new QboDiscoveryProvider(cfg, async input => {
    const url = new URL(String(input));
    assert.match(url.searchParams.get("query")!, /Active in \(true,false\).*startposition 21/);
    assert.ok(url.searchParams.get("query")!.includes("Zagimē O\\'Brien"));
    return Response.json({ QueryResponse: { Customer: [
      { Id: "1", DisplayName: who, Active: true, Notes: "private", Balance: 12345 },
      { Id: "2", DisplayName: who + " Foundation" },
      { Id: "3", DisplayName: who + " Project", Job: true, ParentRef: { value: "2" } },
      { Id: "4", DisplayName: "Other" },
    ] } });
  });
  const result = await provider.search("token", "123", who, 2);
  assert.deepEqual(result.matches, [{ id: "1", name: who, active: true }, { id: "2", name: who + " Foundation", active: true }]);
});
test("hierarchy traverses by stable IDs and excludes reparented branches", () => {
  assert.deepEqual(customerHierarchy([root, moved, historical, { ...moved, id: "5", parentId: "2" }], "1").map(r => r.id), ["1", "2", "5"]);
  assert.throws(() => customerHierarchy([{ ...root, parentId: "9" }], "1"), /root customer changed/);
  assert.throws(() => customerHierarchy([root, root], "1"), /paging/);
});
test("partial customer or native-project pagination rejects the entire inventory", async () => {
  let page = 0;
  const customers = new QboDiscoveryProvider(cfg, async () => ++page === 1 ? Response.json({ QueryResponse: {
    Customer: Array.from({ length: 100 }, (_, i) => ({ Id: String(i + 1), DisplayName: "Record " + i })) } }) :
    new Response(null, { status: 500 }));
  await assert.rejects(customers.customers("token", "123", "1", AbortSignal.timeout(5000)), /unavailable/);
  page = 0;
  const native = new QboDiscoveryProvider({ ...cfg, nativeProjects: true }, async () => {
    if (++page === 2) return Response.json({ data: {}, errors: [{ message: "scope not available" }] });
    return Response.json({ data: { projectManagementProjects: { edges: [{ node: { id: "18", name: "Project", account: { id: "123" },
      customer: { id: "1" } } }], pageInfo: { hasNextPage: true, endCursor: "page2" } } } });
  });
  await assert.rejects(native.projects("token", "123", new Set(["1"]), AbortSignal.timeout(5000)), /page invalid/);
});
