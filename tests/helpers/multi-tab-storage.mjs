// Deterministic model of localStorage shared by several tabs of one origin.
//
// Like Chromium, every tab reads and writes its own cached copy; writes reach
// the shared store and the other tabs only when the test calls deliver().
// While a tab has its own write to a key still in flight, incoming changes to
// that key do not overwrite its cache (its own value wins locally), as in
// Chromium's cached storage area. This lets tests choose the exact ordering
// of concurrent writes instead of hoping a real browser produces it.

class TabStorage {
  constructor(hub, name) {
    this.hub = hub;
    this.name = name;
    this.cache = new Map(hub.server);
    this.inFlight = new Map(); // key -> count of own undelivered writes
    this.listeners = [];
    this.events = [];
  }
  get length() {
    return this.cache.size;
  }
  key(i) {
    return [...this.cache.keys()][i] ?? null;
  }
  getItem(k) {
    return this.cache.has(k) ? this.cache.get(k) : null;
  }
  setItem(k, v) {
    const value = String(v);
    if (this.hub.failSetFor?.(this.name, k)) {
      const e = new Error("The quota has been exceeded.");
      e.name = "QuotaExceededError";
      throw e;
    }
    this.cache.set(k, value);
    this.inFlight.set(k, (this.inFlight.get(k) || 0) + 1);
    this.hub.queue.push({ from: this, key: k, value });
  }
  removeItem(k) {
    this.cache.delete(k);
    this.inFlight.set(k, (this.inFlight.get(k) || 0) + 1);
    this.hub.queue.push({ from: this, key: k, value: null });
  }
  clear() {
    throw new Error("clear() is never expected in these tests");
  }
}

export class StorageHub {
  constructor(initial = {}) {
    this.server = new Map(Object.entries(initial));
    this.queue = [];
    this.tabs = [];
  }

  open(name) {
    const tab = new TabStorage(this, name);
    this.tabs.push(tab);
    return tab;
  }

  // Run `fn` as code inside `tab` (window.localStorage / events = that tab's).
  as(tab, fn) {
    const prev = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    globalThis.window = globalThis;
    Object.defineProperty(globalThis, "localStorage", { value: tab, configurable: true, writable: true });
    globalThis.addEventListener = (type, cb) => type === "storage" && tab.listeners.push(cb);
    globalThis.removeEventListener = (type, cb) => {
      tab.listeners = tab.listeners.filter((x) => x !== cb);
    };
    try {
      return fn();
    } finally {
      if (prev) Object.defineProperty(globalThis, "localStorage", prev);
      delete globalThis.addEventListener;
      delete globalThis.removeEventListener;
    }
  }

  // Applies queued writes to the shared store in `order` (indices into the
  // current queue; default: queue order), then to the other tabs' caches,
  // recording a "storage" event for each tab that observes a change.
  deliver(order) {
    const batch = this.queue;
    this.queue = [];
    const seq = order ? order.map((i) => batch[i]) : batch;
    if (order && new Set(order).size !== batch.length) throw new Error("order must list every queued write once");
    for (const w of seq) {
      const oldValue = this.server.has(w.key) ? this.server.get(w.key) : null;
      if (w.value === null) this.server.delete(w.key);
      else this.server.set(w.key, w.value);
      const left = w.from.inFlight.get(w.key) - 1;
      if (left) w.from.inFlight.set(w.key, left);
      else w.from.inFlight.delete(w.key);
      for (const t of this.tabs) {
        if (t === w.from) continue;
        if (!t.inFlight.has(w.key)) {
          if (w.value === null) t.cache.delete(w.key);
          else t.cache.set(w.key, w.value);
        }
        t.events.push({ key: w.key, oldValue, newValue: w.value });
      }
    }
    // a tab whose own writes have all landed now converges on the shared value
    for (const t of this.tabs) {
      for (const k of new Set(seq.map((w) => w.key))) {
        if (!t.inFlight.has(k)) {
          if (this.server.has(k)) t.cache.set(k, this.server.get(k));
          else t.cache.delete(k);
        }
      }
    }
  }

  // Deliver everything, then let each tab handle its storage events (which may
  // write again) until nothing is left in flight.
  settle(handlers = new Map(), maxRounds = 10) {
    for (let i = 0; i < maxRounds; i++) {
      this.deliver();
      let acted = false;
      for (const t of this.tabs) {
        const events = t.events;
        t.events = [];
        const h = handlers.get(t);
        if (h && events.length) {
          this.as(t, () => h(events));
          acted = true;
        }
      }
      if (!this.queue.length && !acted) return;
      if (!this.queue.length) return;
    }
    throw new Error("storage did not settle");
  }

  get(key) {
    return this.server.has(key) ? this.server.get(key) : null;
  }
  keys() {
    return [...this.server.keys()];
  }
}
