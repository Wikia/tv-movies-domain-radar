#!/usr/bin/env node
/** Generate plausible history for the daily-snapshot sources.
 *
 *   npm run mock:signals          # fill gaps, keep real readings
 *   npm run mock:signals -- --reset   # drop generated readings first
 *
 * WHY THIS EXISTS: Google News, YouTube and TMDB have no history endpoint, so
 * their series only accrue a day at a time. That means roughly four weeks of
 * daily runs before any of them can say anything — too long to wait to find out
 * whether the multi-source view is worth building. This fabricates the history
 * so the end-to-end behaviour can be seen today.
 *
 * IT IS NOT DATA. Every generated reading carries `mock: 1`, that flag survives
 * into the scoring, and anything computed from it is labelled in the UI. Real
 * readings are never overwritten — only missing days are filled — so the two
 * can coexist and the real ones win.
 *
 * The shape is correlated on purpose: a title Wikipedia says is rising gets a
 * matching surge in the other sources, on roughly the same days. A demo where
 * every source disagrees would exercise nothing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { BUZZ, ROOT, SIGNALS } from '../src/config.js'
import * as store from '../src/store.js'
import type { SignalStore } from '../src/store.js'
import type { Title } from '../src/types.js'

/** Enough history to clear the baseline window with room to spare. */
const DAYS = BUZZ.baselineDays + BUZZ.recentDays + 4

/** Deterministic PRNG, seeded per title, so re-running produces the same
 * history instead of a new random world each time. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function isoDay(offsetFromToday: number, today: Date): string {
  return store.isoDay(new Date(today.getTime() + offsetFromToday * 86_400_000))
}

/** A day's multiplier for a title that spikes: flat, then a sharp rise a few
 * days ago, then decay. Mirrors the real trailer-drop curves we measured. */
function spikeCurve(dayIndex: number, peakIndex: number, height: number): number {
  const distance = dayIndex - peakIndex
  if (distance < -1) return 1
  if (distance === -1) return 1 + height * 0.35 // the day before, already climbing
  if (distance === 0) return 1 + height
  return 1 + height * Math.exp(-distance / 2.2) // decay over roughly a week
}

interface Plan {
  title: Title
  spikes: boolean
  peakIndex: number
  height: number
}

function planFor(titles: Title[], today: Date): Plan[] {
  return titles.map((title) => {
    const random = rng(title.id)
    // Follow Wikipedia where it has an opinion: a title genuinely rising there
    // gets a correlated surge here. Everything else stays flat apart from a
    // couple of titles given a spike of their own, so the demo also shows a
    // source disagreeing — which is the case the confirmed/single-source
    // distinction exists for.
    const wikiRising = title.buzz?.phase === 'rising'
    const surprise = !wikiRising && random() < 0.04
    const height = wikiRising ? 4 + random() * 8 : 3 + random() * 4
    return {
      title,
      spikes: wikiRising || surprise,
      // Peak a few days back so the decay is visible and momentum has
      // something to read.
      peakIndex: DAYS - 4 - Math.floor(random() * 3),
      height,
    }
  })
}

/** Build one source's readings, filling only the days that are missing.
 *
 * The fiddly part is JOINING ONTO REAL DATA. Fabricated history that ignores
 * the real readings produces a cliff at the seam: the first attempt spliced a
 * made-up YouTube total onto today's genuine 34-million-view count and scored
 * the jump as a 419x surge. So when a title already has observations, the mock
 * is anchored to them —
 *
 *   cumulative (YouTube): daily rates are integrated BACKWARDS from the
 *     earliest real total, so the series arrives exactly where reality starts.
 *   level (news, TMDB): the synthetic baseline is rescaled to the median of the
 *     real readings, so the two sit at the same magnitude.
 *
 * Either way the seam is continuous and the only spikes are the intended ones.
 */
function build(
  plans: Plan[],
  existing: SignalStore,
  today: Date,
  metric: string,
  baselineFor: (plan: Plan, random: () => number) => number,
  cumulative: boolean,
): SignalStore {
  const readings: SignalStore = {}

  for (const plan of plans) {
    const random = rng(plan.title.id * 7919 + metric.length)
    const key = String(plan.title.id)
    const have = existing[key] ?? {}

    // Real observations for this metric, oldest first.
    const realDays = Object.keys(have)
      .filter((day) => typeof have[day]?.[metric] === 'number' && have[day]?.mock !== 1)
      .sort()
    const realValues = realDays.map((day) => have[day]![metric]!)

    let base = baselineFor(plan, random)
    if (!cumulative && realValues.length > 0) {
      // Match the real level so the seam doesn't step.
      const sorted = [...realValues].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]!
      if (median > 0) base = median
    }
    if (base <= 0) continue

    // The daily rate for each synthetic day.
    const days: string[] = []
    const rates: number[] = []
    for (let i = 0; i < DAYS; i++) {
      const day = isoDay(-(DAYS - i), today)
      if (day in have) continue // never overwrite an observation
      const multiplier = plan.spikes ? spikeCurve(i, plan.peakIndex, plan.height) : 1
      days.push(day)
      rates.push(base * multiplier * (0.8 + random() * 0.4))
    }
    if (days.length === 0) continue

    readings[key] = {}
    if (!cumulative) {
      days.forEach((day, i) => {
        readings[key]![day] = { [metric]: Math.round(rates[i]! * 100) / 100, mock: 1 }
      })
      continue
    }

    // Integrate backwards from where reality begins, so the last synthetic day
    // sits just below the first real total.
    const anchor = realValues[0] ?? Math.round(base * 300)
    const totals = new Array<number>(days.length)
    let running = anchor
    for (let i = days.length - 1; i >= 0; i--) {
      running -= rates[i]!
      totals[i] = Math.max(0, Math.round(running))
    }
    days.forEach((day, i) => {
      readings[key]![day] = { [metric]: totals[i]!, mock: 1 }
    })
  }
  return readings
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset')
  const radar = JSON.parse(
    readFileSync(path.join(ROOT, 'out', 'radar.json'), 'utf8'),
  ) as { titles: Title[] }
  const today = new Date()
  const plans = planFor(radar.titles, today)
  const spiking = plans.filter((p) => p.spikes).length

  console.log(
    `[mock] ${radar.titles.length} titles, ${spiking} given a surge ` +
      `(${plans.filter((p) => p.title.buzz?.phase === 'rising').length} because Wikipedia says so)`,
  )

  for (const [source, metric, cumulative, baselineFor] of [
    [
      'news',
      'articles',
      false,
      (plan: Plan, random: () => number) =>
        // Press volume tracks profile: a title with a big Wikipedia audience
        // gets more coverage at rest than an indie.
        Math.max(2, Math.round(((plan.title.buzz?.baseline ?? 400) / 400) * (2 + random() * 6))),
    ],
    [
      'youtube',
      'views',
      true,
      (plan: Plan, random: () => number) =>
        Math.max(200, Math.round(((plan.title.buzz?.baseline ?? 400) / 400) * (800 + random() * 4000))),
    ],
    [
      'tmdb',
      'popularity',
      false,
      (plan: Plan, random: () => number) =>
        Math.max(1, ((plan.title.buzz?.baseline ?? 400) / 400) * (3 + random() * 12)),
    ],
  ] as const) {
    const current = await store.load(source)
    if (reset) {
      for (const [id, series] of Object.entries(current)) {
        for (const [day, reading] of Object.entries(series)) {
          if (reading.mock === 1) delete series[day]
        }
        if (Object.keys(series).length === 0) delete current[id]
      }
    }
    const readings = build(plans, current, today, metric, baselineFor, cumulative)
    await store.save(source, current, readings, today)
    const titles = Object.keys(readings).length
    const days = Object.values(readings).reduce((n, s) => n + Object.keys(s).length, 0)
    console.log(
      `[mock] ${source}: filled ${days} days across ${titles} titles ` +
        `(real readings untouched) · ${store.mature(current, metric)} now past the ` +
        `${SIGNALS.minHistoryDays}-day gate`,
    )
  }

  console.log('\n[mock] every generated reading carries mock:1 — the UI labels anything built on it')
}

main().catch((error: unknown) => {
  console.error('\n[fatal]', error instanceof Error ? error.message : error)
  process.exit(1)
})
