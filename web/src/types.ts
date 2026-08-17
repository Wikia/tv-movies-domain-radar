/** Mirrors src/types.ts in the pipeline — the shape of out/radar.json.
 *
 * Hand-written copy rather than a cross-package import so the web app builds
 * standalone. If the pipeline's model changes, change it here too.
 *
 * The radar carries no demand ranking of the calendar: the schedule is
 * chronological, and the two attention signals (`trend`, `buzz`) hang off
 * titles as labelled evidence. An ABSENT signal means "not measured", never
 * "cold" — the UI has to keep those apart. */

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

  // signals; absent = not measured
  trend?: TitleTrend
  buzz?: Buzz
}

/** Wikipedia-pageview reading. `relative` is the one to reason about: growth
 * measured against titles the same distance from release, so the release ramp
 * every title shares is already divided out. 1.0 is normal for its age. */
export interface Buzz {
  /** 0..100 by the SIZE of the surge, anchored so 100 = The Odyssey's 1.2M
   * views/day peak. An ordinary trailer drop lands in the 40s-60s. */
  points: number
  /** Colour band for `points` — a green -> yellow -> orange -> red ramp. Always
   * rendered with the number beside it, never colour alone. */
  band: 'exceptional' | 'strong' | 'notable' | 'quiet'
  /** Daily views beyond what a title of this age would get anyway. */
  excess: number
  recent: number
  baseline: number
  ratio: number
  relative: number
  /** recent vs the week before it. >1 climbing, <1 falling — what separates a
   * live event from the tail of a finished one. */
  momentum: number
  cohort: string
  phase: 'rising' | 'fading' | 'flat'
  spiking: boolean // phase === 'rising'
}

/** How confidently a title was tied to a trending wiki. `franchise` means the
 * franchise hub is hot, NOT this title — a different claim, and the UI must
 * not collapse the two. */
export type WikiMatch = 'exact' | 'franchise'

export interface TitleTrend {
  domain: string
  name: string
  match: WikiMatch
  matchedOn: 'domain' | 'franchise' | 'installment'
  fpScore: number
  trendingScore: number
  velocity: number
  isNew: boolean
  pageviews14d: number
}

export interface TrendingWiki {
  domain: string
  name: string
  week: string
  trendingScore: number
  /** Last week's score, or null if absent from last week's export — lets the UI
   * say "16% → 85%" instead of an unlabelled velocity delta. */
  priorScore: number | null
  velocity: number
  isNew: boolean
  fpScore: number
  pageviews14d: number
  tier: string
  vertical: string
  genres: string[]
  franchise: string
  installment: string
}

/** `unmapped` is the "are we missing something?" list — wikis our audience is
 * hot on with no upcoming release behind them. */
export interface TrendingReport {
  week: string | null
  wikis: number
  matched: number
  unmapped: TrendingWiki[]
  unmappedTotal: number
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

/** Why a title is being surfaced. The first two come from our own snapshot
 * diff; the third from the first-party wiki export. All three are changes — a
 * wiki merely trending at a steady level is a standing fact, not news. */
export type AlertReason = 'newly-added' | 'date-changed' | 'wiki-trending'

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
    trendingMatched: number
    buzzScored: number
  }
  /** Coverage of the Wikipedia signal, so the UI can say "138 of 211 measured"
   * rather than implying the other 73 are cold. Null = no data this run. */
  buzz: {
    resolved: number
    scored: number
    spiking: number
  } | null
  titles: Title[]
  changes: Change[]
  alerts: Alert[]
  /** Null when the first-party export wasn't present — "no signal", not
   * "nothing is trending". */
  trending: TrendingReport | null
}
