import { expect, test, type Browser, type Page } from "@playwright/test";

async function createPlayer(browser: Browser, name: string, hero: "lena" | "maks" | "iga" | "bruno"): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:5173/");
  await page.getByTestId(`hero-${hero}`).click();
  await page.getByTestId("player-name").fill(name);
  return { page, close: () => context.close() };
}

async function createRoomAndGetCode(page: Page): Promise<string> {
  await page.getByTestId("host-room").click();
  await expect(page.getByTestId("room-panel")).toBeVisible();
  await expect.poll(async () => (await page.getByTestId("room-code").textContent())?.trim() ?? "").not.toBe("—");
  const roomCode = (await page.getByTestId("room-code").textContent())?.trim() ?? "";
  expect(roomCode.length).toBeGreaterThan(2);
  return roomCode;
}

test.describe.serial("P2P co-op", () => {
  test("host and guest form a P2P room, start together and sync guest movement", async ({ browser }) => {
    const host = await createPlayer(browser, "Host Lena", "lena");
    const guest = await createPlayer(browser, "Guest Maks", "maks");

    try {
      const roomCode = await createRoomAndGetCode(host.page);
      await guest.page.getByTestId("room-input").fill(roomCode);
      await guest.page.getByTestId("join-room").click();

      await expect(host.page.locator("[data-testid=player-list] .lobby-player")).toHaveCount(2);
      await expect(guest.page.locator("[data-testid=player-list] .lobby-player")).toHaveCount(2);
      await expect(host.page.getByTestId("network-pill")).toHaveText("P2P READY", { timeout: 12_000 });
      await expect(guest.page.getByTestId("network-pill")).toHaveText("P2P READY", { timeout: 12_000 });

      await expect(host.page.getByTestId("start-shift")).toBeVisible();
      await host.page.getByTestId("start-shift").click();

      await expect(host.page.getByTestId("lobby-overlay")).toBeHidden();
      await expect(guest.page.getByTestId("lobby-overlay")).toBeHidden();
      await expect(host.page.locator("#game canvas")).toBeVisible();
      await expect(guest.page.locator("#game canvas")).toBeVisible();

      await expect.poll(async () => host.page.evaluate(() => (window as any).__animalCareNetwork?.connectedPeers)).toBe(1);
      await expect.poll(async () => guest.page.evaluate(() => (window as any).__animalCareNetwork?.connectedPeers)).toBe(1);

      const before = await host.page.evaluate(() => {
        const scene = (window as any).__animalCareGame.scene.getScene("ClinicSceneV2");
        const actor = [...scene.__p2pBridgeRuntime.actors.values()][0] as any;
        const body = actor.sprite.body as any;
        // Procedural layouts can spawn next to a wall or counter. Put the
        // network actor on the already-valid local-player position and disable
        // collision checks only for this transport/physics assertion.
        actor.sprite.setPosition(scene.player.x, scene.player.y);
        body.reset(scene.player.x, scene.player.y);
        body.checkCollision.none = true;
        body.setCollideWorldBounds(false);
        return { x: actor.sprite.x as number, y: actor.sprite.y as number, seq: actor.input.seq as number };
      });

      await guest.page.keyboard.down("d");
      await expect.poll(async () => host.page.evaluate(() => {
        const scene = (window as any).__animalCareGame.scene.getScene("ClinicSceneV2");
        const actor = [...scene.__p2pBridgeRuntime.actors.values()][0] as any;
        return { seq: actor.input.seq as number, x: actor.input.x as number };
      }), { timeout: 5_000 }).toEqual(expect.objectContaining({ x: expect.any(Number) }));
      await expect.poll(async () => host.page.evaluate(() => {
        const scene = (window as any).__animalCareGame.scene.getScene("ClinicSceneV2");
        const actor = [...scene.__p2pBridgeRuntime.actors.values()][0] as any;
        return actor.input.seq as number;
      }), { timeout: 5_000 }).toBeGreaterThan(before.seq);
      await expect.poll(async () => host.page.evaluate(() => {
        const scene = (window as any).__animalCareGame.scene.getScene("ClinicSceneV2");
        const actor = [...scene.__p2pBridgeRuntime.actors.values()][0] as any;
        return actor.input.x as number;
      }), { timeout: 5_000 }).toBeGreaterThan(0.5);

      await guest.page.waitForTimeout(450);
      await guest.page.keyboard.up("d");

      await expect.poll(async () => host.page.evaluate(({ x, y }) => {
        const scene = (window as any).__animalCareGame.scene.getScene("ClinicSceneV2");
        const actor = [...scene.__p2pBridgeRuntime.actors.values()][0] as any;
        return Math.hypot(actor.sprite.x - x, actor.sprite.y - y);
      }, before), { timeout: 5_000 }).toBeGreaterThan(12);

      const seeds = await Promise.all([host.page, guest.page].map((page) => page.evaluate(() => (window as any).__animalCareLaunch?.seed)));
      expect(seeds[0]).toBe(seeds[1]);
    } finally {
      await guest.close();
      await host.close();
    }
  });

  test("host migration is announced when the host leaves the lobby", async ({ browser }) => {
    const host = await createPlayer(browser, "Migrating Host", "iga");
    const guest = await createPlayer(browser, "Next Host", "bruno");

    try {
      const roomCode = await createRoomAndGetCode(host.page);
      await guest.page.getByTestId("room-input").fill(roomCode);
      await guest.page.getByTestId("join-room").click();
      await expect(guest.page.locator("[data-testid=player-list] .lobby-player")).toHaveCount(2);

      const guestSessionId = await guest.page.evaluate(() => (window as any).__animalCareNetwork?.sessionId);
      await host.close();

      await expect.poll(async () => guest.page.evaluate(() => (window as any).__animalCareNetwork?.hostSessionId), { timeout: 25_000 }).toBe(guestSessionId);
      await expect(guest.page.getByTestId("start-shift")).toBeVisible();
    } finally {
      await guest.close();
    }
  });
});
