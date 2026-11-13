// Stress: one tab repeatedly performs confirmed "replace" restores while
// another tab saves new words as fast as it can (real Chromium storage, same
// origin, synthetic page serving the repo's storage modules).
//
// Invariants checked after everything settles:
// - no acknowledged word vanishes from storage altogether;
// - every acknowledged word that no restore deliberately replaced is in the vocabulary;
// - the restored snapshot is not undone.
// RACE_LIB_DIR can point to another copy of src/lib (used to measure older code).
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { KEY } from "./helpers.mjs";

const LIB = process.env.RACE_LIB_DIR || path.resolve("src/lib");
const SNAPSHOT = { Moje: [{ known: "sun", learn: "slonce" }], Nowe: [{ known: "fresh", learn: "swieze" }] };

const PAGE = `<!doctype html><script type="module">
import * as S from "./storage.js";
import * as B from "./backup.js";
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seen = (e) => (e.key === "${KEY}" ? [e.newValue] : []);
// a passive page (Settings, Game): repairs and rescues on every change event
window.listen = () => S.subscribeToFolderChanges((e) => S.repairAfterRestore?.({ seen: seen(e) }));
window.saver = async (tag, n, listening) => {
  let mine = null, epoch = S.loadFoldersWithStatus().epoch;
  const acked = [];
  const off = listening
    ? S.subscribeToFolderChanges((e) => {
        const r = S.reconcileLostWrite(mine, { epoch });
        if (r.raw) mine = r.raw;
        if (r.epoch !== undefined) epoch = r.epoch;
        if (r.superseded && !r.raw) mine = null;
        S.repairAfterRestore?.({ seen: seen(e) });
      })
    : () => {};
  for (let i = 0; i < n; i++) {
    const w = tag + "-" + i;
    const r = S.updateFolders((f) => S.mergePairs(f, "Moje", [{ known: w, learn: "x" }]), { mine, epoch });
    if (r.ok) { mine = r.raw; epoch = r.epoch; acked.push(w); }
    await tick();
  }
  off(); // a non-listening saver behaves like a tab closed right after saving
  await sleep(listening ? 0 : 0);
  return acked;
};
window.restorer = async (n, snapshot) => {
  const replaced = [];
  for (let i = 0; i < n; i++) {
    const r = B.restoreSnapshot({ raw: snapshot, mode: "replace" });
    if (r.ok && r.recoveryKey) replaced.push(r.recoveryKey);
    await tick();
  }
  return replaced;
};
window.ready = true;
</script>`;

async function serveLib(context) {
  await context.route("**/__race__/**", (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (["storage.js", "backup.js", "utils.js"].includes(name)) {
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(path.join(LIB, name), "utf8") });
    }
    return route.fulfill({ contentType: "text/html", body: PAGE });
  });
}

const words = (raw) => {
  try {
    return Object.values(JSON.parse(raw)).flat().map((p) => p.known);
  } catch {
    return [];
  }
};

for (const scenario of ["saver listening", "saver closes after saving"]) {
  test(`restore vs. concurrent saves (${scenario})`, async ({ context }, testInfo) => {
    test.setTimeout(120_000);
    await serveLib(context);
    const listening = scenario === "saver listening";
    const ROUNDS = 4;
    const totals = { acked: 0, vanished: 0, droppedNew: 0, restoreUndone: 0 };
    for (let round = 0; round < ROUNDS; round++) {
      const [restorerTab, saverTab, otherTab] = [await context.newPage(), await context.newPage(), await context.newPage()];
      for (const p of [restorerTab, saverTab, otherTab]) {
        await p.goto("__race__/index.html");
        await p.waitForFunction(() => window.ready);
      }
      await restorerTab.evaluate(([k]) => {
        localStorage.clear();
        localStorage.setItem(k, JSON.stringify({ Moje: [{ known: "old", learn: "stare" }] }));
      }, [KEY]);
      await restorerTab.evaluate(() => window.listen());
      await otherTab.evaluate(() => window.listen());
      const [replacedKeys, acked] = await Promise.all([
        restorerTab.evaluate(([n, s]) => window.restorer(n, s), [30, JSON.stringify(SNAPSHOT)]),
        saverTab.evaluate(([t, n, l]) => window.saver(t, n, l), [`r${round}`, 150, listening]),
      ]);
      await restorerTab.waitForTimeout(1500); // late events, repairs
      const all = await restorerTab.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
      const primary = new Set(words(all[KEY]));
      const everywhere = new Set(Object.values(all).flatMap(words));
      const replacedWords = new Set(replacedKeys.flatMap((k) => words(all[k])));
      totals.acked += acked.length;
      totals.vanished += acked.filter((w) => !everywhere.has(w)).length;
      totals.droppedNew += acked.filter((w) => !replacedWords.has(w) && !primary.has(w)).length;
      totals.restoreUndone += ["sun", "fresh"].filter((w) => !primary.has(w)).length;
      for (const p of [restorerTab, saverTab, otherTab]) await p.close();
    }
    const summary = `${scenario}: acknowledged=${totals.acked} vanished=${totals.vanished} new-writes-dropped=${totals.droppedNew} restore-undone=${totals.restoreUndone}`;
    console.log(`[restore-race] ${summary}`);
    testInfo.annotations.push({ type: "restore-race", description: summary });
    expect(totals.vanished).toBe(0);
    expect(totals.droppedNew).toBe(0);
    expect(totals.restoreUndone).toBe(0);
  });
}
