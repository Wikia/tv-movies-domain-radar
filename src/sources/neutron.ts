import { API_BASE, IMAGE_BASE, MAX_PAGE_SIZE, MCO_TYPE, USER_AGENT } from '../config.js'
import { sleep } from '../pool.js'
import type { MediaType, Title } from '../types.js'

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

      if (attempt < MAX_RETRIES) await sleep(attempt * 500)
    }
  }
  throw lastError
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
    daysOut: null,
    genres: (item.genres ?? []).map((g) => g?.name).filter((n): n is string => !!n),
    network: networkName(item.network),
    rating: item.rating ?? null,
    description: item.description ?? null,
    image: imageUrl(item.image),
    poster: null,
    criticScore: item.criticScoreSummary?.score ?? null,
    userScore: userScoreValue(item.userScore),
  }
}

// `sortBy` and releaseYear* are silently overwritten server-side when
// releaseType=coming-soon; sort and narrow client-side instead. Paging repeats
// titles, hence the dedupe.
export async function fetchUpcoming(type: MediaType, pageSize = MAX_PAGE_SIZE): Promise<Title[]> {
  const items: Title[] = []

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

    if (page.length === 0) break
    for (const item of page) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      items.push(toTitle(item, type))
    }
    offset += page.length
  }

  return items
}
