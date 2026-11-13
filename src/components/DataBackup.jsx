// src/components/DataBackup.jsx
// Dane i kopia zapasowa: eksport, import, lista kopii, podgląd i przywracanie.
// Przywracanie tylko po potwierdzeniu; obecne dane są najpierw zachowywane.
import { useEffect, useState } from "react";
import { STORAGE_KEY, storageUsage, subscribeToFolderChanges, repairAfterRestore } from "../lib/storage.js";
import {
  listSnapshots,
  createExport,
  parseImport,
  restoreSnapshot,
  storageErrorMessage,
  downloadText,
  deleteSnapshot,
  isDeletableCopyKey,
  MAX_IMPORT_CHARS,
  STORAGE_LIMIT_CHARS,
} from "../lib/backup.js";

const STATUS_TEXT = {
  ok: "poprawne",
  partial: "częściowo uszkodzone",
  unreadable: "nieczytelne (tylko do pobrania)",
};

const k = (chars) => `${Math.ceil(chars / 1000)} tys. znaków`;
const when = (iso) => (iso ? new Date(iso).toLocaleString("pl-PL") : "");
const counts = (s) => `${s.folderCount} folder(y), ${s.pairCount} par`;

function DataBackup() {
  const [snapshots, setSnapshots] = useState([]);
  const [usage, setUsage] = useState(undefined); // undefined = jeszcze nie sprawdzono, null = pamięć niedostępna
  const [preview, setPreview] = useState(null); // { title, raw, key?, ...inspect }
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null); // kopia czekająca na potwierdzenie
  const [understood, setUnderstood] = useState(false);

  function refresh() {
    setSnapshots(listSnapshots());
    setUsage(storageUsage());
  }

  useEffect(() => {
    refresh();
    // zmiana w innej karcie: najpierw ochrona przywróconych danych i zgubionych zapisów
    return subscribeToFolderChanges((e) => {
      repairAfterRestore({ seen: e.key === STORAGE_KEY ? [e.newValue] : [] });
      refresh();
    });
  }, []);

  const current = snapshots.find((s) => s.kind === "current");

  function download(s) {
    const { filename, text } = createExport({ raw: s.raw, source: s.key });
    downloadText(filename, text);
  }

  async function onImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage("");
    if (file.size > MAX_IMPORT_CHARS * 4) {
      setPreview(null);
      setMessage(storageErrorMessage({ error: "too-large" }));
      return;
    }
    const res = parseImport(await file.text());
    if (!res.ok) {
      setPreview(null);
      setMessage(storageErrorMessage(res));
      return;
    }
    setPreview({ ...res, title: `Plik: ${file.name}` });
  }

  function askDelete(s) {
    setMessage("");
    setPreview(null);
    setUnderstood(false);
    setPendingDelete(s);
  }

  function confirmDelete() {
    const s = pendingDelete;
    if (!window.confirm(`Usunąć na stałe: ${s.label} ${when(s.createdAt)} (${k(s.chars)})?

Tej kopii nie da się potem odzyskać. Obecne słówka nie zostaną zmienione.`)) return;
    const res = deleteSnapshot({ key: s.key, raw: s.raw });
    setMessage(res.ok ? `Usunięto kopię ${s.key} (zwolniono ${k(res.freedChars)}).` : storageErrorMessage(res));
    setPendingDelete(null);
    refresh();
  }

  function restore(mode) {
    const cur = current ? counts(current) : "brak zapisanych słówek";
    const question =
      mode === "replace"
        ? `Zastąpić obecne słówka (${cur}) danymi z: ${preview.title} (${counts(preview)})?`
        : `Dodać do obecnych słówek (${cur}) brakujące foldery i pary z: ${preview.title}? Nic nie zostanie usunięte.`;
    if (!window.confirm(`${question}\n\nObecne dane zostaną najpierw zachowane jako kopia odzyskiwania. Kopie nie są usuwane automatycznie.`)) return;

    const res = restoreSnapshot({ raw: preview.raw, key: preview.key, mode });
    if (!res.ok) {
      setMessage(storageErrorMessage(res));
    } else {
      setMessage(
        `Przywrócono (${counts(res)}).` +
          (res.recoveryKey ? ` Poprzednie dane zachowano jako: ${res.recoveryKey}.` : "")
      );
      setPreview(null);
    }
    refresh();
  }

  if (usage === undefined) {
    return (
      <section className="panel" id="dane" aria-label="Dane i kopia zapasowa">
        <h2>Dane i kopia zapasowa</h2>
      </section>
    );
  }

  if (!usage) {
    return (
      <section className="panel" id="dane" aria-label="Dane i kopia zapasowa">
        <h2>Dane i kopia zapasowa</h2>
        <p className="hint" role="status">
          ⚠️ Pamięć przeglądarki jest niedostępna — nie ma danych do eksportu, a import nie może zostać zapisany.
        </p>
      </section>
    );
  }

  const percent = Math.round((usage.totalChars / STORAGE_LIMIT_CHARS) * 100);
  const nearlyFull = percent >= 80;
  const copiesChars = snapshots.filter((s) => isDeletableCopyKey(s.key)).reduce((n, s) => n + s.key.length + s.chars, 0);

  return (
    <section className="panel" id="dane" aria-label="Dane i kopia zapasowa">
      <h2>Dane i kopia zapasowa</h2>
      <p className="hint">
        Słówka są zapisane tylko w tej przeglądarce. Zajęte miejsce: {k(usage.totalChars)} ({percent}% z ok. 5,2 mln znaków),
        w tym ta aplikacja: {k(usage.appChars)}, kopie: {k(copiesChars)}. Limit jest wspólny dla wszystkich stron z rexer00.github.io.
      </p>
      {nearlyFull && (
        <p className="hint" role="status" id="capacity-warning">
          ⚠️ Mało miejsca w pamięci przeglądarki — zapisy mogą się nie udać. Wyeksportuj słówka; niepotrzebne kopie możesz pobrać i usunąć poniżej.
        </p>
      )}

      <div className="row">
        <button className="btn" onClick={() => download(current)} disabled={!current}>
          Eksportuj słówka (JSON)
        </button>
        <label className="btn" htmlFor="import-file">
          Importuj z pliku…
        </label>
        <input id="import-file" type="file" accept=".json,application/json" onChange={onImportFile} hidden />
      </div>

      {message && (
        <p className="hint" role="status" id="backup-message">
          {message}
        </p>
      )}

      <h3>Zapisane kopie</h3>
      {snapshots.length === 0 && <p className="hint">Brak zapisanych słówek i kopii.</p>}
      <ul className="snapshot-list">
        {snapshots.map((s) => (
          <li key={s.key} data-key={s.key}>
            <div>
              <strong>{s.label}</strong> {when(s.createdAt)}
              <div className="hint">
                {s.key === STORAGE_KEY ? "" : `${s.key} • `}
                {STATUS_TEXT[s.status]}
                {s.status !== "unreadable" && ` • ${counts(s)}`} • {k(s.chars)}
              </div>
            </div>
            <div className="row">
              <button className="btn ghost" onClick={() => download(s)}>
                Pobierz
              </button>
              {s.kind !== "current" && (
                <button className="btn ghost" onClick={() => { setMessage(""); setPendingDelete(null); setPreview({ ...s, title: `${s.label} ${when(s.createdAt)}`.trim() }); }}>
                  Podgląd
                </button>
              )}
              {isDeletableCopyKey(s.key) && (
                <button className="btn ghost" onClick={() => askDelete(s)}>
                  Usuń…
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {pendingDelete && (
        <div className="snapshot-preview" aria-label="Usuwanie kopii" id="delete-panel">
          <h3>Usunąć kopię: {pendingDelete.label} {when(pendingDelete.createdAt)}</h3>
          <p className="hint">
            {pendingDelete.key} • {STATUS_TEXT[pendingDelete.status]}
            {pendingDelete.status !== "unreadable" && ` • ${counts(pendingDelete)}`} • {k(pendingDelete.chars)}.
            Usuniętej kopii nie da się odzyskać — najpierw ją pobierz, jeśli może się przydać.
          </p>
          <label className="hint">
            <input type="checkbox" id="delete-understood" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />{" "}
            Rozumiem, że ta kopia zostanie usunięta na stałe
          </label>
          <div className="row">
            <button className="btn" onClick={() => download(pendingDelete)}>
              Pobierz przed usunięciem
            </button>
            <button className="btn" onClick={confirmDelete} disabled={!understood}>
              Usuń na stałe
            </button>
            <button className="btn ghost" onClick={() => setPendingDelete(null)}>
              Anuluj
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="snapshot-preview" aria-label="Podgląd kopii">
          <h3>Podgląd: {preview.title}</h3>
          <p className="hint">
            Stan: {STATUS_TEXT[preview.status]}
            {preview.status === "partial" && ` (pominięte uszkodzone wpisy: ${preview.skipped})`}
            {preview.status !== "unreadable" && ` • ${counts(preview)}`}
          </p>
          {preview.status !== "unreadable" && (
            <ul>
              {Object.entries(preview.folders).slice(0, 20).map(([name, list]) => (
                <li key={name}>
                  {name} ({list.length}){list.length > 0 && ": "}
                  {list.slice(0, 3).map((x) => `${x.known} — ${x.learn}`).join(", ")}
                  {list.length > 3 && ", …"}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            {preview.status !== "unreadable" && (
              <>
                <button className="btn" onClick={() => restore("merge")}>
                  Dodaj brakujące do obecnych
                </button>
                <button className="btn" onClick={() => restore("replace")}>
                  Zastąp obecne słówka
                </button>
              </>
            )}
            <button className="btn ghost" onClick={() => setPreview(null)}>
              Zamknij podgląd
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default DataBackup;
