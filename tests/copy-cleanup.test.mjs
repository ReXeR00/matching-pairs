// FIX 007: manual cleanup of backup / recovery copies.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage, installThrowingStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";
import * as B from "../src/lib/backup.js";

const KEY = "wordFolders_v2";
const BK = "mp:backup:wordFolders_v2";
const REC = "mp:recovery:wordFolders_v2:2026-01-01T10:00:00.000Z";
const v1 = JSON.stringify({ Moje: [{ known: "sun", learn: "słońce" }] });
const v2 = JSON.stringify({ Moje: [], Kolory: [] });
const seed = () => installStorage({ [KEY]: v2, [BK]: v1, [REC]: "{broken", wordFolders: v1, folders: "{}", [S.EPOCH_KEY]: "e1" });

describe("deleting copies", () => {
  test("a recovery copy is removed only when its content matches what the user saw", () => {
    const store = seed();
    assert.equal(B.deleteSnapshot({ key: REC, raw: "different" }).error, "source-changed");
    assert.equal(store.getItem(REC), "{broken");
    const res = B.deleteSnapshot({ key: REC, raw: "{broken" });
    assert.deepEqual(res, { ok: true, freedChars: REC.length + 7 });
    assert.equal(store.getItem(REC), null);
  });

  test("the backup copy can be removed; the vocabulary itself never changes", () => {
    const store = seed();
    assert.equal(B.deleteSnapshot({ key: BK, raw: v1 }).ok, true);
    assert.equal(store.getItem(KEY), v2);
  });

  test("the active vocabulary, legacy data, other sites' keys and the generation marker are protected", () => {
    const store = seed();
    for (const key of [KEY, "wordFolders", "matchbox-folders", "folders", "contacts", S.EPOCH_KEY, "mp_theme", "mp:recovery", "", null]) {
      assert.equal(B.deleteSnapshot({ key, raw: store.getItem(key) }).error, "protected-key", String(key));
    }
    assert.equal(S.removeCopy(KEY), false);
    assert.deepEqual(store.writes.filter((w) => w.op !== "set"), [], "nothing removed");
  });

  test("only the requested key is removed (never clear())", () => {
    const store = seed();
    const before = Object.keys(store.snapshot()).sort();
    B.deleteSnapshot({ key: REC, raw: "{broken" });
    assert.deepEqual(store.writes.filter((w) => w.op !== "set"), [{ op: "remove", key: REC }]);
    assert.deepEqual(Object.keys(store.snapshot()).sort(), before.filter((k) => k !== REC));
  });

  test("nothing is ever deleted automatically: load, save, restore and listing only add keys", () => {
    const store = seed();
    S.loadFoldersWithStatus();
    S.updateFolders((f) => S.ensureFolder(f, "Nowy"));
    B.listSnapshots();
    B.restoreSnapshot({ raw: v1, mode: "replace" });
    B.restoreSnapshot({ raw: v2, mode: "merge" });
    assert.ok(store.writes.every((w) => w.op === "set"));
  });

  test("blocked storage: deletion fails safely", () => {
    installThrowingStorage();
    assert.equal(B.deleteSnapshot({ key: REC, raw: "{broken" }).error, "source-changed");
    assert.equal(S.removeCopy(REC), false);
  });

  test("a failing removeItem is reported", () => {
    const store = seed();
    store.removeItem = () => { throw new Error("denied"); };
    assert.equal(B.deleteSnapshot({ key: REC, raw: "{broken" }).error, "delete-failed");
  });

  test("after deleting the recovery copy of unreadable data, a save makes a new copy first", () => {
    const store = installStorage({ [KEY]: "{broken" });
    S.loadFoldersWithStatus();
    const [rec] = S.listRecoveryKeys();
    assert.equal(B.deleteSnapshot({ key: rec, raw: "{broken" }).ok, true);
    assert.equal(S.updateFolders((f) => S.ensureFolder(f, "A")).ok, true);
    assert.ok([...store.map.values()].includes("{broken"), "unreadable original still preserved before overwrite");
  });

  test("messages exist for cleanup errors", () => {
    for (const error of ["protected-key", "delete-failed", "epoch-failed"]) {
      assert.notEqual(B.storageErrorMessage({ error }), B.storageErrorMessage({ error: "write-failed" }), error);
    }
  });
});
