/** Mirrors src/types.ts in the pipeline — the shape of out/radar.json.
 *
 * Kept as a hand-written copy rather than a cross-package import so the web app
 * builds standalone. If the pipeline's model changes, change it here too. */

export type MediaType = 'movie' | 'show'

export interface Title {
  id: number
  type: MediaType
  title: string
  slug: string
  url: string
  releaseDate: string | null
  daysOut: number | null
  genres: string[]
  network: string | null
  rating: string | null
  description: string | null
  image: string | null // full-resolution original — never render this directly
  poster: string | null // display-ready art: signed resize URL or /thumbs/<id>.jpg
  criticScore: number | null
  userScore: number | null
  trendingRank: number | null
  popularityRank: number | null
  fandomSignal: number | null
  signals: Record<string, number>
  score: number
  sources: string[]
}

export type ChangeKind = 'new' | 'date-changed' | 'removed'

export interface Change {
  kind: ChangeKind
  id: number
  type: MediaType
  title: string
  from?: string | null
  to?: string | null
}

export type AlertReason =
  | 'trending-and-imminent'
  | 'high-score'
  | 'newly-added'
  | 'date-changed'

export interface Alert {
  title: Title
  reasons: AlertReason[]
  change?: Change
}

export interface RadarOutput {
  generatedAt: string
  today: string
  horizonDays: number
  counts: { upcoming: number; inHorizon: number; trending: number; alerts: number }
  titles: Title[]
  trending: Title[]
  changes: Change[]
  alerts: Alert[]
}

/** A title has a real demand signal only if something other than its release
 * date backs it. Mirrors the pipeline's confidence cap — see README. */
export function hasDemandSignal(title: Title): boolean {
  return (
    title.popularityRank != null || title.trendingRank != null || title.fandomSignal != null
  )
}
