// FIX 007: a confirmed "replace" restore must not be undone by another tab
// that still remembers words it wrote before the restore.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers/fake-storage.mjs";
import * as S from "../src/lib/storage.js";
import * as B from "../src/lib/backup.js";

const KEY = "wordFolders_v2";
const p = (known, learn) => ({ known, learn });
const words = (store) => Object.values(JSON.parse(store.getItem(KEY))).flat().map((x) => x.known).sort();

// Storage-page state of one tab: what it loaded, wrote, and which restore generation it saw.
function openTab() {
  const loaded = S.loadFoldersWithStatus();
  const tab = { revision: loaded.raw, mine: null, epoch: loaded.epoch, notes: [] };
  tab.add = (folder, pairs) => {
    const res = S.updateFolders((f) => S.mergePairs(f, folder, pairs), { expected: tab.revision, mine: tab.mine, epoch: tab.epoch });
    if (res.ok) Object.assign(tab, { revision: res.raw, mine: res.raw, epoch: res.epoch });
    return res;
  };
  // what the page does on a "storage" event
  tab.onChange = () => {
    const rec = S.reconcileLostWrite(tab.mine, { epoch: tab.epoch });
    if (rec.superseded) tab.notes.push("superseded");
    if (rec.ok && rec.restored > 0) tab.mine = rec.raw;
    if (rec.superseded) tab.mine = null;
    const now = S.loadFoldersWithStatus();
    Object.assign(tab, { revision: now.raw, epoch: now.epoch });
    return rec;
  };
  return tab;
}

function scenario() {
  const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("sun", "słońce")] }) });
  const b = openTab();
  b.add("Moje", [p("old1", "x"), p("old2", "y")]); // tab B's words, later judged obsolete
  const a = openTab();
  const snapshot = JSON.stringify({ Moje: [p("sun", "słońce")], Nowe: [p("fresh", "z")] });
  const res = B.restoreSnapshot({ raw: snapshot, mode: "replace" });
  assert.equal(res.ok, true);
  return { store, a, b, snapshot, res };
}

describe("replace restore vs. an older tab", () => {
  test("the older tab's change handler does not bring back replaced words", () => {
    const { store, b } = scenario();
    const rec = b.onChange();
    assert.equal(rec.restored, 0);
    assert.equal(rec.superseded, true, "the tab is told its data was superseded by a restore");
    assert.deepEqual(words(store), ["fresh", "sun"]);
  });

  test("an explicit save from the older tab keeps its new word only", () => {
    const { store, b } = scenario();
    const res = b.add("Moje", [p("new", "n")]); // tab missed the event entirely
    assert.equal(res.ok, true);
    assert.equal(res.superseded, true);
    assert.equal(res.restored, 0);
    assert.deepEqual(words(store), ["fresh", "new", "sun"]);
  });

  test("replaced words are not lost: they are in the recovery copy made by the restore", () => {
    const { store, res } = scenario();
    assert.deepEqual(Object.values(JSON.parse(store.getItem(res.recoveryKey))).flat().map((x) => x.known).sort(), ["old1", "old2", "sun"]);
  });

  test("after adopting the new generation, normal cross-tab repair works again", () => {
    const { store, b } = scenario();
    b.onChange();
    b.add("Moje", [p("b1", "x")]);
    const overwritten = JSON.parse(store.getItem(KEY));
    overwritten.Moje = overwritten.Moje.filter((x) => x.known !== "b1");
    store.setItem(KEY, JSON.stringify(overwritten)); // another tab's racing write dropped b1
    assert.equal(b.onChange().restored, 1);
    assert.ok(words(store).includes("b1"));
  });

  test("a tab opened after the restore is not treated as outdated", () => {
    const { store } = scenario();
    const c = openTab();
    const res = c.add("Moje", [p("c1", "x")]);
    assert.equal(res.superseded, false);
    assert.deepEqual(words(store), ["c1", "fresh", "sun"]);
  });

  test("merge restore keeps the generation: other tabs keep their repair ability", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [] }) });
    const b = openTab();
    b.add("Moje", [p("b1", "x")]);
    assert.equal(B.restoreSnapshot({ raw: JSON.stringify({ Inne: [p("i", "j")] }), mode: "merge" }).ok, true);
    const rec = b.onChange();
    assert.equal(rec.superseded, undefined);
    assert.deepEqual(words(store), ["b1", "i"]);
  });

  test("the generation marker is written before the data (refused if it cannot be written)", () => {
    const store = installStorage({ [KEY]: JSON.stringify({ Moje: [p("a", "b")] }) }, { failSetFor: (k) => k === S.EPOCH_KEY });
    const res = B.restoreSnapshot({ raw: JSON.stringify({ X: [] }), mode: "replace" });
    assert.equal(res.ok, false);
    assert.equal(res.error, "epoch-failed");
    assert.deepEqual(JSON.parse(store.getItem(KEY)), { Moje: [p("a", "b")] });
  });

  test("the generation marker is not listed as a copy and is counted as app data", () => {
    const { store } = scenario();
    assert.ok(store.getItem(S.EPOCH_KEY));
    assert.ok(!B.listSnapshots().some((s) => s.key === S.EPOCH_KEY));
  });
});
