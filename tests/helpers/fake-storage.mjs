// In-memory stand-in for window.localStorage used by the storage tests.
// Never touches a real browser profile.

export class FakeStorage {
  constructor(initial = {}, { failSetFor = null, quotaBytes = Infinity } = {}) {
    this.map = new Map(Object.entries(initial));
    this.failSetFor = failSetFor; // null | "all" | (key) => boolean
    this.quotaBytes = quotaBytes;
    this.writes = []; // log of { op, key }
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    const value = String(v);
    const fails = this.failSetFor === "all" || (typeof this.failSetFor === "function" && this.failSetFor(k));
    const used = [...this.map].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
    if (fails || used + k.length + value.length > this.quotaBytes) {
      const err = new Error("The quota has been exceeded.");
      err.name = "QuotaExceededError";
      throw err;
    }
    this.writes.push({ op: "set", key: k });
    this.map.set(k, value);
  }
  removeItem(k) {
    this.writes.push({ op: "remove", key: k });
    this.map.delete(k);
  }
  clear() {
    this.writes.push({ op: "clear" });
    this.map.clear();
  }
  snapshot() {
    return Object.fromEntries(this.map);
  }
}

// Install a fake as the global localStorage (window === globalThis in tests).
export function installStorage(initial, options) {
  const store = new FakeStorage(initial, options);
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true, writable: true });
  return store;
}

// Simulate a browser where touching localStorage throws (blocked site data).
export function installThrowingStorage() {
  globalThis.window = globalThis;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      const err = new Error("Access is denied for this document.");
      err.name = "SecurityError";
      throw err;
    },
  });
}
