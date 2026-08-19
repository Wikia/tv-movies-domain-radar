// Inspect and correct which YouTube video a title's signal is measured from.
//
// Search picks the trailer automatically and mostly gets it right, but "mostly"
// is not good enough to present as evidence: an aggregator re-upload or the
// wrong film's teaser produces a real-looking view curve for the wrong thing.
// A pinned entry is never re-resolved by a later run.
//
//   npm run trailer                          list resolved titles
//   npm run trailer -- --missing             list titles with no video
//   npm run trailer -- set "Wicked" <url|id>
//   npm run trailer -- clear "Wicked"
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, YOUTUBE_KEY } from '../src/config.js'
import { cacheKey, TRAILER_CACHE, type Cache } from '../src/sources/youtube.js'
import type { RadarOutput, Title } from '../src/types.js'

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

async function loadTitles(): Promise<Title[]> {
  const file = path.join(ROOT, 'out', 'radar.json')
  const raw = await readFile(file, 'utf8').catch(() => null)
  if (raw === null) throw new Error('no out/radar.json — run `npm run scan` first')
  return (JSON.parse(raw) as RadarOutput).titles
}

async function loadCache(): Promise<Cache> {
  const raw = await readFile(TRAILER_CACHE, 'utf8').catch(() => '{}')
  return JSON.parse(raw) as Cache
}

async function saveCache(cache: Cache): Promise<void> {
  await writeFile(TRAILER_CACHE, JSON.stringify(cache, null, 2))
}

// Accepts a bare id or any of the URL shapes people actually paste.
function videoIdFrom(input: string): string | null {
  const trimmed = input.trim()
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed
  const match =
    /(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/.exec(trimmed) ??
    /^https?:\/\/[^\s]*[/=]([\w-]{11})(?:[?&#]|$)/.exec(trimmed)
  return match?.[1] ?? null
}

// One title, or an unambiguous prefix of one. Refuses rather than guessing:
// pinning the wrong title is the mistake this tool exists to fix.
function findTitle(titles: Title[], query: string): Title {
  const wanted = query.toLowerCase()
  const exact = titles.filter((t) => t.title.toLowerCase() === wanted)
  const matches = exact.length > 0 ? exact : titles.filter((t) => t.title.toLowerCase().includes(wanted))
  if (matches.length === 0) throw new Error(`no title matching "${query}"`)
  if (matches.length > 1) {
    throw new Error(
      `"${query}" matches ${matches.length} titles:\n` +
        matches.slice(0, 10).map((t) => `  ${t.title} (${t.releaseDate ?? '?'})`).join('\n'),
    )
  }
  return matches[0]!
}

async function describe(videoId: string): Promise<string> {
  if (!YOUTUBE_KEY) return ''
  const params = new URLSearchParams({ part: 'snippet', id: videoId, key: YOUTUBE_KEY })
  const data = (await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
    .then((r) => r.json())
    .catch(() => null)) as { items?: { snippet: { title: string; channelTitle: string } }[] } | null
  const item = data?.items?.[0]
  return item ? `${item.snippet.title} — ${item.snippet.channelTitle}` : ''
}

async function list(titles: Title[], cache: Cache, onlyMissing: boolean): Promise<void> {
  let shown = 0
  for (const title of titles) {
    const hit = cache[cacheKey(title)]
    const missing = !hit?.videoId
    if (onlyMissing !== missing) continue
    shown++
    const pin = hit?.pinned ? ' [pinned]' : ''
    if (missing) {
      out(`  ${title.title}${pin}`)
    } else {
      out(`  ${title.title}${pin}`)
      out(`      https://youtu.be/${hit.videoId}  ${hit.channel ?? '?'} — ${hit.videoTitle ?? ''}`)
    }
  }
  out(`\n${shown} ${onlyMissing ? 'without a video' : 'with a video'} of ${titles.length} titles`)
  if (!onlyMissing) out('Wrong video? npm run trailer -- set "<title>" <url>')
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2)

  if (command === 'set' || command === 'clear') {
    const [query, value] = rest
    if (!query) throw new Error(`usage: npm run trailer -- ${command} "<title>"${command === 'set' ? ' <url|id>' : ''}`)
    const titles = await loadTitles()
    const cache = await loadCache()
    const title = findTitle(titles, query)
    const key = cacheKey(title)

    if (command === 'clear') {
      delete cache[key]
      await saveCache(cache)
      out(`cleared ${title.title} — the next scan will resolve it again`)
      return
    }

    if (!value) throw new Error('usage: npm run trailer -- set "<title>" <url|id>')
    const videoId = videoIdFrom(value)
    if (!videoId) throw new Error(`not a YouTube video id or url: ${value}`)

    // An 11-character string is a plausible id, which is not the same as a real
    // video. With a key we can settle it, and pinning a video that doesn't exist
    // would silently leave the title with no signal at all.
    const label = await describe(videoId)
    if (YOUTUBE_KEY && !label) {
      throw new Error(`YouTube has no video ${videoId} — nothing pinned`)
    }
    cache[key] = {
      videoId,
      channel: label.split(' — ')[1] ?? cache[key]?.channel,
      videoTitle: label.split(' — ')[0] ?? cache[key]?.videoTitle,
      checked: new Date().toISOString().slice(0, 10),
      pinned: true,
    }
    await saveCache(cache)
    out(`pinned ${title.title} -> https://youtu.be/${videoId}${label ? `\n  ${label}` : ''}`)
    out('History already recorded against the old video is kept; the daily rate')
    out('is a difference between readings, so the switch shows as one gap day.')
    return
  }

  const onlyMissing = process.argv.includes('--missing')
  await list(await loadTitles(), await loadCache(), onlyMissing)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
