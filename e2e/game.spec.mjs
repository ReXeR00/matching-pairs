// Game engine behaviour through the real UI: scoring, transient states,
// timers, restarts and folder refresh. Synthetic vocabulary: kN <-> lN.
import { test, expect } from "@playwright/test";
import { KEY, seed, dialogs, errors, openStorage, addWord } from "./helpers.mjs";

const folder = (n, prefix = "") =>
  Array.from({ length: n }, (_, i) => ({ known: `${prefix}k${i + 1}`, learn: `${prefix}l${i + 1}` }));
const answer = (known) => known.replace(/k(\d+)$/, "l$1");

const left = (page) => page.locator(".columns .col").nth(0);
const right = (page) => page.locator(".columns .col").nth(1);
const card = (col, word) => col.getByRole("button", { name: word, exact: true });
const chips = (page) => page.locator(".stats .chip").allTextContents();
const modal = (page) => page.locator(".gameover-card");

async function chip(page, label) {
  const all = await chips(page);
  return all.find((c) => c.startsWith(label));
}

async function startRound(page, { pairs, count = pairs.length, name = "F" }) {
  await seed(page, { [KEY]: JSON.stringify({ [name]: pairs }) });
  await page.goto("game");
  await page.locator("#folder").selectOption({ label: `${name} (${pairs.length})` });
  await page.locator("#pairs-count").fill(String(count));
  await page.locator("#btn-start").click();
  await expect(left(page).locator(".card")).toHaveCount(Math.min(count, pairs.length, 5));
}

// Visible, not-yet-matched left words.
async function openLeftWords(page) {
  return left(page).locator(".card:not(.fading)").allTextContents().then((w) => w.map((x) => x.trim()));
}

async function matchPair(page, known, { wait = true } = {}) {
  await card(left(page), known).click();
  await card(right(page), answer(known)).click();
  if (wait) await page.waitForTimeout(650); // removal animation (500 ms) + refill
}

async function wrongAttempt(page, known, wrongKnown) {
  await card(left(page), known).click();
  await card(right(page), answer(wrongKnown)).click();
  await page.waitForTimeout(700); // mismatch feedback (600 ms)
}

async function finishAll(page) {
  for (let guard = 0; guard < 50 && (await page.locator(".columns").count()); guard++) {
    const words = await openLeftWords(page);
    if (!words.length) break;
    await matchPair(page, words[0]);
  }
}

const modalNumbers = async (page) => {
  const text = (await modal(page).innerText()).replace(/\s+/g, " ");
  return {
    pairs: text.match(/Trafione pary: (\d+)\/(\d+)/)?.slice(1).map(Number),
    accuracy: Number(text.match(/Skuteczność: (\d+)%/)?.[1]),
    attempts: Number(text.match(/Próby: (\d+)/)?.[1] ?? NaN),
    text,
  };
};

test.describe("scoring", () => {
  test("perfect game: moves = pairs, accuracy 100%", async ({ page }) => {
    const errs = errors(page);
    await startRound(page, { pairs: folder(5) });
    await finishAll(page);
    await expect(modal(page)).toBeVisible();
    const m = await modalNumbers(page);
    expect(m.pairs).toEqual([5, 5]);
    expect(m.accuracy).toBe(100);
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 5");
    expect(errs).toEqual([]);
  });

  test("game with mistakes: accuracy = correct / attempts", async ({ page }) => {
    await startRound(page, { pairs: folder(4) });
    await wrongAttempt(page, "k1", "k2");
    await wrongAttempt(page, "k3", "k4");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 2");
    expect(await chip(page, "Pary")).toBe("Pary: 0/4");
    await finishAll(page);
    const m = await modalNumbers(page);
    expect(m.pairs).toEqual([4, 4]);
    expect(m.accuracy).toBe(67); // 4 / 6
    expect(m.attempts).toBe(6);
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 6");
  });

  test("a one-card selection is not an attempt; re-clicking a card toggles it", async ({ page }) => {
    await startRound(page, { pairs: folder(3) });
    const k1 = card(left(page), "k1");
    for (let i = 0; i < 5; i++) await k1.click({ delay: 0 });
    await expect(k1).toHaveClass(/selected/); // odd number of clicks
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 0");
    await card(right(page), "l1").click();
    await expect.poll(() => chip(page, "Pary")).toBe("Pary: 1/3");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 1");
  });
});

test.describe("transient states", () => {
  test("cards being removed after a match cannot be matched again", async ({ page }) => {
    await startRound(page, { pairs: folder(6) });
    await card(left(page), "k1").click();
    await card(right(page), "l1").click();
    // during the 500 ms removal animation, click the same pair again (rapidly)
    await card(left(page), "k1").click({ force: true, timeout: 300 }).catch(() => {});
    await card(right(page), "l1").click({ force: true, timeout: 300 }).catch(() => {});
    await page.waitForTimeout(700);
    expect(await chip(page, "Pary")).toBe("Pary: 1/6");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 1");
  });

  test("a card selected during a removal animation stays the same card", async ({ page }) => {
    await startRound(page, { pairs: folder(9) });
    for (let i = 0; i < 3; i++) {
      const words = await openLeftWords(page);
      const [first, second] = [words[0], words[words.length - 1]];
      await matchPair(page, first, { wait: false });
      await card(left(page), second).click(); // selected while the matched pair is being removed
      await page.waitForTimeout(650); // removal finishes, a new pair is inserted
      await expect(card(left(page), second)).toHaveClass(/selected/);
      await card(right(page), answer(second)).click();
      await page.waitForTimeout(650);
    }
    expect(await chip(page, "Pary")).toBe("Pary: 6/9");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 6");
  });

  test("after a wrong attempt, a new selection is not cleared by the old feedback timer", async ({ page }) => {
    await startRound(page, { pairs: folder(4) });
    await card(left(page), "k1").click();
    await card(right(page), "l2").click(); // wrong
    await card(left(page), "k3").click(); // within the 600 ms feedback window
    await page.waitForTimeout(800);
    await expect(card(left(page), "k3")).toHaveClass(/selected/);
    await card(right(page), "l3").click();
    await expect.poll(() => chip(page, "Pary")).toBe("Pary: 1/4");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 2");
  });

  test("very rapid clicking never double-counts or breaks the round", async ({ page }) => {
    const errs = errors(page);
    await startRound(page, { pairs: folder(6) });
    // hammer every visible card a few times with no waits
    for (let round = 0; round < 3; round++) {
      for (const w of await openLeftWords(page)) {
        await card(left(page), w).click({ force: true, timeout: 300 }).catch(() => {});
        await card(right(page), answer(w)).click({ force: true, timeout: 300 }).catch(() => {});
      }
    }
    await page.waitForTimeout(800);
    await finishAll(page);
    await expect(modal(page)).toBeVisible();
    const m = await modalNumbers(page);
    expect(m.pairs).toEqual([6, 6]);
    expect(m.accuracy).toBeLessThanOrEqual(100);
    expect(m.attempts).toBeGreaterThanOrEqual(6);
    expect(m.accuracy).toBe(Math.round((6 / m.attempts) * 100));
    expect(errs).toEqual([]);
  });

  test("completing the last pair ends the round exactly once", async ({ page }) => {
    await startRound(page, { pairs: folder(2) });
    await matchPair(page, "k1");
    await card(left(page), "k2").click();
    await card(right(page), "l2").click();
    // spam the finishing cards while the round ends
    await card(left(page), "k2").click({ force: true, timeout: 200 }).catch(() => {});
    await card(right(page), "l2").click({ force: true, timeout: 200 }).catch(() => {});
    await expect(modal(page)).toBeVisible();
    await page.waitForTimeout(700);
    expect(await chip(page, "Pary")).toBe("Pary: 2/2");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 2");
    await expect(modal(page)).toHaveCount(1);
  });
});

test.describe("timers, restarts and navigation", () => {
  test("restart during the final removal animation starts a clean round", async ({ page }) => {
    await startRound(page, { pairs: folder(2) });
    await matchPair(page, "k1");
    await matchPair(page, "k2", { wait: false });
    await page.locator(".gameover-card__btn--first").click(); // "Graj ponownie" within 500 ms
    await page.waitForTimeout(900); // the old round's timers would have fired by now
    await expect(left(page).locator(".card")).toHaveCount(2);
    await expect(right(page).locator(".card")).toHaveCount(2);
    expect(await chip(page, "Pary")).toBe("Pary: 0/2");
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 0");
    await finishAll(page);
    expect((await modalNumbers(page)).pairs).toEqual([2, 2]);
  });

  test("time runs during the round and stops when it ends", async ({ page }) => {
    await startRound(page, { pairs: folder(2) });
    await page.waitForTimeout(1300);
    expect(Number((await chip(page, "Czas")).match(/\d+/)[0])).toBeGreaterThanOrEqual(1);
    await finishAll(page);
    const atEnd = await chip(page, "Czas");
    await page.waitForTimeout(1500);
    expect(await chip(page, "Czas")).toBe(atEnd);
  });

  test("navigating away with pending timers causes no errors; next round is clean", async ({ page }) => {
    const errs = errors(page);
    await startRound(page, { pairs: folder(4) });
    await card(left(page), "k1").click();
    await card(right(page), "l2").click(); // wrong: 600 ms timer pending
    await matchPair(page, "k3", { wait: false }); // 500 ms removal timer pending
    await page.locator("nav.toolbar a", { hasText: "Home" }).first().click();
    await page.waitForTimeout(1000);
    await page.locator("nav.toolbar a", { hasText: "Gra" }).first().click();
    await expect(page.locator("#btn-start")).toBeVisible();
    await page.locator("#pairs-count").fill("4");
    await page.locator("#btn-start").click();
    await expect(left(page).locator(".card")).toHaveCount(4);
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 0");
    expect(await chip(page, "Pary")).toBe("Pary: 0/4");
    expect(errs).toEqual([]);
  });

  test("refreshing the page mid-round returns to a clean start", async ({ page }) => {
    const errs = errors(page);
    await startRound(page, { pairs: folder(3) });
    await wrongAttempt(page, "k1", "k2");
    await page.reload();
    await expect(page.locator("#btn-start")).toBeVisible();
    await expect(modal(page)).toHaveCount(0);
    await page.locator("#btn-start").click();
    await expect(left(page).locator(".card")).toHaveCount(3);
    expect(await chip(page, "Ruchy")).toBe("Ruchy: 0");
    expect(errs).toEqual([]);
  });

  test("repeated rounds keep no stale state", async ({ page }) => {
    await startRound(page, { pairs: folder(3) });
    for (let r = 0; r < 3; r++) {
      await wrongAttempt(page, "k1", "k2");
      await finishAll(page);
      const m = await modalNumbers(page);
      expect(m.pairs).toEqual([3, 3]);
      expect(m.accuracy).toBe(75); // 3 / 4
      await page.waitForTimeout(600);
      await page.locator(".gameover-card__btn--first").click();
      await expect(left(page).locator(".card")).toHaveCount(3);
      expect(await chip(page, "Ruchy")).toBe("Ruchy: 0");
    }
  });
});

test.describe("folder sizes", () => {
  for (const [size, count] of [[2, 2], [5, 5], [7, 7], [12, 12], [12, 3]]) {
    test(`${size} pairs, ${count} per round`, async ({ page }) => {
      await startRound(page, { pairs: folder(size), count });
      await finishAll(page);
      const m = await modalNumbers(page);
      expect(m.pairs).toEqual([count, count]);
      expect(m.accuracy).toBe(100);
      expect(await chip(page, "Ruchy")).toBe(`Ruchy: ${count}`);
    });
  }
});

test.describe("vocabulary changes in another tab", () => {
  test("the game's folder list refreshes; an active round is not disturbed", async ({ context }) => {
    const game = await context.newPage();
    const editor = await context.newPage();
    dialogs(editor);
    await seed(game, { [KEY]: JSON.stringify({ F: folder(3) }) });
    await game.goto("game");
    await expect(game.locator("#folder option", { hasText: "F (3)" })).toBeAttached();

    await openStorage(editor);
    await editor.locator("#new-folder-name").fill("Nowy");
    await editor.getByRole("button", { name: "Utwórz nowy folder" }).click();
    await addWord(editor, "a", "b");
    await expect(game.locator("#folder option", { hasText: "Nowy (1)" })).toBeAttached();

    await game.locator("#folder").selectOption({ label: "F (3)" });
    await game.locator("#pairs-count").fill("3");
    await game.locator("#btn-start").click();
    await expect(left(game).locator(".card")).toHaveCount(3);
    await editor.locator("#edit-folder").selectOption({ label: "F (3)" });
    await addWord(editor, "k9", "l9"); // folder in play changes
    await game.waitForTimeout(400);
    await expect(left(game).locator(".card")).toHaveCount(3);
    expect(await chip(game, "Pary")).toBe("Pary: 0/3");
    await finishAll(game);
    expect((await modalNumbers(game)).pairs).toEqual([3, 3]);
    await game.locator(".gameover-card__btn--second").click();
    await game.goto("game");
    await expect(game.locator("#folder option", { hasText: "F (4)" })).toBeAttached();
  });
});
