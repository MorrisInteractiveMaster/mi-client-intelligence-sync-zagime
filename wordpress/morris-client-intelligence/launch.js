(() => {
  function reset() {
    for (const link of document.querySelectorAll(".mici-portal__action[data-opening]")) {
      link.removeAttribute("data-opening");
      const status = link.nextElementSibling;
      if (status) status.textContent = "";
    }
  }
  document.addEventListener("click", event => {
    const link = event.target instanceof Element && event.target.closest(".mici-portal__action");
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    link.setAttribute("data-opening", "");
    const status = link.nextElementSibling;
    if (status) status.textContent = status.dataset.opening;
    window.setTimeout(reset, 4000);
  });
  window.addEventListener("pageshow", reset);
})();
