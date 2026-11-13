// FIX 008 Part B: a save made in one tab while another tab performs a
// confirmed "replace" restore. Uses a deterministic multi-tab storage model
// (per-tab caches, explicit delivery order) to enumerate every interleaving.
//
// Expected semantics:
// - words the restoring tab saw (its "replaced" snapshot) are deliberately
//   replaced: they leave the vocabulary but stay in a recovery copy;
// - a word saved concurrently that the restoring tab did NOT see is a new
//   write: it must end up in the vocabulary (never silently discarded);
// - restored words must not be silently undone by a stale writer;
// - no acknowledged word is ever lost from storage altogether.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { StorageHub } from "./helpers/multi-tab-storage.mjs";
import * as S from "../src/lib/storage.js";
import * as B from "../src/lib/backup.js";

const KEY = "wordFolders_v2";
const p = (known, learn = known + "-pl") => ({ known, learn });
const wordsOf = (raw) => {
  try {
    return Object.values(JSON.parse(raw)).flat().map((x) => x.known);
  } catch {
    return [];
  }
};
const SNAPSHOT = JSON.stringify({ Moje: [p("sun")], Nowe: [p("fresh")] });

// A "Moje słówka" page in a tab: remembers what it wrote and in which generation.
function storagePage(hub, tab) {
  const page = { mine: null, epoch: null, notes: [] };
  hub.as(tab, () => {
    page.epoch = S.loadFoldersWithStatus().epoch;
  });
  page.save = (word) =>
    hub.as(tab, () => {
      const res = S.updateFolders((f) => S.mergePairs(f, "Moje", [p(word)]), { mine: page.mine, epoch: page.epoch });
      assert.equal(res.ok, true, `save of ${word} acknowledged`);
      page.mine = res.raw;
      page.epoch = res.epoch;
      return res;
    });
  // what Storage.jsx does on "storage" events
  page.onEvents = (events) => {
    const rec = S.reconcileLostWrite(page.mine, { epoch: page.epoch });
    S.repairAfterRestore({ seen: seenValues(events) });
    if (rec.raw) page.mine = rec.raw;
    if (rec.superseded) page.notes.push(rec.restored ? "superseded+kept" : "superseded");
    if (rec.epoch !== undefined) page.epoch = rec.epoch;
    if (rec.superseded && !rec.raw) page.mine = null;
  };
  return page;
}

const seenValues = (events) => events.filter((e) => e.key === KEY).map((e) => e.newValue);
// Settings page (the one that restored): repairs on "storage" events.
const settingsPage = () => (events) => S.repairAfterRestore?.({ seen: seenValues(events) });

function setup({ bListens = true, aListens = true } = {}) {
  const hub = new StorageHub({ [KEY]: JSON.stringify({ Moje: [p("sun")] }) });
  const tabA = hub.open("A");
  const tabB = hub.open("B");
  const pageB = storagePage(hub, tabB);
  pageB.save("old1"); // earlier, fully delivered save from tab B
  hub.deliver();
  tabA.events = [];
  tabB.events = [];
  const handlers = new Map();
  if (bListens) handlers.set(tabB, pageB.onEvents);
  if (aListens) handlers.set(tabA, settingsPage());
  const restore = () =>
    hub.as(tabA, () => {
      const res = B.restoreSnapshot({ raw: SNAPSHOT, mode: "replace" });
      assert.equal(res.ok, true, "restore acknowledged");
      return res;
    });
  return { hub, tabA, tabB, pageB, handlers, restore };
}

// Every word ever acknowledged must still exist somewhere in storage.
function assertNothingLost(hub, acknowledged) {
  const everywhere = new Set(hub.keys().flatMap((k) => wordsOf(hub.get(k))));
  for (const w of acknowledged) assert.ok(everywhere.has(w), `"${w}" must not vanish from storage`);
}

describe("restore vs. concurrent save: every delivery order", () => {
  test("sequential: the restoring tab saw the save -> the word is deliberately replaced (kept in a copy)", () => {
    const { hub, pageB, handlers, restore } = setup();
    pageB.save("new1");
    hub.deliver(); // the restoring tab sees new1 before it restores
    restore();
    hub.settle(handlers);
    assert.deepEqual(wordsOf(hub.get(KEY)).sort(), ["fresh", "sun"]);
    assertNothingLost(hub, ["sun", "old1", "new1", "fresh"]);
  });

  test("sequential: save after the restore was seen -> kept", () => {
    const { hub, pageB, handlers, restore } = setup();
    restore();
    hub.settle(handlers);
    pageB.save("new1");
    hub.settle(handlers);
    assert.deepEqual(wordsOf(hub.get(KEY)).sort(), ["fresh", "new1", "sun"]);
  });

  for (const listening of [true, false]) {
    test(`concurrent (neither tab saw the other), all orders — tab B ${listening ? "listening" : "deaf until its next save"}`, () => {
      const orders = [];
      {
        const probe = setup();
        probe.pageB.save("new1");
        const bWrites = probe.hub.queue.length;
        probe.restore();
        const total = probe.hub.queue.length;
        const aWrites = total - bWrites;
        // B's writes stay in order as one block; A's too; B's block at every position
        for (let pos = 0; pos <= aWrites; pos++) {
          const a = Array.from({ length: aWrites }, (_, i) => bWrites + i);
          const b = Array.from({ length: bWrites }, (_, i) => i);
          orders.push([...a.slice(0, pos), ...b, ...a.slice(pos)]);
        }
      }
      for (const order of orders) {
        const { hub, pageB, handlers, restore } = setup({ bListens: listening });
        pageB.save("new1");
        restore();
        hub.deliver(order);
        hub.settle(handlers);
        if (!listening) {
          pageB.save("new2"); // its next save must also repair the situation
          hub.settle(handlers);
        }
        const now = wordsOf(hub.get(KEY)).sort();
        const label = `order ${order.join(",")}`;
        assert.ok(now.includes("new1"), `${label}: concurrent save new1 kept (got ${now})`);
        assert.ok(now.includes("fresh") && now.includes("sun"), `${label}: restored words present (got ${now})`);
        assert.ok(!now.includes("old1"), `${label}: deliberately replaced word not reintroduced (got ${now})`);
        if (!listening) assert.ok(now.includes("new2"), `${label}: later save kept`);
        assertNothingLost(hub, ["sun", "old1", "new1", "fresh"]);
      }
    });
  }

  test("the saving tab closes right after saving (never handles events): the word is still kept, all orders", () => {
    const probe = setup({ bListens: false });
    probe.pageB.save("new1");
    const nb = probe.hub.queue.length;
    probe.restore();
    const na = probe.hub.queue.length - nb;
    for (let pos = 0; pos <= na; pos++) {
      const { hub, pageB, handlers, restore } = setup({ bListens: false });
      pageB.save("new1");
      restore();
      const a = Array.from({ length: na }, (_, i) => nb + i);
      const b = Array.from({ length: nb }, (_, i) => i);
      hub.deliver([...a.slice(0, pos), ...b, ...a.slice(pos)]);
      hub.settle(handlers);
      const now = wordsOf(hub.get(KEY)).sort();
      assert.deepEqual(now, ["fresh", "new1", "sun"], `B's writes after ${pos} of A's writes`);
    }
  });

  test("stale writer lands last and nobody saves again: the restoring tab repairs it", () => {
    const { hub, pageB, handlers, restore } = setup({ bListens: false });
    pageB.save("new1");
    const b = hub.queue.length;
    restore();
    const order = [...Array.from({ length: hub.queue.length - b }, (_, i) => b + i), ...Array.from({ length: b }, (_, i) => i)];
    hub.deliver(order);
    hub.settle(handlers);
    const now = wordsOf(hub.get(KEY)).sort();
    assert.deepEqual(now, ["fresh", "new1", "sun"]);
    assertNothingLost(hub, ["sun", "old1", "new1", "fresh"]);
  });

  test("the overwritten stale value is preserved before it is repaired", () => {
    const { hub, pageB, handlers, restore } = setup({ bListens: false });
    pageB.save("new1");
    const staleRaw = hub.tabs[1].getItem(KEY);
    const b = hub.queue.length;
    restore();
    hub.deliver([...Array.from({ length: hub.queue.length - b }, (_, i) => b + i), ...Array.from({ length: b }, (_, i) => i)]);
    hub.settle(handlers);
    assert.ok(hub.keys().some((k) => k.startsWith("mp:recovery:") && hub.get(k) === staleRaw));
  });

  test("a later legitimate save of a replaced word is not removed again", () => {
    const { hub, pageB, handlers, restore } = setup();
    restore();
    hub.settle(handlers);
    pageB.save("old1"); // the user types it again on purpose after the restore
    hub.settle(handlers);
    assert.ok(wordsOf(hub.get(KEY)).includes("old1"));
  });

  test("merge restores never trigger repairs", () => {
    const hub = new StorageHub({ [KEY]: JSON.stringify({ Moje: [p("sun")] }) });
    const a = hub.open("A");
    hub.as(a, () => B.restoreSnapshot({ raw: SNAPSHOT, mode: "merge" }));
    hub.deliver();
    const before = hub.queue.length;
    hub.as(a, () => assert.deepEqual(S.repairAfterRestore(), { ok: true, repaired: 0, rescued: 0 }));
    assert.equal(hub.queue.length, before);
  });
});

describe("lost-write rescue without any restore", () => {
  test("two tabs overwrite each other and both close; a third open tab re-adds the lost word", () => {
    const hub = new StorageHub({ [KEY]: JSON.stringify({ Moje: [p("sun")] }) });
    const [a, b, c] = ["A", "B", "C"].map((n) => hub.open(n));
    const save = (tab, word) => hub.as(tab, () => S.updateFolders((f) => S.mergePairs(f, "Moje", [p(word)])));
    save(a, "a1");
    save(b, "b1"); // neither saw the other: the later delivery drops one word
    hub.settle(new Map([[c, (events) => S.repairAfterRestore({ seen: seenValues(events) })]]));
    assert.deepEqual(wordsOf(hub.get(KEY)).sort(), ["a1", "b1", "sun"]);
  });
});

describe("copies used by the latest restore", () => {
  test("cannot be deleted while they protect concurrent saves", () => {
    const hub = new StorageHub({ [KEY]: JSON.stringify({ Moje: [p("sun")] }) });
    const a = hub.open("A");
    hub.as(a, () => {
      const res = B.restoreSnapshot({ raw: SNAPSHOT, mode: "replace" });
      const gen = S.readGeneration(S.readGenerationRaw());
      for (const key of [gen.replaced, gen.restored]) {
        assert.equal(B.deleteSnapshot({ key, raw: a.getItem(key) }).error, "copy-in-use");
      }
      assert.equal(gen.replaced, res.recoveryKey);
    });
  });
});
