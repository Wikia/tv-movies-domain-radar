# tv-movies-domain-radar — agent notes

Upcoming release calendar for the Fandom TV & Movies domain. Full detail in
[`README.md`](README.md); this is the fast path.

- **Entrypoint:** `src/index.ts` — `npm run scan` locally, `npm run scan:publish`
  in the daily Jenkins job (`Jenkinsfile-daily-scan`). Both are the same file;
  `--publish` uploads and `--no-render` skips the 15 MB of HTML the cron discards.
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
- **Flags:** `--horizon N`, `--today YYYY-MM-DD`, `--publish`.
- **Check:** `npm run typecheck`, `npm run web:build`, `npm run backtest`.
- **`npm run typecheck` covers `src/` and `scripts/`, NOT `web/`.** The React app is typechecked by
  its own `tsc -b`, which runs as part of `npm run web:build`. So a broken
  component compiles clean at the root and the build fails instead — and if you
  redirect that build's output you'll screenshot a stale bundle and think the
  change landed. Never `web:build >/dev/null`; read its output.
- **A JSX comment can't be a ternary branch's sibling.** `cond ? ( {/* … */}
  <div/> ) : …` is a syntax error, and it bit this repo twice. Put the comment
  above the statement or hoist the value to a named const.
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

### Snapshot storage (`src/remote.ts`, `src/publish.ts`)

- **Writes need `X-Wikia-Internal-Request`.** Pandora blocks every route not
  annotated `@PublicResource`; retrieval is public, uploading is not, so without
  the header every write 403s. The filter checks presence, not value.
- **Objects are write-once.** Re-POSTing an existing path returns a 500 — the
  bucket or its service account refuses replacement, verified live. A second run
  on the same date leaves the published copy alone and reports it as `ok`; a slot
  holding *another* day's data reports `degraded` and needs a manual GCS delete.

- **Six documents, one folder each**: `{news,youtube,tmdb}/{date}/readings.json`,
  `resolve/{date}/ids.json`, `trending/{week}/wikis.json`,
  `radar/{date}/radar.json`. A folder per source because scriptlr resolves
  `latest` per *folder* — sharing one would 404 every other file the moment a
  single upload failed.
- **The version segment is the date, unpadded**: `2026.8.9`, never `2026.08.09`
  — scriptlr's regex is `(0|[1-9]\d*)` per component and rejects leading zeros
  with a 400. Inside the JSON, dates stay ISO. `remote.versionFor()` is the only
  place that converts; don't hand-write one.
- **Each file holds the WHOLE store**, not a daily delta. The public deployment
  has no list endpoint (`/apps/*` is on-prem only), so the dashboard cannot
  enumerate versions — it reads `latest` once and needs everything in it.
- **The diff baseline is fetched by explicit date, walking back from yesterday**,
  never `latest` — `latest` becomes today's file the moment we publish, so a
  second run would diff today against today. Same rule as `latest.json`.
- **Never let a remote miss become an empty store.** A 404 falls through to the
  local copy (so a first publish carries existing history); a *failed request*
  throws and aborts the run; a document without a `readings` object throws.
  Returning `{}` from any of those publishes one day over sixty, and YouTube and
  TMDB history is not re-fetchable.
- **`save()` refuses to write a store that shrank by more than
  `SCRIPTLR.maxShrink`**, measured against local disk rather than against what
  was loaded — if the remote read came back thin, the loaded store is thin too
  and comparing it to itself proves nothing.
- **The id caches are cron state, not a cache.** Losing `youtube-videos.json`
  means re-running `search.list` at 100 quota units a title against a 10,000/day
  budget — 234 titles exceeds the day's quota outright. `hydrateCaches()` only
  fills files that are MISSING locally; it never overwrites work in progress.
- **Publishing is opt-in (`--publish`) and never happens on a pinned `--today`**,
  for the same reason that writes no snapshot.

### The run report (`src/report.ts`)

- **Every run writes `out/run.json`**, on the failure path too — a missing report
  is indistinguishable from a cron that never fired. Jenkins reads it for the
  build result and the Slack message, so the exit code alone is not the verdict.
- **Four statuses, and they mean different things.** `failed` exits non-zero and
  pings; `degraded` shipped but something is off and stays exit 0; `skipped` is
  configuration, not a fault; `ok` is silent. Don't promote a standing condition
  (no Fastly key, no YouTube key) to `degraded` — a daily alarm nobody can action
  is one people learn to scroll past.

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
- **`points` measures the SIZE of the surge (excess views/day), not the
  multiple.** Scoring the multiple ranked a 200→3,700 article above a
  3,000→32,000 one. Excess is used rather than raw views so a big title sitting
  at its normal level scores ~0 — that's what keeps it from becoming the fame
  score that was deleted.
- **100 points is anchored to a measured event**: The Odyssey's 1,199,464
  views/day peak (2026-07-18). Superman 93, Avatar 90, Wicked 82. Don't retune
  the anchor to make more titles look hot — the whole point is that an ordinary
  trailer drop scores in the 40s-60s.
- **Both dashboards must sort the buzz panel identically.** `ranked()` in
  buzz.ts and the sort in `web/src/components/Buzz.tsx` are separate code; they
  disagreed for one build and the React panel rendered visibly unordered.
- **The heat palette is two colours for a measured reason.** red+amber clear
  colourblind separation; red→orange→yellow→green does not (orange/yellow
  normal-vision ΔE 13.6, red/green deutan ΔE 4.1). Validated with the dataviz
  skill's `validate_palette.js` against this app's own surfaces — re-run it
  before touching these values. Band colour always ships with the band's name
  in text, because amber is sub-3:1 on the light ground.
### Daily signal snapshots (`src/store.ts`, `src/sources/{news,youtube,tmdb}.ts`)

- **These three have no history endpoint.** Wikipedia backfills two months;
  YouTube and TMDB report only lifetime totals, and Google News answers one day
  at a time. The series in `data/signals/` exists *only* because we record it —
  wipe that directory and the history is gone for good, not re-fetchable.
- **Never fill a gap with zero.** Same lesson as the Wikipedia lag bug: absent
  is not zero. `store.series()` returns the days that exist and no others.
- **The baseline is adaptive, with a floor.** `measure()` uses as much history
  as a series has, capped at `BUZZ.baselineDays` (28) and refused below
  `BUZZ.minBaselineDays` (7); `SIGNALS.minHistoryDays` is derived from it so the
  two can't drift. The floor was measured, not guessed — replaying 120 days of
  real pageviews, a 7-day baseline sustains 72% of its fires against a 13%
  control (5.3x lift) versus 80%/19% (4.3x) at 28 days. Shorter is less precise,
  not broken. Don't drop the floor further to "get more results": at 3 days it's
  68%, and a source with two points can't tell a spike from its own arrival.
- **`days` must keep reaching the UI.** It's what distinguishes a reading built
  on a week of history from one built on a month; without it a young, noisy
  verdict is indistinguishable from a mature one.
- **Google News counts headlines that name the title, not `<item>` tags.** The
  feed carries headline and outlet per item; counting items measured the query,
  not the title — "Animals" returns 50 articles of which 12 are about the film.
  Three numbers are stored: `articles` (raw), `onTopic` (scored) and `outlets`.
- **`outlets` is the honest number for a saturated day.** The feed stops at 100,
  and Avengers: Doomsday already hits it while sitting at 55 distinct outlets.
  Outlets also resist syndication — twelve sites re-running one wire story is
  one story.
- **Single-word titles stay excluded.** Headline filtering rescues some ("Animals"
  → 6 real hits) but fails on common words: for "War" it keeps "A Cold War
  Movie…", for "Him" it keeps "…makes him the most residuals". Both look exactly
  like a hit. The 8-letter floor is gone — filtering handles short distinctive
  phrases like "The Deb" — but the 2-word minimum is load-bearing.
- **Google News must be queried one day at a time.** Counting `pubDate`s from a
  single feed undercounts older days (relevance-ordered, capped at 100) and
  manufactures spikes: one query said 36 articles for a day that windowed
  queries showed as 320. Also saturates at 100/day — stored with `capped: 1`.
- **News backfill is budgeted** (`newsQueriesPerRun`). Seeding the calendar
  unbudgeted is ~3,000 requests and takes minutes.
- **TMDB `voteCount` is 0 until release**, so for a calendar of *upcoming*
  titles `popularity` is the only metric that moves — despite being a black box
  that feeds on its own previous value and is therefore pre-smoothed. Record
  both; score popularity pre-release and votes after.
- **TMDB licensing is unresolved.** Free for non-commercial use only; this is a
  commercial company. Clear it before anything user-facing, and carry the
  attribution notice.
- **A pinned `--today` records no readings**, for the same reason it writes no
  calendar snapshot: today's numbers filed under a past date would corrupt the
  history permanently.
- **Sources are combined by agreement, not arithmetic.** `signals.ts` counts how
  many are rising; it never averages them into one score. Averaging is what the
  deleted demand score did.
- **Only Wikipedia gets 0-100 points.** The Odyssey anchor calibrates pageviews
  and is meaningless for article counts or TMDB popularity. Other sources report
  `relative`/`momentum`/`phase` only.
- **The trailer behind a title is correctable**: `npm run trailer` lists what
  each title is measured from, `set` pins a video and `clear` forgets it. A
  pinned entry has `"pinned": true` and `resolveTrailers()` must keep skipping
  it — an automatic search silently overwriting a human correction is the whole
  failure this guards against.
- **YouTube views are cumulative and must be differenced** before scoring; news
  articles and TMDB popularity are already rates. Getting this backwards
  produces nonsense either way.
- **The detail page shows dissenting sources on purpose.** Hiding the flat rows
  would turn a disagreement into an unearned consensus.
- **Don't reach for Reddit, X or Google Trends without re-probing.** All three
  were tested live and rejected — Reddit 403s unauthenticated, X needs a paid
  key, Google Trends' explore API 429s and its working RSS feed had zero
  intersection with our calendar. Details and numbers are in the README.

## Conventions

- Paths resolve from `ROOT` in `config.ts`, never `process.cwd()`.
- Tunable knobs live in `config.ts`; logic doesn't hardcode numbers.
- Comments explain *why*, especially around API workarounds.
