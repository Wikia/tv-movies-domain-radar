/** Core data model for a tracked TV/film title.
 *
 * The radar deliberately carries NO demand or popularity scoring. Those signals
 * were tried and removed: the popularity query covered 32 of 233 titles and no
 * TV at all, and the *upstream* trending feed never once intersected the
 * release calendar. What's left is what actually works — the calendar itself,
 * what changed on it since the last run, and (since the first-party export was
 * wired) whether our own wiki audience is showing up for a title.
 *
 * `TitleTrend` is the exception the README sanctions, and it is deliberately
 * NOT a score: it hangs off a title as labelled evidence with its own match
 * confidence, and the schedule stays in date order. Nothing here ranks titles.
 */

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

  // first-party signal, attached only when a trending wiki could be tied to
  // this title. Absent means "no signal", which is NOT the same as "cold".
  trend?: TitleTrend

  // public-attention signal from Wikipedia pageviews. Same rule: absent means
  // we couldn't measure it (no article, or too little traffic to be meaningful),
  // never that the title is cold.
  buzz?: Buzz
}

/** Wikipedia-pageview reading for a title.
 *
 * `points` is the headline 0..100 number, but it is derived from `relative`,
 * and `relative` is the one to reason about: it's how far this title's growth
 * departs from what titles at the same distance from release are doing. 1.0 is
 * "exactly normal for its age".
 */
export interface Buzz {
  /** 0..100 by the SIZE of the surge, anchored so 100 = The Odyssey's
   * 1.2M views/day peak. An ordinary trailer drop lands in the 40s-60s. */
  points: number
  /** Which colour band `points` falls in — a green -> yellow -> orange -> red
   * heat ramp. Always rendered alongside the number, so colour is never the
   * only channel. */
  band: 'exceptional' | 'strong' | 'notable' | 'quiet'
  /** Daily views beyond what a title of this age would be getting anyway.
   * This is what `points` is computed from. */
  excess: number
  recent: number // mean daily views over the recent window
  baseline: number // median daily views over the baseline window
  ratio: number // recent / baseline, before cohort adjustment
  relative: number // ratio / the cohort's median ratio — the detrended figure
  /** recent vs the week immediately before it. >1 climbing, <1 falling. This
   * is what separates a live event from the tail of a finished one. */
  momentum: number
  cohort: string // which days-out bucket it was compared against
  /** `rising` = elevated and still climbing (the actionable one).
   *  `fading`  = elevated, but the event has passed and views are falling.
   *  `flat`    = not elevated. */
  phase: 'rising' | 'fading' | 'flat'
  spiking: boolean // phase === 'rising'
}

/** A trending Fandom wiki, one row of the internal weekly export. */
export interface TrendingWiki {
  domain: string // e.g. shameless.fandom.com
  name: string // human display name
  week: string // trending_week, ISO date — the export is WEEKLY, not daily
  trendingScore: number // 0..1 level: how hot the wiki is this week
  /** Last week's score, or null when the wiki wasn't in last week's export.
   * Kept so the UI can say "was 16%, now 85%" instead of printing a velocity
   * delta that means nothing to a reader. */
  priorScore: number | null
  velocity: number // week-over-week rise, >= 0; 0 when prior week is untrustworthy
  isNew: boolean // first week this wiki has trended in the 8-week window
  fpScore: number // 0..1 composite of the three above
  pageviews14d: number // audience size — used to pick the canonical hub on ties
  tier: string // traffic_tier (H1 biggest .. H3 smallest)
  vertical: string // raw vertical_labels value, kept for auditing the filter
  genres: string[]
  // raw taxonomy labels, kept verbatim because matching reads them and because
  // a bad tie is only debuggable if you can see what it matched on.
  franchise: string
  installment: string
}

/** How confidently a tracked title was tied to a trending wiki.
 *
 * The distinction matters editorially and must survive to the UI: most films
 * have no wiki of their own, only a franchise hub, so a `franchise` match says
 * "the franchise is hot", NOT "this title is hot". Presenting the two the same
 * way would overclaim. */
export type WikiMatch = 'exact' | 'franchise'

/** The trending wiki tied to a title, plus how we got there. */
export interface TitleTrend {
  domain: string
  name: string
  match: WikiMatch
  matchedOn: 'domain' | 'franchise' | 'installment' // which key produced the tie
  fpScore: number
  trendingScore: number
  velocity: number
  isNew: boolean
  pageviews14d: number
}

/** The trending view: what we matched, and — just as important — what we
 * couldn't. `unmapped` is the "are we missing something?" list: wikis our
 * audience is hot on right now that have no upcoming release behind them. */
export interface TrendingReport {
  week: string | null
  wikis: number // tv/movie wikis found in the export
  matched: number // tracked titles tied to one
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

/** Why a title is being surfaced.
 *
 * The first two come from our own snapshot diff; the third from the first-party
 * trending export. All three are *changes* — a wiki that is merely trending at
 * a steady level is a standing fact, not news, and doesn't alert. */
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
  /** Coverage of the Wikipedia signal. Published so the dashboard can say "we
   * measured 140 of 211" rather than implying the other 71 are cold. */
  buzz: {
    resolved: number // titles matched to a Wikipedia article
    scored: number // of those, with enough traffic and history to score
    spiking: number
  } | null
  titles: Title[]
  changes: Change[]
  alerts: Alert[]
  /** null when the first-party export wasn't present for this run. Null means
   * "we had no first-party signal", never "nothing is trending". */
  trending: TrendingReport | null
}
