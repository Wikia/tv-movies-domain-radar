/** Mirrors src/types.ts in the pipeline — the shape of out/radar.json.
 *
 * Hand-written copy rather than a cross-package import so the web app builds
 * standalone. If the pipeline's model changes, change it here too.
 *
 * The radar deliberately carries NO demand or popularity scoring; the calendar
 * and its day-over-day diff are the whole product. */

export type MediaType = 'movie' | 'show'

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

  // descriptive metadata, straight from the catalog payload
  genres: string[]
  network: string | null
  rating: string | null
  description: string | null
  criticScore: number | null // Metascore; usually absent before release
  userScore: number | null

  // art
  image: string | null // full-resolution catalog original (multi-MB — never render)
  poster: string | null // display-ready art: signed resize URL or /thumbs/<id>.jpg
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

/** Why a title is being surfaced. Both reasons come from our own snapshot diff —
 * no upstream API exposes them. */
export type AlertReason = 'newly-added' | 'date-changed'

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
    alerts: number
  }
  titles: Title[]
  changes: Change[]
  alerts: Alert[]
}
