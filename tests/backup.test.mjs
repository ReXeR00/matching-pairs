// FIX 006: backup / export / import / restore and storage-quota handling.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage, installThrowingStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";
import * as B from "../src/lib/backup.js";

const KEY = "wordFolders_v2";
const BK = "mp:backup:wordFolders_v2";
const p = (known, learn) => ({ known, learn });
const v1 = JSON.stringify({ Moje: [p("sun", "słońce")] });
const v2 = JSON.stringify({ Moje: [p("sun", "słońce"), p("moon", "księżyc")], Kolory: [p("red", "czerwony")] });
const noRemovals = (store) => assert.ok(store.writes.every((w) => w.op === "set"), "nothing removed or cleared");
const recoveryValues = (store) => [...store.map].filter(([k]) => k.startsWith("mp:recovery:")).map(([, v]) => v);

describe("listing snapshots", () => {
  test("lists current, backup, recovery (newest first) and legacy copies; ignores foreign keys", () => {
    const store = installStorage({
      [KEY]: v2,
      [BK]: v1,
      "mp:recovery:wordFolders_v2:2026-01-01T10:00:00.000Z": "{broken",
      "mp:recovery:wordFolders_v2:2026-03-01T10:00:00.000Z": v1,
      wordFolders: JSON.stringify({ Stare: [p("tree", "drzewo")] }),
      folders: JSON.stringify({ foreign: [] }),
      contacts: "[1]",
    });
    const before = store.writes.length;
    const list = B.listSnapshots();
    assert.deepEqual(list.map((s) => s.kind), ["current", "backup", "recovery", "recovery", "legacy"]);
    assert.equal(list[2].createdAt, "2026-03-01T10:00:00.000Z");
    assert.equal(list[3].status, "unreadable");
    assert.deepEqual([list[0].folderCount, list[0].pairCount], [2, 3]);
    assert.ok(!list.some((s) => s.key === "folders" || s.key === "contacts"));
    assert.equal(store.writes.length, before, "listing writes nothing (not even recovery copies)");
  });

  test("blocked storage: empty list, no throw", () => {
    installThrowingStorage();
    assert.deepEqual(B.listSnapshots(), []);
    assert.equal(S.storageUsage(), null);
  });

  test("storageUsage separates this app from other sites on the shared origin", () => {
    installStorage({ [KEY]: "{}", mp_theme: "dark", other: "x".repeat(100) });
    const u = S.storageUsage();
    assert.equal(u.appChars, KEY.length + 2 + "mp_theme".length + 4);
    assert.equal(u.totalChars, u.appChars + "other".length + 100);
  });
});

describe("export / import", () => {
  const now = new Date("2026-11-12T10:20:30.000Z");

  test("export of readable data round-trips through import exactly (extra fields, reserved names)", () => {
    const raw = '{"constructor":[{"known":"a","learn":"b","note":"x"}],"__proto__":[{"known":"c","learn":"d"}]}';
    const { filename, text } = B.createExport({ raw, source: KEY }, now);
    assert.equal(filename, "matching-pairs-wordFolders_v2-2026-11-12T10-20-30-000Z.json");
    const file = JSON.parse(text);
    assert.equal(file.format, "matching-pairs-backup");
    assert.equal(file.version, 1);
    const imp = B.parseImport(text);
    assert.equal(imp.ok, true);
    assert.equal(imp.raw, raw);
    assert.equal(imp.status, "ok");
    assert.deepEqual([imp.folderCount, imp.pairCount], [2, 2]);
  });

  test("unreadable data is exported byte-for-byte as rawText and imported as unreadable", () => {
    const raw = '{"Moje":[{"known":"sun"';
    const { text } = B.createExport({ raw, source: "mp:recovery:x" }, now);
    assert.equal(JSON.parse(text).rawText, raw);
    const imp = B.parseImport(text);
    assert.equal(imp.ok, true);
    assert.equal(imp.raw, raw);
    assert.equal(imp.status, "unreadable");
  });

  test("partial data keeps its invalid entries in the export", () => {
    const raw = JSON.stringify({ Moje: [p("a", "b"), { known: "x", learn: 5 }] });
    const imp = B.parseImport(B.createExport({ raw, source: KEY }, now).text);
    assert.equal(imp.status, "partial");
    assert.equal(imp.skipped, 1);
    assert.equal(imp.raw, raw);
  });

  test("accepts a plain wordFolders_v2 object and the console backup format", () => {
    assert.equal(B.parseImport(v2).folderCount, 2);
    const snippet = JSON.stringify({ exportedAt: "x", origin: "https://rexer00.github.io", data: { [KEY]: v1, mp_theme: "dark" } });
    const imp = B.parseImport(snippet);
    assert.equal(imp.source, KEY);
    assert.equal(imp.raw, v1);
    const legacyOnly = JSON.stringify({ data: { wordFolders: v1 } });
    assert.equal(B.parseImport(legacyOnly).source, "wordFolders");
  });

  test("rejects invalid files with a reason", () => {
    assert.equal(B.parseImport("not json").error, "not-json");
    assert.equal(B.parseImport("[1,2]").error, "invalid-format");
    assert.equal(B.parseImport(JSON.stringify({ format: "matching-pairs-backup", version: 2, data: {} })).error, "unsupported-version");
    assert.equal(B.parseImport(JSON.stringify({ data: { contacts: "[1]" } })).error, "no-vocabulary");
    assert.equal(B.parseImport("x".repeat(B.MAX_IMPORT_CHARS + 1)).error, "too-large");
  });
});

describe("restore", () => {
  test("replace: current data is preserved in a verified recovery copy first", () => {
    const store = installStorage({ [KEY]: v2 });
    const res = B.restoreSnapshot({ raw: v1, mode: "replace" });
    assert.equal(res.ok, true);
    assert.equal(store.getItem(res.recoveryKey), v2, "previous data kept");
    assert.equal(store.getItem(KEY), v1);
    assert.equal(store.getItem(BK), v2);
    noRemovals(store);
  });

  test("merge: adds missing folders and pairs, removes nothing", () => {
    const store = installStorage({ [KEY]: v1 });
    const res = B.restoreSnapshot({ raw: JSON.stringify({ Moje: [p("moon", "księżyc")], Nowy: [] }), mode: "merge" });
    assert.equal(res.ok, true);
    assert.deepEqual(JSON.parse(store.getItem(KEY)), { Moje: [p("sun", "słońce"), p("moon", "księżyc")], Nowy: [] });
  });

  test("restoring from a stored snapshot: the backup becomes current, nothing is lost", () => {
    const store = installStorage({ [KEY]: v2, [BK]: v1 });
    const snap = B.listSnapshots().find((s) => s.kind === "backup");
    const res = B.restoreSnapshot({ key: snap.key, raw: snap.raw, mode: "replace" });
    assert.equal(res.ok, true);
    assert.equal(store.getItem(KEY), v1);
    assert.ok(recoveryValues(store).includes(v2) && store.getItem(BK) === v2);
  });

  test("refuses when the snapshot changed since preview", () => {
    const store = installStorage({ [KEY]: v2, [BK]: v1 });
    const res = B.restoreSnapshot({ key: BK, raw: "something else", mode: "replace" });
    assert.equal(res.error, "source-changed");
    assert.equal(store.getItem(KEY), v2);
  });

  test("refuses unreadable or empty sources", () => {
    const store = installStorage({ [KEY]: v2 });
    assert.equal(B.restoreSnapshot({ raw: "{broken", mode: "replace" }).error, "unreadable-source");
    assert.equal(B.restoreSnapshot({ raw: "{}", mode: "replace" }).error, "empty-source");
    assert.equal(B.restoreSnapshot({ raw: v1, mode: "wipe" }).error, "invalid-mode");
    assert.equal(store.getItem(KEY), v2);
  });

  test("unreadable current data: its recovery copy exists before it is replaced", () => {
    const store = installStorage({ [KEY]: "{broken" });
    const res = B.restoreSnapshot({ raw: v1, mode: "replace" });
    assert.equal(res.ok, true);
    assert.equal(store.getItem(res.recoveryKey), "{broken");
    assert.equal(recoveryValues(store).filter((v) => v === "{broken").length, 1, "no duplicate copies");
  });

  test("recovery copy cannot be written (quota): nothing is overwritten", () => {
    const store = installStorage({ [KEY]: v2 }, { failSetFor: (k) => k.startsWith("mp:recovery:") });
    const res = B.restoreSnapshot({ raw: v1, mode: "replace" });
    assert.deepEqual([res.ok, res.error, res.reason], [false, "recovery-failed", "quota"]);
    assert.equal(store.getItem(KEY), v2);
    assert.match(B.storageErrorMessage(res), /brak miejsca/);
  });

  test("backup or data write fails after the recovery copy: data intact, copy kept", () => {
    for (const failing of [BK, KEY]) {
      const store = installStorage({ [KEY]: v2 }, { failSetFor: (k) => k === failing });
      const res = B.restoreSnapshot({ raw: v1, mode: "replace" });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "quota");
      assert.equal(store.getItem(KEY), v2);
      assert.equal(store.getItem(res.recoveryKey), v2);
      noRemovals(store);
    }
  });

  test("fresh install: restore needs no recovery copy", () => {
    const store = installStorage({});
    const res = B.restoreSnapshot({ raw: v1, mode: "replace" });
    assert.equal(res.ok, true);
    assert.equal(res.recoveryKey, null);
    assert.equal(store.getItem(KEY), v1);
  });

  test("legacy data shown to the user is the merge base; the legacy key is untouched", () => {
    const legacy = JSON.stringify({ Stare: [p("tree", "drzewo")] });
    const store = installStorage({ wordFolders: legacy });
    B.restoreSnapshot({ raw: v1, mode: "merge" });
    assert.deepEqual(Object.keys(JSON.parse(store.getItem(KEY))).sort(), ["Moje", "Stare"]);
    assert.equal(store.getItem("wordFolders"), legacy);
  });

  test("blocked storage: restore reports unavailable", () => {
    installThrowingStorage();
    assert.equal(B.restoreSnapshot({ raw: v1, mode: "merge" }).error, "unavailable");
  });

  test("repeated restores never delete recovery copies", () => {
    const store = installStorage({ [KEY]: v2 });
    B.restoreSnapshot({ raw: v1, mode: "replace" });
    B.restoreSnapshot({ raw: v2, mode: "replace" });
    B.restoreSnapshot({ raw: JSON.stringify({ C: [] }), mode: "replace" });
    assert.deepEqual(recoveryValues(store).sort(), [v1, v2].sort(), "each distinct previous value kept once");
    noRemovals(store);
  });
});

describe("storage quota", () => {
  test("a full storage is reported as quota, and the save changes nothing", () => {
    const store = installStorage({ [KEY]: v1 }, { quotaBytes: v1.length + KEY.length + 5 });
    const res = S.updateFolders((f) => S.mergePairs(f, "Moje", [p("moon", "księżyc")]));
    assert.deepEqual([res.ok, res.reason], [false, "quota"]);
    assert.equal(store.getItem(KEY), v1);
    assert.match(B.storageErrorMessage(res), /^Nie udało się zapisać — brak miejsca.*Wyeksportuj/);
  });

  test("export still works when storage is full (read-only)", () => {
    installStorage({ [KEY]: v1 }, { failSetFor: "all" });
    const cur = B.listSnapshots().find((s) => s.kind === "current");
    assert.equal(B.parseImport(B.createExport({ raw: cur.raw, source: cur.key }).text).raw, v1);
  });

  test("every error has an understandable message", () => {
    for (const error of ["unavailable", "conflict", "backup-failed", "recovery-failed", "write-failed", "source-changed",
      "unreadable-source", "empty-source", "not-json", "invalid-format", "unsupported-version", "no-vocabulary", "too-large", "???"]) {
      assert.ok(B.storageErrorMessage({ error }).length > 20, error);
    }
  });
});
