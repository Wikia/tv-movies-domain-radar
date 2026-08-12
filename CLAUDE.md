# tv-movies-domain-radar — agent notes

Upcoming release calendar for the Fandom TV & Movies domain. Full detail in
[`README.md`](README.md); this is the fast path.

- **Entrypoint:** `src/index.ts` — run with `npm run radar`.
- **Stack:** TypeScript on Node 20. **Zero runtime dependencies** (built-in
  `fetch`, `node:crypto`); `tsx` + `typescript` are devDependencies only. The
  server is raw `node:http`. Keep it that way.
- **Outputs:** `out/radar.json` (source of truth), plus `out/dashboard.html` and
  `out/dashboard.artifact.html`. All git-ignored.
- **Inputs:** none. Data comes live from `neutron-api`; no keys, no `.env`.
- **Flags:** `--horizon N`, `--top N`, `--today YYYY-MM-DD`.
- **Check:** `npm run typecheck`, `npm run web:build`.

## The one rule that matters

**Don't reintroduce a demand score.** It was built, measured, and removed:
popularity covered 32 of 233 titles and no TV at all, and trending never once
intersected the release calendar. What was left ranked titles purely by how soon
they release — a calendar fact dressed up as evidence. The calendar plus the
day-over-day diff is the product. If you want a real demand signal, the
first-party Fandom trending export is the one worth wiring.

## Gotchas

- **Verify API behavior against the live API, not the source.** neutron-api
  rewrites query params server-side and silently overrides documented ones.
  Every quirk in the README was found by probing.
- **`sortBy` does nothing when `releaseType=coming-soon`.** `limit` > 50 → 400.
  Fastly 403s non-browser user agents. Paging repeats titles (deduped by id).
- **Never render `title.image`** — it's the full-resolution original, averaging
  2.3 MB. Use `title.poster`, which `posters.ts` resolves to a signed resize URL
  or a local thumbnail.
- **The artifact's CSP blocks external hosts**, so its poster art must be inlined
  as data URIs. A remote `<img>` there fails silently.
- **Test the artifact's inline script, don't just count elements.** A stale
  selector once hid every row and shipped a blank page that looked exactly like
  "the pipeline found nothing". `ROW_CLASS` is now shared by the renderer and the
  script, the script bails if it finds no rows, and `build()` throws if it
  renders none — keep all three.
- **Theme tokens are duplicated** in `src/artifact.ts` and `web/src/index.css`.
  Change one, change the other. The React side needs `@theme inline` so classes
  resolve to `var(--c-*)` at runtime rather than being baked at build time.
- **The diff baseline is the most recent snapshot from a PREVIOUS day**, never
  `latest.json` (which every run rewrites, so diffing against it made a second
  run in a day report nothing). Re-running is therefore idempotent. To test diff
  behavior, doctor the relevant `data/snapshots/YYYY-MM-DD.json` and re-run.
- **`--today` in the past does not persist a snapshot**, so reproducing an old
  run can't overwrite that day's real baseline.

## Conventions

- Paths resolve from `ROOT` in `config.ts`, never `process.cwd()`.
- Tunable knobs live in `config.ts`; logic doesn't hardcode numbers.
- Comments explain *why*, especially around API workarounds.
