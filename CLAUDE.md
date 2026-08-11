# tv-movies-domain-radar — agent notes

Release radar for the Fandom TV & Movies domain. Full detail in
[`README.md`](README.md); this is the fast path.

- **Entrypoint:** `src/index.ts` — run with `npm run radar`.
- **Stack:** TypeScript on Node 20. **Zero runtime dependencies** (built-in
  `fetch`); `tsx` + `typescript` are devDependencies only. Keep it that way.
- **Outputs:** `out/radar.json` (git-ignored) — the single artifact everything
  downstream reads.
- **Inputs:** none. All data comes live from `neutron-api`; no keys, no `.env`.
- **Flags:** `--horizon N`, `--top N`, `--today YYYY-MM-DD`, `--no-trending`.
- **Check types:** `npm run typecheck`.

## Gotchas

- **Verify API behavior against the live API, not the source.** neutron-api
  rewrites query params server-side, and several documented params are silently
  overridden. Every quirk in the README was found by probing, and at least one
  (`sortBy` being ignored) contradicts what the param name implies.
- **`sortBy` does nothing when `releaseType=coming-soon`.** To get a demand
  ranking you must *avoid* `coming-soon` and use `releaseDateMin` +
  `releaseYearMax` instead. See `fetchUpcomingPopularity`.
- **`limit` > 50 → HTTP 400.** Page with `MAX_PAGE_SIZE`.
- **Fastly 403s non-browser user agents** — never drop the `User-Agent` header.
- **Paging repeats titles**; dedupe by catalog id (already handled).
- **Demand coverage is thin and TV has none.** ~32 of ~220 upcoming titles carry
  a popularity signal. The `SIGNAL_CONFIDENCE` cap in `config.ts` is what stops
  uncorroborated titles from topping the list on imminence alone — don't remove
  it without replacing it with something better.
- **`fandomSignal` is declared but unwired.** It's the reserved slot for the
  first-party trending export (heaviest weight). Weights re-normalize over
  present signals, so populating `title.fandomSignal` is the *only* change
  needed to activate it.
- **The first snapshot raises no change alerts** by design. If you're testing
  diff behavior, doctor `data/snapshots/latest.json` and re-run.

## Conventions

- Paths resolve from `ROOT` in `config.ts`, never `process.cwd()`, so the tool
  works no matter where it's invoked from.
- Tunable knobs (weights, thresholds, horizon) live in `config.ts`. Business
  logic doesn't hardcode numbers.
- Comments explain *why*, especially where the code works around an API quirk.
