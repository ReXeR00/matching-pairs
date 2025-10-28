import React from "react";
import "../styles/GameOverModal.scss";

export default function GameOverModal({
  isOpen,
  stats = {},
  onPlayAgain,
  onGoMenu,
  onEditWords,
  variant = "green", // "green" = wygrana vibe, "blue" = neutral info vibe
}) {
  if (!isOpen) return null;

  // stats które dostajemy z Game.jsx
  const {
    pairsFound = 0,
    totalPairs = 0,
    accuracy = 0,
    timeSec = 0,
  } = stats;

  // formatujemy czas na mm:ss
  const minutes = Math.floor(timeSec / 60);
  const seconds = timeSec % 60;
  const niceTime = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div className="gameover-overlay">
      <div className="gameover-wrapper">
        {/* .gameover-card + wariant koloru */}
        <article className={`gameover-card ${variant}`}>
          {/* HEADER z przyciskiem X */}
          <header className="gameover-card__header">
            <button
              className="gameover-card__close-btn"
              onClick={onGoMenu}
              aria-label="Zamknij podsumowanie"
            >
              {/* ikona X */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="gameover-card__close-icon"
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18 18 6M6 6l12 12"
                />
              </svg>
            </button>
          </header>

          {/* BODY */}
          <section className="gameover-card__body">
            {/* Ikona po lewej */}
            <div className="gameover-card__icon-wrapper">
              {/* ta ikonka ma kolor ustawiany w SCSS przez .blue/.green */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="gameover-card__icon"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                {/* Dajemy okrągłą ikonę z checkiem vibe success */}
                <path
                  fillRule="evenodd"
                  d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12Zm13.36-1.814a.75.75 0 1 0-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.14-.094l3.75-5.25Z"
                  clipRule="evenodd"
                />
              </svg>
            </div>

            {/* Teksty po prawej */}
            <div className="gameover-card__text">
              <h3 className="gameover-card__title">
                Runda zakończona 🎉
              </h3>

              <p className="gameover-card__desc">
                Oto Twoje statystyki:
                <br />
                • Trafione pary:{" "}
                <strong>
                  {pairsFound}/{totalPairs}
                </strong>
                <br />
                • Skuteczność:{" "}
                <strong>{accuracy}%</strong>
                <br />
                • Czas:{" "}
                <strong>{niceTime}</strong>{" "}
                min
              </p>

              {/* Pasek progresu skuteczności */}
              <div className="gameover-card__progress">
                <div className="gameover-card__progress-header">
                  <span>Skuteczność {accuracy}%</span>
                </div>
                <div className="gameover-card__progress-bar">
                  <div
                    className="gameover-card__progress-fill"
                    style={{ width: `${accuracy}%` }}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ACTION BUTTONS */}
          <footer className="gameover-card__actions">
            <button
              className="gameover-card__btn gameover-card__btn--first"
              onClick={onPlayAgain}
            >
              Graj ponownie
            </button>

            <button
              className="gameover-card__btn gameover-card__btn--second"
              onClick={onGoMenu}
            >
              Idź do menu
            </button>

            <button
              className="gameover-card__btn gameover-card__btn--third"
              onClick={onEditWords}
            >
              Edytuj słówka
            </button>
          </footer>
        </article>
      </div>
    </div>
  );
}
