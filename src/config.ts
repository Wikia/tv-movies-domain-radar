import path from 'node:path'

export const HORIZON_DAYS = 90

export const ALERTS = {
  changeWindowDays: 180,
} as const

export const TRENDING = {
  verticals: ['tv', 'movies'],
  minKey: 4,
  // 6, not 4: franchise "Coco" prefixed "Cocomelon: The Movie" in the live export.
  minPrefixKey: 6,
  velocityAlert: 0.15,
  topUnmapped: 15,
} as const

// 100 points = The Odyssey's 1,199,464 views/day peak (2026-07-18).
export const BUZZ = {
  recentDays: 3,
  baselineDays: 28,
  minBaselineViews: 50,
  spikeRatio: 2,
  anchorExcess: 1_200_000,
  floorExcess: 100,
  bands: { exceptional: 85, strong: 60, notable: 40 },
  momentumDays: 7,
  fadingBelow: 0.9,
  cohortBuckets: [7, 30, 90, 365],
  // Pageviews lag ~4 days and the API omits missing days; anchoring the window
  // on "yesterday" zero-filled it and scored the whole calendar 0.
  lagDays: 7,
  concurrency: 4,
  retryMissAfterDays: 7,
} as const

export const WIKI_USER_AGENT =
  'tv-movies-domain-radar/0.1 (https://github.com/fandom; tv-movies-domain@fandom.com)'

export const SIGNALS = {
  minHistoryDays: 7,
  keepDays: 60,
  newsBackfillDays: 10,
  newsQueriesPerRun: 600,
  newsDailyCap: 100,
  concurrency: 4,
  confirmAtSources: 2,
} as const

export const YOUTUBE_KEY = process.env.YOUTUBE_API_KEY ?? ''
export const TMDB_TOKEN = process.env.TMDB_ACCESS_TOKEN ?? ''

export const API_BASE = process.env.NEUTRON_API_BASE ?? 'https://backend.metacritic.com'

// The finder rejects limit > 50 with a 400. Verified against the live API.
export const MAX_PAGE_SIZE = 50

export const ROOT = path.join(import.meta.dirname, '..')

// Fastly 403s non-browser user agents.
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

export const MCO_TYPE = { show: 1, movie: 2 } as const

export const IMAGE_BASE = 'https://www.metacritic.com/a/img'
