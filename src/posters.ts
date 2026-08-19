import { createHmac } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { IMAGE_BASE, ROOT, USER_AGENT } from './config.js'
import type { Title } from './types.js'

const run = promisify(execFile)

const CACHE_DIR = path.join(ROOT, 'data', 'posters')

const SECRET = process.env.FASTLY_IMAGE_SECRET ?? ''

const POSTER_WIDTH = 300
const POSTER_HEIGHT = 450

const MAX_DOWNLOADS_PER_RUN = 90
const CONCURRENCY = 6

function catalogPath(imageUrl: string): string | null {
  const marker = '/a/img'
  const at = imageUrl.indexOf(marker)
  return at === -1 ? null : imageUrl.slice(at + marker.length)
}

function signedPosterUrl(
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
  return `${IMAGE_BASE}/resize/${hash}${toHash}`
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

async function cacheOne(title: Title): Promise<boolean> {
  if (!title.image) return false
  const target = path.join(CACHE_DIR, `${title.id}.jpg`)
  if (await exists(target)) return true

  const temp = `${target}.tmp`
  try {
    const response = await fetch(title.image, { headers: { 'User-Agent': USER_AGENT } })
    if (!response.ok) return false
    await writeFile(temp, Buffer.from(await response.arrayBuffer()))

    await run('sips', ['-Z', String(POSTER_HEIGHT), temp, '--out', target])
    return true
  } catch {
    return false
  } finally {
    await rm(temp, { force: true })
  }
}

export async function cacheThumbnails(priority: Title[]): Promise<Set<number>> {
  const cached = new Set<number>()
  await mkdir(CACHE_DIR, { recursive: true })

  for (const file of await readdir(CACHE_DIR).catch(() => [])) {
    const id = Number(path.basename(file, '.jpg'))
    if (Number.isFinite(id)) cached.add(id)
  }

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

export function posterSrc(title: Title, cached: Set<number>): string | null {
  if (title.image) {
    const signed = signedPosterUrl(title.image)
    if (signed) return signed
  }
  return cached.has(title.id) ? `/thumbs/${title.id}.jpg` : null
}

export async function posterDataUri(id: number): Promise<string | null> {
  try {
    const bytes = await readFile(path.join(CACHE_DIR, `${id}.jpg`))
    return `data:image/jpeg;base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

export { CACHE_DIR as POSTER_CACHE_DIR }
