// Pairs whose visible text repeats: the same source word, the same
// translation, or the same pair spelled differently. A player who answers by
// reading the cards must never get a correct-looking answer scored as wrong.
import { test, expect } from "@playwright/test";
import { KEY, seed, errors } from "./helpers.mjs";

const look = (w) => w.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const cols = (page) => page.locator(".columns .col");
const modal = (page) => page.locator(".gameover-card");

const FOLDERS = {
  "repeated source word": [
    { known: "bank", learn: "brzeg" },
    { known: "bank", learn: "bank (finanse)" },
    { known: "Bank ", learn: "ławka" },
    { known: "sun", learn: "słońce" },
    { known: "moon", learn: "księżyc" },
    { known: "star", learn: "gwiazda" },
  ],
  "repeated translation": [
    { known: "shore", learn: "brzeg" },
    { known: "bank", learn: "brzeg" },
    { known: "edge", learn: "Brzeg " },
    { known: "lock", learn: "zamek" },
    { known: "castle", learn: "zamek" },
    { known: "sun", learn: "słońce" },
  ],
  "duplicate pairs": [
    { known: "cat", learn: "kot" },
    { known: " Cat", learn: "kot" },
    { known: "cat", learn: "KOT  " },
    { known: "dog", learn: "pies" },
    { known: "dog", learn: "pies" },
  ],
};

// clickable cards of one column: [{ index, text }]
async function clickable(page, side) {
  const cards = cols(page).nth(side).locator(".card");
  const all = await cards.evaluateAll((els) => els.map((e) => ({ text: e.textContent, fading: e.classList.contains("fading") })));
  return all.map((c, index) => ({ ...c, index })).filter((c) => !c.fading);
}

async function playByReading(page, pairs) {
  const valid = new Set(pairs.map((p) => look(p.known) + "|" + look(p.learn)));
  for (let guard = 0; guard < 40 && (await page.locator(".columns").count()); guard++) {
    const [L, R] = [await clickable(page, 0), await clickable(page, 1)];
    if (!L.length) break;
    // what the player sees is unambiguous
    for (const col of [L, R]) {
      const texts = col.map((c) => look(c.text));
      expect(new Set(texts).size, `identical cards in a column: ${texts}`).toBe(texts.length);
    }
    const combos = L.flatMap((l) => R.filter((r) => valid.has(look(l.text) + "|" + look(r.text))));
    expect(combos.length, "every visible left card has exactly one visible answer").toBe(L.length);

    const l = L[0];
    const r = R.find((x) => valid.has(look(l.text) + "|" + look(x.text)));
    await cols(page).nth(0).locator(".card").nth(l.index).click();
    await cols(page).nth(1).locator(".card").nth(r.index).click();
    await page.waitForTimeout(650);
  }
}

for (const [name, pairs] of Object.entries(FOLDERS)) {
  test(`${name}: reading the cards always scores 100%`, async ({ page }) => {
    test.setTimeout(90_000); // three full rounds with real animations
    const errs = errors(page);
    await seed(page, { [KEY]: JSON.stringify({ F: pairs }) });
    await page.goto("game");
    const unique = new Set(pairs.map((p) => look(p.known) + "|" + look(p.learn))).size;
    for (let round = 0; round < 3; round++) {
      if (round === 0) {
        await page.locator("#pairs-count").fill("10");
        await page.locator("#btn-start").click();
      } else {
        await modal(page).getByRole("button", { name: "Graj ponownie" }).click();
      }
      await expect(cols(page).first().locator(".card").first()).toBeVisible();
      await playByReading(page, pairs);
      await expect(modal(page)).toBeVisible();
      const text = (await modal(page).innerText()).replace(/\s+/g, " ");
      expect(text).toContain(`Trafione pary: ${unique}/${unique}`);
      expect(text).toContain("Skuteczność: 100%");
      expect(text).toContain(`Próby: ${unique} (błędne: 0)`);
    }
    // the vocabulary itself is untouched by playing
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBe(JSON.stringify({ F: pairs }));
    expect(errs).toEqual([]);
  });
}
