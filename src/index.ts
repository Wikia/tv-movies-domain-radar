#!/usr/bin/env node
/** tv-movies-domain-radar — upcoming TV & film release radar.
 *
 * Pulls the full coming-soon calendar and the trending list from neutron-api,
 * scores every title, diffs against yesterday's snapshot, and writes a single
 * JSON artifact that both the dashboard and the Slack notifier read.
 *
 * Usage:
 *   npm run radar
 *   npm run radar -- --horizon 60 --top 15
 *   npm run radar -- --today 2026-08-11    # reproducible runs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import * as alerts from './alerts.js'
import * as artifact from './artifact.js'
import { HORIZON_DAYS, ROOT } from './config.js'
import { applyDates, applyPopularity, applyTrending, byReleaseDate, score } from './scoring.js'
import * as snapshot from './snapshot.js'
import { fetchTrending, fetchUpcoming, fetchUpcomingPopularity } from './sources/neutron.js'
import type { MediaType, RadarOutput, Title } from './types.js'

const OUT_DIR = path.join(ROOT, 'out')
const TYPES: MediaType[] = ['movie', 'show']

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      horizon: { type: 'string' },
      top: { type: 'string' },
      today: { type: 'string' },
      'no-trending': { type: 'boolean' },
    },
  })

  const horizonDays = Number(values.horizon ?? HORIZON_DAYS)
  const top = Number(values.top ?? 20)
  const today = values.today ? new Date(`${values.today}T00:00:00Z`) : new Date()

  if (Number.isNaN(today.getTime())) {
    throw new Error(`--today must be YYYY-MM-DD, got: ${values.today}`)
  }

  console.log('='.repeat(72))
  console.log(' tv-movies radar :: upcoming releases + what is gaining traction')
  console.log('='.repeat(72))

  // --- fetch -------------------------------------------------------------
  const upcoming: Title[] = []
  for (const type of TYPES) {
    const titles = await fetchUpcoming(type)
    console.log(`[fetch] ${titles.length} upcoming ${type}s`)
    upcoming.push(...titles)
  }

  let trending: Title[] = []
  if (!values['no-trending']) {
    for (const type of TYPES) {
      const titles = await fetchTrending(type)
      console.log(`[fetch] ${titles.length} trending ${type}s`)
      trending.push(...titles)
    }
  }

  // The one real anticipation signal we can get. Coverage is partial (movies
  // only, in practice) — see fetchUpcomingPopularity.
  const popularity = new Map<number, number>()
  for (const type of TYPES) {
    const ranks = await fetchUpcomingPopularity(type, today)
    for (const [id, rank] of ranks) popularity.set(id, rank)
    console.log(`[fetch] ${ranks.size} upcoming ${type}s carry a popularity rank`)
  }

  // --- enrich + score ----------------------------------------------------
  applyDates(upcoming, today)
  applyDates(trending, today)

  const matched = applyTrending(upcoming, trending)
  console.log(`[merge] ${matched} upcoming titles are also trending right now`)
  applyPopularity(upcoming, popularity)

  const ranked = score(upcoming, trending.length, popularity.size)
  const rankedTrending = score(trending, trending.length, popularity.size)

  const withDemand = ranked.filter(
    (t) => t.popularityRank != null || t.trendingRank != null || t.fandomSignal != null,
  ).length
  console.log(
    `[score] ${withDemand}/${ranked.length} titles have a real demand signal; ` +
      `the rest are capped as schedule-only`,
  )

  // --- diff against yesterday -------------------------------------------
  const previous = await snapshot.loadPrevious()
  const changes = snapshot.diff(previous, ranked)
  if (previous) {
    const added = changes.filter((c) => c.kind === 'new').length
    const moved = changes.filter((c) => c.kind === 'date-changed').length
    const gone = changes.filter((c) => c.kind === 'removed').length
    console.log(
      `[diff] vs ${previous.takenAt.slice(0, 10)}: ${added} new, ${moved} date changes, ${gone} dropped off`,
    )
  } else {
    console.log('[diff] no previous snapshot — baseline established, no change alerts')
  }

  const fired = alerts.build(ranked, changes)
  console.log(`[alert] ${fired.length} titles meet an alert rule`)

  // --- write -------------------------------------------------------------
  const generatedAt = new Date().toISOString()
  const inHorizon = ranked.filter(
    (t) => t.daysOut != null && t.daysOut >= 0 && t.daysOut <= horizonDays,
  )

  const output: RadarOutput = {
    generatedAt,
    today: today.toISOString().slice(0, 10),
    horizonDays,
    counts: {
      upcoming: ranked.length,
      inHorizon: inHorizon.length,
      trending: rankedTrending.length,
      alerts: fired.length,
    },
    titles: byReleaseDate(ranked),
    trending: rankedTrending,
    changes,
    alerts: fired,
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, 'radar.json'), JSON.stringify(output, null, 2))
  await snapshot.save(ranked, generatedAt)
  console.log(`\n[out] wrote ${ranked.length} titles to out/radar.json`)

  await artifact.build(output)
  console.log('[out] wrote out/dashboard.html + out/dashboard.artifact.html')

  report(ranked, inHorizon, fired, top, horizonDays)
}

function report(
  ranked: Title[],
  inHorizon: Title[],
  fired: RadarOutput['alerts'],
  top: number,
  horizonDays: number,
): void {
  console.log('\n' + '='.repeat(72))
  console.log(` TOP ${Math.min(top, ranked.length)} BY DEMAND — all upcoming titles`)
  console.log('='.repeat(72))
  for (const [i, t] of ranked.slice(0, top).entries()) {
    const star = t.trendingRank != null ? ' *' : '  '
    const when = t.releaseDate ?? '?'
    const out = t.daysOut != null ? `${t.daysOut >= 0 ? '+' : ''}${t.daysOut}d` : ''
    console.log(`\n${String(i + 1).padStart(2)}.${star}[${String(t.score).padStart(5)}] ${t.title}`)
    console.log(`      ${t.type.padEnd(5)} | ${when} ${out.padEnd(7)}| ${t.genres.slice(0, 3).join(', ')}`)
    if (t.trendingRank != null) console.log(`      trending now at #${t.trendingRank}`)
  }
  console.log('\n  * = also in the trending list right now')

  console.log('\n' + '='.repeat(72))
  console.log(` NEXT ${horizonDays} DAYS — ${inHorizon.length} titles landing`)
  console.log('='.repeat(72))
  for (const t of byReleaseDate(inHorizon).slice(0, top)) {
    const flag = t.trendingRank != null ? ' *' : '  '
    console.log(`  ${t.releaseDate}${flag} [${String(t.score).padStart(5)}] ${t.type.padEnd(5)} ${t.title}`)
  }

  if (fired.length === 0) return
  console.log('\n' + '='.repeat(72))
  console.log(` ALERTS — ${fired.length} titles worth a Slack ping`)
  console.log('='.repeat(72))
  for (const alert of fired.slice(0, top)) {
    const reasons = alert.reasons.map(alerts.describe).join(', ')
    console.log(`\n▸ [${String(alert.title.score).padStart(5)}] ${alert.title.title} (${alert.title.releaseDate ?? '?'})`)
    console.log(`    ${reasons}`)
    if (alert.change?.kind === 'date-changed') {
      console.log(`    moved: ${alert.change.from ?? '?'} -> ${alert.change.to ?? '?'}`)
    }
  }
  console.log()
}

main().catch((error: unknown) => {
  console.error('\n[fatal]', error instanceof Error ? error.message : error)
  process.exit(1)
})
