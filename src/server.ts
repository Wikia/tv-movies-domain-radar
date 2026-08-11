#!/usr/bin/env node
/** Thin server: the dashboard's only origin.
 *
 * The browser talks exclusively to this process, never to neutron-api. That
 * matters for three reasons:
 *   - CORS: neutron-api only allows *.metacritic.com / *.tvguide.com origins.
 *     This is a standalone internal tool, so we proxy instead of being hosted
 *     there.
 *   - The diff ("new on the calendar", "date moved") needs yesterday's snapshot.
 *     A browser has no yesterday; only a server process can hold that state.
 *   - It keeps the upstream API surface off the public internet.
 *
 * Deliberately built on node:http with NO dependencies — the pipeline is
 * dependency-free and the server should not be the thing that breaks that.
 *
 * Routes:
 *   GET /api/radar            -> the scored + diffed artifact (out/radar.json)
 *   GET /api/live/trending/:t -> live passthrough to neutron-api (t = movie|show)
 *   GET /thumbs/<id>.jpg      -> cached poster art (data/posters)
 *   GET /health               -> liveness probe for k8s
 *   GET /*                    -> the built React app (web/dist)
 */
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { API_BASE, ROOT, USER_AGENT } from './config.js'
import { POSTER_CACHE_DIR } from './posters.js'

const PORT = Number(process.env.PORT ?? 8787)
const RADAR_JSON = path.join(ROOT, 'out', 'radar.json')
const WEB_DIST = path.join(ROOT, 'web', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

/** The artifact the pipeline wrote. 404s with a useful hint before a first run. */
async function serveRadar(res: http.ServerResponse): Promise<void> {
  try {
    const body = await readFile(RADAR_JSON, 'utf8')
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  } catch {
    sendJson(res, 404, {
      error: 'No radar data yet.',
      hint: 'Run `npm run radar` to generate out/radar.json.',
    })
  }
}

/** Live passthrough. Only the trending list is exposed: it's cheap, 1h-cached
 * upstream, and the one thing genuinely worth reading fresh on page load. The
 * scored/diffed data deliberately does NOT come from here. */
async function serveLiveTrending(res: http.ServerResponse, type: string): Promise<void> {
  if (type !== 'movie' && type !== 'show') {
    sendJson(res, 400, { error: 'type must be "movie" or "show"' })
    return
  }
  try {
    const upstream = await fetch(`${API_BASE}/recommendations/metacritic/trending/${type}`, {
      headers: { 'User-Agent': USER_AGENT }, // Fastly 403s non-browser agents
    })
    if (!upstream.ok) {
      sendJson(res, 502, { error: `upstream returned ${upstream.status}` })
      return
    }
    sendJson(res, 200, await upstream.json())
  } catch (error) {
    sendJson(res, 502, {
      error: 'upstream request failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Cached poster thumbnail. Content-addressed by catalog id, so it can be
 * cached hard by the browser. */
async function serveThumb(res: http.ServerResponse, id: string): Promise<void> {
  const file = path.join(POSTER_CACHE_DIR, `${id}.jpg`)
  try {
    await stat(file)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('no art')
    return
  }
  res.writeHead(200, {
    'Content-Type': 'image/jpeg',
    'Cache-Control': 'public, max-age=604800',
  })
  createReadStream(file).pipe(res)
}

/** Static file serving for the built SPA, with traversal protection. */
async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  const requested = path.normalize(path.join(WEB_DIST, urlPath))
  // Never serve outside the dist root, whatever the request looks like.
  const target = requested.startsWith(WEB_DIST) ? requested : WEB_DIST

  let filePath = target
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
    // Unknown path -> SPA fallback so client-side routing works.
    filePath = path.join(WEB_DIST, 'index.html')
  }

  try {
    await stat(filePath)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Dashboard not built. Run `npm run web:build`.')
    return
  }

  const type = MIME[path.extname(filePath)] ?? 'application/octet-stream'
  // Hashed assets are immutable; index.html must always be revalidated.
  const cache = filePath.endsWith('index.html')
    ? 'no-cache'
    : 'public, max-age=31536000, immutable'

  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache })
  createReadStream(filePath).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const route = url.pathname

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' })
    return
  }

  if (route === '/health') {
    sendJson(res, 200, { ok: true })
    return
  }
  if (route === '/api/radar') {
    void serveRadar(res)
    return
  }

  const live = route.match(/^\/api\/live\/trending\/([a-z]+)$/)
  if (live?.[1]) {
    void serveLiveTrending(res, live[1])
    return
  }

  // Cached poster art. The id pattern is strict, so nothing outside the cache
  // directory is reachable through this route.
  const thumb = route.match(/^\/thumbs\/(\d+)\.jpg$/)
  if (thumb?.[1]) {
    void serveThumb(res, thumb[1])
    return
  }

  if (route.startsWith('/api/')) {
    sendJson(res, 404, { error: 'unknown endpoint' })
    return
  }

  void serveStatic(res, route)
})

server.listen(PORT, () => {
  console.log(`tv-movies radar server -> http://localhost:${PORT}`)
  console.log(`  upstream: ${API_BASE}`)
})
