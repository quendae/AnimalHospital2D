import { expect, test } from "@playwright/test";

test("P2P lobby survives a temporary signaling drop", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await host.goto("http://127.0.0.1:5173/");
    await host.getByTestId("player-name").fill("Reconnect Host");
    await host.getByTestId("host-room").click();
    await expect(host.getByTestId("room-code")).not.toHaveText("—", { timeout: 12_000 });
    const roomCode = (await host.getByTestId("room-code").textContent())!.trim();
    expect(roomCode.length).toBeGreaterThan(1);

    await guest.goto("http://127.0.0.1:5173/");
    await guest.getByTestId("player-name").fill("Reconnect Guest");
    await guest.getByTestId("room-input").fill(roomCode);
    await guest.getByTestId("join-room").click();
    await expect(guest.getByTestId("network-pill")).toHaveText("P2P READY", { timeout: 12_000 });

    const originalSessionId = await guest.evaluate(() => (window as any).__animalCareNetwork?.sessionId);
    await guest.waitForTimeout(1_200);

    await guest.evaluate(() => {
      const session = (window as any).__animalCareSession;
      if (!session?.room) throw new Error("Missing active room");
      void session.room.leave(false);
    });

    await expect.poll(async () => guest.evaluate(() => (window as any).__animalCareNetwork?.connectionState), { timeout: 12_000 }).toBe("connected");
    await expect.poll(async () => guest.evaluate(() => (window as any).__animalCareNetwork?.sessionId)).toBe(originalSessionId);
    await expect(guest.locator("[data-testid=player-list] .lobby-player")).toHaveCount(2);
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});
