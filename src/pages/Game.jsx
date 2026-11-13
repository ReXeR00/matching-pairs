// src/pages/Game.jsx
// Widok rundy. Cała logika gry (zaznaczenia, próby, punktacja, koniec rundy)
// jest w lib/gameEngine.js; tutaj tylko render, dźwięki i timery.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGame } from "../context/GameContext.jsx";
import { useGameSounds } from "../hooks/useGameSounds.jsx";
import GameOverModal from "../components/GameOverModal.jsx";
import StorageNotice from "../components/StorageNotice.jsx";

import {
  STORAGE_KEY,
  loadFoldersWithStatus,
  ensureDefaults,
  getFolderNames,
  getLastFolder,
  setLastFolder,
  getFolderPairs,
  getLastPairs,
  setLastPairs,
  subscribeToFolderChanges,
  repairAfterRestore,
} from "../lib/storage.js";
import { createIdleState, step, roundStats, isHighlighted } from "../lib/gameEngine.js";
import { random } from "../lib/utils.js";

function Game() {
  // global stats
  const { setStats } = useGame();
  // sounds
  const { playCorrect, playWrong, setVolume, setMuted, AudioElements } =
    useGameSounds();
  // nav
  const navigate = useNavigate();

  // folders / settings
  const [folders, setFolders] = useState({});
  const [folderNames, setFolderNames] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [pairCount, setPairCount] = useState(8);
  const [storageState, setStorageState] = useState(null);

  // stan rundy (silnik gry); ref = zawsze najnowszy stan dla timerów i kliknięć
  const [game, setGame] = useState(createIdleState);
  const gameRef = useRef(game);
  const timersRef = useRef(new Set());
  const [now, setNow] = useState(() => performance.now());

  function clearTimers() {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current.clear();
  }

  function dispatch(action) {
    const { state, effects } = step(gameRef.current, action, { now: performance.now(), rng: random });
    if (state !== gameRef.current) {
      gameRef.current = state;
      setGame(state);
    }
    for (const fx of effects) {
      if (fx.type === "sound") (fx.kind === "correct" ? playCorrect : playWrong)();
      else if (fx.type === "timer") {
        const id = setTimeout(() => {
          timersRef.current.delete(id);
          dispatch(fx.action);
        }, fx.ms);
        timersRef.current.add(id);
      }
    }
  }

  // --- folders: odczyt bez zapisu; przykładowy folder tylko przy pustej pamięci ---
  function loadFolderList() {
    const loaded = loadFoldersWithStatus();
    const f = loaded.status === "empty" ? ensureDefaults(loaded.folders) : loaded.folders;
    const names = getFolderNames(f);
    setStorageState(loaded);
    setFolders(f);
    setFolderNames(names);
    return names;
  }

  useEffect(() => {
    const names = loadFolderList();
    const last = getLastFolder();
    setSelectedFolder(last && names.includes(last) ? last : names[0] || "");

    const rememberedPairs = getLastPairs();
    if (rememberedPairs) setPairCount(rememberedPairs);

    setVolume(1);
    setMuted(false);

    // słówka zmienione w innej karcie: odśwież listę folderów.
    // Trwająca runda ma własną kopię par — nic się w niej nie zmienia.
    const unsubscribe = subscribeToFolderChanges((e) => {
      repairAfterRestore({ seen: e.key === STORAGE_KEY ? [e.newValue] : [] });
      const fresh = loadFolderList();
      setSelectedFolder((cur) => (fresh.includes(cur) ? cur : fresh[0] || ""));
    });
    // timery rundy nie mogą działać po opuszczeniu strony
    return () => {
      unsubscribe();
      clearTimers();
    };
  }, [setVolume, setMuted]);

  // --- zegar: tylko w trakcie rundy ---
  const playing = game.status === "playing";
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [playing]);

  // --- statystyki w pasku u góry ---
  const stats = roundStats(game, now);
  useEffect(() => {
    if (game.status === "idle") return;
    setStats({ moves: stats.attempts, matches: stats.correct, totalPairs: stats.totalPairs, seconds: stats.seconds });
  }, [game.status, stats.attempts, stats.correct, stats.totalPairs, stats.seconds, setStats]);

  // --- start round ---
  function handleStartRound() {
    if (!selectedFolder) { alert("Wybierz folder najpierw."); return; }
    const allPairs = getFolderPairs(folders, selectedFolder) || [];
    if (allPairs.length === 0) { alert("Ten folder jest pusty."); return; }

    clearTimers(); // animacje poprzedniej rundy nie dotkną nowej
    setNow(performance.now());
    dispatch({ type: "start", pairs: allPairs, count: pairCount });

    setLastFolder(selectedFolder);
    setLastPairs(gameRef.current.queue.length);
  }

  // --- modal actions ---
  function handlePlayAgain() {
    handleStartRound(); // restart z tymi samymi ustawieniami
  }
  function handleGoMenu() {
    navigate("/");
  }
  function handleEditWords() {
    navigate("/mystorage");
  }

  const modalStats = {
    pairsFound: stats.correct,
    totalPairs: stats.totalPairs,
    accuracy: stats.accuracy,
    attempts: stats.attempts,
    wrong: stats.wrong,
    timeSec: stats.seconds,
  };

  function renderCard(side, card) {
    const cls =
      "card" +
      (isHighlighted(game, side, card.id) ? " selected" : "") +
      (game.removing[card.id] ? " fading" : "") +
      (game.appearing[card.id] ? " appearing" : "");
    return (
      <button
        key={card.id}
        className={cls}
        aria-disabled={game.removing[card.id] ? "true" : undefined}
        onClick={() => dispatch({ type: "select", side, cardId: card.id })}
      >
        {card.word}
      </button>
    );
  }

  return (
    <>
      <main className="board wrap">
        {/* PANEL USTAWIEŃ — widoczny tylko PRZED grą */}
        {!playing && (
          <section className="panel" aria-label="Wybór folderu">
            <StorageNotice state={storageState} />
            <div className="row">
              <div>
                <label htmlFor="folder">Wybierz folder</label>
                <select
                  id="folder"
                  value={selectedFolder}
                  onChange={(e) => setSelectedFolder(e.target.value)}
                >
                  {folderNames.length === 0 && <option value="">(brak folderów)</option>}
                  {folderNames.map((name) => (
                    <option key={name} value={name}>
                      {name} ({getFolderPairs(folders, name)?.length || 0})
                    </option>
                  ))}
                </select>
                <div className="hint">
                  {folderNames.length
                    ? "Wybierz folder i kliknij Start."
                    : 'Brak folderów — dodaj je w zakładce "Dodaj słowa".'}
                </div>
              </div>

              <div>
                <label htmlFor="pairs-count">Ile par w rundzie?</label>
                <input
                  id="pairs-count"
                  type="number"
                  min="2"
                  step="1"
                  value={pairCount}
                  onChange={(e) => setPairCount(e.target.value)}
                />
                <div className="hint">Zapamiętamy to ustawienie.</div>
              </div>

              <div>
                <button className="btn" id="btn-start" onClick={handleStartRound}>
                  Start ▶
                </button>
              </div>
            </div>
          </section>
        )}

        {/* PLANSZA — widoczna tylko W TRAKCIE gry */}
        {playing && (
          <section className="panel" aria-live="polite">
            <div className="columns">
              <div className="col" aria-label="Kolumna język 1">
                {game.left.map((card) => renderCard("left", card))}
              </div>
              <div className="col" aria-label="Kolumna język 2">
                {game.right.map((card) => renderCard("right", card))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* MODAL KOŃCA GRY */}
      <GameOverModal
        isOpen={game.status === "finished"}
        stats={modalStats}
        onPlayAgain={handlePlayAgain}
        onGoMenu={handleGoMenu}
        onEditWords={handleEditWords}
        variant="green"
      />

      {/* audio (ukryte) */}
      {AudioElements}
    </>
  );
}

export default Game;
