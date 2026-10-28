import { defineConfig, devices } from "@playwright/test";

// BASE_URL points the suite at the live site; otherwise it runs against `vite preview`.
const live = process.env.BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: live ?? "http://localhost:4174/", trace: "retain-on-failure", acceptDownloads: true },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } },
    { name: "iphone", use: { ...devices["iPhone 15 Pro"] } },
    { name: "android", use: { ...devices["Pixel 7"] } },
  ],
  webServer: live ? undefined : { command: "npx vite preview --port 4174 --strictPort", url: "http://localhost:4174/", reuseExistingServer: !process.env.CI },
});
