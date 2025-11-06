// src/lib/storage.js
import { stableId } from "./utils.js";

// --- klucze (nowy + stare do migracji) ---
const STORAGE_KEY = "wordFolders_v2";
const LEGACY_KEYS = ["wordFolders", "matchbox-folders", "folders"];

const LAST_FOLDER_KEY = "mp_last_folder";
const LAST_PAIRS_KEY = "mp_last_pairs";

// --- helpers ---
function hasLocalStorage() {
  try {
    return typeof window !== "undefined" && "localStorage" in window;
  } catch {
    return false;
  }
}

function safeGet(key) {
  if (!hasLocalStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key, val) {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(key, val);
  } catch {
    // quota/full/private mode – ignorujemy
  }
}

function isValidFolders(obj) {
  if (!obj || typeof obj !== "object") return false;
  // oczekujemy: { [folderName]: Array<{known, learn}> }
  for (const [k, v] of Object.entries(obj)) {
    if (!Array.isArray(v)) return false;
    for (const p of v) {
      if (!p || typeof p !== "object") return false;
      if (typeof p.known !== "string" || typeof p.learn !== "string") return false;
    }
  }
  return true;
}

function tryParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// --- API ---
export function loadFolders() {
  // 1) spróbuj nowy klucz
  const raw = safeGet(STORAGE_KEY);
  if (raw) {
    const obj = tryParse(raw);
    if (isValidFolders(obj)) return obj;
    // uszkodzony wpis -> czyścimy, żeby nie wysypywać się w kółko
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // 2) migracja legacy kluczy (pierwszy, który zadziała)
  for (const key of LEGACY_KEYS) {
    const legacyRaw = safeGet(key);
    if (!legacyRaw) continue;
    const legacyObj = tryParse(legacyRaw);
    if (isValidFolders(legacyObj)) {
      // zapisz w nowym formacie i zwróć
      saveFolders(legacyObj);
      // opcjonalnie usuń stary
      try { localStorage.removeItem(key); } catch {}
      return legacyObj;
    }
  }

  // 3) brak danych lub niepoprawne
  return {};
}

export function saveFolders(folders) {
  safeSet(STORAGE_KEY, JSON.stringify(folders || {}));
}

export function ensureDefaults(folders) {
  if (!folders || Object.keys(folders).length === 0) {
    const defaults = {
      "Przykład": [
        { known: "cat",   learn: "kot" },
        { known: "dog",   learn: "pies" },
        { known: "house", learn: "dom" },
        { known: "car",   learn: "samochód" },
      ],
    };
    // od razu zapisz, żeby UI miał dane nawet na Pages
    saveFolders(defaults);
    return defaults;
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
  safeSet(LAST_FOLDER_KEY, String(name ?? ""));
}

export function getLastPairs() {
  const raw = safeGet(LAST_PAIRS_KEY);
  const n = parseInt(raw || "", 10);
  return Number.isNaN(n) ? null : n;
}
export function setLastPairs(n) {
  safeSet(LAST_PAIRS_KEY, String(n));
}

export function ensureFolder(folders, folderName) {
  if (!folders[folderName]) {
    folders[folderName] = [];
  }
  return folders;
}

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
  saveFolders(folders);
  return { folders, added };
}

// OPTIONAL: szybkie czyszczenie przy debugowaniu
export function resetAllStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LAST_FOLDER_KEY);
    localStorage.removeItem(LAST_PAIRS_KEY);
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {}
}
