import { copyFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages nie ma przekierowań SPA: dla nieznanej ścieżki (np. odświeżenie
// /matching-pairs/game) serwuje 404.html. Kopia index.html jako 404.html
// ładuje aplikację, a React Router renderuje właściwą stronę.
function githubPagesSpaFallback() {
  let outDir;
  return {
    name: "github-pages-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(path.join(outDir, "index.html"), path.join(outDir, "404.html"));
    },
  };
}

export default defineConfig({
  plugins: [react(), githubPagesSpaFallback()],
  base: "/matching-pairs/",
});
