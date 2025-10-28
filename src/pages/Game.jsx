// src/pages/Game.jsx

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useGame } from "../context/GameContext.jsx";
import { useGameSounds } from "../hooks/useGameSounds.jsx";

import GameOverModal from "../components/GameOverModal.jsx";

import {
  loadFolders,
  ensureDefaults,
  saveFolders,
  getFolderNames,
  getLastFolder,
  setLastFolder,
  getLastPairs,
  setLastPairs,
} from "../lib/storage.js";

import { clamp, shuffle, stableId } from "../lib/utils.js";

function Game() {
  // global stats z contextu gry
  const { stats, setStats } = useGame();

  const { playCorrect, playWrong, setVolume, setMuted, AudioElements } =
    useGameSounds();

  // nawigacja (do menu / do edycji słówek)
  const navigate = useNavigate();

  // foldery / ustawienia rundy
  const [folders, setFolders] = useState({});
  const [folderNames, setFolderNames] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [pairCount, setPairCount] = useState(8);

  // talie kart
  const [leftDeck, setLeftDeck] = useState([]);
  const [rightDeck, setRightDeck] = useState([]);

  // aktualnie zaznaczone karty
  const [selectedLeft, setSelectedLeft] = useState(null);
  const [selectedRight, setSelectedRight] = useState(null);

  // czy runda trwa
  const [roundActive, setRoundActive] = useState(false);

  // czy wyświetlamy ekran końca gry
  const [isFinished, setIsFinished] = useState(false);

  // referencje czasu / timeoutu
  const startTimeRef = useRef(0);
  const mismatchTimeoutRef = useRef(null);

  // ---------------------------------
  // INIT folderów, ustawień audio itp.
  // ---------------------------------
  useEffect(() => {
    let f = loadFolders();
    f = ensureDefaults(f);
    saveFolders(f);

    const names = getFolderNames(f);
    const last = getLastFolder();
    const firstFolder = last && names.includes(last) ? last : names[0] || "";

    setFolders(f);
    setFolderNames(names);
    setSelectedFolder(firstFolder);

    const rememberedPairs = getLastPairs();
    if (rememberedPairs) {
      setPairCount(rememberedPairs);
    }

    // domyślne audio settings
    setVolume(1);
    setMuted(false);
  }, [setVolume, setMuted]);

  // ---------------------------------
  // TIMER: aktualizuj czas gry w sekundach
  // ---------------------------------
  useEffect(() => {
    if (!roundActive) return;
    const id = setInterval(() => {
      const secs = Math.floor(
        (performance.now() - startTimeRef.current) / 1000
      );
      setStats((prev) => ({
        ...prev,
        seconds: secs,
      }));
    }, 200);
    return () => clearInterval(id);
  }, [roundActive, setStats]);

  // ---------------------------------
  // START RUNDY
  // ---------------------------------
  function handleStartRound() {
    if (!selectedFolder) {
      alert("Wybierz folder najpierw.");
      return;
    }

    const allPairs = folders[selectedFolder] || [];
    if (allPairs.length === 0) {
      alert("Ten folder jest pusty.");
      return;
    }

    const req = parseInt(pairCount, 10) || 2;
    const finalCount = clamp(req, 2, allPairs.length);

    setLastFolder(selectedFolder);
    setLastPairs(finalCount);

    const chosen = shuffle(allPairs).slice(0, finalCount);

    const left = shuffle(
      chosen.map((p) => ({
        word: p.known,
        pairId: stableId(p.known, p.learn),
        matched: false,
      }))
    );
    const right = shuffle(
      chosen.map((p) => ({
        word: p.learn,
        pairId: stableId(p.known, p.learn),
        matched: false,
      }))
    );

    setLeftDeck(left);
    setRightDeck(right);

    setSelectedLeft(null);
    setSelectedRight(null);

    startTimeRef.current = performance.now();
    setRoundActive(true);
    setIsFinished(false); // start nowej gry -> modal nie pokazuje się

    // reset statystyk
    setStats({
      moves: 0,
      matches: 0,
      totalPairs: chosen.length,
      seconds: 0,
    });
  }

  // ---------------------------------
  // KONIEC GRY (wywołujemy, gdy wszystkie pary trafione)
  // ---------------------------------
  function finishGameForReal(finalMatches, finalTotalPairs, finalSeconds, finalMoves) {
    // zatrzymujemy rundę
    setRoundActive(false);

    // utrwalamy końcowe wartości w stats (żeby modal dostał świeży czas/moves)
    setStats((prev) => ({
      ...prev,
      matches: finalMatches,
      totalPairs: finalTotalPairs,
      seconds: finalSeconds,
      moves: finalMoves,
    }));

    // pokazujemy modal końca gry
    setIsFinished(true);
  }

  // ---------------------------------
  // SPRAWDŹ PARĘ kart
  // ---------------------------------
  function evaluatePair(leftIdx, rightIdx) {
    const leftCard = leftDeck[leftIdx];
    const rightCard = rightDeck[rightIdx];

    const isMatch =
      leftCard.pairId === rightCard.pairId &&
      !leftCard.matched &&
      !rightCard.matched;

    // każdy check pary = +1 ruch
    setStats((prev) => ({
      ...prev,
      moves: prev.moves + 1,
    }));

    if (isMatch) {
      // poprawna para
      const newLeft = [...leftDeck];
      const newRight = [...rightDeck];

      newLeft[leftIdx] = { ...leftCard, matched: true };
      newRight[rightIdx] = { ...rightCard, matched: true };

      setLeftDeck(newLeft);
      setRightDeck(newRight);

      setSelectedLeft(null);
      setSelectedRight(null);

      playCorrect();

      setStats((prev) => {
        const newMatches = prev.matches + 1;

        // sprawdzamy czy to był ostatni match = KONIEC GRY
        if (newMatches === prev.totalPairs) {
          const secondsEnd = Math.floor(
            (performance.now() - startTimeRef.current) / 1000
          );

          // UWAGA: tu podmieniamy alert() na nasz modal
          finishGameForReal(
            newMatches,
            prev.totalPairs,
            secondsEnd,
            prev.moves + 1 // +1 bo dopiero co zwiększyliśmy moves
          );
        }

        return { ...prev, matches: newMatches };
      });
    } else {
      // zła para
      playWrong();

      if (mismatchTimeoutRef.current) {
        clearTimeout(mismatchTimeoutRef.current);
      }

      mismatchTimeoutRef.current = setTimeout(() => {
        setSelectedLeft(null);
        setSelectedRight(null);
      }, 600);
    }
  }

  // ---------------------------------
  // KLIK w kartę po lewej
  // ---------------------------------
  function onLeftClick(idx) {
    if (!roundActive) return;
    const card = leftDeck[idx];
    if (card.matched) return;

    if (selectedLeft === idx) {
      setSelectedLeft(null);
      return;
    }

    setSelectedLeft(idx);

    if (selectedRight !== null) {
      evaluatePair(idx, selectedRight);
    }
  }

  // ---------------------------------
  // KLIK w kartę po prawej
  // ---------------------------------
  function onRightClick(idx) {
    if (!roundActive) return;
    const card = rightDeck[idx];
    if (card.matched) return;

    if (selectedRight === idx) {
      setSelectedRight(null);
      return;
    }

    setSelectedRight(idx);

    if (selectedLeft !== null) {
      evaluatePair(selectedLeft, idx);
    }
  }

  // ---------------------------------
  // CALLBACKI do modalowych przycisków
  // ---------------------------------
  function handlePlayAgain() {
    // restart tej samej rundy z tymi samymi ustawieniami
    // po prostu odpalamy handleStartRound znowu
    handleStartRound();
  }

  function handleGoMenu() {
    navigate("/"); // Home / menu główne
  }

  function handleEditWords() {
    navigate("/mystorage"); // zakładka edycji słówek
  }

  // ---------------------------------
  // DANE dla modała końca gry
  // ---------------------------------
  const pairsFound = stats.matches || 0;
  const totalPairs = stats.totalPairs || 0;
  const accuracy =
    totalPairs > 0 ? Math.round((pairsFound / totalPairs) * 100) : 0;
  const timeSec = stats.seconds || 0;

  const modalStats = {
    pairsFound,
    totalPairs,
    accuracy,
    timeSec,
  };

  return (
    <>
      <main className="board wrap">
        {/* PANEL USTAWIEŃ RUNDY */}
        <section className="panel" aria-label="Wybór folderu">
          <div className="row">
            <div>
              <label htmlFor="folder">Wybierz folder</label>
              <select
                id="folder"
                value={selectedFolder}
                onChange={(e) => setSelectedFolder(e.target.value)}
                disabled={roundActive} // blokuj zmianę w trakcie gry
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
              <div className="hint" id="folder-hint">
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
                disabled={roundActive} // nie zmieniamy w trakcie gry
              />
              <div className="hint">Zapamiętamy to ustawienie.</div>
            </div>

            <div>
              <button
                className="btn"
                id="btn-start"
                onClick={handleStartRound}
                disabled={roundActive}
              >
                Start ▶
              </button>
            </div>

            {/* DEBUG PRZYCISK: wymuś koniec gry, żeby zobaczyć modal */}
            <div>
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  // symulujemy "wszystkie pary znalezione"
                  finishGameForReal(
                    5, // trafione pary
                    5, // łącznie par
                    42, // sekundy
                    stats.moves || 12 // ruchy (fallback)
                  );
                }}
              >
                [DEBUG] Pokaż ekran końca gry
              </button>
            </div>
          </div>
        </section>

        {/* PANEL Z KARTAMI GRY */}
        <section className="panel" aria-live="polite">
          <div className="columns">
            {/* LEWA KOLUMNA */}
            <div className="col" aria-label="Kolumna język 1">
              {leftDeck.map((card, idx) => {
                const isSelected = selectedLeft === idx && !card.matched;
                const cls =
                  "card" +
                  (card.matched ? " matched disabled" : "") +
                  (isSelected ? " selected" : "");
                return (
                  <button
                    key={idx}
                    className={cls}
                    onClick={() => onLeftClick(idx)}
                    disabled={!roundActive}
                  >
                    {card.word}
                  </button>
                );
              })}
            </div>

            {/* PRAWA KOLUMNA */}
            <div className="col" aria-label="Kolumna język 2">
              {rightDeck.map((card, idx) => {
                const isSelected = selectedRight === idx && !card.matched;
                const cls =
                  "card" +
                  (card.matched ? " matched disabled" : "") +
                  (isSelected ? " selected" : "");
                return (
                  <button
                    key={idx}
                    className={cls}
                    onClick={() => onRightClick(idx)}
                    disabled={!roundActive}
                  >
                    {card.word}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* MODAL KOŃCA GRY */}
      <GameOverModal
        isOpen={isFinished}
        stats={modalStats}
        onPlayAgain={handlePlayAgain}
        onGoMenu={handleGoMenu}
        onEditWords={handleEditWords}
        variant="green" // "green" sukces vibe, możesz zmienić na "blue"
      />

      {/* audio players (niewidoczne) */}
      {AudioElements}
    </>
  );
}

export default Game;
  