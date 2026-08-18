# tv-movies-domain-radar

A release radar for the Fandom **TV & Movies** domain team, so nothing worth
supporting ships without us noticing.

It does one job well: show the **forward release calendar**, and flag **what
changed on it** since the last run.

```
neutron-api ─▶ fetch coming-soon calendar
            ─▶ diff vs the previous snapshot
            ─▶ out/radar.json ─▶ dashboard · static page · Slack
```

## Quick start

```bash
npm install
npm run scan                          # full run, writes out/radar.json
npm run scan -- --horizon 60          # narrower window
npm run scan -- --today 2026-08-12    # pin the date for a reproducible run
```

No API keys, no `.env`, no VPN. The pipeline has **zero runtime dependencies** —
Node 20's built-in `fetch` is all it uses.

### Dashboard

```bash
npm run web:install   # first time only
npm run dashboard     # radar + build + serve -> http://localhost:8787
```

For UI work, run the server and Vite side by side — Vite proxies `/api` to the
server, so the dashboard hot-reloads against real data:

```bash
npm run serve      # terminal 1  (port 8787)
npm run web:dev    # terminal 2  (Vite dev server, proxies /api)
```

## What it deliberately does NOT do

**There is no demand or popularity score.** An earlier version had one, built
from the only two signals this API offers, and both were removed:

- **Popularity** covered **32 of 233** titles and **no TV at all** — the
  upstream sort forces a `reviewCount >= 7` filter that nothing unreleased
  clears.
- **Trending** never once intersected the release calendar. It measures what
  people are watching *now*, which is almost entirely already-released catalog.

With those gone, the ranking had nothing left but "how soon does it release",
which is a calendar fact wearing a score's clothing. Sorting by date and being
honest about it beats a number that looks like evidence and isn't.

The **diff is the real product**, and it's the one signal no upstream API
exposes.

That paragraph used to end "a first-party Fandom trending signal is the thing
worth adding". It has since been added — see below — and it is deliberately
**not** a score. Nothing ranks titles against each other; the wiki signal hangs
off a title as labelled evidence with its own match confidence, and the schedule
stays in date order.

## The first-party trending signal

Fandom's own weekly wiki traffic, from the internal **"Trending Data Workbook"**
export (Snowflake `DB_CURATED.ENGAGEMENT.SECURE_VIEW_TRENDING_WIKIS`). This is
the one demand measure that works here, because it is keyed on **wikis**, which
exist long before a release does — which is exactly why it succeeds where the
upstream trending feed failed.

Each wiki row yields three things, and the composite `fpScore` (0..1) that
orders them:

| Field | Meaning |
|---|---|
| `trendingScore` | the level — how hot the wiki is this week (weight 0.85) |
| `velocity` | week-over-week rise; only trusted when a prior week exists, since a prior of `0` nearly always means "absent last week" (weight 0.15) |
| `isNew` | first week trending in the 8-week window — the strongest early signal, because an audience just *formed* (flat +0.05) |

**Two outputs, and the second matters as much as the first:**

- **Matched** — upcoming titles whose wiki is trending, tagged in place on the
  schedule. Small by construction: on the first live run, 3 of 212.
- **Unmapped** — trending wikis with *no* upcoming release behind them (57 of
  59 on that run). This is the "are we missing something?" list, and for TV/film
  it's arguably the more valuable half: a back-catalog show surging on a
  streamer is invisible to a release calendar by construction. It renders full
  width **below** the schedule rather than in the sidebar, because at 300px each
  wiki was one truncated line.

Every figure in that panel is phrased as a sentence — "2,393 readers in 14 days
· 16% → 85% this week", with a `1st week trending` or `climbing` badge. It used
to print `0.83 · level 0.85 · +0.69`, which is the raw export's vocabulary:
three unlabelled decimals that look like the same kind of number and aren't.
`priorScore` is carried through the pipeline purely so the UI can say "was 16%,
now 85%" instead of a velocity delta no reader can interpret.

### Matching is strict, on purpose

A wiki ties to a title on its **domain** (the strong anchor), franchise label,
or installment label — but only by **exact** match or by one key **prefixing**
the other, with prefixes needing 6+ characters. Both limits come from real false
positives in the live export:

- free substring matching tied *"The Musical"* to `sixthemusical.fandom.com` —
  contained, but a coincidence of wording rather than a franchise;
- a 4-character key let franchise *"Coco"* claim *"Cocomelon: The Movie"*.

A wrong tie attributes real audience heat to the wrong title and nothing
downstream would catch it, whereas a miss just lands in the unmapped panel for a
human. So the trade is deliberately biased toward missing.

Most matches come out as **`franchise`**, not `exact`, because most films have
no wiki of their own — only a franchise hub. The UI says *"franchise hot"* for
those and *"wiki hot"* only for an exact tie; that distinction is editorial, not
cosmetic, and shouldn't be collapsed.

### When it alerts

The export is **weekly**; the radar runs **daily**. So a wiki merely trending at
a steady level never alerts — that's a standing fact, true again tomorrow, and
alerting on it would reproduce the same list every run until people stopped
reading it. `wiki-trending` fires only when the wiki is **newly trending** or has
**climbed** by at least `TRENDING.velocityAlert` (0.15), and only inside the same
alert window as the date rules.

### First-party data sync

`data/fandom_trending.csv` is **not committed and has no seeded fallback** — a
stale trending signal presented as this week's is worse than none.

- **Via the `/radar` skill (default):** the agent pulls the sheet through the
  **Google Drive MCP** (`download_file_content`, `fileId`
  `1jQ6iuOxhSnZK674t-H7MLGI74oZSpHoDfMAHZ_kPlfc`, `exportMimeType=text/csv`) and
  writes it verbatim to `data/fandom_trending.csv`. No credentials live in the
  repo; the agent fetches, the pipeline just reads the file.
- **Manual fallback:** open the workbook, **File → Download → Comma-separated
  values** on the "Auto-refreshed trending" tab, and copy it into place. Faster
  than fighting the MCP when it's slow.

Without the file the pipeline still runs and says so — `trending` comes out
`null`, which means *"we had no first-party signal"*, never *"nothing is
trending"*. The dashboard renders that as missing input rather than a quiet
week.

The loader tolerates the sheet's raw formats directly: `trending_score` as
either a float (`0.9579`) or a percent string (`"95.79%"`), and `vertical_labels`
in either case (this one sheet carries both `tv` and `TV`, `movies` and
`Movies` — matching case-sensitively would silently drop a tenth of the rows).

## Where the data comes from

Everything comes from **`neutron-api`**, the backend-for-frontend behind
metacritic.com and tvguide.com, reached through Fastly at
`https://backend.metacritic.com`. Its content endpoints are public — no key, no
auth header. Override the host with `NEUTRON_API_BASE` for stage/dev.

```
GET /finder/metacritic/web?releaseType=coming-soon&mcoTypeId={1 TV, 2 film}
```

### API quirks worth knowing

All verified against the live API, not just read in the source:

- **`sortBy` is silently ignored when `releaseType=coming-soon`.** The server
  overwrites it with `sortBy=releaseDate` and forces the window to now → +3
  years. `releaseYearMin`/`Max` are overwritten too. Sort and narrow locally.
- **`limit` above 50 returns a 400.**
- **Fastly 403s non-browser user agents** — the client sends a browser `User-Agent`.
- **Paging can repeat a title**; results are deduped by catalog id.
- **CORS is locked to `*.metacritic.com` / `*.tvguide.com`**, so a browser app
  can never call this API directly. The dashboard reads `out/radar.json` instead.

## Buzz — the public-attention score

Wikipedia pageviews for each title's own article, turned into a 0–100 score.
This is the "point system" for what's actually being talked about, and it is
built specifically to avoid the two failures that killed the original demand
score:

1. **It scores a title against itself, not against other titles.** Ranking by
   absolute attention just rediscovers which franchises are famous. What's
   actionable is a title departing from its *own* normal, so a mid-budget
   thriller breaking out is visible next to a tentpole.
2. **It removes the release ramp first.** Attention rises as a release
   approaches for *every* title, so raw growth would flag the whole calendar in
   release week — a calendar fact wearing a score's clothing, which is exactly
   what the deleted score became. Each title is compared against the median
   growth of titles at the same distance from release (`<=7`, `<=30`, `<=90`,
   `<=365`, `far`), so only unusual movement survives. That also absorbs
   anything that moves the whole calendar at once — a holiday, an outage.

| Field | Meaning |
|---|---|
| `baseline` | median daily views over the previous 28 days |
| `recent` | mean daily views over the most recent 3 days |
| `ratio` | `recent / baseline` — raw growth |
| `relative` | `ratio` ÷ the median ratio of its days-out cohort — the detrended figure, and the one to reason about |
| `momentum` | `recent` ÷ median of the **7 days immediately before** it. >1 climbing, <1 falling |
| `excess` | `recent − (baseline × cohort ratio)` — daily views beyond what a title this close to release would get anyway. **This is what `points` measures.** |
| `points` | 0–100 log-scaled on `excess`, anchored so **100 = 1,200,000 excess views/day** |
| `band` | `exceptional` (≥85) · `strong` (≥60) · `normal` |
| `phase` | `rising` (≥2× and climbing) · `fading` (≥2× but falling) · `flat` |
| `spiking` | `phase === 'rising'` |

### Why `points` measures size, not multiple

An earlier version scored the *multiple* (`relative`), which ranked a small
article going 200 → 3,700/day above a major one going 3,000 → 32,000/day — when
the second is by far the larger event. Points now measure the **size of the
anomaly** in absolute excess views.

Using *excess* rather than raw views is what keeps this from becoming the fame
score that was deleted: a huge title sitting at its normal level has excess ≈ 0
and scores ≈ 0. Only a surge scores, whoever it belongs to.

### The anchor: 100 = The Odyssey

The scale is pinned to a real measured event rather than a guess. Peak daily
Wikipedia views, from the API:

| Title | Peak/day | Would score |
|---|---:|---:|
| The Odyssey (18 Jul 2026) | 1,199,464 | **100** |
| Superman (2025) | 651,446 | 93 |
| Avatar: Fire and Ash | 494,427 | 90 |
| Wicked: For Good | 231,066 | 82 |
| *Verity, today's biggest* | *31,883* | *60* |

So an ordinary trailer drop lands in the **40s–60s**, and 100 means a
once-a-year cultural moment. That is deliberate: a score everything can reach
measures nothing.

Band edges sit at **85 / 60** rather than the 90 / 70 the raw anchor suggests,
because at 90/70 a normal week produced no coloured rows at all and the scale
never showed itself. In excess views/day the edges are roughly 330,000
(`exceptional`) and 28,000 (`strong`).

### The heat palette

A four-step green → yellow → orange → red ramp:

| Band | Points | Light | Dark |
|---|---:|---|---|
| `exceptional` | ≥85 | `#b4232a` | `#ef4444` |
| `strong` | ≥60 | `#e2622a` | `#fb923c` |
| `notable` | ≥40 | `#eda100` | `#fde047` |
| `quiet` | <40 | `#008300` | `#4ade80` |

**The steps were re-picked until they passed, not chosen by eye.** Validated with
the dataviz skill's `validate_palette.js` against this app's own surfaces
(`#FAFAF9` / `#0C0C0D`) — obvious picks fail:

- `#ea580c` orange vs `#d97706` amber: deutan ΔE **1.6**, and **6.7** even with
  full colour vision;
- on the dark ground every step must clear 3:1, which pushes orange and red
  together — `#eb6834` sits ΔE **5.6** from `#e66767`.

The shipped sets clear the gates: light worst-adjacent deutan ΔE 11.9 /
normal-vision 15.1; dark normal-vision 16.2 / protan 8.2. Dark is a **separate
selection**, not a lightened copy of light.

Yellow is sub-3:1 on the light ground, so **the score is always rendered beside
the colour** — colour is reinforcement, never the only channel. That also means
the ramp survives greyscale and forced-colors.

A red→green ramp of only two colours was tried first and rejected for a
different reason: with two bands, everything on an ordinary week landed in the
same neutral and a 34 looked identical to a 60.

**Why momentum exists.** A 28-day baseline has a long memory, so a title that
peaked two weeks ago still scores as if it were spiking. *Wicker* went 500/day →
73,000 → back down to 6,000 and was scoring 100 with the event plainly over.
Momentum has a one-week memory, so it catches exactly that: the title is still
elevated (`relative` high) but no longer climbing (`momentum` 0.37), and it's
labelled `fading` instead of `spiking`. On a representative run this moved 4 of
20 "spiking" titles into `fading`.

**Why 15 points per doubling, not 25.** At 25 the scale hit its ceiling at only
4×, and eight titles piled up on exactly 100 — discarding the ordering between a
4× move and a 17× one. Panels rank on `relative`, which never saturates;
`points` exists to be readable at a glance.

**Calibration check** on a representative run of 139 scored titles: median
`points` exactly **50**, median `relative` exactly **1.00**, 16 rising, 4 fading,
119 flat. The per-cohort divisors show the release ramp is real and worth
removing — titles ≤7 days out grow **1.59×** as a matter of course, ≤30 days
**1.19×**, ≤365 days **0.93×**. Without detrending, imminent releases would
dominate the list purely for being imminent.

**Coverage is published, not implied.** On a representative run: 150 of 211
titles resolved to a Wikipedia article, 138 had enough traffic and history to
score, 19 were spiking. A title with no `buzz` has **no signal** — not a cold
one — and the dashboard says so. Titles below `minBaselineViews` (50/day) are
deliberately unscored: an article going 3 → 30 views is a 10× "spike" and pure
noise.

The schedule stays in date order. Buzz appears as its own panel plus a
`spiking` tag on the handful of rows that earn it; only spiking titles are
tagged, because tagging all 138 measured ones would make the marker meaningless.

### Validation — `npm run backtest`

The detector is backtested rather than eyeballed, because the original demand
score shipped on plausibility and had to be torn out. `scripts/backtest.ts`
imports the real `attach()` from `src/buzz.ts` — a reimplementation would
validate a copy — replays it once per historical day over 120 days of real
pageviews, and reports:

```
=== 1. ALERT VOLUME ===
replayed 89 days over 150 titles
rising per day — min 3, median 10, max 22

=== 2. STABILITY ===
distinct rising episodes: 198
flickered off then back within 3d: 17 (9%)

=== 3. HIT vs FALSE ALARM (first fire per title, +7d) ===
judged 110 episodes
  hit (still >=1.5x baseline):  96 (87%)
  ambiguous:                     8 (7%)
  false alarm (reverted):        6 (5%)

=== 4. CONTROL — same test on days the detector stayed QUIET ===
quiet (title, day) pairs: 9087
  elevated anyway: 1592 (18%)

LIFT: 87% vs 18% base rate = 5.0x better than firing at random
```

**The control is the number that matters.** 87% precision means nothing on its
own — if quiet days were equally likely to be elevated a week later, the
detector would be selecting noise. The base rate is 18%, so firing is **5×**
better than random. Any change to the scoring should be judged by re-running
this, not by whether the dashboard looks nicer.

**Ground truth spot-check.** The three highest-scoring titles on 2026-08-17 all
trace to a real, verifiable event on **2026-08-11**:

| Title | Pageviews | Event |
|---|---|---|
| Verity | 3.1k → 31.9k/day | [Amazon MGM released the trailer](https://deadline.com/2026/08/verity-trailer-anne-hathaway-dakota-johnson-amazon-mgm-1236873939/) |
| Josephine | 490 → 7.9k/day | [Sumerian released the first teaser](https://deadline.com/2026/08/josephine-trailer-release-date-gemma-chan-channing-tatum-1237031226/) |
| Gentle Monster | 208 → 3.7k/day | [Netflix released the teaser](https://deadline.com/2026/08/gentle-monster-trailer-lea-seydoux-catherine-deneuve-1237030369/) |

Three for three — and all on the same day, which is the honest explanation for
why the board can look busy: **trailers drop in batches**, so the detector fires
in clusters rather than evenly. That's the world being bursty, not the detector
being noisy.

**Known limits of this backtest:**

- The +7d test measures *durability*, not whether a human would care. A spike
  that decays slowly counts as a hit even if nobody acted on it.
- 110 judged episodes over 150 titles is a small sample from one 4-month window.
- The ground-truth check is 3 titles, chosen because they scored highest — that
  is a precision check on the top of the list, not a recall check. Nothing here
  measures what the detector **missed**.

### Resolving titles to articles

Strict, for the same reason wiki matching is. We search with the title, year and
a type hint (`film` / `TV series`), take five candidates, strip a *trailing*
parenthetical disambiguator, and require an exact match. Then any candidate that
came back **bare** (no disambiguator) is checked against its Wikipedia
categories and kept only if it's categorised as a film or show.

Both steps are load-bearing:

- Without the exact-match rule, `It Ends` resolved to `It Ends with Us (film)` —
  a different, older movie sharing a prefix.
- Without the category check, a title like `The Whisper Man` can resolve to a
  **novel** of the same name and attribute a book's readership to a film.
- Searching five while matching strictly beats searching one loosely: it's what
  lets `It Ends` find its own article further down the list.

The year+type hint does most of the work — it's why `Harry Potter` resolves to
`Harry Potter (TV series)` and not the franchise hub.

Resolutions are cached in `data/wiki-articles.json` (git-ignored). Hits are kept
forever; **misses are retried after 7 days**, because an unreleased film often
gains an article later.

### Why Wikipedia and not Reddit / X / Google Trends

All three were probed against the live APIs before this was built. None of them
is usable here today:

| Source | Result |
|---|---|
| **Reddit** | `HTTP 403` on every unauthenticated endpoint — search *and* plain listings. Needs a registered OAuth app (free) for a client ID/secret. **Viable if someone creates one.** |
| **X** | No usable free tier; the cheapest API access that supports search is ~$200/month. Not probed — it can't work without a paid key. |
| **Google Trends** | No official API. The `/trends/api/explore` endpoint returns `429` immediately without a browser token flow, and the realtime entertainment endpoint now `404`s. The daily-trends RSS *does* work keylessly — but it returns ~10 general search terms per region, and across US+GB those 20 terms had **zero** intersection with our 211 upcoming titles. Google Trends is also relative-normalized per request, so two titles queried separately aren't comparable without an anchor-term scheme. |

Wikipedia won on the three things that matter: keyless, per-title, and it has
~2 months of history available immediately — so the baseline exists on the
**first** run rather than after a month of collecting.

Reddit remains the best addition if it's wanted; the scoring layer is
source-agnostic and a second, independent source would let a spike require
corroboration before it's promoted.

## Signal sources (daily snapshots)

Wikipedia hands back two months of history on every call, so the buzz detector
worked on its first run. **Google News, YouTube and TMDB don't.** YouTube and
TMDB report only lifetime totals; Google News can be asked about a past day, but
one day at a time. For those three, a time series exists *only because we record
one*.

So each run writes a dated reading per source under `data/signals/`:

```
data/signals/news.json     { "<titleId>": { "2026-08-17": { "articles": 21 } } }
data/signals/youtube.json  { "<titleId>": { "2026-08-17": { "views": 12000 } } }
data/signals/tmdb.json     { "<titleId>": { "2026-08-17": { "voteCount": 88 } } }
```

Three rules, each from a bug this project already hit:

- **Append, never rewrite.** A recorded day is history; re-running must not
  disturb it.
- **A missing day is missing, not zero.** Nothing fills gaps. Treating an absent
  reading as a real zero is what scored the entire calendar 0 when Wikipedia's
  publication lag was mistaken for "no views".
- **Keyed by title id**, so a title that drops off the calendar keeps its
  history if the release comes back.

### The 7-day maturity gate

`store.series()` returns `null` until a title has **`SIGNALS.minHistoryDays`
(7)** distinct readings. Three points can't distinguish a spike from a title we
simply started watching, so scoring one would report every newly-added title as
trending. Below the gate it's *no signal* — which the UI already renders
differently from a low score.

Coverage is printed per source, e.g. `60 titles with 7+ days`.

### Google News — no credentials needed

Keyless, no quota, no approval. It also reaches titles Wikipedia can't see: an
article can exist about a film with no Wikipedia article, which is exactly the
buzz detector's blind spot.

**One request per title per day, deliberately.** The obvious approach — fetch
the feed once, count `pubDate`s — is a false-spike generator: the feed is
relevance-ordered and capped at 100 items, so for a busy title the older days
are silently truncated and read as a flat baseline followed by a huge jump.
Measured live: one unwindowed query reported 36 articles for *Coyote vs. Acme*
on 2026-08-12; day-windowed queries over the same period found **320**.
`after:`/`before:` are respected, so a windowed query returns that day only.

**Three numbers per title per day**, because a raw item count measures the
*query*, not the title:

| field | meaning |
|---|---|
| `articles` | everything the query returned — kept for continuity, and so the on-topic share stays inspectable |
| `onTopic` | headlines that actually name the title — **this is what's scored** |
| `outlets` | distinct publications among those |

The feed carries a headline and an outlet on every item, so all three cost the
same single request. Measured on one day: *Star Wars: Starfighter* 45 articles →
38 on-topic; *Animals* 50 → 12.

Two limits, both recorded rather than hidden:

- **Saturates at 100/day.** A day at the cap is stored with `capped: 1` so
  nothing downstream reads it as exact. `outlets` is the more honest number for
  those days — *Avengers: Doomsday* hits the 100-article ceiling while sitting
  at 55 distinct outlets — and it also resists syndication, since twelve sites
  re-running one wire story is one story.
- **Single-word titles are declined.** Headline filtering rescues some of them —
  *Animals* yields 6 hits that really are the Ben Affleck thriller — but it
  fails on common words: for *War* it keeps *"A Cold War Movie…"*, for *Him*
  *"…makes him the most residuals"*. Both look exactly like a hit, so the phrase
  has to carry more than one word. The old eight-letter floor is gone: filtering
  handles short but distinctive phrases like *The Deb*, which it used to throw
  away.

Backfill is **budgeted** (`newsQueriesPerRun`, 600) and ordered nearest-release
first: seeding the whole calendar at once is thousands of requests and took
minutes. The remainder fills in over subsequent runs; steady state is one new
day per title.

### YouTube — needs `YOUTUBE_API_KEY`

Free, self-serve from Google Cloud Console (enable *YouTube Data API v3* →
create an API key). No approval queue.

No backfill: nothing usable on day one, a baseline after about a week. What
*is* available immediately is the trailer's `publishedAt` — a timestamped,
verifiable cause, which is the half of the sentence the dashboard can't yet say.

Quota (10,000 units/day) drives the design: `search.list` costs 100 units so
trailer resolution is cached forever in `data/youtube-videos.json` and budgeted
per run; `videos.list` costs 1 unit and batches 50 ids, so polling the whole
calendar costs about **5 units/day**.

#### Which video a title is measured from

One video per title: the official trailer, found once with
`"{title} {year} official trailer"`, filtered to results whose title contains
the title *and* matches `/trailer|teaser/`, preferring a channel that doesn't
look like an aggregator. Only `views` is scored — `likes` and `comments` are
recorded because the same call returns them, but nothing reads them yet. Views
are a lifetime counter, so the signal is the *difference* between consecutive
readings: a trailer sitting at 34M scores nothing, one adding 200k/day above its
own normal scores.

The resolved id lives in `data/youtube-videos.json`, keyed by
`title|type|year`:

```json
"Here the Whole Time|movie|2026": {
  "videoId": "1Xs_N_qZ3LQ",
  "channel": "IGMDb",
  "videoTitle": "Here the Whole Time (2026) Trailer [ENG SUB]",
  "checked": "2026-08-18"
}
```

Search is right most of the time, and "most of the time" is not good enough to
present as evidence — an aggregator re-upload or the wrong film's teaser
produces a real-looking curve for the wrong thing. So the choice is correctable
by hand:

```bash
npm run trailer                      # every title and the video behind it
npm run trailer -- --missing         # titles with no video at all
npm run trailer -- set "Wicked" https://youtu.be/dQw4w9WgXcQ
npm run trailer -- clear "Wicked"    # forget it; the next scan re-resolves
```

- `set` accepts a bare id or any watch/`youtu.be`/embed/shorts URL, and
  **verifies the video exists** before writing — an 11-character string is a
  plausible id, which is not the same as a real video.
- A title query must match exactly one title; ambiguity is refused with the
  candidates listed rather than guessed at.
- A pinned entry carries `"pinned": true` and is **never re-resolved** by a
  later run, so an automatic search can't undo a human correction.
- Readings already recorded against the old video are kept. Because the daily
  rate is a difference between consecutive readings, switching shows up as one
  gap day rather than a fake spike.
- Pins travel with the rest of the id caches to `resolve/{date}/ids.json`, so a
  cron on a fresh container inherits them.

### TMDB — needs `TMDB_ACCESS_TOKEN`

v3 Read Access Token as a Bearer header. Ids cached in `data/tmdb-ids.json`.

**Score `popularity` before release, `voteCount` after.** `voteCount` is the
more interpretable metric — a plain counter, so day-over-day it's votes-per-day
— but it is **0 until a title is released**: *Verity* (out in September) has 0
votes and popularity 13, while released titles carry thousands. Since this radar
is entirely about upcoming titles, `popularity` is the only TMDB metric that
moves for us, despite being a proprietary composite that feeds on its own
previous value and is therefore pre-smoothed. Both are stored; `voteCount`
becomes the better signal the moment a title lands.

TMDB has changed the popularity formula before, moving every title at once. The
detector is already immune: cohort detrending divides each title's ratio by the
median ratio of its days-out bucket, so anything shifting the whole population
cancels — a guard built for the release ramp that happens to cover this too.

> **Licensing.** TMDB is free for non-commercial use with attribution.
> Commercial use requires a licence from TMDB. This is an internal tool at a
> commercial company, so **get that cleared before it goes user-facing**, and
> add the required notice: *"This product uses the TMDB API but is not endorsed
> or certified by TMDB."*

### Environment

```bash
YOUTUBE_API_KEY=      # optional; YouTube no-ops without it
TMDB_ACCESS_TOKEN=    # optional; TMDB no-ops without it
```

Both degrade to "no signal" when absent, the same way the first-party export
does — a missing key never fails the run.

## The multi-source verdict

Every source with enough history is asked the same question — *is this title
above its own normal?* — using buzz.ts's machinery: same baseline window, same
cohort detrend, same momentum gate.

**What is deliberately NOT shared is the 0–100 score.** That scale is anchored on
The Odyssey's 1.2M pageviews/day and means nothing for article counts or a TMDB
popularity index; a shared number would invent a comparability that doesn't
exist. Each source reports only the part that transfers — how far above its own
normal (`relative`), which way it's moving (`momentum`, `phase`), and how many
days back the claim.

Sources are then combined by **agreement, not arithmetic**:

- **confirmed** — `SIGNALS.confirmAtSources` (2) or more rising
- **single source** — one rising

Averaging them into one more-confident-looking number is exactly the move that
produced the demand score this project deleted. Counting them tells you
something averaging can't: whether an event is broad or narrow.

Two details that matter:

- **YouTube views are cumulative**, so they're differenced into a daily rate
  before scoring; TMDB popularity and news article counts are already rates.
  Diffing a level, or failing to diff a counter, both produce nonsense.
- **Detrending happens per source.** A week where the whole calendar gets more
  press is a property of the press, not of any title in it.

### Per-title detail pages

A trending title links to `/title/<id>`, which shows every source's reading side
by side — **including the ones that disagree.** A title rising on YouTube and
flat on Wikipedia is a different and more interesting fact than one rising
everywhere, and hiding the dissent would turn a disagreement into an unearned
consensus.

`confirmed` is a claim; the detail page is the evidence behind it. A claim the
reader can't inspect is one they have to take on faith, which is what got the
original score deleted.

## Changes and alerts

Every run diffs against the previous snapshot:

| Kind | Meaning | Alerts? |
|---|---|---|
| `new` | Appeared on the calendar since the last run | yes |
| `date-changed` | Release date moved | yes |
| `removed` | Fell off "coming soon" | no — it usually just released |

Plus one reason that doesn't come from the diff at all: **`wiki-trending`**, when
a title's Fandom wiki is newly trending or climbing (see above). A title already
on the calendar, unmoved, can still be the one whose audience just showed up.

Changed titles are tagged **in place** in the schedule and reachable through the
**Changed** filter; there's no separate section duplicating the same rows. They
are exempt from the horizon window — a change matters however far out it sits.

The baseline is the most recent snapshot from a **previous day** — never the
last run. That makes re-running idempotent: run the radar five times and it
still reports "what changed since yesterday", instead of the second run
comparing today against today and reporting nothing.

A run with no earlier day on record establishes the baseline and reports no
changes, so a first run can't post hundreds of lines of noise. Snapshots are
pruned after 60 days, and `--today` pinned to a past date deliberately does not
persist one — reproducing an old run must not overwrite that day's real
baseline.

## Architecture

The browser talks **only** to our own server, never to neutron-api:

```
React (Tailwind)  ──/api/radar──▶  server  ──▶  out/radar.json
                  ──/thumbs/*───▶  (poster cache)
```

- **State.** The diff needs yesterday's snapshot. A browser has no yesterday —
  only a server process can hold that.
- **Unattended work.** The Slack notifier has to run with no browser open.
- **CORS.** neutron-api only allows `*.metacritic.com` / `*.tvguide.com` origins,
  and this is a standalone internal tool.

The server is `node:http` with **no dependencies**; React/Vite/Tailwind are
build-time only.

| Route | Serves |
|---|---|
| `GET /api/radar` | the diffed calendar |
| `GET /thumbs/<id>.jpg` | cached poster art |
| `GET /health` | liveness probe |
| `GET /*` | the built React app, with SPA fallback |

## Outputs

- **`out/radar.json`** — the single source of truth: `titles` (chronological),
  `changes`, `alerts`, `counts`. Every surface reads this one file, so they
  can't drift apart.
- **`out/dashboard.html`** — self-contained page, data baked in.
- **`out/dashboard.artifact.html`** — body-only fragment for publishing as a
  shareable Artifact.
- **`data/snapshots/latest.json`** + a dated copy — the diff baseline. Git-ignored.
- **`data/posters/<id>.jpg`** — cached poster thumbnails. Git-ignored.

## Theme

Light and dark, with an explicit toggle that persists to `localStorage`. Until
someone chooses, the page follows the OS — so all three viewer states resolve:
system-light, system-dark, and an explicit choice that beats the OS in both
directions.

Tokens are duplicated in `src/artifact.ts` (CSS) and `web/src/index.css`
(Tailwind) — the static page can't import from the React app. **Change one,
change the other.** The React side declares its palette as plain custom
properties and maps them through `@theme inline`, which is what lets a class
like `bg-ground` follow the active theme instead of being baked at build time.
The static page scopes its tokens to `.radar` rather than `:root`, so its toggle
can't fight the theme the Artifact host stamps on the root element.

## Poster art

The catalog's images are **full-resolution originals — 2.3 MB on average, one
sampled at 13 MB**. Never render `title.image` directly; use `title.poster`.

1. **Signed resize URLs** — what metacritic.com itself serves, via
   `/a/img/resize/{hmac}{path}?{params}`, HMAC-SHA1 keyed by the Fastly image
   secret. Set `FASTLY_IMAGE_SECRET` and the pipeline generates them directly
   (~15 KB webp, no local cache, works on any host). Uses `node:crypto`, so the
   zero-dependency rule still holds. **This is the right answer for deployment.**
2. **Local thumbnail cache** — no secret needed. Downloads once and downscales
   with `sips` (macOS), into `data/posters/`. Capped at 90 downloads per run, so
   run the radar a few times to fill it. This is the current default.

Neither available → titles fall back to an initials tile. Art is an enhancement;
nothing depends on it.

The Artifact fragment **inlines** art as data URIs, because its CSP blocks every
external host. Inlining is budgeted (7 MB) to stay inside the 16 MB cap.

## Layout

```
src/                    # pipeline + server (zero runtime dependencies)
├── index.ts            # entrypoint: fetch, diff, write, report
├── server.ts           # static host + JSON API for the dashboard
├── config.ts           # horizon, alert window, API constants
├── types.ts            # data model
├── schedule.ts         # date maths and chronological ordering
├── snapshot.ts         # save/load/diff — the "don't miss anything" mechanism
├── alerts.ts           # which changes are worth surfacing
├── artifact.ts         # self-contained HTML page + artifact fragment
├── posters.ts          # signed resize URLs or a local thumbnail cache
└── sources/neutron.ts  # the only network dependency

web/                    # React + Tailwind dashboard (build-time deps only)
```

## Status

- [x] Pipeline: fetch → diff → `out/radar.json`
- [x] Server, dashboard, shareable static page
- [x] Light/dark theme with a toggle
- [ ] Slack notifier (needs a channel + incoming webhook)
- [ ] Dockerfile + k8s manifests for GKE
- [ ] First-party Fandom signal — the only demand measure worth adding
- [ ] Scheduled daily run (manual for now)
