// src/components/ThemeToggle.jsx
import { useEffect, useState } from "react";

const THEME_KEY = "mp_theme";

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  // przy montowaniu: odczytaj z localStorage
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const wantsDark = saved === "dark";
    setDark(wantsDark);
    document.documentElement.setAttribute(
      "data-theme",
      wantsDark ? "dark" : "light"
    );
  }, []);

  function onToggle(e) {
    const newDark = e.target.checked;
    setDark(newDark);
    document.documentElement.setAttribute(
      "data-theme",
      newDark ? "dark" : "light"
    );
    localStorage.setItem(THEME_KEY, newDark ? "dark" : "light");
  }

  return (
    <div className="theme-toggle" title="Tryb dzienny / nocny">
      <input
        type="checkbox"
        id="theme-toggle"
        aria-label="Przełącz motyw"
        checked={dark}
        onChange={onToggle}
      />
      <label htmlFor="theme-toggle" className="toggle-track">
        <span className="icon sun" aria-hidden>
          ☀️
        </span>
        <span className="icon moon" aria-hidden>
          🌙
        </span>
        <span className="thumb" aria-hidden></span>
      </label>
    </div>
  );
}

export default ThemeToggle;
