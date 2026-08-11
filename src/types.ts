/** Core data model for a tracked TV/film title. */

export type MediaType = 'movie' | 'show'

/** A title on the radar, after fetch + enrichment + scoring. */
export interface Title {
  // identity
  id: number
  type: MediaType
  title: string
  slug: string
  url: string

  // release info
  releaseDate: string | null // ISO YYYY-MM-DD as returned by the finder
  daysOut: number | null // days from the run date; negative = already out

  // classification / display
  genres: string[]
  network: string | null
  rating: string | null
  description: string | null
  image: string | null
  criticScore: number | null
  userScore: number | null

  // raw signals
  trendingRank: number | null // 1..N in the JustWatch-derived trending list
  popularityRank: number | null // 1..N among future titles by popularity
  fandomSignal: number | null // RESERVED: first-party signal, not wired yet

  // scoring
  signals: Record<string, number> // normalized 0..1 per signal
  score: number // 0..100
  sources: string[]
}

/** What changed versus the previous snapshot. */
export type ChangeKind = 'new' | 'date-changed' | 'removed'

export interface Change {
  kind: ChangeKind
  id: number
  type: MediaType
  title: string
  from?: string | null // previous release date (date-changed)
  to?: string | null // current release date (date-changed)
}

/** Why a title is being surfaced in Slack. */
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

/** The full artifact written to out/radar.json — everything the UI needs. */
export interface RadarOutput {
  generatedAt: string
  today: string
  horizonDays: number
  counts: {
    upcoming: number
    inHorizon: number
    trending: number
    alerts: number
  }
  titles: Title[]
  trending: Title[]
  changes: Change[]
  alerts: Alert[]
}
