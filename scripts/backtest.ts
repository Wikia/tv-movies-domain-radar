#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { attach, median } from '../src/buzz.js'
import { BUZZ, ROOT, WIKI_USER_AGENT } from '../src/config.js'
import { pooled } from '../src/pool.js'
import type { Title } from '../src/types.js'

function out(line: string): void {
  process.stdout.write(`${line}\n`)
}

const DAYS = 120
const LOOKAHEAD = 7

const HIT = 1.5
const REVERTED = 1.2

const CACHE = path.join(ROOT, 'data', 'backtest-series.json')
const MIN_HISTORY = BUZZ.baselineDays + BUZZ.recentDays

const stamp = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '')

async function fetchSeries(article: string, end: Date): Promise<Record<string, number>> {
  const start = new Date(end.getTime() - (DAYS - 1) * 86_400_000)
  const slug = encodeURIComponent(article.replace(/ /g, '_'))
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia` +
    `/all-access/user/${slug}/daily/${stamp(start)}/${stamp(end)}`
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    try {
      const response = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } })
      if (!response.ok) throw new Error(String(response.status))
      const data = (await response.json()) as { items?: { timestamp: string; views: number }[] }
      const out: Record<string, number> = {}
      for (const item of data.items ?? []) out[item.timestamp.slice(0, 8)] = item.views
      return out
    } catch {
    }
  }
  return {}
}

async function main(): Promise<void> {
  const radar = JSON.parse(
    readFileSync(path.join(ROOT, 'out', 'radar.json'), 'utf8'),
  ) as { titles: Title[] }
  const articles = JSON.parse(
    readFileSync(path.join(ROOT, 'data', 'wiki-articles.json'), 'utf8'),
  ) as Record<string, { article: string | null }>

  const articleOf = new Map<number, string>()
  for (const title of radar.titles) {
    const key = `${title.title}|${title.type}|${title.releaseDate?.slice(0, 4) ?? '?'}`
    const resolved = articles[key]?.article
    if (resolved) articleOf.set(title.id, resolved)
  }

  let history: Record<string, Record<string, number>>
  if (existsSync(CACHE)) {
    history = JSON.parse(readFileSync(CACHE, 'utf8'))
    out(`[cache] history for ${Object.keys(history).length} titles`)
  } else {
    out(`[fetch] ${DAYS}d of pageviews for ${articleOf.size} titles…`)
    const entries = [...articleOf.entries()]
    const end = new Date(Date.now() - 86_400_000)
    const series = await pooled(entries, BUZZ.concurrency, ([, a]) => fetchSeries(a, end))
    history = {}
    entries.forEach(([id], i) => {
      if (Object.keys(series[i]!).length > 0) history[String(id)] = series[i]!
    })
    mkdirSync(path.dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, JSON.stringify(history))
  }

  const axis = [...new Set(Object.values(history).flatMap((s) => Object.keys(s)))].sort()
  const dayIndex = new Map(axis.map((d, i) => [d, i]))
  out(`[data] ${axis[0]} .. ${axis.at(-1)} (${axis.length} days)\n`)

  const dense = new Map<number, number[]>()
  for (const [id, series] of Object.entries(history)) {
    const last = Object.keys(series).sort().at(-1)!
    dense.set(
      Number(id),
      axis.filter((d) => d <= last).map((d) => series[d] ?? 0),
    )
  }

  const titleById = new Map(radar.titles.map((t) => [t.id, t]))
  const fires: { id: number; day: string; baseline: number }[] = []
  const perDay: number[] = []
  const phases = new Map<number, Map<string, string>>()

  for (let j = MIN_HISTORY; j < axis.length; j++) {
    const day = axis[j]!
    const asOf = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T00:00:00Z`)

    const snapshot: Title[] = []
    const series = new Map<number, number[]>()
    for (const [id, values] of dense) {
      if (values.length <= j) continue

      const title = titleById.get(id)
      if (!title) continue
      const daysOut = title.releaseDate
        ? Math.round((Date.parse(`${title.releaseDate}T00:00:00Z`) - asOf) / 86_400_000)
        : null
      snapshot.push({ ...title, daysOut, buzz: undefined })
      series.set(id, values.slice(0, j + 1))
    }
    attach(snapshot, series)

    let fired = 0
    for (const title of snapshot) {
      if (!title.buzz) continue
      if (!phases.has(title.id)) phases.set(title.id, new Map())
      phases.get(title.id)!.set(day, title.buzz.phase)
      if (title.buzz.phase === 'rising') {
        fired++
        fires.push({ id: title.id, day, baseline: title.buzz.baseline })
      }
    }
    perDay.push(fired)
  }

  out('=== 1. ALERT VOLUME ===')
  out(`replayed ${perDay.length} days over ${dense.size} titles`)
  out(
    `rising per day — min ${Math.min(...perDay)}, median ${median(perDay)}, max ${Math.max(...perDay)}`,
  )

  let episodes = 0
  let flickers = 0
  for (const days of phases.values()) {
    const seq = axis.filter((d) => days.has(d)).map((d) => days.get(d)!)
    let open = false
    for (let i = 0; i < seq.length; i++) {
      const rising = seq[i] === 'rising'
      if (rising && !open) {
        episodes++
        open = true
      } else if (!rising && open) {
        if (seq.slice(i, i + 3).includes('rising')) flickers++
        open = false
      }
    }
  }
  out('\n=== 2. STABILITY ===')
  out(`distinct rising episodes: ${episodes}`)
  out(`flickered off then back within 3d: ${flickers} (${pct(flickers, episodes)})`)

  const first = new Map<number, (typeof fires)[number]>()
  for (const fire of fires) if (!first.has(fire.id)) first.set(fire.id, fire)

  let hits = 0
  let reverted = 0
  let ambiguous = 0
  for (const fire of first.values()) {
    const values = dense.get(fire.id)!
    const j = dayIndex.get(fire.day)! + LOOKAHEAD
    if (j >= values.length) continue
    const lift = median(values.slice(j - 2, j + 1)) / Math.max(fire.baseline, 1)
    if (lift >= HIT) hits++
    else if (lift <= REVERTED) reverted++
    else ambiguous++
  }
  const judged = hits + reverted + ambiguous
  out(`\n=== 3. HIT vs FALSE ALARM (first fire per title, +${LOOKAHEAD}d) ===`)
  out(`judged ${judged} episodes`)
  out(`  hit (still >=${HIT}x baseline):  ${hits} (${pct(hits, judged)})`)
  out(`  ambiguous:                     ${ambiguous} (${pct(ambiguous, judged)})`)
  out(`  false alarm (reverted):        ${reverted} (${pct(reverted, judged)})`)

  let quietHit = 0
  let quietTotal = 0
  for (const [id, days] of phases) {
    const values = dense.get(id)!
    for (const [day, phase] of days) {
      if (phase !== 'flat') continue
      const i = dayIndex.get(day)!
      const j = i + LOOKAHEAD
      if (i < MIN_HISTORY || j >= values.length) continue
      const base = median(values.slice(i - MIN_HISTORY + 1, i - BUZZ.recentDays + 1))
      if (base < BUZZ.minBaselineViews) continue
      quietTotal++
      if (median(values.slice(j - 2, j + 1)) / base >= HIT) quietHit++
    }
  }
  out('\n=== 4. CONTROL — same test on days the detector stayed QUIET ===')
  out(`quiet (title, day) pairs: ${quietTotal}`)
  out(`  elevated anyway: ${quietHit} (${pct(quietHit, quietTotal)})`)
  const lift = hits / judged / (quietHit / quietTotal)
  out(
    `\nLIFT: ${pct(hits, judged)} vs ${pct(quietHit, quietTotal)} base rate = ${lift.toFixed(1)}x better than firing at random`,
  )
}

function pct(n: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((100 * n) / total)}%`
}

main().catch((error: unknown) => {
  process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
