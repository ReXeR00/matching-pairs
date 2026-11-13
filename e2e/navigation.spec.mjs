// Main navigation, game start-up and GitHub Pages behaviour (deep links,
// refresh, favicon, base path) against the production build served like Pages.
import { test, expect } from "@playwright/test";
import { errors, dialogs } from "./helpers.mjs";

const ROUTES = [
  ["", ".radial"],
  ["game", "#btn-start"],
  ["mystorage", "#edit-folder"],
  ["settings", "#dane"],
];

test.describe("GitHub Pages deep links", () => {
  for (const [route, selector] of ROUTES) {
    test(`direct navigation and refresh: /${route}`, async ({ page }) => {
      const errs = errors(page);
      const res = await page.goto(route);
      // GitHub Pages answers unknown paths with 404.html (a copy of index.html) and status 404
      expect(res.status()).toBe(route === "" ? 200 : 404);
      await expect(page.locator(selector).first()).toBeVisible();
      await page.reload();
      await expect(page.locator(selector).first()).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(`/matching-pairs/${route}`);
      const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(hrefs.every((h) => h.startsWith("/matching-pairs"))).toBe(true);
      expect(errs).toEqual([]);
    });
  }

  test("/matching-pairs without a slash redirects to the app", async ({ page }) => {
    await page.goto("/matching-pairs");
    await expect(page).toHaveURL(/\/matching-pairs\/$/);
    await expect(page.locator(".radial")).toBeVisible();
  });

  test("unknown route renders the app shell without crashing", async ({ page }) => {
    const errs = errors(page);
    const res = await page.goto("does/not/exist");
    expect(res.status()).toBe(404);
    await expect(page.locator("nav.toolbar")).toBeVisible();
    expect(errs).toEqual([]);
  });

  test("favicon resolves under the base path and there is no <base> tag", async ({ page, request }) => {
    await page.goto("");
    const icon = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(icon.startsWith("/matching-pairs/")).toBe(true);
    expect((await request.get(icon)).status()).toBe(200);
    expect(await page.locator("base").count()).toBe(0);
  });
});

test.describe("navigation and game start-up", () => {
  test("toolbar links navigate client-side (no reload)", async ({ page }) => {
    const errs = errors(page);
    await page.goto("");
    await page.evaluate(() => (window.__noReload = 1));
    for (const [text, selector, path] of [
      ["Gra", "#btn-start", "/matching-pairs/game"],
      ["Dodaj słowa", "#edit-folder", "/matching-pairs/mystorage"],
      ["Ustawienia", "#dane", "/matching-pairs/settings"],
      ["Home", ".radial", "/matching-pairs/"],
    ]) {
      await page.locator("nav.toolbar a", { hasText: text }).first().click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.locator(selector).first()).toBeVisible();
    }
    expect(await page.evaluate(() => window.__noReload)).toBe(1);
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
    expect(errs).toEqual([]);
  });

  test("a round starts with the sample folder and can be completed", async ({ page }) => {
    const errs = errors(page);
    dialogs(page);
    await page.goto("game");
    await page.locator("#pairs-count").fill("4");
    await page.locator("#btn-start").click();
    await expect(page.locator(".columns .card")).toHaveCount(8);
    const answers = { cat: "kot", dog: "pies", house: "dom", car: "samochód" };
    for (let n = 0; n < 4; n++) {
      const left = page.locator(".columns .col").first().locator(".card:not(.fading)").first();
      const word = (await left.textContent()).trim();
      await left.click();
      await page.locator(".columns .col").nth(1).locator(".card:not(.fading)", { hasText: answers[word] }).first().click();
      await page.waitForTimeout(700); // fade/refill animation
    }
    await expect(page.locator(".gameover-card")).toBeVisible();
    await page.locator(".gameover-card__btn--second").click();
    await expect(page).toHaveURL(/\/matching-pairs\/$/);
    expect(errs).toEqual([]);
  });
});
