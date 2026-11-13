// src/lib/backup.js
// Kopie zapasowe: lista kopii, eksport, import i przywracanie.
// Zasady:
// - przed przywróceniem obecne dane są zachowywane (kopia sprawdzona odczytem);
//   jeśli się nie da — nic nie jest zapisywane,
// - żadna kopia nie jest nigdy usuwana,
// - zapis tylko na wyraźne żądanie (potwierdzenie w UI).
import {
  STORAGE_KEY,
  BACKUP_KEY,
  RECOVERY_PREFIX,
  LEGACY_KEYS,
  inspectRaw,
  readSnapshotRaw,
  listRecoveryKeys,
  loadFoldersWithStatus,
  preserveForRecovery,
  startNewGeneration,
  lastWriteFailureReason,
  mergeFolders,
  saveFolders,
  isDeletableCopyKey,
  removeCopy,
  readGeneration,
  readGenerationRaw,
} from "./storage.js";

export const EXPORT_FORMAT = "matching-pairs-backup";
export const EXPORT_VERSION = 1;
export const MAX_IMPORT_CHARS = 5_000_000;
// Zmierzony limit localStorage w Edge/Chromium: 5 242 880 znaków (klucz + wartość) na origin.
export const STORAGE_LIMIT_CHARS = 5_242_880;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function summarize(folders) {
  const names = Object.keys(folders || {});
  return { folderCount: names.length, pairCount: names.reduce((n, k) => n + folders[k].length, 0) };
}

// --- lista kopii ---

function describe(key, raw) {
  const info = inspectRaw(raw);
  let kind = "legacy";
  let label = `Starsze dane (${key})`;
  let createdAt = null;
  if (key === STORAGE_KEY) {
    kind = "current";
    label = "Obecne słówka";
  } else if (key === BACKUP_KEY) {
    kind = "backup";
    label = "Kopia sprzed ostatniego zapisu";
  } else if (key.startsWith(RECOVERY_PREFIX)) {
    kind = "recovery";
    label = "Kopia odzyskiwania";
    const m = key.match(/:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)(?:-[a-z0-9]+)*$/);
    createdAt = m ? m[1] : null;
  }
  return { key, kind, label, createdAt, raw, chars: raw.length, ...info, ...summarize(info.folders) };
}

// Wszystkie kopie słówek tej aplikacji; nic nie zapisuje.
export function listSnapshots() {
  const recovery = listRecoveryKeys().reverse(); // najnowsze najpierw
  const keys = [STORAGE_KEY, BACKUP_KEY, ...recovery, ...LEGACY_KEYS];
  const out = [];
  for (const key of keys) {
    const raw = readSnapshotRaw(key);
    if (raw !== null) out.push(describe(key, raw));
  }
  return out;
}

// --- eksport ---

// Plik JSON: `data` = zapisane dane bez zmian (także uszkodzone wpisy),
// a dla danych nieczytelnych `rawText` = dokładna zapisana wartość.
export function createExport({ raw, source }, now = new Date()) {
  const parsed = tryParse(raw);
  const body = parsed.ok && isPlainObject(parsed.value) ? { data: parsed.value } : { rawText: raw };
  const payload = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now.toISOString(), source, ...body };
  const slug = String(source).replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "dane";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return { filename: `matching-pairs-${slug}-${stamp}.json`, text: JSON.stringify(payload, null, 2) };
}

// --- import ---

// Akceptuje: plik z createExport, zwykły obiekt { folder: [pary] } (format
// wordFolders_v2) oraz kopię z konsoli { exportedAt, origin, data: { klucz: "tekst" } }.
// Zwraca { ok, raw, source, folders, status, skipped, folderCount, pairCount } albo { ok: false, error }.
export function parseImport(text) {
  if (typeof text !== "string") return { ok: false, error: "invalid-format" };
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: "too-large" };
  const parsed = tryParse(text);
  if (!parsed.ok) return { ok: false, error: "not-json" };
  const v = parsed.value;
  if (!isPlainObject(v)) return { ok: false, error: "invalid-format" };

  let raw;
  let source;
  if (v.format === EXPORT_FORMAT) {
    if (v.version !== EXPORT_VERSION) return { ok: false, error: "unsupported-version" };
    if (isPlainObject(v.data)) raw = JSON.stringify(v.data);
    else if (typeof v.rawText === "string") raw = v.rawText;
    else return { ok: false, error: "invalid-format" };
    source = typeof v.source === "string" ? v.source : "plik";
  } else if (isPlainObject(v.data) && Object.values(v.data).every((x) => typeof x === "string" || x === null)) {
    const key = [STORAGE_KEY, ...LEGACY_KEYS].find((k) => typeof v.data[k] === "string");
    if (!key) return { ok: false, error: "no-vocabulary" };
    raw = v.data[key];
    source = key;
  } else {
    raw = text;
    source = "plik";
  }
  const info = inspectRaw(raw);
  return { ok: true, raw, source, ...info, ...summarize(info.folders) };
}

// --- przywracanie ---

// mode "merge": dopisuje brakujące foldery/pary (nic nie znika).
// mode "replace": zastępuje obecne słówka kopią.
// `key` — kopia z pamięci przeglądarki; musi być taka sama jak w podglądzie (`raw`).
// Zwraca { ok, recoveryKey, raw, folderCount, pairCount } albo { ok: false, error, reason? }.
export function restoreSnapshot({ raw, key, mode = "merge" }) {
  if (mode !== "merge" && mode !== "replace") return { ok: false, error: "invalid-mode" };
  if (key !== undefined && readSnapshotRaw(key) !== raw) return { ok: false, error: "source-changed" };
  const src = inspectRaw(raw);
  if (src.status === "unreadable") return { ok: false, error: "unreadable-source" };
  if (Object.keys(src.folders).length === 0) return { ok: false, error: "empty-source" };

  const current = loadFoldersWithStatus();
  if (current.status === "unavailable") return { ok: false, error: "unavailable" };

  // obecne dane najpierw do sprawdzonej kopii odzyskiwania — bez niej nic nie zapisujemy
  let recoveryKey = null;
  if (current.raw !== null) {
    recoveryKey = preserveForRecovery(current.raw);
    if (!recoveryKey) return { ok: false, error: "recovery-failed", reason: lastWriteFailureReason() };
  }

  // "zastąp": przywracane dane też trafiają do sprawdzonej kopii, a nowa
  // generacja (jeden klucz: id + obie kopie) powstaje PRZED zapisem danych —
  // inne karty odróżnią świadomie zastąpione słówka od nowych zapisów
  if (mode === "replace") {
    const restoredKey = preserveForRecovery(JSON.stringify(src.folders));
    if (!restoredKey) return { ok: false, error: "recovery-failed", reason: lastWriteFailureReason(), recoveryKey };
    const gen = startNewGeneration({ replacedKey: recoveryKey, restoredKey });
    if (!gen.ok) return { ok: false, error: "epoch-failed", reason: gen.reason, recoveryKey };
  }

  let next = src.folders;
  if (mode === "merge") {
    next = current.folders;
    mergeFolders(next, src.folders);
  }
  const res = saveFolders(next, { expected: current.raw });
  if (!res.ok) return { ok: false, error: res.error, reason: res.reason, recoveryKey };
  return { ok: true, mode, recoveryKey, raw: res.raw, ...summarize(next) };
}

// --- ręczne usuwanie kopii ---

export { isDeletableCopyKey };

// `raw` — zawartość pokazana użytkownikowi; jeśli kopia się zmieniła, nic nie usuwamy.
// Obecne słówka (STORAGE_KEY) i starsze klucze nie mogą być usunięte.
// Kopie wskazane przez ostatnie przywrócenie chronią zapisy z innych kart —
// nie można ich usunąć, dopóki nie zastąpi ich kolejne przywrócenie.
export function isCopyInUse(key) {
  const gen = readGeneration(readGenerationRaw());
  return !!gen && (gen.replaced === key || gen.restored === key);
}

export function deleteSnapshot({ key, raw }) {
  if (!isDeletableCopyKey(key)) return { ok: false, error: "protected-key" };
  if (isCopyInUse(key)) return { ok: false, error: "copy-in-use" };
  const now = readSnapshotRaw(key);
  if (now === null || now !== raw) return { ok: false, error: "source-changed" };
  if (!removeCopy(key)) return { ok: false, error: "delete-failed" };
  return { ok: true, freedChars: key.length + raw.length };
}

// --- komunikaty ---

const MESSAGES = {
  unavailable: "Pamięć przeglądarki jest zablokowana (np. tryb prywatny lub zablokowane dane witryn) — nic nie zostało zapisane.",
  conflict: "Nie udało się zapisać — dane zmieniły się w międzyczasie w innej karcie. Spróbuj ponownie.",
  "backup-failed": "Nie udało się zapisać — nie powstała kopia zapasowa, więc nic nie zostało nadpisane. Wcześniej zapisane słówka są nienaruszone.",
  "recovery-failed": "Nie udało się zachować kopii obecnych słówek, więc nic nie zostało nadpisane.",
  "epoch-failed": "Nie udało się przygotować przywracania (zapis znacznika nie powiódł się), więc nic nie zostało nadpisane.",
  "write-failed": "Nie udało się zapisać. Wcześniej zapisane słówka są nienaruszone.",
  "source-changed": "Ta kopia zmieniła się od podglądu — otwórz podgląd ponownie.",
  "copy-in-use": "Ta kopia chroni ostatnie przywrócenie (zapisy z innych kart) — nie można jej teraz usunąć.",
  "protected-key": "Tej pozycji nie można usunąć — obecne słówka i starsze dane są chronione.",
  "delete-failed": "Nie udało się usunąć kopii (pamięć przeglądarki zablokowana?). Nic nie zostało zmienione.",
  "unreadable-source": "Tej kopii nie da się odczytać jako słówek — możesz ją tylko pobrać.",
  "empty-source": "Ta kopia nie zawiera żadnych folderów.",
  "not-json": "To nie jest poprawny plik JSON.",
  "invalid-format": "Nieznany format pliku — oczekiwano kopii wyeksportowanej z tej aplikacji.",
  "unsupported-version": "Ten plik pochodzi z nowszej wersji aplikacji.",
  "no-vocabulary": "W pliku nie ma słówek tej aplikacji.",
  "too-large": "Plik jest za duży (ponad 5 mln znaków) — to nie wygląda na kopię słówek.",
};

export const QUOTA_MESSAGE =
  "Nie udało się zapisać — brak miejsca w pamięci przeglądarki. Nic nie zostało nadpisane, zapisane słówka są nienaruszone. " +
  "Miejsce dzielą wszystkie strony z rexer00.github.io. Wyeksportuj słówka: Ustawienia → Dane i kopia zapasowa.";

export function storageErrorMessage({ error, reason } = {}) {
  if (reason === "quota") return QUOTA_MESSAGE;
  return MESSAGES[error] || MESSAGES["write-failed"];
}

// --- pobieranie pliku (tylko przeglądarka) ---
export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
