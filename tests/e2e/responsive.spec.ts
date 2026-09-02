import { expect, test } from "@playwright/test";

test("@responsive lobby fits and remains usable in the configured viewport", async ({ page }) => {
  await page.goto("/");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

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
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(panelBox!.y + Math.min(panelBox!.height, viewport!.height)).toBeLessThanOrEqual(viewport!.height + 1);

  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);

  await page.getByTestId("hero-bruno").click();
  await expect(page.getByTestId("hero-bruno")).toHaveClass(/is-selected/);
});
