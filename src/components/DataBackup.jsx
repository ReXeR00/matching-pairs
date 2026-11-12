// src/components/DataBackup.jsx
// Dane i kopia zapasowa: eksport, import, lista kopii, podgląd i przywracanie.
// Przywracanie tylko po potwierdzeniu; obecne dane są najpierw zachowywane.
import { useEffect, useState } from "react";
import { STORAGE_KEY, storageUsage, subscribeToFolderChanges } from "../lib/storage.js";
import {
  listSnapshots,
  createExport,
  parseImport,
  restoreSnapshot,
  storageErrorMessage,
  downloadText,
  MAX_IMPORT_CHARS,
} from "../lib/backup.js";

// Typowy limit localStorage w przeglądarkach (znaki, cały origin).
const TYPICAL_LIMIT_CHARS = 5_000_000;
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

  function refresh() {
    setSnapshots(listSnapshots());
    setUsage(storageUsage());
  }

  useEffect(() => {
    refresh();
    return subscribeToFolderChanges(refresh);
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

  const nearlyFull = usage.totalChars > TYPICAL_LIMIT_CHARS * 0.8;

  return (
    <section className="panel" id="dane" aria-label="Dane i kopia zapasowa">
      <h2>Dane i kopia zapasowa</h2>
      <p className="hint">
        Słówka są zapisane tylko w tej przeglądarce. Zajęte miejsce: {k(usage.totalChars)} (ta aplikacja: {k(usage.appChars)}).
        Przeglądarki zwykle pozwalają na ok. 5 mln znaków — wspólnie dla wszystkich stron z rexer00.github.io.
      </p>
      {nearlyFull && (
        <p className="hint" role="status">
          ⚠️ Mało miejsca w pamięci przeglądarki — wyeksportuj kopię słówek.
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
                <button className="btn ghost" onClick={() => { setMessage(""); setPreview({ ...s, title: `${s.label} ${when(s.createdAt)}`.trim() }); }}>
                  Podgląd
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

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
