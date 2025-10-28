// src/components/StatsBar.jsx
import { useGame } from "../context/GameContext.jsx";

function StatsBar() {
  const { stats } = useGame();

  return (
    <div className="stats">
      <span className="chip">Ruchy: {stats.moves}</span>
      <span className="chip">
        Pary: {stats.matches}/{stats.totalPairs}
      </span>
      <span className="chip">Czas: {stats.seconds}s</span>
    </div>
  );
}

export default StatsBar;
