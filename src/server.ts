#!/usr/bin/env node

import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

import { API_BASE, ROOT } from './config.js'
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
      hint: 'Run `npm run scan` to generate out/radar.json.',
    })
  }
}

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

async function serveStatic(res: http.ServerResponse, urlPath: string): Promise<void> {
  const requested = path.normalize(path.join(WEB_DIST, urlPath))

  const inside = requested === WEB_DIST || requested.startsWith(WEB_DIST + path.sep)
  const target = inside ? requested : WEB_DIST

  let filePath = target
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html')
  } catch {
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
  process.stdout.write(`tv-movies radar -> http://localhost:${PORT} (upstream ${API_BASE})\n`)
})
