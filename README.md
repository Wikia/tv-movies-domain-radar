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
npm run radar                          # full run, writes out/radar.json
npm run radar -- --horizon 60 --top 15 # narrower window, longer printout
npm run radar -- --today 2026-08-12    # pin the date for a reproducible run
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
exposes. A first-party Fandom trending signal is the thing worth adding — it
would be the first demand measure covering TV *and* pre-release titles.

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

## Changes and alerts

Every run diffs against the previous snapshot:

| Kind | Meaning | Alerts? |
|---|---|---|
| `new` | Appeared on the calendar since the last run | yes |
| `date-changed` | Release date moved | yes |
| `removed` | Fell off "coming soon" | no — it usually just released |

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
