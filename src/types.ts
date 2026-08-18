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
  criticScore: number | null
  userScore: number | null

  image: string | null
  poster: string | null

  trend?: TitleTrend

  buzz?: Buzz

  attention?: Attention
}

export interface SourceSignal {
  source: SignalSource

  metric: string
  recent: number
  baseline: number

  relative: number

  momentum: number
  phase: 'rising' | 'fading' | 'flat'

  days: number
}

export type SignalSource = 'wikipedia' | 'news' | 'youtube' | 'tmdb'

export interface Attention {
  sources: SourceSignal[]

  rising: SignalSource[]

  confirmed: boolean
}

export interface Buzz {
  points: number

  band: 'exceptional' | 'strong' | 'notable' | 'quiet'

  excess: number
  recent: number
  baseline: number
  ratio: number
  relative: number

  momentum: number
  cohort: string

  phase: 'rising' | 'fading' | 'flat'
  spiking: boolean
}

export interface TrendingWiki {
  domain: string
  name: string
  week: string
  trendingScore: number

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

export interface TrendingReport {
  week: string | null
  wikis: number
  matched: number
  unmapped: TrendingWiki[]
  unmappedTotal: number
}

type ChangeKind = 'new' | 'date-changed' | 'removed'

export interface Change {
  kind: ChangeKind
  id: number
  type: MediaType
  title: string
  from?: string | null
  to?: string | null
}

export type AlertReason = 'newly-added' | 'date-changed' | 'wiki-trending'

export interface Alert {
  title: Title
  reasons: AlertReason[]
  change?: Change
}

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

  buzz: {
    resolved: number
    scored: number
    spiking: number
  } | null
  titles: Title[]
  changes: Change[]
  alerts: Alert[]

  trending: TrendingReport | null
}
