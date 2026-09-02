import { expect, test } from "@playwright/test";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "phone-portrait", width: 390, height: 844 },
  { name: "phone-landscape", width: 844, height: 390 },
];

for (const viewport of viewports) {
  test(`lobby stays usable on ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.getByTestId("multiplayer-lobby")).toBeVisible();
    await expect(page.getByTestId("create-room")).toBeVisible();
    await expect(page.getByTestId("join-room")).toBeVisible();

    const metrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport + 1);

    await context.close();
  });

  test(`game canvas fits ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    await page.goto("/?autostart=1&seed=12345");
    const canvas = page.locator("#game canvas");
    await expect(canvas).toBeVisible();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.y).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
    await context.close();
  });
}
