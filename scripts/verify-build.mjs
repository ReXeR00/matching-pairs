// Build/deploy safety checks used by CI and `npm run deploy:check`.
// Dependency-free (Node built-ins only).
//
//   node scripts/verify-build.mjs config [--require-clean]   before `npm run build`
//   node scripts/verify-build.mjs dist                       after  `npm run build`
//
// EXPECTED_BASE (default "/matching-pairs/") must match Vite's `base`.
// Exits 1 on any failure; appends a summary to $GITHUB_STEP_SUMMARY when set.
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const EXPECTED_BASE = process.env.EXPECTED_BASE || "/matching-pairs/";
const [phase, ...flags] = process.argv.slice(2);
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function checkConfig() {
  const viteConfig = readFileSync(path.join(ROOT, "vite.config.js"), "utf8");
  const base = viteConfig.match(/\bbase\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
  check("Vite base matches EXPECTED_BASE", base === EXPECTED_BASE, `base=${base ?? "(missing)"}, expected=${EXPECTED_BASE}`);

  // Exactly one router (regression guard for the nested BrowserRouter crash).
  const sources = walk(path.join(ROOT, "src")).filter((f) => /\.(jsx?|tsx?)$/.test(f));
  const routers = sources.flatMap((f) =>
    [...readFileSync(f, "utf8").matchAll(/<(BrowserRouter|HashRouter|MemoryRouter|Router)\b[^>]*>/g)]
      .map((m) => ({ file: path.relative(ROOT, f), tag: m[0] }))
  );
  check("exactly one <Router> in src/", routers.length === 1, routers.map((r) => `${r.file}: ${r.tag}`).join("; ") || "none found");
  check(
    "router uses basename={import.meta.env.BASE_URL}",
    routers.length === 1 && /basename=\{import\.meta\.env\.BASE_URL\}/.test(routers[0].tag)
  );

  // Build output and dependencies must never be committed (stale-artifact guard).
  let tracked = [];
  try {
    tracked = execFileSync("git", ["ls-files", "--", "dist", "node_modules"], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (e) {
    check("git available for tracked-artifact check", false, e.message);
  }
  check("dist/ and node_modules/ are not tracked by git", tracked.length === 0, tracked.length ? `${tracked.length} tracked, e.g. ${tracked[0]}` : "");

  if (flags.includes("--require-clean")) {
    check("no pre-existing dist/ before build", !existsSync(path.join(ROOT, "dist")), "a fresh build must not reuse an old dist/");
  }
}

function checkDist() {
  const dist = path.join(ROOT, "dist");
  const indexPath = path.join(dist, "index.html");
  if (!existsSync(indexPath)) {
    check("dist/index.html exists", false);
    return;
  }
  check("dist/index.html exists", true);
  const html = readFileSync(indexPath, "utf8");
  check("index.html is a production build (no /src/main.jsx)", !/\/src\/main\.jsx/.test(html));

  const refs = [...html.matchAll(/<(?:script|link)\b[^>]*?\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const local = refs.filter((r) => !/^(https?:)?\/\//.test(r));
  const scripts = local.filter((r) => /\/assets\/[^/]+\.js$/.test(r));
  check("index.html references a hashed assets/*.js bundle", scripts.length > 0, scripts.join(" "));
  const badPrefix = local.filter((r) => !r.startsWith(EXPECTED_BASE));
  check(`all asset URLs start with ${EXPECTED_BASE}`, badPrefix.length === 0, badPrefix.join(" "));
  const missing = local
    .filter((r) => r.startsWith(EXPECTED_BASE) && r !== EXPECTED_BASE)
    .filter((r) => !existsSync(path.join(dist, r.slice(EXPECTED_BASE.length))));
  check("every referenced asset exists in dist/", missing.length === 0, missing.join(" "));

  for (const s of scripts) {
    const file = path.join(dist, s.slice(EXPECTED_BASE.length));
    if (!existsSync(file)) continue;
    const js = readFileSync(file, "utf8");
    check(`${path.basename(file)} is minified production code (no jsxDEV)`, !js.includes("jsxDEV"));
  }
}

if (phase === "config") checkConfig();
else if (phase === "dist") checkDist();
else {
  console.error("usage: node scripts/verify-build.mjs <config [--require-clean] | dist>");
  process.exit(2);
}

const failed = results.filter((r) => !r.ok);
const lines = results.map((r) => `${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(lines.join("\n"));
console.log(`\n${phase}: ${results.length - failed.length}/${results.length} checks passed`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const md = [`### verify-build: ${phase}`, "", ...results.map((r) => `- ${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — \`${r.detail}\`` : ""}`), ""];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join("\n") + "\n");
}

process.exit(failed.length ? 1 : 0);
