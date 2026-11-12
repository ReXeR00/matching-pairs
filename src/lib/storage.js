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
export function loadFoldersWithStatus() {
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

// Zwraca { ok: true } albo { ok: false, error }.
export function saveFolders(folders) {
  if (!getStorage()) return { ok: false, error: "unavailable" };

  const next = JSON.stringify(folders || {});
  const prev = safeGet(STORAGE_KEY);
  if (prev === next) return { ok: true };

  if (prev !== null) {
    // dane nieczytelne/częściowe: pełna kopia musi istnieć, zanim je nadpiszemy
    const prevState = fromRaw(prev, { preserve: true });
    if (prevState.status !== "ok" && !prevState.recoveryKey) return { ok: false, error: "backup-failed" };
    if (safeGet(BACKUP_KEY) !== prev && !safeSet(BACKUP_KEY, prev)) return { ok: false, error: "backup-failed" };
  }

  return safeSet(STORAGE_KEY, next) ? { ok: true } : { ok: false, error: "write-failed" };
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

export function ensureFolder(folders, folderName) {
  if (!folders[folderName]) {
    folders[folderName] = [];
  }
  return folders;
}

// Zwraca { folders, added, saved, error? } — `saved: false` gdy zapis się nie udał.
export function mergePairsIntoFolder(folders, folderName, pairs) {
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
  const res = saveFolders(folders);
  return { folders, added, saved: res.ok, error: res.error };
}
