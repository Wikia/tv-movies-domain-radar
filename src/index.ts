#!/usr/bin/env node
/** tv-movies-domain-radar — upcoming TV & film release calendar.
 *
 * Pulls the full coming-soon calendar from neutron-api, diffs it against the
 * previous run, and writes a single JSON artifact that the dashboard, the
 * static page and the Slack notifier all read.
 *
 * There is deliberately no demand scoring — see types.ts for why.
 *
 * Usage:
 *   npm run radar
 *   npm run radar -- --horizon 60 --top 15
 *   npm run radar -- --today 2026-08-12    # reproducible runs
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import * as alerts from './alerts.js'
import * as artifact from './artifact.js'
import { HORIZON_DAYS, ROOT } from './config.js'
import * as posters from './posters.js'
import { applyDates, byReleaseDate } from './schedule.js'
import * as snapshot from './snapshot.js'
import { fetchUpcoming } from './sources/neutron.js'
import type { MediaType, RadarOutput, Title } from './types.js'

const OUT_DIR = path.join(ROOT, 'out')
const TYPES: MediaType[] = ['movie', 'show']

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      horizon: { type: 'string' },
      top: { type: 'string' },
      today: { type: 'string' },
    },
  })

  const horizonDays = Number(values.horizon ?? HORIZON_DAYS)
  const top = Number(values.top ?? 20)
  const today = values.today ? new Date(`${values.today}T00:00:00Z`) : new Date()

  if (Number.isNaN(today.getTime())) {
    throw new Error(`--today must be YYYY-MM-DD, got: ${values.today}`)
  }

  // A pinned --today is for reproducing or inspecting a past run, so it must NOT
  // write to the snapshot history: dated files are keyed by date, and saving
  // here would overwrite that day's real baseline with today's live calendar,
  // permanently corrupting every diff that later compares against it.
  const pinned = Boolean(values.today) && values.today !== new Date().toISOString().slice(0, 10)

  console.log('='.repeat(72))
  console.log(' tv-movies radar :: upcoming release calendar')
  console.log('='.repeat(72))

  // --- fetch -------------------------------------------------------------
  const upcoming: Title[] = []
  for (const type of TYPES) {
    const titles = await fetchUpcoming(type)
    console.log(`[fetch] ${titles.length} upcoming ${type}s`)
    upcoming.push(...titles)
  }

  applyDates(upcoming, today)
  const titles = byReleaseDate(upcoming)

  // --- diff against the previous run -------------------------------------
  const previous = await snapshot.loadPrevious(today)
  const changes = snapshot.diff(previous, titles)
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

  const fired = alerts.build(titles, changes)
  console.log(`[alert] ${fired.length} titles changed inside the alert window`)

  // Poster art, cached in importance order so a capped run fetches what's on
  // screen first: alerts, then whatever lands soonest.
  const priority = [...fired.map((alert) => alert.title), ...titles]
  const cachedPosters = await posters.cacheThumbnails(priority)
  for (const title of titles) title.poster = posters.posterSrc(title, cachedPosters)
  console.log(
    `[poster] ${titles.filter((t) => t.poster).length}/${titles.length} titles have display art ` +
      `(${process.env.FASTLY_IMAGE_SECRET ? 'signed resize URLs' : 'local thumbnail cache'})`,
  )

  // --- write -------------------------------------------------------------
  const generatedAt = new Date().toISOString()
  const inHorizon = titles.filter(
    (t) => t.daysOut != null && t.daysOut >= 0 && t.daysOut <= horizonDays,
  )

  const output: RadarOutput = {
    generatedAt,
    today: today.toISOString().slice(0, 10),
    horizonDays,
    counts: { upcoming: titles.length, inHorizon: inHorizon.length, alerts: fired.length },
    titles,
    changes,
    alerts: fired,
  }

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(path.join(OUT_DIR, 'radar.json'), JSON.stringify(output, null, 2))
  if (pinned) {
    console.log('\n[snapshot] --today is pinned to a past date — not persisting a snapshot')
  } else {
    await snapshot.save(titles, generatedAt, today)
  }
  console.log(`[out] wrote ${titles.length} titles to out/radar.json`)

  await artifact.build(output)
  console.log('[out] wrote out/dashboard.html + out/dashboard.artifact.html')

  report(inHorizon, fired, top, horizonDays)
}

function report(
  inHorizon: Title[],
  fired: RadarOutput['alerts'],
  top: number,
  horizonDays: number,
): void {
  console.log('\n' + '='.repeat(72))
  console.log(` NEXT ${horizonDays} DAYS — ${inHorizon.length} titles landing`)
  console.log('='.repeat(72))
  for (const t of inHorizon.slice(0, top)) {
    const score = t.criticScore != null ? String(t.criticScore).padStart(3) : '  -'
    console.log(
      `  ${t.releaseDate}  [${score}] ${t.type === 'movie' ? 'film' : 'tv  '} ${t.title}`,
    )
  }

  if (fired.length === 0) return
  console.log('\n' + '='.repeat(72))
  console.log(` CHANGED — ${fired.length} titles added or moved since the last run`)
  console.log('='.repeat(72))
  for (const alert of fired.slice(0, top)) {
    const reasons = alert.reasons.map(alerts.describe).join(', ')
    console.log(`\n▸ ${alert.title.title} (${alert.title.releaseDate ?? '?'})`)
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
