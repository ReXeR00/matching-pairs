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

const MAX_VISIBLE = 5;

function Game() {
  // global stats
  const { stats, setStats } = useGame();
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

  // queue of pairs (cała runda)
  const [queue, setQueue] = useState([]); // [{pairId, known, learn}]
  const queueIdxRef = useRef(0);

  // widoczne karty (zawsze max 5 par)
  const [leftVisible, setLeftVisible] = useState([]);  // [{uid, word, pairId}]
  const [rightVisible, setRightVisible] = useState([]); // [{uid, word, pairId}]

  // zaznaczenia (indeksy w tablicach visible)
  const [selectedLeft, setSelectedLeft] = useState(null);
  const [selectedRight, setSelectedRight] = useState(null);

  // stan rundy / modal końca
  const [roundActive, setRoundActive] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  // animacyjne znaczniki: {uid: true}
  const [fading, setFading] = useState({});
  const [appearing, setAppearing] = useState({});

  // czasy
  const startTimeRef = useRef(0);
  const mismatchTimeoutRef = useRef(null);

  // --- init folders + audio ---
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
    if (rememberedPairs) setPairCount(rememberedPairs);

    setVolume(1);
    setMuted(false);
  }, [setVolume, setMuted]);

  // --- timer ---
  useEffect(() => {
    if (!roundActive) return;
    const id = setInterval(() => {
      const secs = Math.floor((performance.now() - startTimeRef.current) / 1000);
      setStats((prev) => ({ ...prev, seconds: secs }));
    }, 200);
    return () => clearInterval(id);
  }, [roundActive, setStats]);

  // helpers
  const uid = () => Math.random().toString(36).slice(2);

  function buildVisibleFromPairs(pairs) {
    const left = pairs.map((p) => ({ uid: `L-${uid()}`, word: p.known, pairId: p.pairId }));
    const right = pairs.map((p) => ({ uid: `R-${uid()}`, word: p.learn, pairId: p.pairId }));
    // niezależny shuffle, żeby nie stały „para pod parą”
    return { left: shuffle(left), right: shuffle(right) };
  }

  // --- start round ---
  function handleStartRound() {
    if (!selectedFolder) { alert("Wybierz folder najpierw."); return; }
    const allPairs = folders[selectedFolder] || [];
    if (allPairs.length === 0) { alert("Ten folder jest pusty."); return; }

    const req = parseInt(pairCount, 10) || 2;
    const finalCount = clamp(req, 2, allPairs.length);

    setLastFolder(selectedFolder);
    setLastPairs(finalCount);

    // twórz kolejkę par na rundę
    const chosenPairs = shuffle(allPairs).slice(0, finalCount).map((p) => ({
      pairId: stableId(p.known, p.learn),
      known: p.known,
      learn: p.learn,
    }));

    setQueue(chosenPairs);

    // pierwsze „okno” 5 par
    const initialPairs = chosenPairs.slice(0, MAX_VISIBLE);
    queueIdxRef.current = Math.min(MAX_VISIBLE, chosenPairs.length);

    const { left, right } = buildVisibleFromPairs(initialPairs);
    setLeftVisible(left);
    setRightVisible(right);

    setSelectedLeft(null);
    setSelectedRight(null);
    setFading({});
    setAppearing({});

    startTimeRef.current = performance.now();
    setRoundActive(true);
    setIsFinished(false);

    setStats({
      moves: 0,
      matches: 0,
      totalPairs: chosenPairs.length,
      seconds: 0,
    });
  }

  // --- finish ---
  function finishGameForReal(finalMatches, finalTotalPairs, finalSeconds, finalMoves) {
    setRoundActive(false);
    setStats((prev) => ({
      ...prev,
      matches: finalMatches,
      totalPairs: finalTotalPairs,
      seconds: finalSeconds,
      moves: finalMoves,
    }));
    setIsFinished(true);
  }

  // --- evaluate ---
  function evaluatePair(leftCard, rightCard) {
    const isMatch =
      leftCard &&
      rightCard &&
      leftCard.pairId === rightCard.pairId;

    // +1 ruch
    setStats((prev) => ({ ...prev, moves: prev.moves + 1 }));

    if (isMatch) {
      playCorrect();

      // reset zaznaczeń
      setSelectedLeft(null);
      setSelectedRight(null);

      // 1) fade-out obu kart tej pary
      setFading((prev) => ({ ...prev, [leftCard.uid]: true, [rightCard.uid]: true }));

      setTimeout(() => {
        // 2) usuń trafioną parę z widoku
        setLeftVisible((prev) => prev.filter((c) => c.pairId !== leftCard.pairId));
        setRightVisible((prev) => prev.filter((c) => c.pairId !== rightCard.pairId));

        // 3) dołóż następną parę z kolejki (utrzymujemy max 5 par)
        if (queueIdxRef.current < queue.length) {
          const nextPair = queue[queueIdxRef.current++];
          const newLeft = { uid: `L-${uid()}`, word: nextPair.known, pairId: nextPair.pairId };
          const newRight = { uid: `R-${uid()}`, word: nextPair.learn, pairId: nextPair.pairId };

          setLeftVisible((prev) => {
            const next = [...prev, newLeft];
            // mały shuffle, żeby nie zawsze trafiało na koniec
            return shuffle(next);
          });
          setRightVisible((prev) => {
            const next = [...prev, newRight];
            return shuffle(next);
          });

          // 4) fade-in dla nowej pary
          setAppearing((a) => ({ ...a, [newLeft.uid]: true, [newRight.uid]: true }));
          setTimeout(() => {
            setAppearing((a) => {
              const { [newLeft.uid]: _1, [newRight.uid]: _2, ...rest } = a;
              return rest;
            });
          }, 500);
        }

        // wyczyść znaczniki fade-out
        setFading((f) => {
          const { [leftCard.uid]: _a, [rightCard.uid]: _b, ...rest } = f;
          return rest;
        });
      }, 500); // 0.5s fade-out

      // statystyka + ewentualny koniec
      setStats((prev) => {
        const newMatches = prev.matches + 1;
        if (newMatches === prev.totalPairs) {
          const secondsEnd = Math.floor((performance.now() - startTimeRef.current) / 1000);
          finishGameForReal(newMatches, prev.totalPairs, secondsEnd, prev.moves + 1);
        }
        return { ...prev, matches: newMatches };
      });
    } else {
      playWrong();
      if (mismatchTimeoutRef.current) clearTimeout(mismatchTimeoutRef.current);
      mismatchTimeoutRef.current = setTimeout(() => {
        setSelectedLeft(null);
        setSelectedRight(null);
      }, 600);
    }
  }

  // --- clicks (na widocznych indeksach) ---
  function onLeftClick(idx) {
    if (!roundActive) return;
    const card = leftVisible[idx];
    if (!card) return;

    if (selectedLeft === idx) {
      setSelectedLeft(null);
      return;
    }
    setSelectedLeft(idx);

    if (selectedRight !== null) {
      evaluatePair(leftVisible[idx], rightVisible[selectedRight]);
    }
  }

  function onRightClick(idx) {
    if (!roundActive) return;
    const card = rightVisible[idx];
    if (!card) return;

    if (selectedRight === idx) {
      setSelectedRight(null);
      return;
    }
    setSelectedRight(idx);

    if (selectedLeft !== null) {
      evaluatePair(leftVisible[selectedLeft], rightVisible[idx]);
    }
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

  // --- stats for modal ---
  const pairsFound = stats.matches || 0;
  const totalPairs = stats.totalPairs || 0;
  const accuracy = totalPairs > 0 ? Math.round((pairsFound / totalPairs) * 100) : 0;
  const timeSec = stats.seconds || 0;
  const modalStats = { pairsFound, totalPairs, accuracy, timeSec };

  return (
    <>
      <main className="board wrap">
        {/* PANEL USTAWIEŃ — widoczny tylko PRZED grą */}
        {!roundActive && (
          <section className="panel" aria-label="Wybór folderu">
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
                      {name} ({folders[name]?.length || 0})
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
        {roundActive && (
          <section className="panel" aria-live="polite">
            <div className="columns">
              {/* LEWA */}
              <div className="col" aria-label="Kolumna język 1">
                {leftVisible.map((card, idx) => {
                  const isSelected = selectedLeft === idx;
                  const cls =
                    "card" +
                    (isSelected ? " selected" : "") +
                    (fading[card.uid] ? " fading" : "") +
                    (appearing[card.uid] ? " appearing" : "");
                  return (
                    <button
                      key={card.uid}
                      className={cls}
                      onClick={() => onLeftClick(idx)}
                    >
                      {card.word}
                    </button>
                  );
                })}
              </div>

              {/* PRAWA */}
              <div className="col" aria-label="Kolumna język 2">
                {rightVisible.map((card, idx) => {
                  const isSelected = selectedRight === idx;
                  const cls =
                    "card" +
                    (isSelected ? " selected" : "") +
                    (fading[card.uid] ? " fading" : "") +
                    (appearing[card.uid] ? " appearing" : "");
                  return (
                    <button
                      key={card.uid}
                      className={cls}
                      onClick={() => onRightClick(idx)}
                    >
                      {card.word}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* MODAL KOŃCA GRY */}
      <GameOverModal
        isOpen={isFinished}
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
