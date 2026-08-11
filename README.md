# tv-movies-domain-radar

A release radar for the Fandom **TV & Movies** domain team, so nothing worth
supporting ships without us noticing.

It does two jobs:

1. **Schedule** — the full forward calendar of upcoming films and shows.
2. **Traction** — a daily read on what's gaining attention right now.

```
neutron-api ─▶ fetch (coming-soon + trending + popularity)
            ─▶ score (weighted, confidence-capped)
            ─▶ diff vs yesterday's snapshot
            ─▶ out/radar.json ─▶ dashboard + Slack
```

## Quick start

```bash
npm install
npm run radar                          # full run, writes out/radar.json
npm run radar -- --horizon 60 --top 15 # narrower window, longer printout
npm run radar -- --today 2026-08-11    # pin the date for a reproducible run
npm run radar -- --no-trending         # schedule only
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

## Architecture

The browser talks **only** to our own server, never to neutron-api:

```
React (Tailwind)  ──/api/radar──▶  server  ──▶  out/radar.json
                  ──/api/live/*─▶  (proxy) ──▶  neutron-api
```

Three reasons it's shaped this way, only one of which is CORS:

- **State.** The diff ("new on the calendar", "date moved") needs yesterday's
  snapshot. A browser has no yesterday — only a server process can hold that.
- **Unattended work.** The Slack notifier has to run with no browser open.
- **CORS.** neutron-api only allows `*.metacritic.com` / `*.tvguide.com` origins.
  This is a standalone internal tool, so it proxies rather than being hosted
  there — which also keeps the upstream API surface off the public internet.

The server is `node:http` with **no dependencies**; React/Vite/Tailwind are
build-time only, so nothing ships at runtime.

| Route | Serves |
|---|---|
| `GET /api/radar` | the scored + diffed artifact |
| `GET /api/live/trending/:type` | live passthrough (`movie` \| `show`) |
| `GET /health` | liveness probe |
| `GET /*` | the built React app, with SPA fallback |

## Where the data comes from

Everything comes from **`neutron-api`**, the backend-for-frontend behind
metacritic.com and tvguide.com, reached through Fastly at
`https://backend.metacritic.com`. Its content endpoints are public — no key, no
auth header. Override the host with `NEUTRON_API_BASE` for stage/dev.

| Purpose | Endpoint |
|---|---|
| Schedule | `/finder/metacritic/web?releaseType=coming-soon&mcoTypeId={1 TV, 2 film}` |
| Traction | `/recommendations/metacritic/trending/{movie,show}` (JustWatch-derived, 15/type, 1h cache) |
| Demand | `/finder/metacritic/web?sortBy=-popularityCount&releaseDateMin=…&releaseYearMax=…` |

### API quirks worth knowing

All of these were verified against the live API, not just read in the source:

- **`sortBy` is silently ignored when `releaseType=coming-soon`.** The server
  overwrites it with `sortBy=releaseDate` and forces the window to now → +3
  years. `releaseYearMin`/`Max` are overwritten too. Sort and narrow locally.
- **Getting a demand ranking requires avoiding `coming-soon`.** Passing
  `releaseDateMin` + an explicit `releaseYearMax` gives a forward window without
  triggering the override, so `-popularityCount` survives.
- **`limit` above 50 returns a 400.**
- **Fastly 403s non-browser user agents** — the client sends a browser `User-Agent`.
- **Paging can repeat a title**; results are deduped by catalog id.
- **CORS is locked to `*.metacritic.com` / `*.tvguide.com`**, so a browser app
  can never call this API directly. The dashboard reads `out/radar.json` instead.

## Scoring

| Signal | Weight | Confidence | Notes |
|---|:--:|:--:|---|
| `fandomSignal` | 0.40 | 1.0 | **Reserved, not yet wired** — first-party Fandom trending. |
| `popularityRank` | 0.25 | 1.0 | Metacritic popularity among future titles. |
| `trendingRank` | 0.20 | 1.0 | Current engagement, JustWatch-derived. |
| `imminence` | 0.10 | 0.4 | How soon it lands. A date, *not* demand. |
| `criticScore` | 0.05 | 0.5 | Rarely present pre-release. |

Weights re-normalize over whichever signals a title actually has, so missing data
never counts as zero.

**The confidence cap is what makes the ranking honest.** A title's score is
capped by the confidence of its best signal. Demand data is sparse — only ~32 of
~220 upcoming titles carry a popularity rank, and **no upcoming show does** (the
popularity sort forces a `reviewCount >= 7` filter upstream that nothing
unreleased clears). Without the cap, a title with no demand signal scored ~99
purely because it releases tomorrow, and 164 of 220 titles "qualified" for an
alert. With it, uncorroborated titles cap at 40 and sit in the schedule where
they belong.

> **Known limitation:** demand coverage is thin, and TV has none at all. The
> first-party Fandom signal is the intended fix — it carries the heaviest weight
> and slots in without touching anything else. Until then, treat the ranking as
> "movies with corroboration, then everything else chronologically."

## Alerts

A title is worth a ping if **any** rule fires. Multiple reasons collapse into one
alert, so a title never appears twice.

| Rule | Trigger |
|---|---|
| `trending-and-imminent` | In the trending list **and** landing within 30 days. |
| `high-score` | Computed score ≥ 70. |
| `newly-added` | Appeared on the calendar since the last run. |
| `date-changed` | Release date moved (within 180 days). |

`newly-added` / `date-changed` come from diffing against the previous snapshot —
a signal Metacritic itself doesn't expose. The first run establishes a baseline
and deliberately raises no change alerts, so it can't post hundreds of lines of
noise. `removed` is recorded but never alerts: it usually just means the title
released.

## Outputs

- **`out/radar.json`** — the single source of truth. Contains `titles`
  (chronological), `trending`, `changes`, `alerts`, and headline `counts`. The
  dashboard, the static page, and the Slack notifier all read this one file, so
  they can't drift apart.
- **`out/dashboard.html`** — self-contained page, data baked in. Open it
  directly; no server, no network.
- **`out/dashboard.artifact.html`** — the same page as a body-only fragment for
  publishing as a shareable Artifact (the host supplies the skeleton).
- **`data/snapshots/latest.json`** + a dated copy — the diff baseline. Git-ignored.
- **`data/posters/<id>.jpg`** — cached poster thumbnails. Git-ignored.

## Poster art

The catalog's images are **full-resolution originals — 2.3 MB on average, one
sampled at 13 MB**. Never render `title.image` directly; use `title.poster`.

Two ways to get usable art, in order of preference:

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

The Artifact fragment **inlines** the art as data URIs, because its CSP blocks
every external host — a remote `<img>` would silently show nothing. Inlining is
budgeted (7 MB) to stay well inside the 16 MB artifact cap.

### Two surfaces, one dataset

| | Who it's for | Needs a server |
|---|---|---|
| `web/` (React) | the operator — filters, search, live proxy | yes |
| `out/dashboard*.html` | anyone you share it with | no |

## Visual identity

**Poster-led.** Film and TV are visual and the catalog hands us the artwork, so
the art carries the page and the chrome stays quiet: near-neutral ground, one
warm signal colour, a rose for anything live, generous poster grid. Deliberately
unlike the gaming radar's cool blue-grey card dashboard.

Colour is semantic, never decorative: **live** = urgent, **signal** = demand or
a moved date, **up** = an addition.

The tokens are duplicated in `src/artifact.ts` (CSS) and `web/src/index.css`
(Tailwind `@theme`) — the static page can't import from the React app. **Change
one, change the other.**

## Layout

```
src/                    # pipeline + server (zero runtime dependencies)
├── index.ts            # entrypoint: orchestrate, report, write
├── server.ts           # thin proxy + static host for the dashboard
├── config.ts           # weights, confidence, thresholds, API constants
├── types.ts            # data model
├── scoring.ts          # merge, normalize, weighted score + confidence cap
├── snapshot.ts         # save/load/diff — the "don't miss anything" mechanism
├── alerts.ts           # alert rules
├── artifact.ts         # self-contained HTML page + artifact fragment
└── sources/neutron.ts  # the only network dependency

web/                    # React + Tailwind dashboard (build-time deps only)
└── src/
    ├── App.tsx         # layout, data fetch, stat tiles
    ├── types.ts        # mirrors the pipeline model
    ├── lib/format.ts   # dates, countdowns, reason labels
    └── components/     # Alerts, Schedule, Sidebar, Primitives
```

A note on the UI: titles with no demand signal render **“—” rather than a
score**. A capped 40 is an absence of evidence, not a measurement, and showing it
as a number invites ranking on noise.

## Status

- [x] Pipeline: fetch → score → diff → `out/radar.json`
- [x] Server: `/api/radar`, live proxy, static host
- [x] Dashboard: React + Tailwind, alerts / schedule / trending / changes
- [x] Shareable static page + publishable Artifact fragment
- [ ] Slack notifier (needs a channel + incoming webhook)
- [ ] Dockerfile + k8s manifests for GKE
- [ ] First-party Fandom signal (deferred — availability unconfirmed)
- [ ] Scheduled daily run (manual for now)
