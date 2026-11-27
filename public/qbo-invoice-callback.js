(() => {
  const url = new URL(window.location.href);
  const query = url.searchParams;
  const state = query.get("state");
  history.replaceState(null, "", url.pathname);
  if (!/^[a-zA-Z0-9_-]{43}$/.test(state ?? "") || query.getAll("state").length !== 1 ||
      typeof BroadcastChannel !== "function") return;
  const channel = new BroadcastChannel("mi-qbo-invoice-" + state);
  const failed = query.has("error") || ["code", "realmId"].some(field => query.getAll(field).length !== 1);
  channel.postMessage({ state, failed, code: query.get("code"), realm: query.get("realmId") });
  channel.close();
  window.close();
})();
