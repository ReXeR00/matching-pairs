// src/lib/utils.js
export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function shuffle(arr) {
  const a = arr.slice();
  const rnd =
    window.crypto && window.crypto.getRandomValues
      ? () =>
          window.crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32
      : Math.random;
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function stableId(known, learn) {
  return known.trim().toLowerCase() + "|||" + learn.trim().toLowerCase();
}
