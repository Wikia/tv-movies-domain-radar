/** Merge sources, normalize signals to 0..1, weighted-score.
 *
 * neutron-api exposes no anticipation number of its own (popularityCount orders
 * finder results but is never returned; trending exposes rank only as array
 * order), so the ranking has to be computed here from what IS observable.
 */
import { SIGNAL_CONFIDENCE, WEIGHTS, type SignalName } from './config.js'
import type { Title } from './types.js'

/** Whole days from `today` to `date`. Negative once the date has passed. */
export function daysBetween(today: Date, date: string): number {
  const MS_PER_DAY = 86_400_000
  const target = Date.parse(`${date}T00:00:00Z`)
  const base = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - base) / MS_PER_DAY)
}

/** Attach trending rank to matching upcoming titles.
 *
 * Matched on catalog id, which is stable across both endpoints — no fuzzy title
 * matching needed, and therefore none of the false-positive risk the gaming
 * radar has to guard against. Trending titles with no upcoming counterpart stay
 * in their own list (they're released catalog titles gaining traction).
 */
export function applyTrending(upcoming: Title[], trending: Title[]): number {
  const rankById = new Map(trending.map((t) => [t.id, t.trendingRank]))
  let matched = 0

  for (const title of upcoming) {
    const rank = rankById.get(title.id)
    if (rank == null) continue
    title.trendingRank = rank
    if (!title.sources.includes('trending')) title.sources.push('trending')
    matched++
  }
  return matched
}

/** Attach the popularity rank (id -> rank) to matching titles.
 *
 * Coverage is partial — see fetchUpcomingPopularity. Titles absent from the map
 * simply have no popularity signal; they are NOT recorded as zero, so the
 * weight re-normalizes away instead of penalizing them for missing data. */
export function applyPopularity(titles: Title[], ranks: Map<number, number>): number {
  let matched = 0
  for (const title of titles) {
    const rank = ranks.get(title.id)
    if (rank == null) continue
    title.popularityRank = rank
    matched++
  }
  return matched
}

/** Fill in daysOut for every title. */
export function applyDates(titles: Title[], today: Date): void {
  for (const title of titles) {
    title.daysOut = title.releaseDate ? daysBetween(today, title.releaseDate) : null
  }
}

/** Imminence decays over a year: releasing now = 1.0, a year out = 0.0.
 *
 * Unlike the other signals this is never "missing" — an unknown date is the only
 * absent case — so it's always included rather than omitted, and a distant title
 * legitimately scores low on it instead of being let off the hook. */
function imminence(daysOut: number | null): number | null {
  if (daysOut == null) return null
  if (daysOut <= 0) return 1
  return Math.max(0, 1 - daysOut / 365)
}

function normalize(titles: Title[], trendingSize: number, popularitySize: number): void {
  for (const title of titles) {
    const signals: Record<string, number> = {}

    if (title.trendingRank != null && trendingSize > 0) {
      // rank 1 -> 1.0, decaying with position
      signals.trendingRank = 1 - (title.trendingRank - 1) / trendingSize
    }
    if (title.popularityRank != null && popularitySize > 0) {
      signals.popularityRank = 1 - (title.popularityRank - 1) / popularitySize
    }
    const soon = imminence(title.daysOut)
    if (soon != null) signals.imminence = soon

    if (title.criticScore != null) signals.criticScore = title.criticScore / 100
    if (title.fandomSignal != null) signals.fandomSignal = title.fandomSignal

    title.signals = signals
  }
}

/** Weighted score, re-normalized over the signals actually present.
 *
 * A title missing (say) a critic score isn't penalized to zero for it — the
 * remaining weights simply absorb the difference. This is what lets the reserved
 * `fandomSignal` sit unwired without distorting anything. */
export function score(titles: Title[], trendingSize: number, popularitySize = 0): Title[] {
  normalize(titles, trendingSize, popularitySize)

  for (const title of titles) {
    const present = Object.entries(WEIGHTS).filter(
      ([name]) => name in title.signals,
    ) as Array<[SignalName, number]>

    const weightSum = present.reduce((sum, [, weight]) => sum + weight, 0)
    if (weightSum === 0) {
      title.score = 0
      continue
    }
    const raw = present.reduce(
      (sum, [name, weight]) => sum + (title.signals[name] ?? 0) * (weight / weightSum),
      0,
    )

    // Confidence cap: a title can only score as high as its best signal is
    // trustworthy as DEMAND. A title backed only by imminence caps at 40, so it
    // sits in the schedule without masquerading as something people want.
    const cap = Math.max(...present.map(([name]) => SIGNAL_CONFIDENCE[name]))
    title.score = Math.round(raw * cap * 1000) / 10
  }

  return [...titles].sort((a, b) => b.score - a.score)
}

/** Chronological order, undated titles last — the schedule view. */
export function byReleaseDate(titles: Title[]): Title[] {
  return [...titles].sort((a, b) => {
    if (!a.releaseDate) return 1
    if (!b.releaseDate) return -1
    return a.releaseDate.localeCompare(b.releaseDate) || b.score - a.score
  })
}
