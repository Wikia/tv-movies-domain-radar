/** Poster art — the most useful material in a film/TV tool, and the one thing
 * the catalog gives us for free. Getting it usable takes some care.
 *
 * The raw catalog images are FULL RESOLUTION: 2.3 MB on average, one sampled at
 * 13 MB. Rendering a grid of those is unusable locally and impossible in a
 * published Artifact (16 MB cap, and its CSP blocks remote hosts outright).
 *
 * Two ways to get small images, in order of preference:
 *
 * 1. SIGNED RESIZE URLs — what metacritic.com itself serves. Fastly exposes
 *    /a/img/resize/{hmac}{path}?{params}, where hmac is HMAC-SHA1 of
 *    `${path}?${sortedParams}` keyed by the Fastly image secret. With the
 *    secret set we generate these directly and get ~15 KB webp. Uses
 *    node:crypto, so the zero-dependency rule still holds.
 *
 * 2. LOCAL THUMBNAIL CACHE — no secret required. Download once, downscale with
 *    `sips` (present on macOS), keep in data/posters/. Bounded per run so a
 *    first run doesn't pull hundreds of megabytes in one go.
 *
 * Neither available -> no poster, and the UI falls back to an initials tile.
 * Art is an enhancement; nothing depends on it.
 */
import { createHmac } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { ROOT, USER_AGENT } from './config.js'
import type { Title } from './types.js'

const run = promisify(execFile)

const IMAGE_HOST = 'https://www.metacritic.com/a/img'
const CACHE_DIR = path.join(ROOT, 'data', 'posters')

/** Set FASTLY_IMAGE_SECRET to switch on signed resize URLs (preferred). */
const SECRET = process.env.FASTLY_IMAGE_SECRET ?? ''

/** Posters render at 2:3; 300px wide covers a retina thumbnail. */
export const POSTER_WIDTH = 300
export const POSTER_HEIGHT = 450

/** Bound the first run. Later runs top up the cache from where this left off. */
const MAX_DOWNLOADS_PER_RUN = 90
const CONCURRENCY = 6

/** Turn a stored image URL back into the catalog path the signature covers. */
function catalogPath(imageUrl: string): string | null {
  const marker = '/a/img'
  const at = imageUrl.indexOf(marker)
  return at === -1 ? null : imageUrl.slice(at + marker.length)
}

/** A signed Fastly resize URL, or null when no secret is configured.
 *
 * Mirrors FastlyImage.ts in neutron-apps exactly: params sorted alphabetically,
 * `auto=webp` always present, hash over `${path}?${query}`. */
export function signedPosterUrl(
  imageUrl: string,
  width = POSTER_WIDTH,
  height = POSTER_HEIGHT,
): string | null {
  if (!SECRET) return null
  const src = catalogPath(imageUrl)
  if (!src) return null

  const params: Record<string, string> = {
    auto: 'webp',
    fit: 'cover',
    height: String(height),
    quality: '70',
    width: String(width),
  }
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .sort((a, b) => a.localeCompare(b))
    .join('&')

  const toHash = `${src}?${query}`
  const hash = createHmac('sha1', SECRET).update(toHash).digest('hex')
  return `${IMAGE_HOST}/resize/${hash}${toHash}`
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

let sipsChecked: boolean | null = null
async function hasSips(): Promise<boolean> {
  if (sipsChecked !== null) return sipsChecked
  try {
    await run('sips', ['--version'])
    sipsChecked = true
  } catch {
    sipsChecked = false
  }
  return sipsChecked
}

/** Download one poster and downscale it in place. Best-effort throughout: any
 * failure just means this title has no art. */
async function cacheOne(title: Title): Promise<boolean> {
  if (!title.image) return false
  const target = path.join(CACHE_DIR, `${title.id}.jpg`)
  if (await exists(target)) return true

  const temp = `${target}.tmp`
  try {
    const response = await fetch(title.image, { headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok) return false
    await writeFile(temp, Buffer.from(await response.arrayBuffer()))
    // -Z scales the LONGEST side, preserving aspect ratio.
    await run('sips', ['-Z', String(POSTER_HEIGHT), temp, '--out', target])
    return true
  } catch {
    return false
  } finally {
    await rm(temp, { force: true })
  }
}

/** Fill the local thumbnail cache for the titles most likely to be displayed.
 *
 * `priority` should already be ordered by importance (alerts, then trending,
 * then soonest) so a capped run caches what matters first. Returns the set of
 * title ids that now have a cached thumbnail — including ones cached earlier. */
export async function cacheThumbnails(priority: Title[]): Promise<Set<number>> {
  const cached = new Set<number>()
  await mkdir(CACHE_DIR, { recursive: true })

  for (const file of await readdir(CACHE_DIR).catch(() => [])) {
    const id = Number(path.basename(file, '.jpg'))
    if (Number.isFinite(id)) cached.add(id)
  }

  // With signed URLs there is nothing to cache; with no sips there is no way to.
  if (SECRET || !(await hasSips())) return cached

  const todo = priority
    .filter((title) => title.image && !cached.has(title.id))
    .slice(0, MAX_DOWNLOADS_PER_RUN)
  if (todo.length === 0) return cached

  let cursor = 0
  const workers = Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    while (cursor < todo.length) {
      const title = todo[cursor++]
      if (!title) break
      if (await cacheOne(title)) cached.add(title.id)
    }
  })
  await Promise.all(workers)

  return cached
}

/** Where the browser should load a title's poster from.
 *
 * Signed remote URL when configured, otherwise the local cache served by our
 * own server at /thumbs/. Null means "no art" and the UI shows initials. */
export function posterSrc(title: Title, cached: Set<number>): string | null {
  if (title.image) {
    const signed = signedPosterUrl(title.image)
    if (signed) return signed
  }
  return cached.has(title.id) ? `/thumbs/${title.id}.jpg` : null
}

/** A cached thumbnail as a data URI, for the self-contained artifact page,
 * whose CSP forbids loading anything from another host. */
export async function posterDataUri(id: number): Promise<string | null> {
  try {
    const bytes = await readFile(path.join(CACHE_DIR, `${id}.jpg`))
    return `data:image/jpeg;base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export { CACHE_DIR as POSTER_CACHE_DIR }
