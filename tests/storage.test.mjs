// Regression tests for src/lib/storage.js (run: npm test).
// "Page mount" below mirrors what Game/Storage pages do on load:
//   ensureDefaults(loadFolders())
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage, installThrowingStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";

const KEY = "wordFolders_v2";
const mount = () => S.ensureDefaults(S.loadFolders());
const pairs = (n, p = "w") => Array.from({ length: n }, (_, i) => ({ known: `${p}${i}`, learn: `s${i}` }));
// Any key other than `except` whose value contains `needle` (backup/recovery copy).
const copyOf = (store, needle, except = KEY) =>
  [...store.map].find(([k, v]) => k !== except && v.includes(needle))?.[0] ?? null;

describe("data-loss scenarios (must never delete or overwrite stored vocabulary)", () => {
  test("malformed JSON: original value kept byte-for-byte and a recovery copy is made", () => {
    const raw = '{"Animals":[{"known":"cat","learn":"kot"}';
    const store = installStorage({ [KEY]: raw });
    mount();
    assert.equal(store.getItem(KEY), raw, "stored value must be untouched");
    assert.ok(copyOf(store, raw), "raw value must be copied to a recovery key");
  });

  test("one invalid pair: the other 50 valid pairs are preserved", () => {
    const data = { Animals: [...pairs(50), { known: "x", learn: 5 }] };
    const raw = JSON.stringify(data);
    const store = installStorage({ [KEY]: raw });
    const folders = mount();
    assert.equal(folders.Animals?.length, 50, "valid pairs must be returned");
    assert.deepEqual(folders.Animals, pairs(50));
    assert.equal(store.getItem(KEY), raw, "stored value must be untouched on load");
    assert.ok(copyOf(store, '"learn":5'), "invalid entry must be preserved in a recovery key");
  });

  test("one invalid folder (not an array): other folders preserved", () => {
    const raw = JSON.stringify({ Good: pairs(3), Broken: "oops" });
    const store = installStorage({ [KEY]: raw });
    const folders = mount();
    assert.deepEqual(folders.Good, pairs(3));
    assert.equal(store.getItem(KEY), raw);
  });

  for (const [label, raw] of [["array", "[]"], ["null", "null"], ["number", "42"], ["string", '"text"']]) {
    test(`non-object root (${label}): original value kept`, () => {
      const store = installStorage({ [KEY]: raw });
      mount();
      assert.equal(store.getItem(KEY), raw);
    });
  }

  test("sample data is never written over existing (even unreadable) vocabulary", () => {
    for (const raw of ["{broken", "[]", JSON.stringify({ A: [{ known: 1, learn: 2 }] })]) {
      const store = installStorage({ [KEY]: raw });
      mount();
      assert.ok(!store.getItem(KEY).includes("Przykład"), `sample written over ${raw}`);
    }
  });

  test("fresh install: sample folder is shown but loading writes nothing", () => {
    const store = installStorage({});
    const folders = mount();
    assert.ok(folders["Przykład"]?.length > 0, "UI still gets the example folder");
    assert.deepEqual(store.writes, [], "page load must not write");
  });

  test("valid data: loading performs zero writes", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ A: pairs(2) }) });
    mount();
    assert.deepEqual(store.writes, []);
  });
});

describe("keys that may belong to other apps on the shared github.io origin", () => {
  test('generic "folders" key is neither adopted nor deleted', () => {
    const foreign = JSON.stringify({ inbox: [{ known: "a", learn: "b" }] });
    const store = installStorage({ folders: foreign });
    const folders = mount();
    assert.equal(store.getItem("folders"), foreign, "foreign key must be untouched");
    assert.equal(folders.inbox, undefined, "foreign data must not be adopted");
  });

  test('empty-object "folders" key is not deleted', () => {
    const store = installStorage({ folders: "{}" });
    mount();
    assert.equal(store.getItem("folders"), "{}");
  });

  for (const legacy of ["wordFolders", "matchbox-folders"]) {
    test(`legacy "${legacy}" is copied (not moved): legacy key preserved`, () => {
      const raw = JSON.stringify({ Old: pairs(2) });
      const store = installStorage({ [legacy]: raw });
      const folders = mount();
      assert.deepEqual(folders.Old, pairs(2), "legacy data must be available");
      assert.equal(store.getItem(legacy), raw, "legacy key must not be deleted");
    });
  }

  test("other keys on the origin are never removed", () => {
    const store = installStorage({ contacts: "[1,2]", feedback: '{"good":1}', [KEY]: "{broken" });
    mount();
    S.saveFolders({ A: pairs(1) });
    assert.equal(store.getItem("contacts"), "[1,2]");
    assert.equal(store.getItem("feedback"), '{"good":1}');
    assert.ok(!store.writes.some((w) => w.op === "clear"), "must never call clear()");
  });
});

describe("write failures are reported", () => {
  test("saveFolders reports failure when storage is full", () => {
    const raw = JSON.stringify({ A: pairs(1) });
    const store = installStorage({ [KEY]: raw }, { failSetFor: "all" });
    const res = S.saveFolders({ A: pairs(2) });
    assert.equal(res?.ok, false, "must return { ok: false }");
    assert.equal(store.getItem(KEY), raw, "previous data kept");
  });

  test("mergePairsIntoFolder reports saved:false when the write fails", () => {
    installStorage({ [KEY]: JSON.stringify({ A: [] }) }, { failSetFor: "all" });
    const res = S.mergePairsIntoFolder({ A: [] }, "A", [{ known: "cat", learn: "kot" }]);
    assert.equal(res.saved, false);
    assert.equal(res.added, 1);
  });

  test("save is refused (not silently unprotected) when the backup cannot be written", () => {
    const raw = JSON.stringify({ A: pairs(1) });
    const store = installStorage({ [KEY]: raw }, { failSetFor: (k) => k !== KEY });
    const res = S.saveFolders({ A: pairs(3) });
    assert.equal(res?.ok, false);
    assert.equal(store.getItem(KEY), raw);
  });

  test("blocked storage (access throws): no crash, empty result, save reports failure", () => {
    installThrowingStorage();
    assert.doesNotThrow(() => mount());
    assert.equal(S.saveFolders({ A: pairs(1) })?.ok, false);
  });
});

describe("backup and recovery", () => {
  test("saveFolders keeps the previous value in a backup key", () => {
    const first = JSON.stringify({ A: pairs(1) });
    const store = installStorage({ [KEY]: first });
    assert.equal(S.saveFolders({ A: pairs(2) })?.ok, true);
    assert.equal(store.getItem(S.BACKUP_KEY), first);
    assert.deepEqual(JSON.parse(store.getItem(KEY)), { A: pairs(2) });
  });

  test("saving after an unreadable load keeps the original in recovery (never lost)", () => {
    const raw = "{broken";
    const store = installStorage({ [KEY]: raw });
    mount();
    S.saveFolders({ A: pairs(1) });
    S.saveFolders({ A: pairs(2) }); // second save rotates the backup slot
    assert.ok(copyOf(store, raw), "original corrupt value must still exist somewhere");
  });

  test("recovery copy is not duplicated on every page load", () => {
    const store = installStorage({ [KEY]: "{broken" });
    mount();
    mount();
    mount();
    assert.equal(S.listRecoveryKeys().length, 1);
    assert.equal(store.writes.filter((w) => w.op === "set").length, 1);
  });

  test("loadFoldersWithStatus explains what happened", () => {
    installStorage({ [KEY]: JSON.stringify({ A: [...pairs(2), { known: 1 }] }) });
    const r = S.loadFoldersWithStatus();
    assert.equal(r.status, "partial");
    assert.equal(r.skipped, 1);
    assert.ok(r.recoveryKey);
    installStorage({ [KEY]: "{broken" });
    assert.equal(S.loadFoldersWithStatus().status, "unreadable");
    installStorage({});
    assert.equal(S.loadFoldersWithStatus().status, "empty");
    installStorage({ [KEY]: JSON.stringify({ A: pairs(1) }) });
    assert.equal(S.loadFoldersWithStatus().status, "ok");
  });
});

describe("backwards compatibility", () => {
  test("existing valid vocabulary round-trips unchanged (order, extra fields)", () => {
    const data = { Zoo: [{ known: "cat", learn: "kot", id: "u1", ease: 2.5 }], Alpha: pairs(3) };
    const store = installStorage({ [KEY]: JSON.stringify(data) });
    const folders = S.loadFolders();
    assert.deepEqual(folders, data);
    assert.equal(S.saveFolders(folders)?.ok, true);
    assert.deepEqual(JSON.parse(store.getItem(KEY)), data);
  });

  test("mergePairsIntoFolder: case-insensitive, trimmed de-duplication", () => {
    installStorage({});
    const res = S.mergePairsIntoFolder({ A: [{ known: "Cat", learn: "Kot" }] }, "A", [
      { known: " cat ", learn: "kot" },
      { known: "dog", learn: " pies " },
      { known: "", learn: "x" },
    ]);
    assert.equal(res.added, 1);
    assert.deepEqual(res.folders.A, [{ known: "Cat", learn: "Kot" }, { known: "dog", learn: "pies" }]);
  });

  test("ensureDefaults keeps non-empty input as-is", () => {
    installStorage({});
    const f = { Mine: pairs(1) };
    assert.equal(S.ensureDefaults(f), f);
  });

  test("getFolderNames sorts; last folder / pairs preferences round-trip", () => {
    installStorage({});
    assert.deepEqual(S.getFolderNames({ b: [], a: [] }), ["a", "b"]);
    S.setLastFolder("Zwierzęta");
    S.setLastPairs(6);
    assert.equal(S.getLastFolder(), "Zwierzęta");
    assert.equal(S.getLastPairs(), 6);
    installStorage({ mp_last_pairs: "abc" });
    assert.equal(S.getLastPairs(), null);
  });
});
