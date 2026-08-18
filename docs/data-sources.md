# Data sources & scoring

Six inputs: one builds the release calendar, five measure attention on it.
No scraping, no paid tiers.

Full detail in [`../README.md`](../README.md); agent notes in
[`../CLAUDE.md`](../CLAUDE.md).

## 1. The APIs we call

### neutron-api — the release calendar · public, no key

```
GET backend.metacritic.com/finder/metacritic/web
      ?releaseType=coming-soon&mcoTypeId={1=TV|2=film}&limit=50&offset=N
```

Metacritic and TVGuide's own backend-for-frontend. **Every title in the
schedule table comes from this one endpoint**, paged out in full rather than
top-N. Gives us dates, type, genres, network, rating, synopsis, artwork and
critic/user scores.

Note: `sortBy` is silently ignored under `releaseType=coming-soon` (the server
forces `releaseDate` and a now → +3yr window), `limit > 50` is a 400, paging
repeats titles so results are deduped by id, and there is no popularity number
exposed anywhere in this API.

### Wikimedia Pageviews — public attention · public, no key

```
GET wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/…/daily/{start}/{end}
GET en.wikipedia.org/w/api.php?action=query&list=search        ← title → article
GET en.wikipedia.org/w/api.php?action=query&prop=categories    ← confirm it's a film/show
```

Daily views of a title's Wikipedia article. **The only source that hands back
history** — two months on every call — so it works on a cold first run, and it
is what the buzz score is built on. Views lag ~4 days, so the series is trimmed
to the last day with real data.

### Google News RSS — press volume · public, no key

```
GET news.google.com/rss/search?q="Title" movie after:{day} before:{day+1}
```

Article count per title per day. **Queried one day at a time**: a single
unwindowed feed is relevance-ordered and capped at 100 items, which undercounts
older days and manufactures spikes. Budgeted at 600 queries/run.

### YouTube Data API v3 — trailer traction · free key

```
GET youtube/v3/search                    ← resolve the official trailer once, then cache
GET youtube/v3/videos?part=statistics    ← 50 ids per call
```

Views, likes and comments on the official trailer. **Lifetime totals only**, so
the daily rate is the difference between our own consecutive readings. Roughly
five quota units a day for the whole calendar.

### TMDB API v3 — audience interest · free key

```
GET api.themoviedb.org/3/search/{movie|tv}    ← resolve id once, then cache
GET api.themoviedb.org/3/{movie|tv}/{id}
```

Popularity index, vote count and average. **Current values only**, no history
endpoint. The token stays server-side and is never exposed to the frontend.

### Fandom trending export — our own audience · internal file, no API

Not an API call. A four-step chain out of our own warehouse:

```
Snowflake  DB_CURATED.ENGAGEMENT.SECURE_VIEW_TRENDING_WIKIS
   ↳ Google Sheet "Auto-refreshed trending"        (auto-refreshed weekly)
       fileId 1jQ6iuOxhSnZK674t-H7MLGI74oZSpHoDfMAHZ_kPlfc
   ↳ data/fandom_trending.csv                      (downloaded per run)
   ↳ src/sources/fandom.ts                         (reads the file)
```

The `/radar` skill pulls the sheet through the **Google Drive MCP**
(`download_file_content`, `exportMimeType=text/csv`) and writes it verbatim.
Manual fallback: open the workbook → File → Download → CSV on the
"Auto-refreshed trending" tab. No credentials live in the repo — the agent
fetches, the pipeline only reads the file.

Which TV/film wikis are trending this week, with 14-day pageviews and a
week-over-week score. **The only source that measures our own readers** rather
than someone else's. Currently 205 TV/film wiki rows for week `2026-08-16`.
Matched to titles exact-or-prefix, 6+ characters.

The CSV is **not committed and has no seeded fallback** — a stale trending
signal presented as this week's is worse than none. Without the file the
pipeline still runs and reports `trending: null`, meaning "no first-party
signal", never "nothing is trending".

**Probed and rejected:** Reddit (403 unauthenticated, commercial gate), X (paid
tier only), Google Trends (explore API rate-limits; its working RSS feed had
zero overlap with our calendar).

## 2. How buzz is calculated

One question: **is this title above its own normal right now?**

1. **Compare it to itself.** Last 3 days against the median of the 28 before —
   not against other titles, so a mid-budget horror breakout is visible next to
   Marvel.
2. **Divide out the release ramp.** Every title climbs as its date approaches,
   so each is measured against titles the same distance from release. Only
   unusual movement survives.
3. **Check it's still climbing.** A 7-day memory separates a live spike from
   the tail of one that already ended.
4. **Score the size of the surge**, not the multiple — so a big title sitting
   at its normal level scores ~0.

```
excess = recent − expected     // extra views/day beyond normal
points = log-scaled, where 100 = The Odyssey's 1.2M/day peak
```

For scale: Superman 93, Avatar: Fire and Ash 90, Wicked: For Good 82 — an
ordinary trailer drop lands in the 40s–60s, which is the point.

The other four sources are scored the same way but keep their own units; they
are combined **by agreement, not averaging** — two independent sources rising
is `confirmed`.

Backtested over 120 days: **87% of fires still elevated after 7 days against an
18% control base rate — 5.0× lift**, ~10 firings/day. Re-run `npm run backtest`
before changing any of this.

## 3. What we store

Wikipedia backfills two months on demand. The rest report only what is true
today, so **their history exists only because we record it daily.**

| Source | Kept per day | Where |
|---|---|---|
| neutron-api | the full title record | `data/snapshots/{date}.json` |
| Wikipedia | nothing — refetched | `wiki-articles.json` (id resolution only) |
| Google News | `{articles, capped?}` | `data/signals/news.json` |
| YouTube | `{views, likes, comments}` | `data/signals/youtube.json` |
| TMDB | `{popularity, voteCount, voteAverage}` | `data/signals/tmdb.json` |
| Fandom export | score, 14d views, prior week | re-downloaded from the sheet each run, not stored |

Append-only, keyed by title id, pruned at 60 days. A missing day stays missing
— never backfilled with zero. A source needs **7 recorded days** before it may
call anything a trend.

**Open item:** TMDB is free for non-commercial use only. Licensing needs
clearing, plus the attribution notice ("This product uses the TMDB API but is
not endorsed or certified by TMDB"), before this goes anywhere user-facing.
