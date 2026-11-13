// Several tabs of the same origin (pages in one browser context share storage):
// stale tabs, concurrent writes, and a confirmed "replace" restore vs. an older tab.
import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { KEY, seed, stored, dialogs, errors, openStorage, addWord, folderOptions, pair, words } from "./helpers.mjs";

const start = JSON.stringify({ Moje: [pair("sun", "słońce")] });
const syncNote = (page) => page.locator("[role=status]", { hasText: "innej karcie" });
// This tab never receives "storage" events, so its page copy is guaranteed stale.
const deafToOtherTabs = (page) => page.addInitScript(() => window.addEventListener("storage", (e) => e.stopImmediatePropagation(), true));

test("a stale tab's save keeps words saved meanwhile in another tab", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const logA = dialogs(a);
  const logB = dialogs(b);
  await seed(a, { [KEY]: start });
  await openStorage(a);
  await openStorage(b);
  await addWord(b, "moon", "księżyc");
  await expect.poll(logB.last).toBe('Dodano 1 par(y) do folderu "Moje".');
  await expect(a.locator("#edit-folder option", { hasText: "Moje (2)" })).toBeAttached(); // live refresh
  await expect(syncNote(a)).toBeVisible();
  await addWord(a, "star", "gwiazda");
  await expect.poll(logA.last).toContain("Dodano 1 par(y)");
  expect(words(await stored(a))).toEqual(["moon", "star", "sun"]);
});

test("a tab that missed every change event still merges instead of overwriting", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  await deafToOtherTabs(a);
  const logA = dialogs(a);
  const logB = dialogs(b);
  await seed(a, { [KEY]: start });
  await openStorage(a);
  await openStorage(b);
  await addWord(b, "moon", "księżyc");
  await expect.poll(logB.last).toContain("Dodano");
  expect(await folderOptions(a)).toEqual(["Moje (1)"]); // stale precondition
  await addWord(a, "star", "gwiazda");
  await expect.poll(logA.last).toContain("uwzględniono też zmiany zapisane w innej karcie");
  expect(words(await stored(a))).toEqual(["moon", "star", "sun"]);
});

test("concurrent saves from two tabs through the UI lose nothing", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const errs = [...[a, b].map(errors)];
  const logs = [dialogs(a), dialogs(b)];
  await seed(a, { [KEY]: JSON.stringify({ Moje: [] }) });
  await openStorage(a);
  await openStorage(b);
  const N = 15;
  await Promise.all([a, b].map(async (page, t) => {
    for (let i = 0; i < N; i++) {
      await addWord(page, `t${t}-${i}`, "x");
      await expect.poll(() => logs[t].messages.length).toBe(i + 1);
    }
  }));
  await a.waitForTimeout(500);
  const all = words(await stored(a));
  expect(all).toHaveLength(2 * N);
  expect(errs.flat()).toEqual([]);
});

test.describe("confirmed replace restore vs. an older tab", () => {
  const snapshot = JSON.stringify({ Moje: [pair("sun", "słońce")], Nowe: [pair("fresh", "z")] });

  async function setup(context, testInfo, { deaf }) {
    const older = await context.newPage();
    const restorer = await context.newPage();
    if (deaf) await deafToOtherTabs(older);
    const logOld = dialogs(older);
    dialogs(restorer);
    await seed(older, { [KEY]: start });
    await openStorage(older);
    await addWord(older, "old1", "x");
    await addWord(older, "old2", "y");
    await expect.poll(() => logOld.messages.length).toBe(2);
    // the other tab restores a snapshot that does not contain old1/old2
    const file = testInfo.outputPath("snapshot.json");
    const fs = await import("node:fs/promises");
    await fs.writeFile(file, snapshot);
    await restorer.goto("settings");
    await restorer.locator("#import-file").setInputFiles(file);
    await restorer.getByRole("button", { name: "Zastąp obecne słówka" }).click();
    await expect(restorer.locator("#backup-message")).toContainText("Przywrócono");
    return { older, restorer, logOld };
  }

  test("the older tab refreshes and does not bring replaced words back", async ({ context }, testInfo) => {
    const { older, logOld } = await setup(context, testInfo, { deaf: false });
    await expect(older.locator("[role=status]", { hasText: "przywrócono kopię" })).toBeVisible();
    await older.waitForTimeout(300);
    expect(words(await stored(older))).toEqual(["fresh", "sun"]);
    await addWord(older, "new", "n");
    await expect.poll(() => logOld.messages.length).toBe(3);
    expect(words(await stored(older))).toEqual(["fresh", "new", "sun"]);
  });

  test("an older tab that missed the events cannot reintroduce them on save", async ({ context }, testInfo) => {
    const { older, logOld } = await setup(context, testInfo, { deaf: true });
    await addWord(older, "new", "n");
    await expect.poll(() => logOld.messages.length).toBe(3);
    expect(words(await stored(older))).toEqual(["fresh", "new", "sun"]);
  });

  test("replaced words remain recoverable from the recovery copy", async ({ context }, testInfo) => {
    const { older } = await setup(context, testInfo, { deaf: false });
    const recovery = await older.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith("mp:recovery:")).map((k) => localStorage.getItem(k)));
    expect(recovery.map(words)).toContainEqual(["old1", "old2", "sun"]);
  });
});

test("storage-library stress: two tabs, concurrent writes, nothing lost", async ({ context }, testInfo) => {
  // Serves the repo's storage modules on the app origin (synthetic page; no app data).
  const lib = (f) => readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
  await context.route("**/__stress__/**", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "storage.js" || name === "utils.js") return route.fulfill({ contentType: "text/javascript", body: lib(name) });
    return route.fulfill({ contentType: "text/html", body: `<!doctype html><script type="module">
      import * as S from "./storage.js";
      window.run = async (mode, tab, n) => {
        const pair = (i) => ({ known: tab + "-" + i, learn: "x" + i });
        const tick = () => new Promise((r) => setTimeout(r, Math.random() * 2));
        let mine = null, epoch = S.loadFoldersWithStatus().epoch, copy = S.loadFolders();
        if (mode === "fix") S.subscribeToFolderChanges(() => {
          const r = S.reconcileLostWrite(mine, { epoch });
          if (r.restored) mine = r.raw;
        });
        for (let i = 0; i < n; i++) {
          if (mode === "naive") { const r = S.mergePairsIntoFolder({ ...copy }, "F", [pair(i)]); if (r.saved) copy = r.folders; }
          else { const r = S.updateFolders((f) => S.mergePairs(f, "F", [pair(i)]), { mine, epoch }); if (r.ok) { mine = r.raw; epoch = r.epoch; } }
          await tick();
        }
        await new Promise((r) => setTimeout(r, 1500));
      };
      window.ready = true;</script>` });
  });
  const N = 150;
  const lost = {};
  for (const mode of ["naive", "fix"]) {
    const pages = [await context.newPage(), await context.newPage()];
    for (const p of pages) {
      await p.goto("__stress__/index.html");
      await p.waitForFunction(() => window.ready);
    }
    await pages[0].evaluate((k) => localStorage.setItem(k, JSON.stringify({ F: [] })), KEY);
    await Promise.all(pages.map((p, t) => p.evaluate(([m, tab, n]) => window.run(m, tab, n), [mode, `T${t}`, N])));
    const have = new Set(words(await stored(pages[0])));
    lost[mode] = ["T0", "T1"].flatMap((t) => Array.from({ length: N }, (_, i) => `${t}-${i}`)).filter((w) => !have.has(w)).length;
    for (const p of pages) await p.close();
  }
  testInfo.annotations.push({ type: "stress", description: `writes=${4 * N} lost(naive FIX 004 path)=${lost.naive} lost(FIX 005+)=${lost.fix}` });
  console.log(`[stress] ${2 * N} writes per mode — lost: naive=${lost.naive}, fixed=${lost.fix}`);
  expect(lost.fix).toBe(0);
});
