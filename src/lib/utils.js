// src/lib/utils.js
export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

// Liczba z [0, 1) — z crypto, gdy dostępne.
export function random() {
  const c = typeof window !== "undefined" ? window.crypto : globalThis.crypto;
  return c && c.getRandomValues ? c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 : Math.random();
}

export function shuffle(arr) {
  const a = arr.slice();
  const rnd = random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function stableId(known, learn) {
  return known.trim().toLowerCase() + "|||" + learn.trim().toLowerCase();
}
