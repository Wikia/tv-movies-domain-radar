import path from 'node:path'

/** Tunable knobs: horizon, alert window, API constants.
 *
 * The radar has one job: show the forward release calendar and flag what
 * changed on it. There is deliberately no scoring here — see types.ts.
 */

/** Default forward window, in days. Titles beyond this are still collected —
 * they just don't count as "in horizon" for the headline counts. */
export const HORIZON_DAYS = 90

export const ALERTS = {
  /** Only flag changes to titles landing within this many days, so a date
   * shuffle three years out doesn't interrupt anyone. */
  changeWindowDays: 180,
} as const

/** First-party trending signal, read from the internal weekly wiki export.
 *
 * This is the ONE demand signal the README sanctions, because it measures our
 * own audience rather than guessing at it. It is attached to titles as evidence
 * and never blended into a ranking — see types.ts.
 */
export const TRENDING = {
  /** `vertical_labels` values that belong to this domain, lower-cased. The
   * export also carries gaming, books, graphic_novels, anime and music wikis;
   * those belong to other domain teams. Anime is deliberately excluded — it is
   * its own vertical upstream — but it is a one-word change if that moves. */
  verticals: ['tv', 'movies'],

  /** Shortest normalized key we'll match on at all. Guards the bug the gaming
   * radar hit: an empty key is a substring of everything, so a title that
   * normalizes to "" silently matches every wiki and steals the biggest one. */
  minKey: 4,

  /** Shortest key allowed to match as a *prefix* rather than outright. Set from
   * a real false positive: franchise "Coco" (4) prefixed "Cocomelon: The Movie"
   * and attached the wrong wiki. Six characters kills that and still keeps
   * "Godzilla" -> "Godzilla x Kong: Supernova". */
  minPrefixKey: 6,

  /** Week-over-week rise in trending_score that counts as a real climb worth
   * alerting on. Below this a wiki is simply trending, which is a level, not a
   * change — and this radar only interrupts people for changes. */
  velocityAlert: 0.15,

  /** How many unmapped trending wikis to carry into the output. */
  topUnmapped: 15,
} as const

/** Public-attention signal, from Wikipedia pageviews.
 *
 * Reddit, X and Google Trends were all probed live and rejected — see README
 * "Why Wikipedia and not Reddit/X/Google Trends". This is the only per-title
 * public source that is keyless, reachable, and actually covers the calendar.
 */
export const BUZZ = {
  /** Days of recent attention averaged into the "now" figure. Three smooths
   * out a single freak day without blurring a real spike. */
  recentDays: 3,

  /** Days of history the baseline is taken from, ending where `recentDays`
   * begins. Long enough to survive one quiet week, short enough that a title's
   * normal can move over a season. */
  baselineDays: 28,

  /** Minimum baseline daily views before a title can spike at all. Without
   * this, an article going from 3 views to 30 is a 10x "spike" and pure noise.
   * Set above the level where Wikipedia's own crawler/bot floor lives. */
  minBaselineViews: 50,

  /** Detrended ratio at which a title is elevated. 2 = "twice its own normal,
   * after removing the ramp every title its age is getting". */
  spikeRatio: 2,

  /** What 100 points means, in EXCESS daily pageviews — attention beyond what
   * the title would be getting anyway.
   *
   * Anchored on a real event rather than a guess: The Odyssey peaked at
   * 1,199,464 views/day on 2026-07-18 against a 14k median. For scale, Superman
   * (2025) peaked at 651k, Avatar: Fire and Ash at 494k, Wicked: For Good at
   * 231k. So 100 is a genuine once-a-year cultural moment, and an ordinary
   * trailer drop lands in the 40s-60s — which is the point. A score that
   * everything can reach measures nothing. */
  anchorExcess: 1_200_000,

  /** Excess below this is noise and scores 0 regardless of multiple. */
  floorExcess: 100,

  /** Band edges, in points — a green -> yellow -> orange -> red heat ramp.
   *
   * Four bands rather than two because with only two, everything on an ordinary
   * week landed in the same neutral colour and a 34 looked identical to a 60.
   * Getting four to work needed the hues re-stepped until adjacent pairs cleared
   * separation in BOTH modes (see the palette note in artifact.ts) — the obvious
   * green/yellow/orange/red picks fail, orange against yellow in light and
   * orange against red in dark.
   *
   * In excess views/day the edges land at roughly:
   *   exceptional (85) ~= 330,000/day — Wicked: For Good and up
   *   strong      (60) ~=  28,000/day — a major trailer drop
   *   notable     (40) ~=   4,700/day — a solid, visible bump
   *   quiet       (<40)               — measurable but minor
   */
  bands: { exceptional: 85, strong: 60, notable: 40 },

  /** Days immediately before the recent window, used to tell a spike that is
   * still climbing from the decaying tail of one that already happened.
   *
   * Without this, a title that peaked two weeks ago and has been falling ever
   * since still reads as "spiking", because the 28-day median it's compared
   * against never caught up. Wicker went 500/day -> 73,000 -> back down to
   * 6,000 and was scoring 100 while clearly on the way out. */
  momentumDays: 7,

  /** Below this, recent attention is falling fast enough to call the event
   * over. Slightly under 1 so ordinary day-to-day wobble doesn't read as
   * decline. */
  fadingBelow: 0.9,

  /** Buckets (in days out) used to detrend the release ramp. Attention rises as
   * a release approaches for EVERY title, so comparing a title only against its
   * own past would flag the whole calendar in release week — a calendar fact
   * dressed as evidence, which is exactly what got the old score deleted.
   * Comparing against titles at the same distance removes it. */
  cohortBuckets: [7, 30, 90, 365],

  /** Extra days requested to absorb the pageviews API's publication lag.
   *
   * Measured against the live API, not assumed: on 2026-08-17 the most recent
   * available day was 2026-08-13. Anchoring the recent window on "yesterday"
   * therefore filled it with missing days, every ratio collapsed toward zero,
   * and the whole calendar scored 0. The series is now trimmed to the last day
   * that actually has data, and we over-request by this much so a full window
   * still survives the trim. */
  lagDays: 7,

  /** Politeness. Wikimedia asks for a descriptive agent with a contact, and
   * rate-limits anonymous bursts; 4 in flight keeps a full run well inside it. */
  concurrency: 4,

  /** Re-attempt an unresolved title this many days after the last failed
   * lookup. An unreleased film often has no Wikipedia article yet and gets one
   * later, so a permanent negative cache would freeze it out for good. */
  retryMissAfterDays: 7,
} as const

/** Wikimedia requires a descriptive User-Agent identifying the operator. */
export const WIKI_USER_AGENT =
  'tv-movies-domain-radar/0.1 (https://github.com/fandom; tv-movies-domain@fandom.com)'

/** Daily-snapshot signals: Google News, YouTube and TMDB.
 *
 * These three are grouped because they share the property that shaped the
 * design — unlike Wikipedia, which hands back two months of history on every
 * call, none of them will tell you what yesterday looked like. YouTube and TMDB
 * expose only lifetime counters, so a series exists *only* if we record one.
 * Google News can be asked about a past day, but only one day at a time.
 *
 * So the pipeline records a reading per source per day and reads its own
 * history back. That also means a freshly added title has no history at all,
 * which is what `minHistoryDays` is for.
 */
export const SIGNALS = {
  /** A source needs this many distinct days recorded before it may influence a
   * trend verdict. Below it there is no baseline to be unusual against — three
   * points can't tell a spike from a title we simply started watching. */
  minHistoryDays: 7,

  /** Days of per-source history to keep. Matches the calendar snapshots so the
   * whole of data/ prunes on one horizon. */
  keepDays: 60,

  /** Google News is the only one of the three that can be asked about a past
   * day, so a new title can be seeded rather than waiting a week. */
  newsBackfillDays: 10,

  /** Ceiling on Google News day-queries per run.
   *
   * Backfill is one request per title per day, so seeding a fresh store for the
   * whole calendar is thousands of requests — a first run took minutes and was
   * rude to an endpoint that asks nothing of us. The budget spreads that over
   * several runs instead, nearest-release-first, so the titles that matter get
   * a baseline soonest. Steady state is far below this: one new day per title.
   */
  newsQueriesPerRun: 600,

  /** Google News caps a query at 100 items, so a day at 100 is censored rather
   * than measured — recorded, but flagged so nothing reads it as exact. */
  newsDailyCap: 100,

  /** Requests in flight per source. These are third-party endpoints being
   * polled on a schedule; there is no reason to be impolite about it. */
  concurrency: 4,
} as const

/** Google News RSS needs no key. YouTube and TMDB do; both no-op when absent,
 * so the pipeline degrades to "no signal" instead of failing. */
export const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY ?? ''
export const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN ?? ''

/** neutron-api front door. Override with NEUTRON_API_BASE for stage/dev. */
export const API_BASE = process.env.NEUTRON_API_BASE ?? 'https://backend.metacritic.com'

/** The finder rejects limit > 50 with a 400. Verified against the live API. */
export const MAX_PAGE_SIZE = 50

/** Repo root. Resolved from this module, NOT process.cwd(), so `npm run radar`
 * writes to the same place no matter where it's invoked from. */
export const ROOT = path.join(import.meta.dirname, '..')

/** Fastly rejects non-browser user agents with a 403, so we must look like one. */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Metacritic media-catalog object type ids (mcoTypeId). */
export const MCO_TYPE = { show: 1, movie: 2 } as const

/** Images are served from Fastly at {host}/a/img/{bucketType}{bucketPath}. */
export const IMAGE_BASE = 'https://www.metacritic.com/a/img'
