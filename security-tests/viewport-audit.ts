import assert from "node:assert/strict";
import type { Page } from "playwright";

export async function auditViewport(page: Page, route: string, width: number, height: number, { compactSidebar = false } = {}) {
  await page.setViewportSize({ width, height });
  const result = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const openDialog = document.querySelector("dialog[open]");
    const sidebars = [...document.querySelectorAll(".mi-workspace-sidebar, .platform-control-nav")]
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible");
    const masthead = document.querySelector(".secure-masthead")?.getBoundingClientRect();
    const sidebar = sidebars[0]?.getBoundingClientRect();
    const outside = [...(openDialog ?? document).querySelectorAll("a[href], button, summary, input, select, textarea")]
      .filter(element => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || getComputedStyle(element).visibility !== "visible" || element.closest('[aria-hidden="true"]')) return false;
        if (rect.left >= -1 && rect.right <= innerWidth + 1) return false;
        for (let container = element.parentElement; container && container !== document.body; container = container.parentElement) {
          if (["scroll", "auto"].includes(getComputedStyle(container).overflowX) && container.scrollWidth > container.clientWidth) return false;
        }
        return true;
      }).slice(0, 8).map(element => ({ element: element.tagName, text: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 70) }));
    return { pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, outside, sidebars: sidebars.length,
      sidebarGap: sidebar ? Math.round(sidebar.top - (masthead?.bottom ?? 0)) : null };
  });
  const label = `${route} at ${width}×${height}`;
  assert.equal(result.viewportWidth, width, `${label} uses the requested viewport width`);
  assert.ok(result.pageWidth <= result.viewportWidth + 1, `${label} page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.outside, [], `${label} clipped controls`);
  if (compactSidebar && width >= 1024) {
    assert.equal(result.sidebars, 1, `${label} has one desktop sidebar`);
    assert.ok(result.sidebarGap !== null && result.sidebarGap >= -2 && result.sidebarGap <= 90, `${label} sidebar is offset ${result.sidebarGap}px from the top of the workspace`);
  }
  return { route, width, height, ...result };
}
