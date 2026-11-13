// Blocked site data (localStorage access throws) and theme switching.
import { test, expect } from "@playwright/test";
import { blockStorage, errors, failWrites, dialogs } from "./helpers.mjs";

test.describe("blocked storage", () => {
  test.beforeEach(async ({ context }) => blockStorage(context));

  for (const [route, selector] of [["", ".radial"], ["game", "#btn-start"], ["mystorage", "#edit-folder"], ["settings", "#dane"]]) {
    test(`/${route} renders without errors`, async ({ page }) => {
      const errs = errors(page);
      await page.goto(route);
      await expect(page.locator(selector).first()).toBeVisible();
      await expect(page.locator("#theme-toggle")).toBeAttached();
      expect(errs).toEqual([]);
    });
  }

  test("pages explain that storage is unavailable", async ({ page }) => {
    await page.goto("game");
    await expect(page.locator("[role=status]").first()).toContainText("niedostępna");
    await page.goto("settings");
    await expect(page.locator("#dane")).toContainText("niedostępna");
  });

  test("theme toggle still works for the session", async ({ page }) => {
    const errs = errors(page);
    await page.goto("");
    const html = page.locator("html");
    await expect(html).toHaveAttribute("data-theme", "light");
    await page.locator("label[for=theme-toggle]").click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await page.locator("label[for=theme-toggle]").click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(errs).toEqual([]);
  });

  test("saving words reports the blocked storage instead of failing silently", async ({ page }) => {
    const log = dialogs(page);
    await page.goto("mystorage");
    await page.locator("#new-folder-name").fill("Nowy");
    await page.getByRole("button", { name: "Utwórz nowy folder" }).click();
    await expect.poll(log.last).toContain("zablokowana");
  });
});

test("theme choice persists across reloads when storage works", async ({ page }) => {
  await page.goto("");
  await page.locator("label[for=theme-toggle]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => localStorage.getItem("mp_theme"))).toBe("dark");
});

test("theme toggle survives a failing write (quota)", async ({ page, context }) => {
  const errs = errors(page);
  await failWrites(context, /^mp_theme$/);
  await page.goto("");
  await page.locator("label[for=theme-toggle]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errs).toEqual([]);
});
