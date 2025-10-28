// src/context/GameContext.jsx
import { createContext, useContext, useState } from "react";

const GameContext = createContext(null);

export function GameProvider({ children }) {
  const [stats, setStats] = useState({
    moves: 0,
    matches: 0,
    totalPairs: 0,
    seconds: 0,
  });

  return (
    <GameContext.Provider value={{ stats, setStats }}>
      {children}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider />");
  return ctx;
}
