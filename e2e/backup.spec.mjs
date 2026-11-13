// Data & Backup: listing, export/download, import, preview, confirmed restore,
// cancellation, quota, and manual deletion of copies.
import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { KEY, BACKUP, seed, dump, stored, failWrites, dialogs, errors, openStorage, folderOptions, pair } from "./helpers.mjs";

const v1 = JSON.stringify({ Moje: [pair("sun", "słońce")] });
const v2 = JSON.stringify({ Moje: [pair("sun", "słońce"), pair("moon", "księżyc")], Kolory: [pair("red", "czerwony")] });
const REC_OLD = "mp:recovery:wordFolders_v2:2026-01-01T10:00:00.000Z";
const REC_BROKEN = "mp:recovery:wordFolders_v2:2026-02-01T10:00:00.000Z";

const item = (page, key) => page.locator(`li[data-key="${key}"]`);
const message = (page) => page.locator("#backup-message");
const preview = (page) => page.locator(".snapshot-preview[aria-label='Podgląd kopii']");

async function openBackup(page) {
  await page.goto("settings");
  await expect(page.locator(".snapshot-list")).toBeAttached();
}

async function download(page, click) {
  const [dl] = await Promise.all([page.waitForEvent("download"), click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), "utf8") };
}

test("lists copies, exports and downloads without writing anything", async ({ page }) => {
  const errs = errors(page);
  await seed(page, { [KEY]: v2, [BACKUP]: v1, [REC_OLD]: v1, [REC_BROKEN]: '{"Moje":[{"known":"x"', folders: '{"foreign":[]}', contacts: "[1]" });
  const before = await dump(page);
  await openBackup(page);
  const keys = await page.locator(".snapshot-list li").evaluateAll((lis) => lis.map((li) => li.dataset.key));
  expect(keys).toEqual([KEY, BACKUP, REC_BROKEN, REC_OLD]);
  await expect(page.locator("#dane .hint").first()).toContainText("rexer00.github.io");

  const exp = await download(page, () => page.getByRole("button", { name: "Eksportuj słówka (JSON)" }).click());
  expect(exp.name).toMatch(/^matching-pairs-wordFolders_v2-.*\.json$/);
  const file = JSON.parse(exp.text);
  expect(file.format).toBe("matching-pairs-backup");
  expect(JSON.stringify(file.data)).toBe(v2);

  const raw = await download(page, () => item(page, REC_BROKEN).getByRole("button", { name: "Pobierz" }).click());
  expect(JSON.parse(raw.text).rawText).toBe('{"Moje":[{"known":"x"');

  await item(page, REC_BROKEN).getByRole("button", { name: "Podgląd" }).click();
  await expect(preview(page)).toContainText("nieczytelne");
  await expect(preview(page).getByRole("button", { name: "Zastąp obecne słówka" })).toHaveCount(0);
  expect(await dump(page)).toEqual(before);
  expect(errs).toEqual([]);
});

test("restore: preview, cancel changes nothing, confirm keeps the previous data", async ({ page }) => {
  const log = dialogs(page, false);
  await seed(page, { [KEY]: v2, [BACKUP]: v1 });
  await openBackup(page);
  await item(page, BACKUP).getByRole("button", { name: "Podgląd" }).click();
  await expect(preview(page)).toContainText("Moje (1)");
  await expect(preview(page)).toContainText("sun — słońce");

  await preview(page).getByRole("button", { name: "Zastąp obecne słówka" }).click();
  await expect.poll(log.last).toMatch(/^Zastąpić obecne słówka/);
  expect(await dump(page)).toEqual({ [KEY]: v2, [BACKUP]: v1 });

  log.answer = true;
  await preview(page).getByRole("button", { name: "Zastąp obecne słówka" }).click();
  await expect(message(page)).toContainText("Poprzednie dane zachowano jako: mp:recovery:");
  const s = await dump(page);
  const rec = Object.keys(s).filter((k) => k.startsWith("mp:recovery:"));
  expect(s[KEY]).toBe(v1);
  expect(rec.map((k) => s[k])).toEqual([v2]);
  await expect(item(page, rec[0])).toBeVisible();
  await openStorage(page);
  expect(await folderOptions(page)).toEqual(["Moje (1)"]);
});

test("import: exported file and console format previewed; merge adds only; bad file rejected", async ({ page }, testInfo) => {
  const errs = errors(page);
  dialogs(page);
  await seed(page, { [KEY]: v1 });
  await openBackup(page);
  const exported = testInfo.outputPath("export.json");
  await writeFile(exported, JSON.stringify({ format: "matching-pairs-backup", version: 1, exportedAt: "2026-11-01T00:00:00.000Z", source: KEY,
    data: { Moje: [pair("moon", "księżyc")], constructor: [pair("a", "b")] } }));
  await page.locator("#import-file").setInputFiles(exported);
  await expect(preview(page)).toContainText("Plik: export.json");
  await expect(preview(page)).toContainText("constructor (1)");
  expect(await stored(page)).toBe(v1);
  await preview(page).getByRole("button", { name: "Dodaj brakujące do obecnych" }).click();
  await expect(message(page)).toContainText("Przywrócono");
  expect(JSON.parse(await stored(page))).toEqual({ Moje: [pair("sun", "słońce"), pair("moon", "księżyc")], constructor: [pair("a", "b")] });

  const bad = testInfo.outputPath("bad.json");
  await writeFile(bad, "this is not json");
  await page.locator("#import-file").setInputFiles(bad);
  await expect(message(page)).toContainText("JSON");
  await expect(preview(page)).toHaveCount(0);

  const snippet = testInfo.outputPath("snippet.json");
  await writeFile(snippet, JSON.stringify({ exportedAt: "x", origin: "https://rexer00.github.io", data: { [KEY]: v2, mp_theme: "dark" } }));
  await page.locator("#import-file").setInputFiles(snippet);
  await expect(preview(page)).toContainText("Kolory (1)");
  expect(errs).toEqual([]);
});

test("quota: restore refused without changes, export still works", async ({ page, context }) => {
  dialogs(page);
  await seed(page, { [KEY]: v2, [BACKUP]: v1 });
  await failWrites(context, /^(mp:recovery:.*|wordFolders_v2|mp:backup:wordFolders_v2|mp:epoch:.*)$/);
  await openBackup(page);
  await item(page, BACKUP).getByRole("button", { name: "Podgląd" }).click();
  await preview(page).getByRole("button", { name: "Zastąp obecne słówka" }).click();
  await expect(message(page)).toContainText("brak miejsca");
  expect(await dump(page)).toEqual({ [KEY]: v2, [BACKUP]: v1 });
  const exp = await download(page, () => page.getByRole("button", { name: "Eksportuj słówka (JSON)" }).click());
  expect(JSON.stringify(JSON.parse(exp.text).data)).toBe(v2);
});

test("corrupt current data restored from backup: corrupt value kept once", async ({ page }) => {
  dialogs(page);
  await seed(page, { [KEY]: "{broken", [BACKUP]: v1 });
  await openBackup(page);
  await item(page, BACKUP).getByRole("button", { name: "Podgląd" }).click();
  await preview(page).getByRole("button", { name: "Zastąp obecne słówka" }).click();
  await expect(message(page)).toContainText("Przywrócono");
  const s = await dump(page);
  expect(s[KEY]).toBe(v1);
  expect(Object.entries(s).filter(([k]) => k.startsWith("mp:recovery:")).map(([, v]) => v)).toEqual(["{broken"]);
});

test.describe("manual cleanup of copies", () => {
  test("download before deletion, explicit checkbox + confirmation, cancel keeps the copy", async ({ page }) => {
    const log = dialogs(page, false);
    await seed(page, { [KEY]: v2, [BACKUP]: v1, [REC_OLD]: v1 });
    await openBackup(page);
    await item(page, REC_OLD).getByRole("button", { name: "Usuń…" }).click();
    const panel = page.locator("#delete-panel");
    await expect(panel).toContainText("nie da się odzyskać");
    await expect(panel.getByRole("button", { name: "Usuń na stałe" })).toBeDisabled();

    const saved = await download(page, () => panel.getByRole("button", { name: "Pobierz przed usunięciem" }).click());
    expect(JSON.stringify(JSON.parse(saved.text).data)).toBe(v1);

    await panel.locator("#delete-understood").check();
    await panel.getByRole("button", { name: "Usuń na stałe" }).click();
    await expect.poll(log.last).toMatch(/^Usunąć na stałe/);
    expect(await stored(page, REC_OLD)).toBe(v1); // confirmation dismissed

    log.answer = true;
    await panel.getByRole("button", { name: "Usuń na stałe" }).click();
    await expect(message(page)).toContainText(`Usunięto kopię ${REC_OLD}`);
    const s = await dump(page);
    expect(s).toEqual({ [KEY]: v2, [BACKUP]: v1 });
    await expect(item(page, REC_OLD)).toHaveCount(0);
  });

  test("the active vocabulary and legacy data have no delete action", async ({ page }) => {
    await seed(page, { [KEY]: v2, [BACKUP]: v1, wordFolders: v1 });
    await openBackup(page);
    await expect(item(page, KEY).getByRole("button", { name: "Usuń…" })).toHaveCount(0);
    await expect(item(page, "wordFolders").getByRole("button", { name: "Usuń…" })).toHaveCount(0);
    await expect(item(page, BACKUP).getByRole("button", { name: "Usuń…" })).toHaveCount(1);
  });

  test("capacity warning when the shared origin is nearly full", async ({ page }) => {
    await seed(page, { [KEY]: v1, "other-site": "x".repeat(4_400_000) });
    await openBackup(page);
    await expect(page.locator("#capacity-warning")).toContainText("Mało miejsca");
    await expect(page.locator("#dane .hint").first()).toContainText("%");
  });
});
