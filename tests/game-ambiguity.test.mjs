// FIX 009: pairs whose visible text repeats (same source word, same
// translation, or the same pair written slightly differently).
// The board must never show two clickable cards in one column that look the
// same, so a correct-looking combination can never be scored as wrong.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/lib/gameEngine.js";

const seeded = (seed = 1) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const look = (w) => String(w).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();

const SAME_SOURCE = [
  { known: "bank", learn: "brzeg" },
  { known: "bank", learn: "bank (finanse)" },
  { known: "sun", learn: "słońce" },
  { known: "moon", learn: "księżyc" },
];
const SAME_TRANSLATION = [
  { known: "shore", learn: "brzeg" },
  { known: "bank", learn: "brzeg" },
  { known: "edge", learn: "Brzeg " },
  { known: "sun", learn: "słońce" },
];
const DUPLICATES = [
  { known: "cat", learn: "kot" },
  { known: " Cat", learn: "kot" },
  { known: "cat", learn: "kot  " },
  { known: "dog", learn: "pies" },
];

function play(pairs, { seed = 1, count = 99 } = {}) {
  const env = { now: 0, rng: seeded(seed) };
  let state = G.createIdleState();
  const timers = [];
  const run = (action) => {
    const res = G.step(state, action, env);
    state = res.state;
    for (const fx of res.effects) if (fx.type === "timer") timers.push(fx.action);
  };
  run({ type: "start", pairs, count });
  return {
    get state() { return state; },
    run,
    flush() { while (timers.length) run(timers.shift()); },
    timers,
  };
}

// no two clickable cards in one column look the same
function assertUnambiguous(s, msg) {
  for (const side of ["left", "right"]) {
    const visible = s[side].filter((c) => !s.removing[c.id]).map((c) => look(c.word));
    assert.equal(new Set(visible).size, visible.length, `${msg}: ${side} column shows ${visible.join(", ")}`);
  }
}

// a player who only sees text: picks the left card and any right card whose
// text matches one of that word's translations in the folder
function solveByText(g, pairs) {
  for (let i = 0; i < 50 && g.state.status === "playing"; i++) {
    for (const side of ["left", "right"]) {
      const sel = g.state.selected[side];
      if (sel) g.run({ type: "select", side, cardId: sel }); // deselect
    }
    const s = g.state;
    const left = s.left.find((c) => !s.removing[c.id]);
    const answers = pairs.filter((p) => look(p.known) === look(left.word)).map((p) => look(p.learn));
    const right = s.right.find((c) => !s.removing[c.id] && answers.includes(look(c.word)));
    g.run({ type: "select", side: "left", cardId: left.id });
    g.run({ type: "select", side: "right", cardId: right.id });
    g.flush();
  }
}

describe("visually identical cards", () => {
  for (const [name, pairs] of [["repeated source word", SAME_SOURCE], ["repeated translation", SAME_TRANSLATION], ["duplicate pairs", DUPLICATES]]) {
    test(`${name}: never two identical cards in a column; reading the text always scores 100%`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const g = play(pairs, { seed });
        assertUnambiguous(g.state, `seed ${seed} start`);
        solveByText(g, pairs);
        const s = G.roundStats(g.state, 0);
        assert.equal(g.state.status, "finished", `seed ${seed}: finished`);
        assert.deepEqual([s.wrong, s.accuracy], [0, 100], `seed ${seed}: no wrong attempts`);
      }
    });
  }

  test("duplicate pairs (case, spacing) count once", () => {
    assert.equal(play(DUPLICATES).state.queue.length, 2);
  });

  test("stable pair ids are kept (first spelling in the folder)", () => {
    const g = play(SAME_SOURCE);
    const ids = g.state.queue.map((p) => p.pairId).sort();
    assert.deepEqual(ids, ["bank|||bank (finanse)", "bank|||brzeg", "moon|||księżyc", "sun|||słońce"]);
  });

  test("a folder made only of conflicting pairs is still playable, one at a time", () => {
    const pairs = [1, 2, 3, 4].map((i) => ({ known: "bank", learn: `b${i}` }));
    const g = play(pairs, { seed: 3 });
    assert.equal(g.state.left.length, 1);
    solveByText(g, pairs);
    assert.deepEqual([g.state.status, g.state.attempts, g.state.correct], ["finished", 4, 4]);
  });

  test("random play with repeated words: invariants after every step", () => {
    const words = ["bank", "brzeg", "Bank", "kot", "pies", "zamek", "lock"];
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = seeded(seed * 104729);
      const n = 2 + Math.floor(rnd() * 12);
      const pairs = Array.from({ length: n }, () => ({
        known: words[Math.floor(rnd() * words.length)],
        learn: words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? " " : ""),
      }));
      const g = play(pairs, { seed });
      for (let i = 0; i < 400 && g.state.status === "playing"; i++) {
        const r = rnd();
        if (r < 0.2 && g.timers.length) g.run(g.timers.splice(Math.floor(rnd() * g.timers.length), 1)[0]);
        else {
          const side = rnd() < 0.5 ? "left" : "right";
          const list = g.state[side];
          if (list.length) g.run({ type: "select", side, cardId: list[Math.floor(rnd() * list.length)].id });
        }
        assertUnambiguous(g.state, `seed ${seed} step ${i}`);
        const s = g.state;
        if (s.status === "playing") assert.ok(s.left.length > 0, `seed ${seed}: board never empty mid-round`);
        assert.deepEqual(s.left.map((c) => c.pairId).sort(), s.right.map((c) => c.pairId).sort(), `seed ${seed}: columns`);
      }
      // whatever happened so far, the round can always be completed
      if (g.state.status === "playing") {
        g.flush();
        solveByText(g, pairs);
      }
      assert.equal(g.state.status, "finished", `seed ${seed}: completable`);
    }
  });
});
