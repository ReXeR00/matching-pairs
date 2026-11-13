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

To look at the build the way GitHub Pages serves it: `npm run build && npm run preview:pages`,
then open <http://127.0.0.1:4173/matching-pairs/>.

## CI

`.github/workflows/pages-doctor.yml` runs, in order: `npm ci`, unit tests, config checks, build,
dist checks (including `404.html` and favicon), Playwright browser tests, then uploads `dist/`.
On a failed run the Playwright report and traces are uploaded as the `playwright-report`
artifact. The production deploy workflow reuses this job, so a release cannot be built without
passing all tests.
