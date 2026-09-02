import { expect, test } from "@playwright/test";

const responsiveCases = [
  { width: 390, height: 844, label: "phone portrait" },
  { width: 844, height: 390, label: "phone landscape" },
  { width: 820, height: 1180, label: "tablet portrait" },
  { width: 1180, height: 820, label: "tablet landscape" },
];

for (const viewport of responsiveCases) {
  test(`@responsive lobby stays readable on ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");

    const overlay = page.getByTestId("lobby-overlay");
    const panel = page.locator(".lobby-panel");
    await expect(overlay).toBeVisible();
    await expect(page.getByTestId("hero-lena")).toBeVisible();
    await expect(page.getByTestId("hero-bruno")).toBeVisible();
    await expect(page.getByTestId("host-room")).toBeVisible();
    await expect(page.getByTestId("join-room")).toBeVisible();
    await expect(page.getByTestId("local-game")).toBeVisible();

    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(-1);
    expect(panelBox!.y).toBeGreaterThanOrEqual(-1);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(panelBox!.y + Math.min(panelBox!.height, viewport.height)).toBeLessThanOrEqual(viewport.height + 1);

    const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    await page.getByTestId("hero-bruno").click();
    await expect(page.getByTestId("hero-bruno")).toHaveClass(/is-selected/);
  });
}
