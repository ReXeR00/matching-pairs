// FIX 006: folder names that are also JavaScript property names
// ("constructor", "toString", "__proto__", ...) are ordinary folders.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";

const KEY = "wordFolders_v2";
const RESERVED = ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", "__defineGetter__"];
const p = (known, learn) => ({ known, learn });
const storedRaw = (store) => store.getItem(KEY);
// Own keys of the stored JSON, read without going through a plain object.
const storedNames = (store) => [...storedRaw(store).matchAll(/"((?:[^"\\]|\\.)*)":\[/g)].map((m) => m[1]);

describe("reserved property names as folder names", () => {
  for (const name of RESERVED) {
    test(`"${name}": create, add words, reload — nothing disappears`, () => {
      const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("sun", "słońce")] }) });
      assert.equal(S.updateFolders((f) => S.ensureFolder(f, name)).ok, true);
      const res = S.updateFolders((f) => S.mergePairs(f, name, [p("cat", "kot")]));
      assert.equal(res.ok, true);
      assert.equal(res.result.added, 1);

      const loaded = S.loadFoldersWithStatus();
      assert.equal(loaded.status, "ok");
      assert.deepEqual(S.getFolderNames(loaded.folders), ["Moje", name].sort((a, b) => a.localeCompare(b)));
      assert.deepEqual(S.getFolderPairs(loaded.folders, name), [p("cat", "kot")]);
      assert.deepEqual(S.getFolderPairs(loaded.folders, "Moje"), [p("sun", "słońce")]);
      assert.deepEqual(storedNames(store).sort(), ["Moje", name].sort());
      assert.equal(Object.getPrototypeOf(loaded.folders), Object.prototype, "folders object keeps a normal prototype");
    });
  }

  test("inherited properties are never treated as existing folders", () => {
    const folders = {};
    for (const name of RESERVED) assert.equal(S.getFolderPairs(folders, name), undefined, name);
    S.ensureFolder(folders, "toString");
    assert.deepEqual(folders.toString, []);
    assert.deepEqual(Object.keys(folders), ["toString"]);
  });

  test('stored "__proto__" folder loads as ok and survives an unrelated save', () => {
    const raw = '{"__proto__":[{"known":"p","learn":"q"}],"B":[]}';
    const store = installStorage({ [KEY]: raw });
    const loaded = S.loadFoldersWithStatus();
    assert.equal(loaded.status, "ok");
    assert.deepEqual(S.getFolderNames(loaded.folders), ["__proto__", "B"]);
    S.updateFolders((f) => S.mergePairs(f, "B", [p("x", "y")]));
    assert.match(storedRaw(store), /"__proto__":\[\{"known":"p","learn":"q"\}\]/);
    assert.equal(S.getFolderPairs(S.loadFolders(), "B").length, 1);
  });

  test("no prototype pollution from stored data", () => {
    for (const raw of ['{"__proto__":{"polluted":1},"A":[]}', '{"__proto__":[{"known":"a","learn":"b","polluted":1}]}', '{"constructor":{"prototype":{"polluted":1}}}']) {
      installStorage({ [KEY]: raw });
      const loaded = S.loadFoldersWithStatus();
      S.updateFolders((f) => S.ensureFolder(f, "Z"));
      assert.equal({}.polluted, undefined, raw);
      assert.equal(Object.prototype.polluted, undefined, raw);
      assert.ok(["ok", "partial"].includes(loaded.status));
    }
  });

  test("cross-tab repair and merge keep reserved-name folders", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ A: [] }) });
    const mine = S.updateFolders((f) => S.mergePairs(f, "__proto__", [p("a", "b")])).raw;
    store.setItem(KEY, JSON.stringify({ A: [p("x", "y")] })); // other tab dropped it
    assert.equal(S.reconcileLostWrite(mine).restored, 1);
    assert.deepEqual(storedNames(store).sort(), ["A", "__proto__"]);
    const target = {};
    S.mergeFolders(target, JSON.parse('{"constructor":[{"known":"c","learn":"d"}]}'));
    assert.deepEqual(S.getFolderPairs(target, "constructor"), [p("c", "d")]);
  });

  test("legacy mergePairsIntoFolder also accepts reserved names", () => {
    const store = installStorage({});
    const res = S.mergePairsIntoFolder({}, "constructor", [p("a", "b")]);
    assert.equal(res.saved, true);
    assert.equal(storedRaw(store), '{"constructor":[{"known":"a","learn":"b"}]}');
  });
});
