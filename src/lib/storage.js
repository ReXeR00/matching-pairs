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
export const LEGACY_KEYS = ["wordFolders", "matchbox-folders"];
// Poprzednia wartość STORAGE_KEY sprzed ostatniego zapisu.
export const BACKUP_KEY = "mp:backup:wordFolders_v2";
// Nienaruszone kopie danych, których nie dało się w pełni odczytać.
export const RECOVERY_PREFIX = "mp:recovery:";
// Generacja danych: zmienia się przy przywróceniu kopii w trybie "zastąp".
// Karta, która widziała starszą generację, nie dopisuje z powrotem swoich
// wcześniejszych słówek (zostały świadomie zastąpione; są w kopii odzyskiwania).
export const EPOCH_KEY = "mp:epoch:wordFolders_v2";

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

// Powód ostatniego nieudanego zapisu: "quota" | "blocked" | "unverified".
let lastWriteFailure = null;

function isQuotaError(e) {
  return !!e && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
}

// true tylko gdy wartość faktycznie została zapisana
function safeSet(key, val) {
  lastWriteFailure = null;
  const ls = getStorage();
  if (!ls) {
    lastWriteFailure = "blocked";
    return false;
  }
  try {
    ls.setItem(key, val);
  } catch (e) {
    lastWriteFailure = isQuotaError(e) ? "quota" : "blocked"; // brak miejsca / tryb prywatny
    return false;
  }
  if (safeGet(key) !== val) {
    lastWriteFailure = "unverified";
    return false;
  }
  return true;
}

const fail = (error) => ({ ok: false, error, reason: lastWriteFailure });

export function lastWriteFailureReason() {
  return lastWriteFailure;
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

// Foldery to słownik: "constructor", "toString" czy "__proto__" są zwykłymi
// nazwami folderów. Odczyt tylko własnych pól, zapis przez defineProperty
// (zwykłe przypisanie "__proto__" zmieniłoby prototyp zamiast dodać folder).
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

export function getFolderPairs(folders, name) {
  return folders && hasOwn(folders, name) && Array.isArray(folders[name]) ? folders[name] : undefined;
}

function setFolderPairs(folders, name, list) {
  Object.defineProperty(folders, name, { value: list, writable: true, enumerable: true, configurable: true });
}

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
    setFolderPairs(folders, name, good);
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
// Zwraca klucz kopii (sprawdzonej odczytem) albo null.
export function preserveForRecovery(raw) {
  for (const k of listRecoveryKeys()) {
    if (safeGet(k) === raw) return k;
  }
  const base = `${RECOVERY_PREFIX}${STORAGE_KEY}:${new Date().toISOString()}`;
  let key = base;
  for (let n = 1; safeGet(key) !== null; n++) key = `${base}-${n}`;
  return safeSet(key, raw) ? key : null;
}

// Ocena danych bez żadnego zapisu: { folders, status, skipped }.
export function inspectRaw(raw) {
  const { folders, status, skipped } = fromRaw(raw, { preserve: false });
  return { folders, status, skipped };
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

// Klucze tej aplikacji, z których można odtworzyć słówka (tylko odczyt).
export function isSnapshotKey(key) {
  return key === STORAGE_KEY || key === BACKUP_KEY || LEGACY_KEYS.includes(key) || key.startsWith(RECOVERY_PREFIX);
}

export function readSnapshotRaw(key) {
  return isSnapshotKey(key) ? safeGet(key) : null;
}

// Ręczne usunięcie kopii (tylko kopia zapasowa i kopie odzyskiwania — nigdy
// obecne słówka, starsze klucze ani dane innych stron). Wywoływane wyłącznie
// po potwierdzeniu w UI; aplikacja nigdy nie usuwa kopii automatycznie.
export function isDeletableCopyKey(key) {
  return typeof key === "string" && (key === BACKUP_KEY || key.startsWith(RECOVERY_PREFIX));
}

export function removeCopy(key) {
  if (!isDeletableCopyKey(key)) return false;
  const ls = getStorage();
  if (!ls) return false;
  try {
    ls.removeItem(key);
  } catch {
    return false;
  }
  return safeGet(key) === null;
}

// Zajętość localStorage w znakach (klucz + wartość): cały origin i ta aplikacja.
// Origin rexer00.github.io i jego limit dzielą wszystkie strony tego konta.
export function storageUsage() {
  const ls = getStorage();
  if (!ls) return null;
  let totalChars = 0;
  let appChars = 0;
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k === null) continue;
      const n = k.length + (ls.getItem(k) || "").length;
      totalChars += n;
      if (isSnapshotKey(k) || k.startsWith("mp:") || k.startsWith("mp_")) appChars += n;
    }
  } catch {
    return null;
  }
  return { totalChars, appChars };
}

// --- API ---

// status: "ok" | "partial" | "unreadable" | "empty" | "migrated" | "unavailable"
// raw: dokładna wartość STORAGE_KEY w chwili odczytu (rewizja do wykrywania nieaktualnych kopii)
// epoch: generacja danych (EPOCH_KEY) w chwili odczytu; null = brak przywróceń
export function loadFoldersWithStatus() {
  const res = loadUnversioned();
  const available = res.status !== "unavailable";
  return { ...res, raw: available ? safeGet(STORAGE_KEY) : null, epoch: available ? safeGet(EPOCH_KEY) : null };
}

// Rozpoczyna nową generację danych (przed zapisem przywróconej kopii).
export function startNewGeneration() {
  const epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return safeSet(EPOCH_KEY, epoch) ? { ok: true, epoch } : { ok: false, reason: lastWriteFailure };
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

// Zwraca { ok: true, raw } albo { ok: false, error, reason? } (reason: "quota" | "blocked" | "unverified").
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
    if (prevState.status !== "ok" && !prevState.recoveryKey) return fail("backup-failed");
    if (safeGet(BACKUP_KEY) !== prev && !safeSet(BACKUP_KEY, prev)) return fail("backup-failed");
  }

  return safeSet(STORAGE_KEY, next) ? { ok: true, raw: next } : fail("write-failed");
}

// Nanosi zmianę na NAJNOWSZE zapisane dane, nigdy na nieaktualną kopię strony.
// `change(folders)` modyfikuje świeżo odczytane foldery; jego wynik trafia do `result`.
// `expected`: rewizja, którą widzi strona — `stale: true`, gdy w pamięci jest nowsza
//   (zmiana z innej karty).
// `mine`: wszystko, co ta karta już zapisała (poprzednie `raw`); brakujące wpisy
//   są dopisywane z powrotem (odczyt w tej karcie mógł być nieaktualny).
// `epoch`: generacja, w której powstało `mine`; po przywróceniu kopii w innej
//   karcie (`superseded: true`) `mine` jest pomijane.
// Zwraca { ok, error?, folders, raw, epoch, result, stale, restored, superseded }.
export function updateFolders(change, { expected, mine, epoch } = {}) {
  const loaded = loadFoldersWithStatus();
  if (loaded.status === "unavailable") return { ok: false, error: "unavailable", stale: false, restored: 0, superseded: false };

  // jak przy wejściu na stronę: przykładowy folder tylko przy pustej pamięci
  const folders = loaded.status === "empty" ? ensureDefaults(loaded.folders) : loaded.folders;
  const superseded = mine != null && (epoch ?? null) !== loaded.epoch;
  const own = !superseded && (loaded.status === "ok" || loaded.status === "partial") ? parseOwn(mine) : {};
  const restored = mergeFolders(folders, own);
  const result = change(folders);
  const stale = expected !== undefined && expected !== loaded.raw;
  const res = saveFolders(folders, { expected: loaded.raw });
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason, stale, restored: 0, superseded };
  return { ok: true, folders, raw: res.raw, epoch: loaded.epoch, result, stale, restored, superseded };
}

function parseOwn(mine) {
  const parsed = mine == null ? { ok: false } : tryParse(mine);
  return parsed.ok && isPlainObject(parsed.value) ? sanitize(parsed.value).folders : {};
}

// Dopisuje do `folders` foldery/pary z `own`, których brakuje (oryginalne obiekty).
// Zwraca liczbę przywróconych wpisów (pusty folder = 1).
export function mergeFolders(folders, own) {
  let restored = 0;
  for (const [name, list] of Object.entries(own)) {
    const have = getFolderPairs(folders, name);
    if (!have) {
      setFolderPairs(folders, name, list.slice());
      restored += list.length || 1;
      continue;
    }
    const ids = new Set(have.map((p) => stableId(p.known, p.learn)));
    const lost = list.filter((p) => !ids.has(stableId(p.known, p.learn)));
    setFolderPairs(folders, name, have.concat(lost));
    restored += lost.length;
  }
  return restored;
}

// Dane są tylko dopisywane (brak usuwania/zmiany nazw w aplikacji), więc
// wszystko, co ta karta zapisała (`mine`), a czego nie ma w pamięci, zostało
// nadpisane przez inną kartę. Odczyt tuż przed zapisem nie czyni localStorage
// atomowym między kartami — to jest siatka bezpieczeństwa na taki wyścig.
// Zwraca { ok: true, restored, raw? } albo { ok: false, error, missing };
// { ok: true, restored: 0, superseded: true } — dane zastąpiono kopią w innej karcie.
// Po przywróceniu `raw` jest nowym `mine` tej karty.
export function reconcileLostWrite(mine, { epoch } = {}) {
  const own = parseOwn(mine);
  const current = loadFoldersWithStatus();
  if (mine != null && (epoch ?? null) !== current.epoch) {
    return { ok: true, restored: 0, superseded: true, epoch: current.epoch };
  }
  const missing = mergeFolders({ ...current.folders }, own); // tylko liczy (płytka kopia)
  if (missing === 0) return { ok: true, restored: 0 };
  // dane usunięte lub nieczytelne: nie zapisujemy automatycznie
  if (current.status !== "ok" && current.status !== "partial") {
    return { ok: false, error: "unsafe-target", missing };
  }

  const res = updateFolders(() => {}, { mine, epoch });
  return res.ok ? { ok: true, restored: res.restored, raw: res.raw } : { ok: false, error: res.error, missing };
}

// Powiadamia o zmianie słówek w innej karcie (zdarzenie "storage").
// Zwraca funkcję wypisującą; bez obsługi zdarzeń — bezpieczny no-op.
export function subscribeToFolderChanges(callback) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => {};
  const onStorage = (e) => {
    if (e.key === STORAGE_KEY || e.key === EPOCH_KEY || e.key === null) callback(e);
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
  if (!getFolderPairs(folders, folderName)) {
    setFolderPairs(folders, folderName, []);
  }
  return folders;
}

// Dopisuje pary do folderu (bez zapisu); pomija duplikaty. Zwraca { added }.
export function mergePairs(folders, folderName, pairs) {
  ensureFolder(folders, folderName);
  const map = new Map(
    getFolderPairs(folders, folderName).map((p) => [stableId(p.known, p.learn), p])
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

  setFolderPairs(folders, folderName, Array.from(map.values()));
  return { added };
}

// Zwraca { folders, added, saved, error? } — `saved: false` gdy zapis się nie udał.
// Zapisuje przekazaną kopię; strony używają updateFolders (najnowsze dane).
export function mergePairsIntoFolder(folders, folderName, pairs) {
  const { added } = mergePairs(folders, folderName, pairs);
  const res = saveFolders(folders);
  return { folders, added, saved: res.ok, error: res.error, reason: res.reason };
}
