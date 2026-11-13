// Vocabulary load/save: malformed data, partial data, fresh install, quota,
// backups, legacy/foreign keys and special folder names.
import { test, expect } from "@playwright/test";
import { KEY, BACKUP, seed, dump, stored, failWrites, dialogs, errors, openStorage, addWord, folderOptions, pair } from "./helpers.mjs";

const notice = (page) => page.locator("[role=status]").first();

test("malformed JSON: notice, original untouched, exactly one recovery copy", async ({ page }) => {
  const errs = errors(page);
  await seed(page, { [KEY]: "{broken" });
  await page.goto("game");
  await expect(notice(page)).toContainText("Nie udało się odczytać");
  await expect(notice(page)).toContainText("mp:recovery:");
  expect((await folderOptions(page, "folder")).some((o) => o.includes("Przykład"))).toBe(false);
  await page.goto("mystorage");
  await expect(notice(page)).toBeVisible();
  const s = await dump(page);
  const rec = Object.keys(s).filter((k) => k.startsWith("mp:recovery:"));
  expect(s[KEY]).toBe("{broken");
  expect(rec).toHaveLength(1);
  expect(s[rec[0]]).toBe("{broken");
  expect(errs).toEqual([]);
});

test("one invalid pair: valid pairs shown, entry count reported, nothing rewritten", async ({ page }) => {
  const data = JSON.stringify({ Zwierzęta: [pair("cat", "kot"), pair("dog", "pies"), pair("fox", "lis"), { known: "x", learn: 5 }] });
  await seed(page, { [KEY]: data });
  await page.goto("game");
  await expect(page.locator("#folder option", { hasText: "Zwierzęta (3)" })).toBeAttached();
  await expect(notice(page)).toContainText("(1)");
  expect(await stored(page)).toBe(data);
});

test("fresh install: sample offered, nothing written by visiting pages", async ({ page }) => {
  await seed(page, {});
  await page.goto("game");
  await expect(page.locator("#folder option", { hasText: "Przykład (4)" })).toBeAttached();
  await page.goto("mystorage");
  await page.goto("settings");
  await expect(page.locator("#dane")).toBeVisible();
  expect(await dump(page)).toEqual({});
});

test("normal save keeps the previous value as backup", async ({ page }) => {
  const log = dialogs(page);
  const data = JSON.stringify({ Moje: [pair("sun", "słońce")] });
  await seed(page, { [KEY]: data });
  await openStorage(page);
  await addWord(page, "moon", "księżyc");
  await expect.poll(log.last).toBe('Dodano 1 par(y) do folderu "Moje".');
  expect(JSON.parse(await stored(page)).Moje).toHaveLength(2);
  expect(await stored(page, BACKUP)).toBe(data);
  await page.goto("game");
  await expect(page.locator("#folder option", { hasText: "Moje (2)" })).toBeAttached();
});

test("quota failure on save: explained, words kept in the form, data unchanged", async ({ page, context }) => {
  const log = dialogs(page);
  const data = JSON.stringify({ Moje: [pair("sun", "słońce")] });
  await seed(page, { [KEY]: data });
  await failWrites(context, /^(wordFolders_v2|mp:backup:wordFolders_v2)$/);
  await openStorage(page);
  await addWord(page, "moon", "księżyc");
  await expect.poll(log.last).toContain("brak miejsca");
  await expect(page.locator(".pair-known").first()).toHaveValue("moon");
  await expect(page.getByRole("link", { name: /Dane i kopia zapasowa/ })).toBeVisible();
  expect(await stored(page)).toBe(data);
  await page.locator("#new-folder-name").fill("Nowy");
  await page.getByRole("button", { name: "Utwórz nowy folder" }).click();
  await expect.poll(log.last).toContain("Nie udało się zapisać");
  expect((await folderOptions(page)).some((o) => o.startsWith("Nowy"))).toBe(false);
});

test("legacy data offered; other sites' keys never adopted or touched", async ({ page }) => {
  const foreign = JSON.stringify({ inbox: [pair("a", "b")] });
  const legacy = JSON.stringify({ Stare: [pair("tree", "drzewo")] });
  await seed(page, { folders: foreign, wordFolders: legacy, contacts: "[1]" });
  await page.goto("game");
  await expect(page.locator("#folder option", { hasText: "Stare (1)" })).toBeAttached();
  expect((await folderOptions(page, "folder")).some((o) => o.startsWith("inbox"))).toBe(false);
  const s = await dump(page);
  expect([s.folders, s.contacts, s.wordFolders]).toEqual([foreign, "[1]", legacy]);
});

test("special folder names (constructor, __proto__, toString) are ordinary folders", async ({ page }) => {
  const errs = errors(page);
  const log = dialogs(page);
  await seed(page, { [KEY]: JSON.stringify({ Moje: [pair("sun", "słońce")] }) });
  await openStorage(page);
  for (const name of ["constructor", "__proto__", "toString"]) {
    await page.locator("#new-folder-name").fill(name);
    await page.getByRole("button", { name: "Utwórz nowy folder" }).click();
    await expect.poll(log.last).toBe(`Folder "${name}" gotowy ✅`);
    await addWord(page, `${name}-a`, "x");
    await expect.poll(log.last).toBe(`Dodano 1 par(y) do folderu "${name}".`);
  }
  await page.goto("game");
  for (const o of ["constructor (1)", "__proto__ (1)", "toString (1)", "Moje (1)"]) {
    await expect(page.locator("#folder option", { hasText: o })).toBeAttached();
  }
  const raw = await stored(page);
  for (const k of ['"constructor":[', '"__proto__":[', '"toString":[']) expect(raw).toContain(k);
  expect(errs).toEqual([]);
});
