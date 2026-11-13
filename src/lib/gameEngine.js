// src/lib/gameEngine.js
// Deterministyczna logika rundy — bez Reacta, timerów i losowości z zewnątrz.
// step(state, action, env) zwraca { state, effects }:
//   env:     { now: ms, rng: () => [0, 1) }
//   effects: { type: "sound", kind: "correct" | "wrong" }
//            { type: "timer", ms, action }   — akcja do wysłania po `ms`
//            { type: "finished" }            — dokładnie raz na rundę
//
// Zasady punktacji:
// - próba = porównanie dwóch kart (po jednej z każdej kolumny),
// - liczą się próby trafione i nietrafione; wybranie jednej karty to nie próba,
// - skuteczność = trafione / wszystkie próby × 100 (zaokrąglone),
// - kliknięcia w karty znikające po trafieniu, spoza rundy lub nieistniejące
//   są ignorowane; para może być zaliczona tylko raz.
// Karty i pary mają stałe identyfikatory (nie indeksy w tablicach), a każdy
// timer niesie roundId — timery poprzedniej rundy niczego nie zmieniają.
//
// Jednoznaczność planszy: gracz widzi tylko tekst, więc na planszy nigdy nie ma
// jednocześnie (wśród klikalnych kart):
// - dwóch kart w jednej kolumnie, które wyglądają tak samo,
// - lewej i prawej karty z różnych par, które razem tworzą parę z folderu
//   (np. "bank" z pary bank→brzeg obok "brzeg" z pary shore→brzeg).
// Pary, które by to złamały, czekają w kolejce, aż kolidujące karty znikną.
import { stableId } from "./utils.js";

export const MAX_VISIBLE = 5;
export const MATCH_FADE_MS = 500;
export const APPEAR_MS = 500;
export const MISMATCH_MS = 600;

export function createIdleState() {
  return {
    status: "idle", // "idle" | "playing" | "finished"
    roundId: 0,
    queue: [], // pary rundy: [{ pairId, known, learn }]
    next: 0, // indeks następnej pary do pokazania
    left: [], // widoczne karty: [{ id, pairId, word }]
    right: [],
    selected: { left: null, right: null }, // id kart
    removing: {}, // id -> true (znikają po trafieniu, nieklikalne)
    appearing: {}, // id -> true (animacja pojawienia)
    mismatch: null, // { left, right, token } — krótkie podświetlenie błędu
    matched: [], // pairId trafionych par
    attempts: 0,
    correct: 0,
    startedAt: 0,
    finishedAt: null,
    seq: 0, // licznik id kart
    valid: [], // "lewy|prawy" (wygląd) każdej pary z folderu
  };
}

// Jak tekst wygląda dla gracza: wielkość liter i odstępy nie odróżniają kart.
export function looksLike(word) {
  return String(word).normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}
const combo = (known, learn) => looksLike(known) + "|" + looksLike(learn);

function shuffleWith(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function insertAtRandom(list, item, rng) {
  const at = Math.floor(rng() * (list.length + 1));
  return [...list.slice(0, at), item, ...list.slice(at)];
}

const unchanged = (state) => ({ state, effects: [] });

// Czy para może dołączyć do planszy bez dwuznaczności (patrz nagłówek).
function fits(state, left, right, pair, valid) {
  const shownLeft = left.filter((c) => !state.removing[c.id]);
  const shownRight = right.filter((c) => !state.removing[c.id]);
  const k = looksLike(pair.known);
  const l = looksLike(pair.learn);
  if (shownLeft.some((c) => looksLike(c.word) === k)) return false;
  if (shownRight.some((c) => looksLike(c.word) === l)) return false;
  if (shownRight.some((c) => valid.has(k + "|" + looksLike(c.word)))) return false;
  if (shownLeft.some((c) => valid.has(looksLike(c.word) + "|" + l))) return false;
  return true;
}

// Dokłada pary z kolejki (w jej kolejności, pomijając kolidujące) do MAX_VISIBLE
// kart w kolumnie. Pominięte pary zostają w kolejce na później.
function fill(state, rng) {
  const valid = new Set(state.valid);
  const queue = state.queue.slice();
  let { left, right, next, seq } = state;
  const added = [];
  for (let i = next; i < queue.length && left.length < MAX_VISIBLE; i++) {
    const pair = queue[i];
    if (!fits(state, left, right, pair, valid)) continue;
    queue.splice(i, 1);
    queue.splice(next, 0, pair); // kolejka = kolejność pojawiania się
    next += 1;
    const l = { id: `r${state.roundId}-c${++seq}`, pairId: pair.pairId, word: pair.known };
    const r = { id: `r${state.roundId}-c${++seq}`, pairId: pair.pairId, word: pair.learn };
    left = insertAtRandom(left, l, rng);
    right = insertAtRandom(right, r, rng);
    added.push(l.id, r.id);
  }
  return { state: { ...state, queue, left, right, next, seq }, added };
}

// pairs: [{ known, learn }] z folderu; count: żądana liczba par (min. 2)
function start(prev, { pairs, count }, { now, rng }) {
  const unique = [];
  const seen = new Set();
  for (const p of pairs || []) {
    const key = combo(p.known, p.learn);
    if (seen.has(key)) continue; // ta sama para (np. inna wielkość liter) liczy się raz
    seen.add(key);
    unique.push({ pairId: stableId(p.known, p.learn), known: p.known, learn: p.learn });
  }
  if (!unique.length) return unchanged(prev);
  const requested = Number.parseInt(count, 10) || 2;
  const total = Math.min(unique.length, Math.max(2, requested));
  const queue = shuffleWith(unique, rng).slice(0, total);

  const base = {
    ...createIdleState(),
    status: "playing",
    roundId: prev.roundId + 1,
    queue,
    startedAt: now,
    valid: [...seen], // cały folder: para spoza rundy też "wygląda na poprawną"
  };
  return { state: fill(base, rng).state, effects: [] };
}

function select(state, { side, cardId }, { now }) {
  if (state.status !== "playing") return unchanged(state);
  if (side !== "left" && side !== "right") return unchanged(state);
  const card = state[side].find((c) => c.id === cardId);
  if (!card || state.removing[cardId]) return unchanged(state);

  const other = side === "left" ? "right" : "left";
  // nowe kliknięcie kończy podświetlenie poprzedniego błędu (próba już policzona)
  const base = state.mismatch ? { ...state, mismatch: null } : state;

  if (base.selected[side] === cardId) {
    return { state: { ...base, selected: { ...base.selected, [side]: null } }, effects: [] };
  }
  const selected = { ...base.selected, [side]: cardId };
  if (selected[other] === null) return { state: { ...base, selected }, effects: [] };

  // dwie karty = jedna próba
  const leftCard = base.left.find((c) => c.id === selected.left);
  const rightCard = base.right.find((c) => c.id === selected.right);
  const attempts = base.attempts + 1;
  const cleared = { left: null, right: null };

  if (leftCard.pairId === rightCard.pairId && !base.matched.includes(leftCard.pairId)) {
    const correct = base.correct + 1;
    const finished = correct === base.queue.length;
    const next = {
      ...base,
      attempts,
      correct,
      selected: cleared,
      matched: [...base.matched, leftCard.pairId],
      removing: { ...base.removing, [leftCard.id]: true, [rightCard.id]: true },
      status: finished ? "finished" : "playing",
      finishedAt: finished ? now : null,
    };
    const effects = [
      { type: "sound", kind: "correct" },
      { type: "timer", ms: MATCH_FADE_MS, action: { type: "removeMatched", roundId: base.roundId, pairId: leftCard.pairId } },
    ];
    if (finished) effects.push({ type: "finished" });
    return { state: next, effects };
  }

  const token = attempts;
  return {
    state: { ...base, attempts, selected: cleared, mismatch: { left: leftCard.id, right: rightCard.id, token } },
    effects: [
      { type: "sound", kind: "wrong" },
      { type: "timer", ms: MISMATCH_MS, action: { type: "clearMismatch", roundId: base.roundId, token } },
    ],
  };
}

// koniec animacji trafienia: usuń parę, dołóż następną z kolejki
function removeMatched(state, { roundId, pairId }, { rng }) {
  if (roundId !== state.roundId) return unchanged(state);
  const gone = (c) => c.pairId === pairId;
  const removing = { ...state.removing };
  for (const c of [...state.left, ...state.right]) if (gone(c)) delete removing[c.id];
  const removed = {
    ...state,
    left: state.left.filter((c) => !gone(c)),
    right: state.right.filter((c) => !gone(c)),
    removing,
  };
  if (state.status !== "playing") return { state: removed, effects: [] };

  const { state: filled, added: ids } = fill(removed, rng);
  if (!ids.length) return { state: filled, effects: [] };
  const appearing = { ...filled.appearing };
  for (const id of ids) appearing[id] = true;
  return {
    state: { ...filled, appearing },
    effects: [{ type: "timer", ms: APPEAR_MS, action: { type: "clearAppearing", roundId, ids } }],
  };
}

function clearMismatch(state, { roundId, token }) {
  if (roundId !== state.roundId || !state.mismatch || state.mismatch.token !== token) return unchanged(state);
  return { state: { ...state, mismatch: null }, effects: [] };
}

function clearAppearing(state, { roundId, ids }) {
  if (roundId !== state.roundId) return unchanged(state);
  const appearing = { ...state.appearing };
  for (const id of ids) delete appearing[id];
  return { state: { ...state, appearing }, effects: [] };
}

export function step(state, action, env) {
  switch (action?.type) {
    case "start":
      return start(state, action, env);
    case "select":
      return select(state, action, env);
    case "removeMatched":
      return removeMatched(state, action, env);
    case "clearMismatch":
      return clearMismatch(state, action);
    case "clearAppearing":
      return clearAppearing(state, action);
    default:
      return unchanged(state);
  }
}

// Statystyki do wyświetlenia. Czas zatrzymuje się na końcu rundy.
export function roundStats(state, now) {
  const { attempts, correct } = state;
  const end = state.finishedAt ?? now;
  return {
    attempts,
    correct,
    wrong: attempts - correct,
    accuracy: attempts > 0 ? Math.round((correct / attempts) * 100) : 0,
    totalPairs: state.queue.length,
    seconds: state.status === "idle" ? 0 : Math.max(0, Math.floor((end - state.startedAt) / 1000)),
  };
}

// Do podświetlenia: zaznaczona karta albo karta z właśnie nietrafionej próby.
export function isHighlighted(state, side, cardId) {
  return state.selected[side] === cardId || state.mismatch?.[side] === cardId;
}
