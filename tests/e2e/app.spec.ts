import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.getByRole("heading", { level: 1, name: "store-orders-q3.pdf" })).toBeVisible();
});

test("opens on an extracted sample with types and totals", async ({ page }) => {
  await expect(page.getByText(/5 pages · 120 rows · 7 columns/)).toBeVisible();
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader", { name: /Total/ })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(120);
  await expect(table.locator("tfoot")).toContainText("120 rows");
  await expect(page.getByText("Workbook: 7 sheets")).toBeVisible();
});

test("sheet tabs filter the preview by the split column", async ({ page }) => {
  await page.getByRole("tab", { name: /^Singapore/ }).click();
  await expect(page.getByRole("tab", { name: /^Singapore/ })).toHaveAttribute("aria-selected", "true");
  const rows = page.locator("#preview tbody tr");
  const n = await rows.count();
  expect(n).toBeGreaterThan(5);
  for (let i = 0; i < n; i++) await expect(rows.nth(i).locator("td").nth(3)).toHaveText("Singapore");
  await expect(page.locator("#preview tfoot")).toContainText(`${n} rows`);
  await page.getByLabel("Split into sheets by").selectOption("");
  await expect(page.locator("#preview tbody tr")).toHaveCount(120);
});

test("detection view draws the page and links rows back to the table", async ({ page }) => {
  await page.getByRole("tab", { name: "Detection" }).click();
  await expect(page.getByText("Page 1 of 5")).toBeVisible();
  const rows = page.locator("#overlay rect.row");
  await expect(rows.first()).toBeAttached();
  expect(await rows.count()).toBeGreaterThan(20);
  await expect(page.locator("#overlay rect.header")).toHaveCount(1);
  await expect(page.locator("#overlay rect.skipped").first()).toBeAttached();
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2 of 5")).toBeVisible();
  await page.locator("#overlay rect.row").nth(2).dispatchEvent("click");
  await expect(page.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#preview tr.flash")).toBeVisible();
});

test("downloads a workbook and a CSV", async ({ page }) => {
  const xlsx = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel" }).click();
  expect((await xlsx).suggestedFilename()).toBe("store-orders-q3.xlsx");
  await expect(page.getByText("Excel file ready: 7 sheets, 120 rows.")).toBeVisible();
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV" }).click();
  const text = Buffer.concat(await (await (await csv).createReadStream()).toArray()).toString("utf8");
  expect(text.split(/\r?\n/).filter(Boolean)).toHaveLength(121);
});

test("loads the second sample and offers its group columns", async ({ page }) => {
  await page.getByRole("button", { name: /Membership register/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "membership-register.pdf" })).toBeVisible();
  await expect(page.getByText(/3 pages · 96 rows · 6 columns/)).toBeVisible();
  await expect(page.getByLabel("Split into sheets by").locator("option")).toHaveText(["Don't split", /Branch/, /Status/]);
});

test("a PDF without a table shows a clear message", async ({ page }) => {
  await page.locator("#file").setInputFiles("tests/fixtures/no-table.pdf");
  await expect(page.getByText("No table was found.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Loaded files" })).toContainText("no table found");
});

test("theme choice persists and nothing scrolls sideways", async ({ page }) => {
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("button", { name: "Switch theme" }).click();
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(!dark);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("asks for the password of a protected PDF and offers both of its tables", async ({ page }) => {
  await page.locator("#file").setInputFiles("tests/fixtures/stress/encrypted.pdf");
  const dialog = page.getByRole("dialog", { name: "Password required" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("PDF password").fill("wrong");
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(dialog).toContainText("did not open");
  await dialog.getByLabel("PDF password").fill("user");
  await dialog.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText(/1 page · 35 rows · 5 columns/)).toBeVisible();
  await page.locator("#table-pick").selectOption({ label: "Status, Count, Amount · 6 rows" });
  await expect(page.getByText(/1 page · 6 rows · 3 columns/)).toBeVisible();
});

test("skipping the password says why nothing was read", async ({ page }) => {
  await page.locator("#file").setInputFiles("tests/fixtures/stress/encrypted.pdf");
  await page.getByRole("dialog", { name: "Password required" }).getByRole("button", { name: "Skip file" }).click();
  await expect(page.getByText("This PDF is password protected.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Loaded files" })).toContainText("password protected");
});

test("a file that is not a PDF is named, not mistaken for an empty table", async ({ page }) => {
  await page.locator("#file").setInputFiles(["tests/fixtures/stress/html-renamed.pdf", "tests/fixtures/stress/empty.pdf"]);
  await expect(page.getByText(/Could not open: html-renamed\.pdf \(not a PDF or damaged\), empty\.pdf \(empty file\)/)).toBeVisible();
});

test("totals printed in the table are set aside and checked", async ({ page }) => {
  await page.locator("#file").setInputFiles("tests/fixtures/stress/subtotals.pdf");
  await expect(page.getByText("4 total lines from the PDF are set aside")).toBeVisible();
  await expect(page.getByText("The rows add up to the PDF's total for Sales ✓")).toBeVisible();
  await expect(page.locator("#preview tbody tr")).toHaveCount(18);
});

test("a turned landscape page is read and its rows are marked where they are drawn", async ({ page }) => {
  await page.locator("#file").setInputFiles("tests/fixtures/stress/rotated-text.pdf");
  await expect(page.getByText(/12 rows · 4 columns/)).toBeVisible();
  await page.getByRole("tab", { name: "Detection" }).click();
  const row = page.locator("#overlay rect.row").first();
  await expect(row).toBeAttached();
  // The page is portrait and the text runs upwards, so each row box is taller than it is wide.
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThan(box.width * 3);
});

test("the whole page works in Turkish", async ({ page }) => {
  await page.goto("./?lang=tr");
  await expect(page.getByRole("heading", { level: 1, name: "store-orders-q3.pdf" })).toBeVisible();
  await expect(page.getByText(/5 sayfa · 120 satır · 7 sütun/)).toBeVisible();
  await expect(page.getByText("Çalışma kitabı: 7 sayfa")).toBeVisible();
  await page.getByRole("tab", { name: "Algılama" }).click();
  await expect(page.getByText("Sayfa 1 / 5")).toBeVisible();
  await page.getByRole("tab", { name: "Tablo" }).click();
  await page.getByRole("button", { name: "Üyelik kaydı" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "membership-register.pdf" })).toBeVisible();
  expect(await page.evaluate(() => [...((window as unknown as { __i18nMisses: Set<string> }).__i18nMisses ?? [])])).toEqual([]);
  // Back to English with the switch; the choice is kept on reload.
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(page.getByRole("tab", { name: "Detection" })).toBeVisible();
});

test("the command palette loads a sample and splits by a column", async ({ page }) => {
  await page.getByRole("button", { name: "Search and commands" }).click();
  const box = page.getByRole("combobox", { name: "Search commands" });
  await box.fill("membership");
  await box.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "membership-register.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Search and commands" }).click();
  await box.fill("don't split");
  await box.press("Enter");
  await expect(page.getByLabel("Split into sheets by")).toHaveValue("");
});
