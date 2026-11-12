// src/lib/storage.js
// Zasada: nigdy nie usuwamy ani nie nadpisujemy danych użytkownika bez kopii.
// - odczyt nie zapisuje niczego (poza jednorazową kopią danych nieczytelnych),
// - każdy zapis najpierw zachowuje poprzednią wartość (BACKUP_KEY),
// - błędy zapisu są zwracane wywołującemu ({ ok: false }).
import { stableId } from "./utils.js";

// --- klucze ---
// Jedyny klucz zapisywany przez aplikację od pierwszej wersji (3817b87).
export const STORAGE_KEY = "wordFolders_v2";
// Starsze nazwy: dane z nich tylko KOPIUJEMY, nigdy nie usuwamy.
// Ogólny klucz "folders" pominięty celowo — origin rexer00.github.io dzielą
// inne aplikacje, a ta aplikacja nigdy go nie zapisywała.
const LEGACY_KEYS = ["wordFolders", "matchbox-folders"];
// Poprzednia wartość STORAGE_KEY sprzed ostatniego zapisu.
export const BACKUP_KEY = "mp:backup:wordFolders_v2";
// Nienaruszone kopie danych, których nie dało się w pełni odczytać.
export const RECOVERY_PREFIX = "mp:recovery:";

const LAST_FOLDER_KEY = "mp_last_folder";
const LAST_PAIRS_KEY = "mp_last_pairs";
const THEME_KEY = "mp_theme";

// --- helpers ---
function getStorage() {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage || null; // sam dostęp może rzucić (zablokowane dane witryny)
  } catch {
    return null;
  }
}

function safeGet(key) {
  const ls = getStorage();
  if (!ls) return null;
  try {
    return ls.getItem(key);
  } catch {
    return null;
  }
}

// true tylko gdy wartość faktycznie została zapisana
function safeSet(key, val) {
  const ls = getStorage();
  if (!ls) return false;
  try {
    ls.setItem(key, val);
    return ls.getItem(key) === val;
  } catch {
    return false; // quota/full/private mode
  }
}

function tryParse(json) {
  try {
    return { ok: true, value: JSON.parse(json) };
  } catch {
    return { ok: false };
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isValidPair = (p) => isPlainObject(p) && typeof p.known === "string" && typeof p.learn === "string";

// Zostawia poprawne foldery i pary; liczy pominięte wpisy.
// Dodatkowe pola par (np. przyszłe id/postępy) są zachowane.
function sanitize(obj) {
  const folders = {};
  let skipped = 0;
  for (const [name, list] of Object.entries(obj)) {
    if (!Array.isArray(list)) {
      skipped++;
      continue;
    }
    const good = list.filter(isValidPair);
    skipped += list.length - good.length;
    folders[name] = good;
  }
  return { folders, skipped };
}

export function listRecoveryKeys() {
  const ls = getStorage();
  if (!ls) return [];
  const keys = [];
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(RECOVERY_PREFIX)) keys.push(k);
    }
  } catch {
    return [];
  }
  return keys.sort();
}

// Zachowuje nienaruszoną kopię `raw` — tylko raz, bez duplikatów przy każdym ładowaniu.
function preserveForRecovery(raw) {
  for (const k of listRecoveryKeys()) {
    if (safeGet(k) === raw) return k;
  }
  const base = `${RECOVERY_PREFIX}${STORAGE_KEY}:${new Date().toISOString()}`;
  let key = base;
  for (let n = 1; safeGet(key) !== null; n++) key = `${base}-${n}`;
  return safeSet(key, raw) ? key : null;
}

function fromRaw(raw, { preserve }) {
  const parsed = tryParse(raw);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    return { folders: {}, status: "unreadable", skipped: 0, recoveryKey: preserve ? preserveForRecovery(raw) : null };
  }
  const { folders, skipped } = sanitize(parsed.value);
  if (skipped === 0) return { folders, status: "ok", skipped: 0, recoveryKey: null };
  return { folders, status: "partial", skipped, recoveryKey: preserve ? preserveForRecovery(raw) : null };
}

// --- API ---

// status: "ok" | "partial" | "unreadable" | "empty" | "migrated" | "unavailable"
// raw: dokładna wartość STORAGE_KEY w chwili odczytu (rewizja do wykrywania nieaktualnych kopii)
export function loadFoldersWithStatus() {
  const res = loadUnversioned();
  return { ...res, raw: res.status === "unavailable" ? null : safeGet(STORAGE_KEY) };
}

function loadUnversioned() {
  if (!getStorage()) return { folders: {}, status: "unavailable", skipped: 0, recoveryKey: null };

  const raw = safeGet(STORAGE_KEY);
  if (raw !== null) return fromRaw(raw, { preserve: true });

  // brak danych w nowym kluczu -> kopia ze starszych kluczy (bez usuwania)
  for (const key of LEGACY_KEYS) {
    const legacyRaw = safeGet(key);
    if (legacyRaw === null) continue;
    const res = fromRaw(legacyRaw, { preserve: false });
    if (res.status === "ok" || res.status === "partial") {
      return { ...res, status: "migrated", migratedFrom: key };
    }
  }

  return { folders: {}, status: "empty", skipped: 0, recoveryKey: null };
}

export function loadFolders() {
  return loadFoldersWithStatus().folders;
}

// Zwraca { ok: true, raw } albo { ok: false, error }.
// `expected` (opcjonalnie): rewizja, na której oparto zmianę — jeśli w pamięci
// jest już coś innego (zapis z innej karty), nic nie zapisujemy ("conflict").
export function saveFolders(folders, { expected } = {}) {
  if (!getStorage()) return { ok: false, error: "unavailable" };

  const next = JSON.stringify(folders || {});
  const prev = safeGet(STORAGE_KEY);
  if (expected !== undefined && prev !== expected) return { ok: false, error: "conflict" };
  if (prev === next) return { ok: true, raw: next };

  if (prev !== null) {
    // dane nieczytelne/częściowe: pełna kopia musi istnieć, zanim je nadpiszemy
    const prevState = fromRaw(prev, { preserve: true });
    if (prevState.status !== "ok" && !prevState.recoveryKey) return { ok: false, error: "backup-failed" };
    if (safeGet(BACKUP_KEY) !== prev && !safeSet(BACKUP_KEY, prev)) return { ok: false, error: "backup-failed" };
  }

  return safeSet(STORAGE_KEY, next) ? { ok: true, raw: next } : { ok: false, error: "write-failed" };
}

// Nanosi zmianę na NAJNOWSZE zapisane dane, nigdy na nieaktualną kopię strony.
// `change(folders)` modyfikuje świeżo odczytane foldery; jego wynik trafia do `result`.
// `expected`: rewizja, którą widzi strona — `stale: true`, gdy w pamięci jest nowsza
//   (zmiana z innej karty).
// `mine`: wszystko, co ta karta już zapisała (poprzednie `raw`); brakujące wpisy
//   są dopisywane z powrotem (odczyt w tej karcie mógł być nieaktualny).
// Zwraca { ok, error?, folders, raw, result, stale, restored }.
export function updateFolders(change, { expected, mine } = {}) {
  const loaded = loadFoldersWithStatus();
  if (loaded.status === "unavailable") return { ok: false, error: "unavailable", stale: false, restored: 0 };

  // jak przy wejściu na stronę: przykładowy folder tylko przy pustej pamięci
  const folders = loaded.status === "empty" ? ensureDefaults(loaded.folders) : loaded.folders;
  const own = loaded.status === "ok" || loaded.status === "partial" ? parseOwn(mine) : {};
  const restored = mergeMissing(folders, own);
  const result = change(folders);
  const stale = expected !== undefined && expected !== loaded.raw;
  const res = saveFolders(folders, { expected: loaded.raw });
  if (!res.ok) return { ok: false, error: res.error, stale, restored: 0 };
  return { ok: true, folders, raw: res.raw, result, stale, restored };
}

function parseOwn(mine) {
  const parsed = mine == null ? { ok: false } : tryParse(mine);
  return parsed.ok && isPlainObject(parsed.value) ? sanitize(parsed.value).folders : {};
}

// Dopisuje do `folders` foldery/pary z `own`, których brakuje (oryginalne obiekty).
// Zwraca liczbę przywróconych wpisów (pusty folder = 1).
function mergeMissing(folders, own) {
  let restored = 0;
  for (const [name, list] of Object.entries(own)) {
    if (!Object.prototype.hasOwnProperty.call(folders, name) || !Array.isArray(folders[name])) {
      folders[name] = list.slice();
      restored += list.length || 1;
      continue;
    }
    const ids = new Set(folders[name].map((p) => stableId(p.known, p.learn)));
    const lost = list.filter((p) => !ids.has(stableId(p.known, p.learn)));
    folders[name] = folders[name].concat(lost);
    restored += lost.length;
  }
  return restored;
}

// Dane są tylko dopisywane (brak usuwania/zmiany nazw w aplikacji), więc
// wszystko, co ta karta zapisała (`mine`), a czego nie ma w pamięci, zostało
// nadpisane przez inną kartę. Odczyt tuż przed zapisem nie czyni localStorage
// atomowym między kartami — to jest siatka bezpieczeństwa na taki wyścig.
// Zwraca { ok: true, restored, raw? } albo { ok: false, error, missing }.
// Po przywróceniu `raw` jest nowym `mine` tej karty.
export function reconcileLostWrite(mine) {
  const own = parseOwn(mine);
  const current = loadFoldersWithStatus();
  const missing = mergeMissing({ ...current.folders }, own); // tylko liczy (płytka kopia)
  if (missing === 0) return { ok: true, restored: 0 };
  // dane usunięte lub nieczytelne: nie zapisujemy automatycznie
  if (current.status !== "ok" && current.status !== "partial") {
    return { ok: false, error: "unsafe-target", missing };
  }

  const res = updateFolders(() => {}, { mine });
  return res.ok ? { ok: true, restored: res.restored, raw: res.raw } : { ok: false, error: res.error, missing };
}

// Powiadamia o zmianie słówek w innej karcie (zdarzenie "storage").
// Zwraca funkcję wypisującą; bez obsługi zdarzeń — bezpieczny no-op.
export function subscribeToFolderChanges(callback) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const onStorage = (e) => {
    if (e.key === STORAGE_KEY || e.key === null) callback(e);
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

// Przykładowy folder tylko do wyświetlenia — zapisze się dopiero,
// gdy użytkownik sam coś zapisze.
export function ensureDefaults(folders) {
  if (!folders || Object.keys(folders).length === 0) {
    return {
      "Przykład": [
        { known: "cat",   learn: "kot" },
        { known: "dog",   learn: "pies" },
        { known: "house", learn: "dom" },
        { known: "car",   learn: "samochód" },
      ],
    };
  }
  return folders;
}

export function getFolderNames(folders) {
  return Object.keys(folders || {}).sort((a, b) => a.localeCompare(b));
}

export function getLastFolder() {
  return safeGet(LAST_FOLDER_KEY) || null;
}
export function setLastFolder(name) {
  return safeSet(LAST_FOLDER_KEY, String(name ?? ""));
}

export function getLastPairs() {
  const raw = safeGet(LAST_PAIRS_KEY);
  const n = parseInt(raw || "", 10);
  return Number.isNaN(n) ? null : n;
}
export function setLastPairs(n) {
  return safeSet(LAST_PAIRS_KEY, String(n));
}

// "dark" | "light" | null — nigdy nie rzuca (zablokowana pamięć).
export function getThemePreference() {
  const v = safeGet(THEME_KEY);
  return v === "dark" || v === "light" ? v : null;
}
export function setThemePreference(theme) {
  return safeSet(THEME_KEY, theme === "dark" ? "dark" : "light");
}

export function ensureFolder(folders, folderName) {
  if (!folders[folderName]) {
    folders[folderName] = [];
  }
  return folders;
}

// Dopisuje pary do folderu (bez zapisu); pomija duplikaty. Zwraca { added }.
export function mergePairs(folders, folderName, pairs) {
  ensureFolder(folders, folderName);
  const map = new Map(
    (folders[folderName] || []).map((p) => [stableId(p.known, p.learn), p])
  );

  let added = 0;
  for (const p of pairs || []) {
    if (!p || !p.known || !p.learn) continue;
    const key = stableId(p.known, p.learn);
    if (!map.has(key)) {
      map.set(key, { known: p.known.trim(), learn: p.learn.trim() });
      added++;
    }
  }

  folders[folderName] = Array.from(map.values());
  return { added };
}

// Zwraca { folders, added, saved, error? } — `saved: false` gdy zapis się nie udał.
// Zapisuje przekazaną kopię; strony używają updateFolders (najnowsze dane).
export function mergePairsIntoFolder(folders, folderName, pairs) {
  const { added } = mergePairs(folders, folderName, pairs);
  const res = saveFolders(folders);
  return { folders, added, saved: res.ok, error: res.error };
}
