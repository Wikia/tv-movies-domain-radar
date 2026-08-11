import path from 'node:path'

/** Tunable knobs: signal weights, alert thresholds, horizon.
 *
 * The radar exists so the team never misses a release worth supporting. Two
 * jobs fall out of that: a forward-looking SCHEDULE, and a daily read on what is
 * GAINING TRACTION. Both are scored here.
 */

/** Signal weights.
 *
 * `fandomSignal` is declared but NOT yet produced — the first-party trending
 * export for the TV/film vertical hasn't been confirmed to exist. Weights are
 * re-normalized over whichever signals are actually present (see scoring.ts),
 * so leaving it unwired costs nothing and wiring it later needs no other change.
 *
 * It carries the heaviest weight on purpose, mirroring the gaming radar: external
 * signals say a title is big; our own audience data says whether Fandom readers
 * actually show up for it.
 */
export const WEIGHTS = {
  fandomSignal: 0.4, // first-party (RESERVED — see above)
  popularityRank: 0.25, // Metacritic popularity ordering among future titles
  trendingRank: 0.2, // JustWatch-derived trending, via neutron-api
  imminence: 0.1, // how soon it lands
  criticScore: 0.05, // rarely present pre-release; corroborating only
} as const

export type SignalName = keyof typeof WEIGHTS

/** Per-signal confidence — how much each one proves genuine AUDIENCE DEMAND.
 *
 * A title's final score is capped by the confidence of the best signal backing
 * it. This matters because demand data is sparse: only ~32 of ~220 upcoming
 * titles carry a popularity rank, and no upcoming SHOW does (the popularity sort
 * forces a reviewCount filter upstream that nothing unreleased clears).
 *
 * Without the cap, a title with no demand signal at all scores ~99 purely
 * because it releases tomorrow — imminence is not demand, it's a calendar fact.
 * The cap keeps uncorroborated titles in the schedule where they belong while
 * letting genuinely-wanted ones rise. Same mechanism as the gaming radar.
 */
export const SIGNAL_CONFIDENCE: Record<SignalName, number> = {
  fandomSignal: 1, // our own audience showing up — the strongest proof
  popularityRank: 1, // real demand ordering
  trendingRank: 1, // real current engagement
  imminence: 0.4, // NOT demand — a date, nothing more
  criticScore: 0.5, // quality, not demand; corroborating at best
}

/** Default forward window, in days. Titles beyond this are still collected —
 * they just don't count as "in horizon" for the dashboard's headline counts. */
export const HORIZON_DAYS = 90

/** Alert rules. A title pings Slack if ANY rule fires. */
export const ALERTS = {
  /** Rule 1: in the trending list AND landing within this many days. */
  trendingImminentDays: 30,
  /** Rule 2: computed demand score at or above this (0..100). */
  scoreThreshold: 70,
  /** Rule 3 has no threshold — any newly-added title or moved date qualifies,
   * but only within this window, so a 2029 date shuffle doesn't page anyone. */
  changeWindowDays: 180,
} as const

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
