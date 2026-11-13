// Shared helpers for the browser suite. Every Playwright test runs in a fresh,
// isolated browser context (empty storage, no user profile); all data is synthetic.
import { expect } from "@playwright/test";

export const KEY = "wordFolders_v2";
export const BACKUP = "mp:backup:wordFolders_v2";
export const EPOCH = "mp:epoch:wordFolders_v2";
export const pair = (known, learn) => ({ known, learn });

// Writes synthetic localStorage for the test origin before the app runs:
// a static asset page is opened (no app code), seeded, then the app is loaded.
export async function seed(page, data) {
  await page.goto("icon.png");
  await page.evaluate((d) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(d)) localStorage.setItem(k, v);
  }, data);
}

export const dump = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));

export const stored = async (page, key = KEY) => page.evaluate((k) => localStorage.getItem(k), key);

// Every later page load in this context sees localStorage as blocked (site data denied).
export const blockStorage = (context) =>
  context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access is denied for this document.", "SecurityError");
      },
    });
  });

// Every later page load: setItem throws QuotaExceededError for matching keys.
export const failWrites = (context, pattern) =>
  context.addInitScript((source) => {
    const re = new RegExp(source);
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (re.test(k)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return orig.call(this, k, v);
    };
  }, pattern.source);

// Records dialogs (alert/confirm) and answers them; `answer` can be changed during a test.
export function dialogs(page, answer = true) {
  const log = { messages: [], answer };
  page.on("dialog", (d) => {
    log.messages.push(d.message());
    return log.answer ? d.accept() : d.dismiss();
  });
  log.last = () => log.messages.at(-1) ?? "";
  return log;
}

// Collects uncaught errors, console errors and failed sub-resources.
// The page document itself may legitimately be a 404: GitHub Pages serves deep
// links through 404.html (the browser logs that as "Failed to load resource").
export function errors(page) {
  const list = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && list.push(m.text()));
  page.on("response", (r) => r.status() >= 400 && r.request().resourceType() !== "document" && list.push(`${r.status()} ${r.url()}`));
  return list;
}

export async function openStorage(page) {
  await page.goto("mystorage");
  await expect(page.locator("#edit-folder option").first()).toBeAttached();
}

export async function addWord(page, known, learn) {
  await page.locator(".pair-known").first().fill(known);
  await page.locator(".pair-learn").first().fill(learn);
  await page.getByRole("button", { name: "Zapisz do folderu" }).click();
}

export const folderOptions = (page, id = "edit-folder") => page.locator(`#${id} option`).allTextContents();
export const words = (raw) => Object.values(JSON.parse(raw)).flat().map((p) => p.known).sort();
