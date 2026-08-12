/** neutron-api client — the only network dependency in the pipeline.
 *
 * neutron-api is the backend-for-frontend behind metacritic.com and tvguide.com.
 * Its content endpoints are PUBLIC (no key, no auth header), reachable through
 * Fastly at https://backend.metacritic.com. One endpoint matters here:
 *
 *   /finder/metacritic/web?releaseType=coming-soon   -> the forward schedule
 *
 * A trending endpoint and a popularity-sorted variant were both used earlier and
 * removed: popularity covered 32 of 233 titles and no TV, and trending never
 * intersected the release calendar at all.
 *
 * Verified quirks (all confirmed against the live API, not just the source):
 *   - `sortBy` is SILENTLY IGNORED when releaseType=coming-soon. The server
 *     overwrites it with sortBy=releaseDate and forces the window to
 *     now .. +3 years. Don't bother passing a sort; sort locally instead.
 *   - `releaseYearMin`/`releaseYearMax` are likewise overwritten by coming-soon,
 *     so date-range narrowing must happen client-side.
 *   - No anticipation NUMBER is exposed anywhere: popularityCount orders results
 *     but is never returned. There is no usable demand measure in this API.
 *   - Fastly 403s non-browser user agents (see USER_AGENT).
 *   - `limit` above 50 is a 400. Hence MAX_PAGE_SIZE.
 */
import { API_BASE, IMAGE_BASE, MAX_PAGE_SIZE, MCO_TYPE, USER_AGENT } from '../config.js'
import type { MediaType, Title } from '../types.js'

/** Shape of the bits of a finder/trending item we actually consume. */
interface ApiItem {
  id: number
  title: string
  slug: string
  releaseDate?: string | null
  premiereYear?: number | null
  rating?: string | null
  description?: string | null
  duration?: string | null
  network?: string | { name?: string } | null
  genres?: Array<{ name?: string | null }> | null
  criticScoreSummary?: { score?: number | null } | null
  userScore?: { score?: number | null } | number | null
  image?: { bucketType?: string | null; bucketPath?: string | null } | null
}

interface ListResponse {
  data?: { items?: ApiItem[]; totalResults?: number }
}

const MAX_RETRIES = 3

async function getJson<T>(url: string): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
      return (await res.json()) as T
    } catch (error) {
      lastError = error
      // Fastly occasionally blips; back off briefly rather than fail the run.
      if (attempt < MAX_RETRIES) await sleep(attempt * 500)
    }
  }
  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function imageUrl(image: ApiItem['image']): string | null {
  if (!image?.bucketPath) return null
  const bucket = image.bucketType ?? 'catalog'
  return `${IMAGE_BASE}/${bucket}${image.bucketPath}`
}

function networkName(network: ApiItem['network']): string | null {
  if (!network) return null
  return typeof network === 'string' ? network : (network.name ?? null)
}

function userScoreValue(score: ApiItem['userScore']): number | null {
  if (score == null) return null
  if (typeof score === 'number') return score
  return score.score ?? null
}

/** Public site path — what a human should click through to. */
function siteUrl(type: MediaType, slug: string): string {
  return `https://www.metacritic.com/${type === 'movie' ? 'movie' : 'tv'}/${slug}/`
}

function toTitle(item: ApiItem, type: MediaType): Title {
  return {
    id: item.id,
    type,
    title: item.title,
    slug: item.slug,
    url: siteUrl(type, item.slug),
    releaseDate: item.releaseDate ?? null,
    daysOut: null, // filled in by schedule.ts, which knows the run date
    genres: (item.genres ?? []).map((g) => g?.name).filter((n): n is string => !!n),
    network: networkName(item.network),
    rating: item.rating ?? null,
    description: item.description ?? null,
    image: imageUrl(item.image),
    poster: null, // resolved later by posters.ts, which knows what's cached
    criticScore: item.criticScoreSummary?.score ?? null,
    userScore: userScoreValue(item.userScore),
  }
}

/** Every upcoming title of one media type, paged out in full.
 *
 * The coming-soon set is small (a few hundred), so we deliberately fetch ALL of
 * it rather than a top-N. Completeness is the point — the radar's promise is
 * "don't miss anything", and a truncated list can't make that promise. */
export async function fetchUpcoming(type: MediaType, pageSize = MAX_PAGE_SIZE): Promise<Title[]> {
  const items: Title[] = []
  // The upstream list shifts between pages, so the same id can surface in two
  // consecutive windows. Dedupe by id or the output carries phantom duplicates.
  const seen = new Set<number>()
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const url =
      `${API_BASE}/finder/metacritic/web` +
      `?releaseType=coming-soon&mcoTypeId=${MCO_TYPE[type]}` +
      `&limit=${pageSize}&offset=${offset}`
    const body = await getJson<ListResponse>(url)
    const page = body.data?.items ?? []
    total = body.data?.totalResults ?? page.length

    if (page.length === 0) break // defensive: never spin on an empty page
    for (const item of page) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(toTitle(item, type))
    }
    offset += page.length
  }

  return items
}
