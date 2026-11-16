const { chromium } = require(process.argv[2] || "playwright");
const fs = require("fs");
const assert = require("node:assert/strict");
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5173");
  await page.getByLabel("Prototype role").selectOption("admin");
  await page.getByRole("link", { name: "New project", exact: true }).click();
  const create = page
    .locator("form")
    .filter({
      has: page.getByRole("heading", { name: "New project", exact: true }),
    });
  await create
    .getByLabel("Project name", { exact: true })
    .fill("PM journey synthetic project");
  await create.locator("select[name=department]").selectOption("health");
  await create.getByRole("button", { name: "Create project" }).click();
  await page.locator('input[value="PM journey synthetic project"]').waitFor();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Project registry", exact: true })
    .click();
  assert.equal(
    (await page.locator("input").filter({ visible: true }).count()) > 0,
    true,
  );
  await page.locator('input[value="PM journey synthetic project"]').waitFor();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Time allocation", exact: true })
    .click();
  const form = page
    .locator("form")
    .filter({
      has: page.getByRole("button", { name: "Save allocation", exact: true }),
    });
  await form.getByLabel("Health / PM journey synthetic project").fill("5");
  await form.getByLabel("Health / Community workshop").fill("2");
  await form.getByRole("button", { name: "Save allocation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Control centre", exact: true })
    .click();
  assert.equal(
    await page.locator(".nordic-kpis strong").first().textContent(),
    "7",
  );
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mi-reporting-v2")),
  );
  assert.equal(saved.raw[0].seconds, 28800);
  assert.equal(
    saved.allocations.at(-1).portions.reduce((n, p) => n + p.seconds, 0),
    25200,
  );
  await page.getByLabel("Reporting month").fill("2026-09");
  assert.equal(
    await page.locator(".nordic-kpis strong").first().textContent(),
    "0",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Project registry", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Reporting month").inputValue(),
    "2026-09",
  );
  await page.getByLabel("Reporting month").fill("2026-10");
  await page.screenshot({
    path: "docs/qa-m2-corrections/pm-journey.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mi-reporting-v2"));
    s.projects.find(
      (p) => p.name === "PM journey synthetic project",
    ).published = false;
    s.projects.find((p) => p.name === "PM journey synthetic project").name =
      "PRIVATE PROJECT";
    s.projects[0].internalNotes = "PRIVATE NOTES";
    s.raw[0].seconds = 3600;
    s.raw[0].revision = "1";
    localStorage.setItem("mi-reporting-v2", JSON.stringify(s));
  });
  await page.reload();
  await page.getByRole("heading", { name: "Partnership dashboard" }).waitFor();
  const client = await page.locator(".nordic").innerText();
  for (const forbidden of [
    "PRIVATE PROJECT",
    "PRIVATE NOTES",
    "external-demo",
    "raw-demo",
    "Source corrections require",
    "Unallocated source hours",
    "Attach illustrative",
  ])
    assert.ok(!client.includes(forbidden), forbidden);
  for (const width of [1440, 1366, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `docs/qa-m2-corrections/client-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("Prototype role").selectOption("admin");
  await page
    .getByRole("alert")
    .filter({ hasText: "Source corrections require" })
    .waitFor();
  await page.getByRole("button", { name: "At a glance · Dots recap" }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("dialog").evaluate((d) => d.open), false);
  await page.goto("http://127.0.0.1:5173/#/legacy/projects");
  await page
    .getByRole("note")
    .filter({ hasText: "Legacy demonstration view" })
    .waitFor();
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "docs/qa-m2-corrections/results.json",
    JSON.stringify(
      {
        pmJourney: true,
        sharedRouteState: true,
        monthFilter: true,
        monthSurvivesNavigation: true,
        rawUnchanged: true,
        partialRemainder: true,
        clientFiltering: true,
        internalConflictVisible: true,
        legacyLabel: true,
        dotsControls: true,
        widths: [1440, 1366, 768, 390],
        errors,
      },
      null,
      2,
    ),
  );
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
