# Testing

All tests use synthetic data. They never open your normal browser profile and never touch the
`localStorage` of the live site (`rexer00.github.io`).

## Unit tests (storage logic)

```sh
npm test
```

Node's built-in test runner (`tests/**/*.test.mjs`) with an in-memory `localStorage` stand-in.

## Browser tests (Playwright)

The browser suite (`e2e/*.spec.mjs`) runs against the **production build** served by
`scripts/pages-server.mjs`, a small static server that behaves like GitHub Pages: unknown paths
return `404.html` with status 404, and `/matching-pairs` redirects to `/matching-pairs/`. Every
test gets a fresh, isolated browser context (empty storage); several "tabs" are pages in the
same context.

```sh
npm ci
npx playwright install chromium   # once; downloads Playwright's Chromium
npm run build
npm run test:e2e
```

Options (environment variables):

| Variable | Default | Purpose |
|---|---|---|
| `PW_CHANNEL` | Playwright's Chromium | Use an installed browser instead, e.g. `msedge` or `chrome` (no download needed) |
| `PAGES_DIST` | `dist` | Build directory to serve |
| `E2E_PORT` | `4173` | Port of the test server |

Examples:

```sh
PW_CHANNEL=msedge npm run test:e2e        # Windows, with Microsoft Edge installed
npx playwright test e2e/multitab.spec.mjs # one file
npx playwright show-trace test-results/<test>/trace.zip   # inspect a failure
```

Stress suites included in the run: `e2e/multitab.spec.mjs` (concurrent saves) and
`e2e/restore-race.spec.mjs` (replace restores racing concurrent saves; set `RACE_LIB_DIR` to
another copy of `src/lib` to measure older code). Deterministic orderings of the same races are
unit-tested in `tests/restore-race.test.mjs` with a per-tab cache model
(`tests/helpers/multi-tab-storage.mjs`).

Game suites: `tests/game-engine.test.mjs` and `tests/game-ambiguity.test.mjs` (seeded random play;
no two clickable cards that look the same, and no visible left/right combination that reads as a
folder pair but belongs to different pairs), plus `e2e/game.spec.mjs` and `e2e/game-ambiguity.spec.mjs`
in the browser.

To look at the build the way GitHub Pages serves it: `npm run build && npm run preview:pages`,
then open <http://127.0.0.1:4173/matching-pairs/>.

## CI

`.github/workflows/pages-doctor.yml` runs, in order: `npm ci`, unit tests, config checks, build,
dist checks (including `404.html` and favicon), Playwright browser tests, then uploads `dist/`.
On a failed run the Playwright report and traces are uploaded as the `playwright-report`
artifact. The production deploy workflow reuses this job, so a release cannot be built without
passing all tests.
