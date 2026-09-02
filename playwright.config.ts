import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"], browserName: "chromium", viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone-portrait",
      use: { ...devices["Pixel 7"], browserName: "chromium" },
      grep: /@responsive/,
    },
    {
      name: "phone-landscape",
      use: { ...devices["Pixel 7"], browserName: "chromium", viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true },
      grep: /@responsive/,
    },
    {
      name: "tablet-portrait",
      use: { ...devices["iPad (gen 7)"], browserName: "chromium" },
      grep: /@responsive/,
    },
    {
      name: "tablet-landscape",
      use: { ...devices["iPad (gen 7) landscape"], browserName: "chromium" },
      grep: /@responsive/,
    },
  ],
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:2567",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npm run dev --workspace @animal-care/client -- --host 127.0.0.1 --port 5173",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
