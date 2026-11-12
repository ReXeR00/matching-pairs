// src/components/ThemeToggle.jsx
import { useEffect, useState } from "react";
import { getThemePreference, setThemePreference } from "../lib/storage.js";

function ThemeToggle() {
  const [dark, setDark] = useState(false);

  // przy montowaniu: odczytaj zapisany motyw (zablokowana pamięć = jasny)
  useEffect(() => {
    const wantsDark = getThemePreference() === "dark";
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
    setThemePreference(newDark ? "dark" : "light"); // błąd zapisu: motyw działa do końca sesji
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
