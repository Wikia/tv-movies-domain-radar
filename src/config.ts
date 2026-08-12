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
