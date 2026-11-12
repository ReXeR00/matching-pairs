// src/pages/Storage.jsx
import { useEffect, useRef, useState } from "react";
import StorageNotice from "../components/StorageNotice.jsx";
import {
  loadFoldersWithStatus,
  updateFolders,
  reconcileLostWrite,
  subscribeToFolderChanges,
  ensureDefaults,
  getFolderNames,
  ensureFolder,
  mergePairs,
} from "../lib/storage.js";

const SAVE_FAILED =
  "Nie udało się zapisać — pamięć przeglądarki jest pełna lub zablokowana. Wcześniej zapisane słówka są nienaruszone.";
const MERGED_NOTE = " (uwzględniono też zmiany zapisane w innej karcie)";

function Storage() {
  const [folders, setFolders] = useState({});
  const [folderNames, setFolderNames] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [rows, setRows] = useState([{ known: "", learn: "" }]);
  const [newFolderName, setNewFolderName] = useState("");
  const [storageState, setStorageState] = useState(null);
  const [syncNote, setSyncNote] = useState("");
  // rewizja danych widocznych na stronie i ostatnia wartość zapisana przez tę kartę
  const revisionRef = useRef(null);
  const lastWrittenRef = useRef(null);

  function showFolders(f, preferred) {
    const names = getFolderNames(f);
    setFolders(f);
    setFolderNames(names);
    setSelectedFolder((cur) => {
      const want = preferred ?? cur;
      return names.includes(want) ? want : names[0] || "";
    });
  }

  function loadView() {
    // odczyt bez zapisu; przykładowy folder tylko przy pustej pamięci
    const loaded = loadFoldersWithStatus();
    const f = loaded.status === "empty" ? ensureDefaults(loaded.folders) : loaded.folders;
    setStorageState(loaded);
    revisionRef.current = loaded.raw;
    showFolders(f);
  }

  useEffect(() => {
    loadView();
    // inna karta zmieniła słówka: przywróć ewentualnie nadpisany zapis tej karty
    // i odśwież listę (wpisane w formularzu słówka zostają)
    return subscribeToFolderChanges(() => {
      const rec = reconcileLostWrite(lastWrittenRef.current);
      loadView();
      if (rec.ok && rec.restored > 0) {
        lastWrittenRef.current = rec.raw;
        setSyncNote(`Przywrócono ${rec.restored} wpis(y) nadpisane przez inną kartę. Lista została odświeżona.`);
      } else if (!rec.ok) {
        setSyncNote("Słówka zapisane w tej karcie zostały usunięte lub uszkodzone w innej karcie — nic nie nadpisano automatycznie.");
      } else {
        setSyncNote("Słówka zmieniły się w innej karcie — lista została odświeżona.");
      }
    });
  }, []);

  // zapis zawsze na najnowszych danych z pamięci, nie na kopii z chwili otwarcia strony;
  // `mine` przywraca wpisy tej karty, gdyby jej odczyt był nieaktualny
  function applyChange(change) {
    const res = updateFolders(change, { expected: revisionRef.current, mine: lastWrittenRef.current });
    if (res.ok) {
      revisionRef.current = res.raw;
      lastWrittenRef.current = res.raw;
    }
    return res;
  }

  function addRow() {
    setRows([...rows, { known: "", learn: "" }]);
  }

  function updateRow(i, field, value) {
    const updated = [...rows];
    updated[i][field] = value;
    setRows(updated);
  }

  function createFolder() {
    const name = newFolderName.trim();
    if (!name) {
      alert("Podaj nazwę folderu.");
      return;
    }

    const res = applyChange((f) => ensureFolder(f, name));
    if (!res.ok) {
      alert(SAVE_FAILED);
      return;
    }

    showFolders(res.folders, name);
    setNewFolderName("");

    alert(`Folder "${name}" gotowy ✅` + (res.stale ? MERGED_NOTE : ""));
  }

  function saveWords() {
    if (!selectedFolder) {
      alert("Wybierz folder docelowy najpierw.");
      return;
    }

    const cleaned = rows
      .map((r) => ({
        known: r.known.trim(),
        learn: r.learn.trim(),
      }))
      .filter((r) => r.known && r.learn);

    if (cleaned.length === 0) {
      alert("Brak słówek do zapisania 😅");
      return;
    }

    const res = applyChange((f) => mergePairs(f, selectedFolder, cleaned));
    if (!res.ok) {
      // wpisane słówka zostają w formularzu, żeby można było spróbować ponownie
      alert(SAVE_FAILED);
      return;
    }

    showFolders(res.folders, selectedFolder);
    setRows([{ known: "", learn: "" }]);

    alert(`Dodano ${res.result.added} par(y) do folderu "${selectedFolder}".` + (res.stale ? MERGED_NOTE : ""));
  }

  // Placeholdery - CSV zrobimy w następnym kroku
  function previewCsv() {
    alert("Podgląd CSV jeszcze nie podpięty 👀");
  }
  function importFromCsv() {
    alert("Import CSV jeszcze nie podpięty 🔄");
  }
  function exportCsv() {
    if (!selectedFolder) {
      alert("Najpierw wybierz folder do eksportu.");
      return;
    }
    alert(
      `Eksport CSV dla folderu "${selectedFolder}" jeszcze nie podpięty 📤`
    );
  }

  return (
    <main className="board wrap">
      <section className="panel" aria-label="Dodaj słowa">
        <StorageNotice state={storageState} />
        {syncNote && (
          <div className="hint" role="status">
            🔄 {syncNote}
          </div>
        )}
        {/* wybór / tworzenie folderu */}
        <div className="stack">
          <label htmlFor="edit-folder">Folder docelowy</label>
          <select
            id="edit-folder"
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.target.value)}
          >
            {folderNames.length === 0 && (
              <option value="">(brak folderów)</option>
            )}
            {folderNames.map((name) => (
              <option key={name} value={name}>
                {name} ({folders[name]?.length || 0})
              </option>
            ))}
          </select>

          <div className="hint" id="edit-folder-hint">
            {folderNames.length === 0
              ? "Brak folderów. Utwórz nowy poniżej 👇"
              : "Edytujesz wybrany folder."}
          </div>

          <div className="row">
            <div className="stack">
              <label htmlFor="new-folder-name">Nowy folder</label>
              <input
                id="new-folder-name"
                placeholder="np. Zwierzęta"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
              />
            </div>

            <div className="stack">
              <label>&nbsp;</label>
              <button className="btn" onClick={createFolder}>
                Utwórz nowy folder
              </button>
            </div>
          </div>
        </div>

        <hr />

        {/* edytor par słówek */}
        <div className="stack">
          <label>Dodaj pary słówek</label>
          <div className="hint">
            Lewa kolumna = język 1 • Prawa kolumna = język 2. Kliknij ➕,
            żeby dodać kolejną linię.
          </div>

          <div id="pair-builder" className="pair-builder">
            {rows.map((row, i) => (
              <div className="pair-row" key={i}>
                <input
                  className="pair-known"
                  placeholder="np. kot"
                  value={row.known}
                  onChange={(e) => updateRow(i, "known", e.target.value)}
                />
                <input
                  className="pair-learn"
                  placeholder="np. cat"
                  value={row.learn}
                  onChange={(e) => updateRow(i, "learn", e.target.value)}
                />
              </div>
            ))}
          </div>

          <button
            className="btn ghost pair-add-btn"
            onClick={addRow}
            title="Dodaj linię"
          >
            ➕
          </button>

          <button className="btn" onClick={saveWords}>
            Zapisz do folderu
          </button>
        </div>

        <hr />

        {/* import/export CSV */}
        <div className="stack">
          <label htmlFor="sheets-url">
            Import z Google Sheets (opublikowany CSV URL)
          </label>
          <input
            type="url"
            id="sheets-url"
            placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
          />
          <div className="hint">
            W Arkuszach: Plik → Publikuj w internecie → wybierz arkusz →
            CSV → skopiuj link.
          </div>

          <div className="row">
            <button className="btn" onClick={previewCsv}>
              Podgląd CSV
            </button>
            <button className="btn" onClick={importFromCsv}>
              Importuj CSV → do wybranego folderu
            </button>
            <button className="btn" onClick={exportCsv}>
              Eksportuj folder → CSV
            </button>
          </div>

          <div
            id="csv-preview"
            className="csv-preview hidden"
            aria-live="polite"
          ></div>
        </div>
      </section>
    </main>
  );
}

export default Storage;
