// Independent of the module bundle; no inline script or CSP exceptions needed.
(() => {
  function fail() {
    const status = document.getElementById("startup-status");
    if (!status || document.documentElement.dataset.applicationState === "ready") return;
    document.documentElement.dataset.applicationState = "failed";
    status.setAttribute("role", "alert");
    document.getElementById("startup-heading").textContent = "The dashboard could not be loaded";
    document.getElementById("startup-message").textContent = "Please reload the page. If the problem continues, contact Morris Interactive.";
  }
  window.addEventListener("error", fail, true);
  window.addEventListener("unhandledrejection", fail);
  const timer = setTimeout(fail, 15000);
  window.addEventListener("mi:application-ready", () => clearTimeout(timer), { once: true });
})();
