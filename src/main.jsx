// src/main.jsx
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "../src/styles/main.scss";


const container = document.getElementById("root");
createRoot(container).render(
  <App />
);
