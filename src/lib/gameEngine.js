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
  };
}

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

function makeCards(state, pairs) {
  let seq = state.seq;
  const id = () => `r${state.roundId}-c${++seq}`;
  const left = pairs.map((p) => ({ id: id(), pairId: p.pairId, word: p.known }));
  const right = pairs.map((p) => ({ id: id(), pairId: p.pairId, word: p.learn }));
  return { left, right, seq };
}

// pairs: [{ known, learn }] z folderu; count: żądana liczba par (min. 2)
function start(prev, { pairs, count }, { now, rng }) {
  const unique = [];
  const seen = new Set();
  for (const p of pairs || []) {
    const pairId = stableId(p.known, p.learn);
    if (seen.has(pairId)) continue; // ta sama para dwa razy w folderze liczy się raz
    seen.add(pairId);
    unique.push({ pairId, known: p.known, learn: p.learn });
  }
  if (!unique.length) return unchanged(prev);
  const requested = Number.parseInt(count, 10) || 2;
  const total = Math.min(unique.length, Math.max(2, requested));
  const queue = shuffleWith(unique, rng).slice(0, total);

  const base = { ...createIdleState(), status: "playing", roundId: prev.roundId + 1, queue, startedAt: now };
  const first = queue.slice(0, MAX_VISIBLE);
  const { left, right, seq } = makeCards(base, first);
  return {
    state: { ...base, next: first.length, left: shuffleWith(left, rng), right: shuffleWith(right, rng), seq },
    effects: [],
  };
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
  let left = state.left.filter((c) => !gone(c));
  let right = state.right.filter((c) => !gone(c));
  let { next, seq, appearing } = state;
  const effects = [];

  if (state.status === "playing" && next < state.queue.length) {
    const cards = makeCards(state, [state.queue[next]]);
    next += 1;
    seq = cards.seq;
    left = insertAtRandom(left, cards.left[0], rng);
    right = insertAtRandom(right, cards.right[0], rng);
    const ids = [cards.left[0].id, cards.right[0].id];
    appearing = { ...appearing, [ids[0]]: true, [ids[1]]: true };
    effects.push({ type: "timer", ms: APPEAR_MS, action: { type: "clearAppearing", roundId, ids } });
  }
  return { state: { ...state, left, right, removing, next, seq, appearing }, effects };
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
