// src/components/Topbar.jsx
import { NavLink } from "react-router-dom";
import StatsBar from "./StatsBar.jsx";
import ThemeToggle from "./ThemeToggle.jsx";

function Topbar() {
  return (
    <header className="topbar">
      <div className="wrap topbar-inner">
        {/* Brand */}
        <div className="brand">
          <h1 className="app-title">Match Box by EN</h1>
        </div>

        {/* Toolbar / Nawigacja */}
        <nav className="toolbar">
          <NavLink className="btn" to="/">
            Home
          </NavLink>
          <NavLink className="btn" to="/game">
            Gra
          </NavLink>
          <NavLink className="btn" to="/mystorage">
            Dodaj słowa
          </NavLink>
          <NavLink className="btn" to="/settings">
            Ustawienia
          </NavLink>
        </nav>

        {/* Statystyki + theme */} 
        <div className="right">
          <StatsBar />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export default Topbar;
