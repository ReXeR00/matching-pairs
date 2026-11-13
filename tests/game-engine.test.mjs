// FIX 008: deterministic game engine (src/lib/gameEngine.js).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/lib/gameEngine.js";

const pairs = (n) => Array.from({ length: n }, (_, i) => ({ known: `k${i + 1}`, learn: `l${i + 1}` }));
const seeded = (seed = 1) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// Small driver: applies actions, records effects and pending timers.
function game(n = 5, { count = n, seed = 1 } = {}) {
  const env = { now: 0, rng: seeded(seed) };
  const g = { state: G.createIdleState(), effects: [], timers: [], env };
  g.do = (action) => {
    const res = G.step(g.state, action, env);
    g.state = res.state;
    g.effects.push(...res.effects);
    for (const fx of res.effects) if (fx.type === "timer") g.timers.push(fx.action);
    return res;
  };
  g.start = () => g.do({ type: "start", pairs: pairs(n), count });
  g.leftOf = (word) => g.state.left.find((c) => c.word === word);
  g.rightOf = (word) => g.state.right.find((c) => c.word === word);
  g.click = (side, word) => {
    const c = (side === "left" ? g.leftOf : g.rightOf)(word);
    return g.do({ type: "select", side, cardId: c ? c.id : "missing" });
  };
  g.attempt = (k, l) => {
    g.click("left", k);
    return g.click("right", l);
  };
  g.flush = () => {
    const pending = g.timers;
    g.timers = [];
    for (const a of pending) g.do(a);
  };
  g.matchVisible = () => {
    const c = g.state.left.find((x) => !g.state.removing[x.id]);
    g.attempt(c.word, c.word.replace("k", "l"));
    g.flush();
  };
  g.start();
  return g;
}
const finishedCount = (g) => g.effects.filter((e) => e.type === "finished").length;

describe("round start", () => {
  test("window of max 5 pairs, both sides hold the same pairs, ids unique", () => {
    const g = game(7);
    assert.equal(g.state.status, "playing");
    assert.equal(g.state.queue.length, 7);
    assert.equal(g.state.left.length, 5);
    assert.deepEqual(g.state.left.map((c) => c.pairId).sort(), g.state.right.map((c) => c.pairId).sort());
    const ids = [...g.state.left, ...g.state.right].map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test("requested count is clamped to 2..folder size; duplicate pairs count once", () => {
    assert.equal(game(12, { count: 3 }).state.queue.length, 3);
    assert.equal(game(3, { count: 1 }).state.queue.length, 2);
    assert.equal(game(3, { count: 99 }).state.queue.length, 3);
    const g = { state: G.createIdleState() };
    const dup = [{ known: "a", learn: "b" }, { known: " A", learn: "B " }, { known: "c", learn: "d" }];
    const res = G.step(g.state, { type: "start", pairs: dup, count: 5 }, { now: 0, rng: seeded() });
    assert.equal(res.state.queue.length, 2);
  });

  test("an empty folder does not start a round", () => {
    const res = G.step(G.createIdleState(), { type: "start", pairs: [], count: 4 }, { now: 0, rng: seeded() });
    assert.equal(res.state.status, "idle");
  });
});

describe("scoring", () => {
  test("perfect game: attempts = pairs, accuracy 100%, finished exactly once", () => {
    const g = game(7);
    for (let i = 0; i < 7; i++) g.matchVisible();
    const s = G.roundStats(g.state, 0);
    assert.deepEqual([g.state.status, s.attempts, s.correct, s.wrong, s.accuracy], ["finished", 7, 7, 0, 100]);
    assert.equal(finishedCount(g), 1);
  });

  test("mistakes count as attempts: accuracy = correct / attempts", () => {
    const g = game(4);
    g.attempt("k1", "l2");
    g.attempt("k3", "l4");
    for (let i = 0; i < 4; i++) g.matchVisible();
    const s = G.roundStats(g.state, 0);
    assert.deepEqual([s.attempts, s.correct, s.wrong, s.accuracy], [6, 4, 2, 67]);
  });

  test("one selected card is not an attempt; clicking it again deselects", () => {
    const g = game(3);
    g.click("left", "k1");
    assert.equal(g.state.attempts, 0);
    g.click("left", "k1");
    assert.equal(g.state.selected.left, null);
    g.click("left", "k1");
    g.click("left", "k2"); // switching the selection on one side is not an attempt either
    assert.equal(g.state.attempts, 0);
    assert.equal(g.state.selected.left, g.leftOf("k2").id);
  });
});

describe("transient states (R1–R3)", () => {
  test("R1: cards being removed are ignored; a pair can be matched only once", () => {
    const g = game(6);
    const w = g.state.left[0].word;
    g.attempt(w, w.replace("k", "l"));
    const after = g.state;
    g.attempt(w, w.replace("k", "l")); // still visible, fading
    assert.equal(g.state.correct, 1);
    assert.equal(g.state.attempts, 1);
    assert.equal(g.state.selected.left, after.selected.left);
  });

  test("R2: a selection survives the removal/refill of another pair (ids, not positions)", () => {
    const g = game(9);
    const [a, b] = [g.state.left[0].word, g.state.left[3].word];
    g.attempt(a, a.replace("k", "l"));
    g.click("left", b);
    const id = g.leftOf(b).id;
    g.flush(); // first pair removed, a new pair inserted at a random position
    assert.equal(g.state.selected.left, id);
    assert.equal(g.state.left.find((c) => c.id === id).word, b);
    g.click("right", b.replace("k", "l"));
    assert.equal(g.state.correct, 2);
  });

  test("R3: the old mismatch timer does not clear a newer selection", () => {
    const g = game(4);
    g.attempt("k1", "l2");
    const stale = g.timers.find((a) => a.type === "clearMismatch");
    g.click("left", "k3"); // during the feedback window
    g.do(stale);
    assert.equal(g.state.selected.left, g.leftOf("k3").id);
    g.click("right", "l3");
    assert.deepEqual([g.state.attempts, g.state.correct], [2, 1]);
  });

  test("a mismatch highlight is cleared by its own timer only", () => {
    const g = game(4);
    g.attempt("k1", "l2");
    assert.ok(G.isHighlighted(g.state, "left", g.leftOf("k1").id));
    g.attempt("k1", "l3"); // second mismatch, new token
    const [first, second] = g.timers.filter((a) => a.type === "clearMismatch");
    g.do(first);
    assert.ok(g.state.mismatch, "first timer does not clear the second mismatch");
    g.do(second);
    assert.equal(g.state.mismatch, null);
  });

  test("unknown cards and invalid sides are ignored", () => {
    const g = game(3);
    const before = g.state;
    g.do({ type: "select", side: "left", cardId: "nope" });
    g.do({ type: "select", side: "up", cardId: g.state.left[0].id });
    g.do({ type: "select", side: "left", cardId: g.state.right[0].id });
    assert.equal(g.state, before);
  });
});

describe("timers, restart and end of round (R4, R5)", () => {
  test("after the last pair, further clicks and timers change nothing", () => {
    const g = game(2);
    g.matchVisible();
    g.attempt(g.state.left.find((c) => !g.state.removing[c.id]).word, g.state.right.find((c) => !g.state.removing[c.id]).word);
    const done = g.state;
    assert.equal(done.status, "finished");
    g.attempt("k1", "l1");
    g.attempt("k2", "l2");
    assert.deepEqual([g.state.attempts, g.state.correct], [done.attempts, done.correct]);
    g.flush();
    assert.equal(finishedCount(g), 1);
  });

  test("R5: timers of a previous round are ignored after a restart", () => {
    const g = game(2);
    g.matchVisible();
    g.attempt(g.state.left[0].word, g.state.left[0].word.replace("k", "l"));
    const oldTimers = g.timers;
    g.timers = [];
    g.start();
    const fresh = g.state;
    for (const a of oldTimers) g.do(a);
    assert.equal(g.state, fresh);
    assert.equal(g.state.left.length, 2);
    assert.equal(g.state.roundId, 2);
  });

  test("R4: time runs while playing and freezes at the end", () => {
    const g = game(2);
    assert.equal(G.roundStats(g.state, 1500).seconds, 1);
    g.env.now = 4200;
    g.matchVisible();
    g.matchVisible();
    assert.equal(g.state.finishedAt, 4200);
    assert.equal(G.roundStats(g.state, 99_000).seconds, 4);
  });

  test("refill keeps both columns in sync until the queue is empty", () => {
    const g = game(12);
    for (let i = 0; i < 12; i++) {
      assert.deepEqual(g.state.left.map((c) => c.pairId).sort(), g.state.right.map((c) => c.pairId).sort());
      g.matchVisible();
    }
    assert.equal(g.state.status, "finished");
    assert.equal(g.state.next, 12);
  });
});

describe("random play (property test)", () => {
  test("invariants hold under random clicks and out-of-order timers", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rnd = seeded(seed * 7919);
      const n = 2 + Math.floor(rnd() * 11);
      const g = game(n, { seed });
      for (let i = 0; i < 400 && g.state.status !== "finished"; i++) {
        const r = rnd();
        if (r < 0.15 && g.timers.length) {
          g.do(g.timers.splice(Math.floor(rnd() * g.timers.length), 1)[0]); // any timer, any order
        } else if (r < 0.2) {
          g.start(); // restart mid-round with pending timers
        } else {
          const side = rnd() < 0.5 ? "left" : "right";
          const list = g.state[side];
          if (list.length) g.do({ type: "select", side, cardId: list[Math.floor(rnd() * list.length)].id });
        }
        const s = g.state;
        assert.ok(s.correct <= s.queue.length && s.correct <= s.attempts, `seed ${seed}: counts`);
        assert.equal(new Set(s.matched).size, s.correct, `seed ${seed}: each pair counted once`);
        assert.equal(s.status === "finished", s.correct === s.queue.length && s.queue.length > 0, `seed ${seed}: finish`);
        assert.deepEqual(s.left.map((c) => c.pairId).sort(), s.right.map((c) => c.pairId).sort(), `seed ${seed}: columns`);
        const ids = [...s.left, ...s.right].map((c) => c.id);
        assert.equal(new Set(ids).size, ids.length, `seed ${seed}: unique ids`);
        for (const side of ["left", "right"]) {
          const sel = s.selected[side];
          assert.ok(sel === null || s[side].some((c) => c.id === sel && !s.removing[c.id]), `seed ${seed}: selection valid`);
        }
      }
      const finishes = g.effects.filter((e) => e.type === "finished").length;
      assert.ok(finishes <= g.state.roundId, `seed ${seed}: at most one finish per round`);
    }
  });
});
