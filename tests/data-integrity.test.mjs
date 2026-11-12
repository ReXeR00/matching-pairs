// FIX 005 regression tests (run: npm test).
// D1: a page holding stale data must never silently overwrite newer data
//     saved from another tab.
// D2: theme preference must not crash the app when storage is blocked.
// "Tabs" share one FakeStorage, like two tabs of the same origin.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage, installThrowingStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";

const KEY = "wordFolders_v2";
const p = (known, learn) => ({ known, learn });
const stored = (store) => JSON.parse(store.getItem(KEY));

// What the Storage page does: load once on mount, later save through
// updateFolders with the revision it loaded and everything it wrote so far.
function openTab() {
  const loaded = S.loadFoldersWithStatus();
  const tab = { folders: loaded.folders, revision: loaded.raw, lastWritten: null };
  const apply = (change) => {
    const res = S.updateFolders(change, { expected: tab.revision, mine: tab.lastWritten });
    if (res.ok) Object.assign(tab, { folders: res.folders, revision: res.raw, lastWritten: res.raw });
    return res;
  };
  tab.addWords = (folder, pairs) => apply((f) => S.mergePairs(f, folder, pairs));
  tab.createFolder = (name) => apply((f) => S.ensureFolder(f, name));
  return tab;
}

describe("D1: stale data from another tab is never silently overwritten", () => {
  test("two tabs: words saved in tab B survive a later save from stale tab A", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("sun", "słońce")] }) });
    const a = openTab();
    const b = openTab();
    assert.equal(b.addWords("Moje", [p("moon", "księżyc")]).ok, true);
    const res = a.addWords("Moje", [p("star", "gwiazda")]);
    assert.equal(res.ok, true);
    assert.equal(res.stale, true, "tab A must be told its copy was out of date");
    assert.equal(res.result.added, 1);
    assert.deepEqual(stored(store).Moje, [p("sun", "słońce"), p("moon", "księżyc"), p("star", "gwiazda")]);
    assert.deepEqual(a.folders, stored(store), "tab A's view now includes tab B's words");
  });

  test("stale tab creating a folder keeps the other tab's new words and folders", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [] }) });
    const a = openTab();
    const b = openTab();
    b.addWords("Moje", [p("moon", "księżyc")]);
    b.createFolder("Kolory");
    assert.equal(a.createFolder("Zwierzęta").ok, true);
    assert.deepEqual(stored(store), { Moje: [p("moon", "księżyc")], Kolory: [], Zwierzęta: [] });
  });

  test("no conflict: stale is false and the result matches the old save path", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("sun", "słońce")] }) });
    const a = openTab();
    const res = a.addWords("Moje", [p("moon", "księżyc"), p("SUN ", "słońce")]);
    assert.equal(res.stale, false);
    assert.equal(res.result.added, 1, "case/whitespace duplicates are still skipped");
    assert.deepEqual(stored(store).Moje, [p("sun", "słońce"), p("moon", "księżyc")]);
  });

  test("saveFolders with an outdated expected revision refuses and writes nothing", () => {
    const raw = JSON.stringify({ Moje: [p("moon", "księżyc")] });
    const store = installStorage({ [KEY]: raw });
    const before = store.writes.length;
    const res = S.saveFolders({ Moje: [] }, { expected: JSON.stringify({ Moje: [] }) });
    assert.deepEqual(res, { ok: false, error: "conflict" });
    assert.equal(store.getItem(KEY), raw);
    assert.equal(store.writes.length, before, "no backup or data write on conflict");
  });

  test("saveFolders without `expected` keeps its FIX 004 behaviour and returns the written revision", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ A: [] }) });
    const res = S.saveFolders({ A: [p("a", "b")] });
    assert.equal(res.ok, true);
    assert.equal(res.raw, store.getItem(KEY));
  });

  test("loadFoldersWithStatus exposes the raw revision it read", () => {
    const raw = JSON.stringify({ A: [] });
    installStorage({ [KEY]: raw });
    assert.equal(S.loadFoldersWithStatus().raw, raw);
    installStorage({});
    assert.equal(S.loadFoldersWithStatus().raw, null);
  });

  test("fresh install: first save still includes the sample folder the user was shown", () => {
    const store = installStorage({});
    const a = openTab();
    a.createFolder("Moje");
    assert.deepEqual(Object.keys(stored(store)).sort(), ["Moje", "Przykład"]);
  });

  test("legacy data is still the base of the first save (copied, never removed)", () => {
    const legacy = JSON.stringify({ Stare: [p("tree", "drzewo")] });
    const store = installStorage({ wordFolders: legacy });
    openTab().addWords("Stare", [p("leaf", "liść")]);
    assert.deepEqual(stored(store).Stare, [p("tree", "drzewo"), p("leaf", "liść")]);
    assert.equal(store.getItem("wordFolders"), legacy);
  });

  test("partial data: the full original is kept in recovery before the merged save", () => {
    const raw = JSON.stringify({ Moje: [p("sun", "słońce"), { known: "x", learn: 5 }] });
    const store = installStorage({ [KEY]: raw });
    openTab().addWords("Moje", [p("moon", "księżyc")]);
    const rec = S.listRecoveryKeys();
    assert.equal(rec.length, 1);
    assert.equal(store.getItem(rec[0]), raw);
    assert.deepEqual(stored(store).Moje, [p("sun", "słońce"), p("moon", "księżyc")]);
  });

  test("a failed write reports the error and leaves the stored vocabulary unchanged", () => {
    const raw = JSON.stringify({ Moje: [p("sun", "słońce")] });
    const store = installStorage({ [KEY]: raw, "mp:backup:wordFolders_v2": "older" }, { failSetFor: (k) => k === KEY });
    const res = openTab().addWords("Moje", [p("moon", "księżyc")]);
    assert.equal(res.ok, false);
    assert.equal(res.error, "write-failed");
    assert.equal(store.getItem(KEY), raw);
  });

  test("this tab's own earlier words are put back if its read was out of date", () => {
    const start = JSON.stringify({ Moje: [] });
    const store = installStorage({ [KEY]: start });
    const a = openTab();
    a.addWords("Moje", [p("moon", "księżyc")]);
    store.setItem(KEY, start); // tab A's next read does not include its own write
    const res = a.addWords("Moje", [p("star", "gwiazda")]);
    assert.equal(res.restored, 1);
    assert.deepEqual(stored(store).Moje, [p("moon", "księżyc"), p("star", "gwiazda")]);
  });

  test("own history is not pushed onto removed or unreadable data", () => {
    for (const current of [null, "{broken"]) {
      const store = installStorage({ [KEY]: JSON.stringify({ Moje: [] }) });
      const a = openTab();
      a.addWords("Moje", [p("moon", "księżyc")]);
      if (current === null) store.removeItem(KEY);
      else store.setItem(KEY, current);
      const res = a.createFolder("Nowy");
      assert.equal(res.restored, 0);
      assert.ok(!JSON.stringify(stored(store)).includes("moon"), `not restored onto ${current}`);
    }
  });

  test("blocked storage: updateFolders reports unavailable without throwing", () => {
    installThrowingStorage();
    const res = S.updateFolders((f) => S.ensureFolder(f, "A"));
    assert.deepEqual({ ok: res.ok, error: res.error }, { ok: false, error: "unavailable" });
  });
});

describe("D1: lost writes are detected and repaired (localStorage is not atomic across tabs)", () => {
  // Simulates the race a re-read cannot exclude: tab B's write is based on a
  // value that did not yet include tab A's write.
  function raceSetup() {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("sun", "słońce")] }) });
    const a = openTab();
    const staleRaw = store.getItem(KEY);
    a.addWords("Moje", [p("moon", "księżyc")]);
    const overwritten = JSON.stringify({ Moje: [p("sun", "słońce"), p("star", "gwiazda")] });
    store.setItem(KEY, overwritten); // B's write, built on staleRaw
    return { store, a, staleRaw, overwritten };
  }

  test("reconcileLostWrite restores this tab's words and keeps the other tab's", () => {
    const { store, a, overwritten } = raceSetup();
    const res = S.reconcileLostWrite(a.lastWritten);
    assert.equal(res.ok, true);
    assert.equal(res.restored, 1);
    assert.equal(res.raw, store.getItem(KEY), "returns the new revision to remember as `mine`");
    assert.deepEqual(stored(store).Moje, [p("sun", "słońce"), p("star", "gwiazda"), p("moon", "księżyc")]);
    assert.equal(store.getItem(S.BACKUP_KEY), overwritten, "the overwriting value is backed up too");
  });

  test("restored folders that disappeared entirely come back", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ A: [] }) });
    const a = openTab();
    a.createFolder("Nowy");
    store.setItem(KEY, JSON.stringify({ A: [p("x", "y")] }));
    assert.equal(S.reconcileLostWrite(a.lastWritten).restored, 1);
    assert.deepEqual(stored(store), { A: [p("x", "y")], Nowy: [] });
  });

  test("nothing missing: no write at all (no ping-pong between tabs)", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [] }) });
    const a = openTab();
    a.addWords("Moje", [p("moon", "księżyc")]);
    const b = openTab();
    b.addWords("Moje", [p("star", "gwiazda")]); // built on A's write
    const before = store.writes.length;
    assert.deepEqual(S.reconcileLostWrite(a.lastWritten), { ok: true, restored: 0 });
    assert.deepEqual(S.reconcileLostWrite(b.lastWritten), { ok: true, restored: 0 });
    assert.equal(store.writes.length, before);
  });

  test("both tabs reconciling converge on the union", () => {
    const { store, a } = raceSetup();
    S.reconcileLostWrite(a.lastWritten);
    const bWrote = JSON.stringify({ Moje: [p("sun", "słońce"), p("star", "gwiazda")] });
    assert.equal(S.reconcileLostWrite(bWrote).restored, 0);
    assert.equal(stored(store).Moje.length, 3);
  });

  test("never auto-writes over data that was removed or is unreadable", () => {
    for (const current of [null, "{broken"]) {
      const store = installStorage({ [KEY]: JSON.stringify({ Moje: [] }) });
      const a = openTab();
      a.addWords("Moje", [p("moon", "księżyc")]);
      if (current === null) store.removeItem(KEY);
      else store.setItem(KEY, current);
      const before = store.writes.length;
      const res = S.reconcileLostWrite(a.lastWritten);
      assert.equal(res.ok, false);
      assert.equal(res.error, "unsafe-target");
      assert.equal(res.missing, 1);
      // (loading unreadable data may make its one-time recovery copy — that is not a data write)
      assert.ok(store.writes.slice(before).every((w) => w.key !== KEY), `no write to ${KEY} when stored value is ${current}`);
      assert.equal(store.getItem(KEY), current);
    }
  });

  test("invalid or empty `mine` is ignored", () => {
    installStorage({ [KEY]: JSON.stringify({ A: [] }) });
    assert.deepEqual(S.reconcileLostWrite(null), { ok: true, restored: 0 });
    assert.deepEqual(S.reconcileLostWrite("{broken"), { ok: true, restored: 0 });
  });
});

describe("D1: cross-tab change notifications", () => {
  test("subscribeToFolderChanges reacts to the vocabulary key and clear(), ignores other keys", () => {
    installStorage({});
    const listeners = new Set();
    globalThis.addEventListener = (type, fn) => type === "storage" && listeners.add(fn);
    globalThis.removeEventListener = (type, fn) => listeners.delete(fn);
    try {
      const seen = [];
      const off = S.subscribeToFolderChanges((e) => seen.push(e.key));
      for (const key of [KEY, "folders", null, "mp_theme"]) for (const fn of listeners) fn({ key });
      assert.deepEqual(seen, [KEY, null]);
      off();
      assert.equal(listeners.size, 0);
    } finally {
      delete globalThis.addEventListener;
      delete globalThis.removeEventListener;
    }
  });

  test("subscribeToFolderChanges is a safe no-op without event support", () => {
    installStorage({});
    const off = S.subscribeToFolderChanges(() => {});
    assert.equal(typeof off, "function");
    off();
  });
});

describe("D2: theme preference never throws", () => {
  test("blocked storage: read returns null, write returns false", () => {
    installThrowingStorage();
    assert.equal(S.getThemePreference(), null);
    assert.equal(S.setThemePreference("dark"), false);
  });

  test("quota failure: write returns false", () => {
    installStorage({}, { failSetFor: "all" });
    assert.equal(S.setThemePreference("dark"), false);
  });

  test("round-trips the existing mp_theme values; unknown values are ignored", () => {
    const store = installStorage({ mp_theme: "dark" });
    assert.equal(S.getThemePreference(), "dark");
    assert.equal(S.setThemePreference("light"), true);
    assert.equal(store.getItem("mp_theme"), "light");
    installStorage({ mp_theme: "purple" });
    assert.equal(S.getThemePreference(), null);
  });
});
