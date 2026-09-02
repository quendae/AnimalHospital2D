import { expect, test } from "@playwright/test";

test.describe("character lobby", () => {
  test("hero cards have clear selection feedback and local play launches", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("lobby-overlay")).toBeVisible();
    await expect(page.getByTestId("hero-lena")).toHaveClass(/is-selected/);

    await page.getByTestId("hero-iga").hover();
    await page.getByTestId("hero-iga").click();
    await expect(page.getByTestId("hero-iga")).toHaveClass(/is-selected/);
    await expect(page.getByTestId("hero-lena")).not.toHaveClass(/is-selected/);

    await page.getByTestId("player-name").fill("Iga Testowa");
    await page.getByTestId("local-game").click();

    await expect(page.getByTestId("lobby-overlay")).toBeHidden();
    await expect(page.locator("#game canvas")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (window as any).__animalCareLaunch?.hero)).toBe("iga");
    await expect.poll(async () => page.evaluate(() => Boolean((window as any).__animalCareGame?.scene?.getScene("ClinicSceneV2")))).toBe(true);
  });

  test("room code from URL is prefilled", async ({ page }) => {
    await page.goto("/?room=sample-room-123");
    await expect(page.getByTestId("room-input")).toHaveValue("sample-room-123");
  });
});
