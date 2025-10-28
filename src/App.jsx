// src/App.jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";

import { GameProvider } from "./context/GameContext.jsx";

import Topbar from "./components/Topbar.jsx";

import Home from "./pages/Home.jsx";
import Game from "./pages/Game.jsx";
import Storage from "./pages/Storage.jsx";
import Settings from "./pages/Settings.jsx";

function App() {
  return (
    <GameProvider>
      <BrowserRouter>
        <Topbar />

        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/game" element={<Game />} />
          <Route path="/mystorage" element={<Storage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </GameProvider>
  );
}

export default App;
