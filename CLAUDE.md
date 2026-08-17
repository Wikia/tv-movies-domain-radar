# tv-movies-domain-radar — agent notes

Upcoming release calendar for the Fandom TV & Movies domain. Full detail in
[`README.md`](README.md); this is the fast path.

- **Entrypoint:** `src/index.ts` — run with `npm run radar`.
- **Stack:** TypeScript on Node 20. **Zero runtime dependencies** (built-in
  `fetch`, `node:crypto`); `tsx` + `typescript` are devDependencies only. The
  server is raw `node:http`. Keep it that way.
- **Outputs:** `out/radar.json` (source of truth), plus `out/dashboard.html` and
  `out/dashboard.artifact.html`. All git-ignored.
- **Inputs:** `neutron-api` and Wikipedia live (no keys, no `.env`), plus one
  optional file, `data/fandom_trending.csv` — the internal first-party trending
  export. Not committed, no fallback; the `/radar` skill pulls it fresh each run.
- **Signals:** two, both attached rather than blended — `title.trend` (our own
  wiki traffic) and `title.buzz` (Wikipedia pageviews vs the title's own normal).
- **Flags:** `--horizon N`, `--top N`, `--today YYYY-MM-DD`.
- **Check:** `npm run typecheck`, `npm run web:build`.
- **Before changing the buzz scoring, run `npm run backtest`** and compare. It
  replays the real detector over 120 days of history and reports precision
  against a control base rate. Current baseline: 87% of fires still elevated
  after 7 days vs an 18% base rate — **5.0x lift**, 9% flicker, median 10
  firings/day. A change that lowers the lift is a regression however good the
  dashboard looks.

## The one rule that matters

**Don't reintroduce a demand score.** It was built, measured, and removed:
popularity covered 32 of 233 titles and no TV at all, and the *upstream*
trending feed never once intersected the release calendar. What was left ranked
titles purely by how soon they release — a calendar fact dressed up as evidence.
The calendar plus the day-over-day diff is the product.

The exception that rule always named — "the first-party Fandom trending export
is the one worth wiring" — is now wired (`src/sources/fandom.ts`,
`src/trending.ts`). It stays on the right side of the rule because it is
**attached, not aggregated**: a title carries a labelled `trend` object with its
own match confidence, and nothing blends it into an ordering.

`src/buzz.ts` goes further and *does* rank titles, so be clear about why it
isn't the deleted score coming back:

- The old score ranked **fame**, and once its sparse inputs were stripped out,
  all that was left was "how soon does it release".
- Buzz ranks **movement** — each title against its own 28-day baseline, then
  detrended against titles at the same distance from release. Release proximity
  is explicitly divided out rather than sneaking in as the answer.
- Coverage is published (`counts.buzzScored`, `buzz.resolved`) and an unmeasured
  title is `undefined`, never `0`.
- The **schedule is still chronological.** Buzz lives in its own panel and tags
  only spiking rows.

Those four properties are the whole defence. If you drop any of them — rank the
schedule by points, default missing data to zero, or fold `fpScore` and `points`
into one number — you have rebuilt the thing that was deleted.

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
- **There are TWO dashboards and they must stay in step.** `src/artifact.ts`
  renders the static/publishable page; `web/src` renders the React app on
  `npm run serve`. Both show the schedule, Buzz and Trending. They drifted once
  already — the signals shipped in the artifact only, so `localhost:8787` showed
  none of them while happily serving the data in `/api/radar`. Adding a signal
  means touching both, plus `web/src/types.ts`, which is a hand-written mirror
  of `src/types.ts`.
- **Theme tokens are duplicated** in `src/artifact.ts` and `web/src/index.css`.
  Change one, change the other. The React side needs `@theme inline` so classes
  resolve to `var(--c-*)` at runtime rather than being baked at build time.
- **The diff baseline is the most recent snapshot from a PREVIOUS day**, never
  `latest.json` (which every run rewrites, so diffing against it made a second
  run in a day report nothing). Re-running is therefore idempotent. To test diff
  behavior, doctor the relevant `data/snapshots/YYYY-MM-DD.json` and re-run.
- **`--today` in the past does not persist a snapshot**, so reproducing an old
  run can't overwrite that day's real baseline.
- **The trending export is WEEKLY**; the radar runs daily. Alerts fire only on
  `isNew` or a real week-over-week climb, never on a steady level — otherwise
  the same wikis would alert every day until people tuned the whole thing out.
- **Trending matching is strict on purpose**, and the guards are load-bearing.
  Both came from live false positives: free substring matching tied "The
  Musical" to `sixthemusical.fandom.com`, and a 4-character franchise key let
  "Coco" claim "Cocomelon: The Movie". Only exact or *prefix* matches count, and
  prefixes need 6+ characters. Loosening this trades a silent wrong attribution
  for a couple more matches — a bad trade, since anything unmatched already
  shows up in the unmapped panel for a human.
- **`installment_title_labels` is not a display name for TV/film.** That column
  is where videogame tie-ins land: the export labels `frozen.fandom.com` as
  "Disney Infinity". The gaming radar prefers it; we deliberately don't.
- **Most matches are `franchise`, not `exact`**, because most films have no wiki
  of their own — only a franchise hub. The UI must keep saying "franchise hot"
  rather than "wiki hot" for those; collapsing the two overclaims.

### Wikipedia buzz (`src/sources/wikipedia.ts`, `src/buzz.ts`)

- **Pageviews lag ~4 days.** The API omits missing days entirely, and a trailing
  gap looks identical to a run of zero-view days. Anchoring the recent window on
  "yesterday" zero-filled it and scored the ENTIRE calendar at 0. The series is
  trimmed to the last day with real data and we over-request by `BUZZ.lagDays`.
- **`cllimit` on a categories batch is a budget for the whole request, not per
  article.** Ignoring the `clcontinue` token meant most articles came back with
  no categories and were rejected as "not a film" — including ones categorised
  `2026 American films`. Follow the continuation.
- **Never conflate "request failed" with "no article".** They were the same
  `null` once; failures got cached as misses and suppressed titles for a week.
  Two identical cold runs resolving 108 then 99 titles is how it was caught.
  Resolution now converges upward across runs: ~89 on a cold first run, 150
  stable by the second.
- **A bad batch must not poison good verdicts.** Category checking returns
  true / false / *absent*, and only definite verdicts get cached.
- **A long baseline can't tell a live spike from a dead one.** The 28-day median
  keeps a title looking hot for weeks after its event ended, so `momentum`
  (a 7-day memory) gates it: `spiking` requires elevated AND still climbing.
  Don't remove that gate to "get more results" — the results it removes are
  stale by construction.
- **Rank on `relative`, never `points`.** Points clamp at 100 and several titles
  reach it, so sorting by them scrambles the top of the list.
- **Don't reach for Reddit, X or Google Trends without re-probing.** All three
  were tested live and rejected — Reddit 403s unauthenticated, X needs a paid
  key, Google Trends' explore API 429s and its working RSS feed had zero
  intersection with our calendar. Details and numbers are in the README.

## Conventions

- Paths resolve from `ROOT` in `config.ts`, never `process.cwd()`.
- Tunable knobs live in `config.ts`; logic doesn't hardcode numbers.
- Comments explain *why*, especially around API workarounds.
