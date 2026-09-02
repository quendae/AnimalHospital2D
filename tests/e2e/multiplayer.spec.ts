import { expect, test } from "@playwright/test";

test("host and guest create a room, connect and start the same shift", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("/");
  await host.getByTestId("player-name").fill("Maja");
  await host.getByTestId("create-room").click();
  const roomCode = (await host.getByTestId("room-code").textContent())?.trim();
  expect(roomCode).toMatch(/^[A-Z2-9]{5}$/);

  await guest.goto("/");
  await guest.getByTestId("player-name").fill("Olek");
  await guest.getByTestId("room-code-input").fill(roomCode!);
  await guest.getByTestId("join-room").click();

  await expect(host.getByTestId("member-list").locator("li")).toHaveCount(2);
  await expect(guest.getByTestId("member-list").locator("li")).toHaveCount(2);
  await expect(host.getByTestId("start-multiplayer")).toBeVisible();

  await host.getByTestId("start-multiplayer").click();

  await expect(host.locator("#game canvas")).toBeVisible();
  await expect(guest.locator("#game canvas")).toBeVisible();
  await expect(host.getByTestId("network-status")).toContainText(roomCode!);
  await expect(guest.getByTestId("network-status")).toContainText(roomCode!);

  await expect.poll(async () => host.evaluate(() => (window as any).__animalCareDebug?.getState()?.shiftStarted)).toBe(true);
  await expect.poll(async () => guest.evaluate(() => (window as any).__animalCareDebug?.getState()?.shiftStarted)).toBe(true);
  await expect.poll(async () => host.evaluate(() => (window as any).__animalCareDebug?.getState()?.remotePlayers)).toBeGreaterThanOrEqual(1);
  await expect.poll(async () => guest.evaluate(() => (window as any).__animalCareDebug?.getState()?.remotePlayers)).toBeGreaterThanOrEqual(1);

  await guest.keyboard.down("ArrowRight");
  await guest.waitForTimeout(450);
  await guest.keyboard.up("ArrowRight");

  const hostTransport = await host.getByTestId("network-status").getAttribute("data-transport");
  const guestTransport = await guest.getByTestId("network-status").getAttribute("data-transport");
  expect(["p2p", "relay", "connecting"]).toContain(hostTransport);
  expect(["p2p", "relay", "connecting"]).toContain(guestTransport);

  await hostContext.close();
  await guestContext.close();
});

test("guest websocket signaling reconnects without destroying the running game", async ({ browser }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  await host.goto("/");
  await host.getByTestId("create-room").click();
  const code = (await host.getByTestId("room-code").textContent())!.trim();
  await guest.goto("/");
  await guest.getByTestId("room-code-input").fill(code);
  await guest.getByTestId("join-room").click();
  await expect(host.getByTestId("member-list").locator("li")).toHaveCount(2);
  await host.getByTestId("start-multiplayer").click();
  await expect(guest.locator("#game canvas")).toBeVisible();

  await guestContext.setOffline(true);
  await guest.waitForTimeout(700);
  await guestContext.setOffline(false);

  await expect.poll(async () => guest.evaluate(() => (window as any).__animalCareDebug?.getState()?.shiftStarted), { timeout: 12_000 }).toBe(true);
  await expect(guest.getByTestId("network-status")).not.toHaveText(/OFFLINE/, { timeout: 12_000 });

  await hostContext.close();
  await guestContext.close();
});
