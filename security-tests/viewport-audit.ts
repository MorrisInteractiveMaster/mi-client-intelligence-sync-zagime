import assert from "node:assert/strict";
import type { Page } from "playwright";

export async function auditViewport(page: Page, route: string, width: number, height: number, { compactSidebar = false, workspaceBanner = false } = {}) {
  await page.setViewportSize({ width, height });
  const result = await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const openDialog = document.querySelector("dialog[open]");
    const sidebars = [...document.querySelectorAll(".mi-workspace-sidebar, .platform-control-nav")]
      .filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility === "visible");
    const masthead = document.querySelector(".secure-masthead")?.getBoundingClientRect();
    const sidebar = sidebars[0]?.getBoundingClientRect();
    const banners = [...document.querySelectorAll<HTMLElement>("#platform-content .mi-workspace-banner")]
      .filter(element => element.getClientRects().length > 0);
    const banner = banners[0];
    const bounds = banner?.getBoundingClientRect();
    const contentRight = document.documentElement.clientWidth;
    const header = bounds && banner ? {
      count: banners.length,
      top: Math.round(bounds.top),
      rightGap: Math.round(contentRight - bounds.right),
      sidebarLeft: sidebar ? Math.round(sidebar.left) : null,
      sidebarAlignment: sidebar ? Math.abs(sidebar.top - bounds.top) : null,
      title: banner.querySelector("h1")?.textContent?.trim(),
      titleCount: document.querySelectorAll("#platform-content h1:not(.mi-print-only h1)").length,
      padding: parseFloat(getComputedStyle(banner).paddingInlineStart),
      utilities: Boolean(banner.querySelector('[aria-label="Appearance"]') && banner.querySelector('[aria-label="Account"]')),
      externalUtilities: [...document.querySelectorAll('[aria-label="Appearance"], summary[aria-label="Account"]')]
        .filter(control => control.getClientRects().length > 0 && !banner.contains(control)).length,
      periods: banner.querySelectorAll('[aria-label="Reporting period"]').length,
    } : undefined;
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
    return { pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, outside, sidebars: sidebars.length, header,
      sidebarGap: sidebar ? Math.round(sidebar.top - (masthead?.bottom ?? 0)) : null };
  });
  const label = `${route} at ${width}×${height}`;
  assert.equal(result.viewportWidth, width, `${label} uses the requested viewport width`);
  assert.ok(result.pageWidth <= result.viewportWidth + 1, `${label} page overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.outside, [], `${label} clipped controls`);
  if (workspaceBanner) {
    const header = result.header;
    assert.ok(header, `${label} has a shared workspace banner`);
    assert.equal(header.count, 1, `${label} has exactly one workspace banner`);
    assert.ok(header.title && header.titleCount === 1, `${label} has one page title`);
    assert.equal(header.utilities, true, `${label} keeps appearance and account in the banner`);
    assert.equal(header.externalUtilities, 0, `${label} has no separate utility row`);
    assert.ok(header.padding >= 16 && header.rightGap <= 25 && header.rightGap >= 0, `${label} banner geometry: ${JSON.stringify(header)}`);
    if (width > 860 && header.sidebarLeft !== null) {
      assert.ok(header.sidebarLeft >= 16 && header.sidebarLeft <= 25, `${label} sidebar left gutter`);
      assert.ok((header.sidebarAlignment ?? 0) <= 2, `${label} sidebar and banner start together`);
    }
    if (route.includes("/projects/new")) assert.equal(header.periods, 0, `${label} wizard has no reporting period`);
  }
  if (compactSidebar && width >= 1024) {
    assert.equal(result.sidebars, 1, `${label} has one desktop sidebar`);
    assert.ok(result.sidebarGap !== null && result.sidebarGap >= -2 && result.sidebarGap <= 90, `${label} sidebar is offset ${result.sidebarGap}px from the top of the workspace`);
  }
  return { route, width, height, ...result };
}
