// src/lib/storage.js
import { stableId } from "./utils.js";

const STORAGE_KEY = "wordFolders_v2";
const LAST_FOLDER_KEY = "mp_last_folder";
const LAST_PAIRS_KEY = "mp_last_pairs";

export function loadFolders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

export function saveFolders(folders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
}

export function ensureDefaults(folders) {
  if (Object.keys(folders).length === 0) {
    folders["Przykład"] = [
      { known: "cat", learn: "kot" },
      { known: "dog", learn: "pies" },
      { known: "house", learn: "dom" },
      { known: "car", learn: "samochód" }
    ];
  }
  return folders;
}

export function getFolderNames(folders) {
  return Object.keys(folders).sort((a, b) => a.localeCompare(b));
}

export function getLastFolder() {
  return localStorage.getItem(LAST_FOLDER_KEY) || null;
}
export function setLastFolder(name) {
  localStorage.setItem(LAST_FOLDER_KEY, name);
}

export function getLastPairs() {
  const n = parseInt(localStorage.getItem(LAST_PAIRS_KEY) || "", 10);
  return Number.isNaN(n) ? null : n;
}
export function setLastPairs(n) {
  localStorage.setItem(LAST_PAIRS_KEY, String(n));
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
    folders[folderName].map((p) => [stableId(p.known, p.learn), p])
  );

  let added = 0;

  for (const p of pairs) {
    if (!p || !p.known || !p.learn) continue;
    const key = stableId(p.known, p.learn);
    if (!map.has(key)) {
      map.set(key, {
        known: p.known.trim(),
        learn: p.learn.trim(),
      });
      added++;
    }
  }

  folders[folderName] = Array.from(map.values());
  saveFolders(folders);
  return { folders, added };
}
