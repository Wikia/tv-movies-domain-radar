/** Public attention, from Wikipedia pageviews.
 *
 * Two endpoints, both keyless and both verified live against the real API
 * before this file was written (per CLAUDE.md — never trust the docs alone):
 *
 *   action=api search   -> resolve "Cliffhanger" to the article "Cliffhanger
 *                          (2026 film)". Cached on disk; an article name almost
 *                          never changes, so this is a one-time cost per title.
 *   pageviews REST      -> daily view counts for that article, with ~2 months of
 *                          history available immediately.
 *
 * That history is what makes this source worth having: the baseline is
 * available on the FIRST run, so the signal works from day one rather than
 * after a month of collecting.
 *
 * Resolution is strict, for the same reason wiki matching is: a wrong article
 * attaches a real audience to the wrong film and nothing downstream would
 * catch it. We strip a trailing parenthetical disambiguator and then require an
 * exact match, which is what stops "It Ends" resolving to "It Ends with Us
 * (film)" — a different, older movie that merely shares a prefix.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUZZ, ROOT, WIKI_USER_AGENT } from '../config.js'
import type { Title } from '../types.js'

const CACHE_FILE = path.join(ROOT, 'data', 'wiki-articles.json')

/** What we remember per title: the resolved article, or a dated miss so we can
 * retry later without re-searching every title on every run. */
interface CacheEntry {
  article: string | null
  checked: string // ISO date of the last lookup
}
type Cache = Record<string, CacheEntry>

/** Outcome of one lookup. `failed` is a distinct state from `absent` because
 * only `absent` is safe to remember — caching a transient network failure as
 * "this title has no article" suppressed titles for a week. */
type Resolution =
  | { status: 'found'; article: string }
  | { status: 'absent' }
  | { status: 'failed' }

/** Cache key. Includes year and type because "Cliffhanger" the 1993 film and
 * "Cliffhanger" the 2026 film are different articles and different signals. */
function cacheKey(title: Title): string {
  return `${title.title}|${title.type}|${title.releaseDate?.slice(0, 4) ?? '?'}`
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** "Cliffhanger (2026 film)" -> "Cliffhanger". Only a TRAILING parenthetical is
 * stripped; anything else is part of the actual name. */
function stripDisambiguator(article: string): string {
  return article.replace(/\s*\([^)]*\)\s*$/, '')
}

/** GET with retry.
 *
 * A full run makes a few hundred requests and Wikimedia throttles anonymous
 * bursts, so a bare fetch fails intermittently. That mattered more than it
 * looks: a failed lookup used to be indistinguishable from "this title has no
 * article", got cached as a miss, and suppressed the title for a week. Two
 * identical runs resolved 108 and then 99 titles, which is how it was caught.
 */
async function getJson(url: string, attempts = 3): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** (attempt - 1)))
    }
    try {
      const response = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`wikipedia: ${String(lastError)} for ${url}`)
}

/** Run `work` over `items` with a small number in flight, so a 200-title run
 * stays inside Wikimedia's anonymous rate limits. */
export async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i]!)
    }
  })
  await Promise.all(workers)
  return results
}

/** Find the Wikipedia article for a title, or null if there isn't a confident one. */
async function search(title: Title): Promise<string | null> {
  const year = title.releaseDate?.slice(0, 4) ?? ''
  const hint = title.type === 'movie' ? 'film' : 'TV series'
  const query = encodeURIComponent(`${title.title} ${year} ${hint}`)
  const url =
    `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json` +
    `&srlimit=5&srsearch=${query}`

  // Deliberately NOT caught here: a request failure must stay distinguishable
  // from "searched, found nothing", because only the latter is safe to cache.
  const data = (await getJson(url)) as { query?: { search?: { title: string }[] } }
  const candidates = data.query?.search ?? []

  // Search five and accept only an exact post-strip match. Searching deeper
  // while matching stricter beats the reverse: it's what lets "It Ends" find
  // its own article further down the list instead of grabbing the wrong film
  // at position one.
  const wanted = norm(title.title)
  return candidates.find((c) => norm(stripDisambiguator(c.title)) === wanted)?.title ?? null
}

/** Categories that mark an article as being about a film or a TV show. */
const SCREEN_CATEGORY =
  /\b(films?|film series|television series|television films?|miniseries|telenovelas?|anime)\b/i

/** Titles per categories request. Twenty rather than the API's 50 maximum:
 * fewer continuation rounds and a shorter URL, which made this step markedly
 * less flaky over a full run. */
const CATEGORY_BATCH = 20

/** Confirm that bare (undisambiguated) articles really are about a film or show.
 *
 * A title like "The Whisper Man" matches an article of exactly that name — but
 * it's the NOVEL, which carries its own unrelated traffic, and scoring it would
 * attribute a book's audience to a film. Articles that came back WITH a
 * "(2026 film)"-style disambiguator have already told us what they are, so only
 * bare ones need this check.
 *
 * Verdicts are cached with the resolution, so this runs once per new title.
 */
async function keepScreenArticles(candidates: string[]): Promise<Map<string, boolean>> {
  // true = confirmed film/show, false = confirmed something else, ABSENT =
  // couldn't check. The three are distinct on purpose: an absent verdict must
  // not be cached, or a transient failure silently becomes "not a film".
  const verdict = new Map<string, boolean>()

  for (let i = 0; i < candidates.length; i += CATEGORY_BATCH) {
    const batch = candidates.slice(i, i + CATEGORY_BATCH)
    const base =
      `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=categories` +
      `&cllimit=500&titles=${encodeURIComponent(batch.join('|'))}`

    // `cllimit` is a budget for the WHOLE batch, not per article, so a 50-title
    // request comes back paginated with a `clcontinue` token. Ignoring it meant
    // most articles arrived with an empty category list and were rejected as
    // "not a film" — including "The Whisper Man", which is categorised
    // "2026 American films". Follow the continuation or the check is worse than
    // useless, because it silently discards good data.
    try {
      const seen = new Set<string>()
      let cont: string | undefined
      do {
        const url = cont ? `${base}&clcontinue=${encodeURIComponent(cont)}` : base
        const data = (await getJson(url)) as {
          query?: {
            pages?: Record<string, { title: string; categories?: { title: string }[] }>
          }
          continue?: { clcontinue?: string }
        }

        for (const page of Object.values(data.query?.pages ?? {})) {
          seen.add(page.title)
          if ((page.categories ?? []).some((c) => SCREEN_CATEGORY.test(c.title))) {
            verdict.set(page.title, true)
          }
        }
        cont = data.continue?.clcontinue
      } while (cont)

      // Everything the API returned for this batch that never showed a screen
      // category is a confirmed negative.
      for (const title of seen) if (!verdict.has(title)) verdict.set(title, false)
    } catch {
      // One bad batch leaves only its own titles unverified, rather than
      // discarding the verdicts for every other batch in the run.
    }
  }
  return verdict
}

/** Resolve every title to an article, using and updating the on-disk cache. */
export async function resolveArticles(
  titles: Title[],
  today: Date,
): Promise<Map<number, string>> {
  const raw = await readFile(CACHE_FILE, 'utf8').catch(() => '{}')
  let cache: Cache = {}
  try {
    cache = JSON.parse(raw) as Cache
  } catch {
    cache = {} // a corrupt cache is regenerable; never fail the run over it
  }

  const todayKey = today.toISOString().slice(0, 10)
  const staleBefore = new Date(today.getTime() - BUZZ.retryMissAfterDays * 86_400_000)
    .toISOString()
    .slice(0, 10)

  const needed = titles.filter((title) => {
    const hit = cache[cacheKey(title)]
    if (!hit) return true
    // Re-check misses periodically: an unreleased film often has no article yet
    // and gains one later. Hits are kept forever — article names don't move.
    return hit.article === null && hit.checked < staleBefore
  })

  if (needed.length > 0) {
    const results = await pooled(needed, BUZZ.concurrency, (title) =>
      search(title).then(
        (article): Resolution => (article ? { status: 'found', article } : { status: 'absent' }),
        (): Resolution => ({ status: 'failed' }),
      ),
    )

    // Verify the bare ones actually describe a film or show before trusting
    // them. If verification itself fails, treat those as unresolved-this-run
    // too — never as "not a film", which would cache a wrong negative.
    const bare = new Set<string>()
    for (const result of results) {
      if (result.status === 'found' && !result.article.includes('(')) bare.add(result.article)
    }
    const verified =
      bare.size > 0
        ? await keepScreenArticles([...bare]).catch(() => new Map<string, boolean>())
        : new Map<string, boolean>()

    needed.forEach((title, i) => {
      const result = results[i]
      // Only "found" and "absent" are cached. A failure is left unrecorded so
      // the next run retries it, rather than being frozen in as a miss for
      // `retryMissAfterDays`.
      if (!result || result.status === 'failed') return

      const remember = (article: string | null): void => {
        cache[cacheKey(title)] = { article, checked: todayKey }
      }
      if (result.status === 'absent') return remember(null)

      // Already disambiguated ("Cliffhanger (2026 film)") — it has told us what
      // it is, so no category check is needed.
      if (result.article.includes('(')) return remember(result.article)

      const isScreen = verified.get(result.article)
      if (isScreen === undefined) return // couldn't check — retry next run
      remember(isScreen ? result.article : null)
    })
    await mkdir(path.dirname(CACHE_FILE), { recursive: true })
    await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2))
  }

  const articles = new Map<number, string>()
  for (const title of titles) {
    const hit = cache[cacheKey(title)]
    if (hit?.article) articles.set(title.id, hit.article)
  }
  return articles
}

function stamp(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

/** Daily pageviews for an article, oldest first.
 *
 * Two subtleties, both found against the live API:
 *
 *  - Zero-view days are OMITTED rather than reported as 0, so gaps inside the
 *    range have to be filled with 0.
 *  - Publication lags several days (4, when this was written). So the series is
 *    trimmed to the last day that actually has data — filling those trailing
 *    days with 0 instead made every recent average collapse and scored the
 *    entire calendar at 0.
 *
 * The two look identical in the response and mean opposite things; the only way
 * to tell them apart is that the lag is always at the END.
 */
export async function pageviews(
  article: string,
  today: Date,
  days: number,
): Promise<number[]> {
  const end = new Date(today.getTime() - 86_400_000) // today is partial
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  // The article segment must be underscored AND encoded — a slash or question
  // mark in a title (there are plenty) otherwise breaks the path.
  const slug = encodeURIComponent(article.replace(/ /g, '_'))
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia` +
    `/all-access/user/${slug}/daily/${stamp(start)}/${stamp(end)}`

  const data = (await getJson(url).catch(() => null)) as
    | { items?: { timestamp: string; views: number }[] }
    | null
  if (!data?.items?.length) return []

  const byDay = new Map(data.items.map((i) => [i.timestamp.slice(0, 8), i.views]))
  const lastAvailable = data.items.at(-1)!.timestamp.slice(0, 8)

  const series: number[] = []
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86_400_000)) {
    const day = stamp(d)
    if (day > lastAvailable) break // not published yet — absent, not zero
    series.push(byDay.get(day) ?? 0)
  }
  return series
}

/** Fetch view series for every resolved title, concurrency-limited. */
export async function fetchSeries(
  articles: Map<number, string>,
  today: Date,
  days: number,
): Promise<Map<number, number[]>> {
  const entries = [...articles]
  const series = await pooled(entries, BUZZ.concurrency, ([, article]) =>
    pageviews(article, today, days).catch(() => []),
  )
  const byTitle = new Map<number, number[]>()
  entries.forEach(([id], i) => {
    const values = series[i]
    if (values?.length) byTitle.set(id, values)
  })
  return byTitle
}
