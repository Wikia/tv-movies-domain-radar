#!/usr/bin/env node
/** Backtest the buzz detector against real Wikipedia history.
 *
 *   npm run backtest
 *
 * Why this exists: the radar's whole discipline is "measure before you ship" —
 * the original demand score was built on plausibility, and had to be torn out.
 * A scoring change should be judged by re-running this, not by eyeballing the
 * top of the dashboard.
 *
 * It imports the REAL `attach` from src/buzz.ts. A reimplementation here would
 * validate a copy rather than the code that ships.
 *
 * Replays the detector once per historical day and answers four questions:
 *   1. How many titles fire per day — is the volume liveable?
 *   2. Do flags flicker on and off? A detector that unfires is untrustworthy.
 *   3. Does "rising" predict sustained attention 7 days later, or reversion?
 *   4. THE CONTROL: what would the same test score on days it stayed quiet?
 *      Without a base rate, question 3's number means nothing.
 *
 * Requires `data/wiki-articles.json` and `out/radar.json`, so run the radar
 * first. Pageview history is cached in data/backtest-series.json (git-ignored);
 * delete it to refetch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { attach } from '../src/buzz.js'
import { BUZZ, ROOT, WIKI_USER_AGENT } from '../src/config.js'
import type { Title } from '../src/types.js'

const DAYS = 120
const LOOKAHEAD = 7
/** Views at +7d must still be this multiple of the fire-time baseline to count
 * as a hit — i.e. the attention actually stuck rather than blipping. */
const HIT = 1.5
const REVERTED = 1.2

const CACHE = path.join(ROOT, 'data', 'backtest-series.json')
const MIN_HISTORY = BUZZ.baselineDays + BUZZ.recentDays

const stamp = (d: Date): string => d.toISOString().slice(0, 10).replace(/-/g, '')

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

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
      /* retry */
    }
  }
  return {}
}

async function pooled<T, R>(items: T[], limit: number, work: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await work(items[i]!)
      }
    }),
  )
  return out
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
    console.log(`[cache] history for ${Object.keys(history).length} titles`)
  } else {
    console.log(`[fetch] ${DAYS}d of pageviews for ${articleOf.size} titles…`)
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
  console.log(`[data] ${axis[0]} .. ${axis.at(-1)} (${axis.length} days)\n`)

  // Densify: the API omits zero-view days, so fill them — but stop at each
  // article's last published day rather than padding the lag with zeros.
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

    // Fresh copies each day: attach() mutates, and daysOut must be recomputed
    // as of the replay date or every title sits in the wrong cohort — which
    // would silently disable the detrending this is meant to test.
    const snapshot: Title[] = []
    const series = new Map<number, number[]>()
    for (const [id, values] of dense) {
      if (values.length <= j) continue
      // The cached history outlives the calendar: titles that have since fallen
      // out of "coming soon" still have an entry here. Skip them rather than
      // asserting non-null, which crashed the whole run 31 titles later.
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

  console.log('=== 1. ALERT VOLUME ===')
  console.log(`replayed ${perDay.length} days over ${dense.size} titles`)
  console.log(
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
  console.log('\n=== 2. STABILITY ===')
  console.log(`distinct rising episodes: ${episodes}`)
  console.log(`flickered off then back within 3d: ${flickers} (${pct(flickers, episodes)})`)

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
  console.log(`\n=== 3. HIT vs FALSE ALARM (first fire per title, +${LOOKAHEAD}d) ===`)
  console.log(`judged ${judged} episodes`)
  console.log(`  hit (still >=${HIT}x baseline):  ${hits} (${pct(hits, judged)})`)
  console.log(`  ambiguous:                     ${ambiguous} (${pct(ambiguous, judged)})`)
  console.log(`  false alarm (reverted):        ${reverted} (${pct(reverted, judged)})`)

  // The control. Without a base rate the number above is unreadable: if quiet
  // days are just as likely to be elevated a week later, the detector selects
  // nothing.
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
  console.log('\n=== 4. CONTROL — same test on days the detector stayed QUIET ===')
  console.log(`quiet (title, day) pairs: ${quietTotal}`)
  console.log(`  elevated anyway: ${quietHit} (${pct(quietHit, quietTotal)})`)
  const lift = hits / judged / (quietHit / quietTotal)
  console.log(
    `\nLIFT: ${pct(hits, judged)} vs ${pct(quietHit, quietTotal)} base rate = ${lift.toFixed(1)}x better than firing at random`,
  )
}

function pct(n: number, total: number): string {
  return total === 0 ? 'n/a' : `${Math.round((100 * n) / total)}%`
}

main().catch((error: unknown) => {
  console.error('\n[fatal]', error instanceof Error ? error.message : error)
  process.exit(1)
})
