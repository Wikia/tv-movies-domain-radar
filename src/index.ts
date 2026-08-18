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
import * as buzz from './buzz.js'
import { BUZZ, HORIZON_DAYS, ROOT, SIGNALS, TMDB_TOKEN, YOUTUBE_KEY } from './config.js'
import * as posters from './posters.js'
import { applyDates, byReleaseDate } from './schedule.js'
import * as snapshot from './snapshot.js'
import * as fandom from './sources/fandom.js'
import { fetchUpcoming } from './sources/neutron.js'
import * as news from './sources/news.js'
import * as tmdb from './sources/tmdb.js'
import * as wikipedia from './sources/wikipedia.js'
import * as youtube from './sources/youtube.js'
import * as store from './store.js'
import * as trending from './trending.js'
import type { MediaType, RadarOutput, Title, TitleTrend, TrendingReport } from './types.js'

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

  // --- first-party signal ------------------------------------------------
  // Attached BEFORE alerts, because a trending wiki is one of the things that
  // can fire one. Absent export = no signal, not "nothing is trending".
  const wikis = await fandom.load()
  let trendingReport: TrendingReport | null = null
  if (wikis.length === 0) {
    console.log(
      `[trend] no first-party export at data/fandom_trending.csv — running without ` +
        `the wiki signal (see README "First-party data sync")`,
    )
  } else {
    trendingReport = trending.attach(titles, wikis)
    console.log(
      `[trend] week ${trendingReport.week}: ${trendingReport.wikis} trending TV/film wikis, ` +
        `${trendingReport.matched} tied to upcoming titles, ${trendingReport.unmappedTotal} unmapped`,
    )
  }

  // --- public attention --------------------------------------------------
  const articles = await wikipedia.resolveArticles(titles, today)
  const series = await wikipedia.fetchSeries(
    articles,
    today,
    BUZZ.baselineDays + BUZZ.recentDays + BUZZ.lagDays,
  )
  const scored = buzz.attach(titles, series)
  const spiking = titles.filter((t) => t.buzz?.spiking).length
  const buzzCoverage = { resolved: articles.size, scored, spiking }
  console.log(
    `[buzz] ${articles.size}/${titles.length} titles resolved to a Wikipedia article, ` +
      `${scored} scored, ${spiking} spiking`,
  )

  // --- daily signal snapshots --------------------------------------------
  // Recorded, not yet scored. These three can't tell us what yesterday looked
  // like, so the series has to be accumulated before it can say anything —
  // SIGNALS.minHistoryDays governs when a title becomes usable.
  await collectSignals(titles, today, pinned)

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
    counts: {
      upcoming: titles.length,
      inHorizon: inHorizon.length,
      alerts: fired.length,
      trendingMatched: trendingReport?.matched ?? 0,
      buzzScored: scored,
    },
    buzz: buzzCoverage,
    titles,
    changes,
    alerts: fired,
    trending: trendingReport,
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

  report(inHorizon, fired, top, horizonDays, trendingReport)
}

/** Record one day's reading from each daily-snapshot source.
 *
 * Deliberately after the calendar and Wikipedia work, and deliberately unable
 * to fail the run: these are accumulating history for later, so a bad day at
 * YouTube must not cost us the calendar. Each source degrades to "no reading"
 * on its own.
 *
 * A pinned --today is skipped for the same reason it doesn't write a calendar
 * snapshot: the readings would be today's numbers filed under a past date,
 * which would corrupt the history permanently.
 */
async function collectSignals(titles: Title[], today: Date, pinned: boolean): Promise<void> {
  if (pinned) {
    console.log('[signal] --today is pinned — not recording snapshots')
    return
  }

  try {
    const store0 = await store.load('news')
    const result = await news.collect(titles, today, store0)
    await store.save('news', store0, result.readings, today)
    console.log(
      `[news] ${result.queried} day-queries, ${result.pending} still to backfill, ` +
        `${result.skipped} too generic to search, ${result.failed} failed · ` +
        `${store.mature(store0, 'articles')} titles with ${SIGNALS.minHistoryDays}+ days`,
    )
  } catch (error) {
    console.log(`[news] skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!YOUTUBE_KEY) {
    console.log('[yt] no YOUTUBE_API_KEY — skipping (see README "Signal sources")')
  } else {
    try {
      const cache = await youtube.resolveTrailers(titles, today)
      const store0 = await store.load('youtube')
      const result = await youtube.collect(titles, today, cache)
      await store.save('youtube', store0, result.readings, today)
      console.log(
        `[yt] ${result.resolved} trailers resolved, ${result.polled} polled · ` +
          `${store.mature(store0, 'views')} titles with ${SIGNALS.minHistoryDays}+ days`,
      )
    } catch (error) {
      console.log(`[yt] skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!TMDB_TOKEN) {
    console.log('[tmdb] no TMDB_ACCESS_TOKEN — skipping (see README "Signal sources")')
  } else {
    try {
      const cache = await tmdb.resolveIds(titles, today)
      const store0 = await store.load('tmdb')
      const result = await tmdb.collect(titles, today, cache)
      await store.save('tmdb', store0, result.readings, today)
      console.log(
        `[tmdb] ${result.resolved} ids resolved, ${result.polled} polled · ` +
          `${store.mature(store0, 'popularity')} titles with ${SIGNALS.minHistoryDays}+ days`,
      )
    } catch (error) {
      console.log(`[tmdb] skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

function report(
  inHorizon: Title[],
  fired: RadarOutput['alerts'],
  top: number,
  horizonDays: number,
  trend: TrendingReport | null,
): void {
  console.log('\n' + '='.repeat(72))
  console.log(` NEXT ${horizonDays} DAYS — ${inHorizon.length} titles landing`)
  console.log('='.repeat(72))
  // Buzz, not the Metascore — the dashboards dropped that column because almost
  // nothing has a Metascore before release.
  for (const title of inHorizon.slice(0, top)) {
    const score = title.buzz ? String(title.buzz.points).padStart(3) : '  -'
    console.log(
      `  ${title.releaseDate}  [${score}] ${title.type === 'movie' ? 'film' : 'tv  '} ${title.title}`,
    )
  }

  const hot = buzz.ranked(inHorizon, top)
  if (hot.length > 0) {
    console.log('\n' + '='.repeat(72))
    console.log(' BUZZ — size of the surge in Wikipedia attention')
    console.log('='.repeat(72))
    for (const title of hot) {
      const buzzed = title.buzz
      console.log(
        `  ${String(buzzed.points).padStart(3)} ${buzzed.band.padEnd(11)} ${buzzed.phase.padEnd(7)}` +
          `${title.releaseDate}  ${title.title}\n` +
          `        +${buzzed.excess.toLocaleString('en-US')}/day over normal ` +
          `(${buzzed.baseline.toLocaleString('en-US')} → ${buzzed.recent.toLocaleString('en-US')}), ` +
          `${buzzed.momentum}x week over week`,
      )
    }
    console.log(
      '\n  100 = The Odyssey at its peak (1.2M views/day). An ordinary trailer drop is 40-60.',
    )
  }

  if (trend) {
    console.log('\n' + '='.repeat(72))
    console.log(` TRENDING ON FANDOM — week of ${trend.week}`)
    console.log('='.repeat(72))
    const tied = inHorizon.filter((t): t is Title & { trend: TitleTrend } => t.trend != null)
    if (tied.length > 0) {
      console.log('\n  Upcoming titles whose wiki is trending:')
      for (const t of tied.slice(0, top)) {
        const w = t.trend
        const flag = w.isNew ? ' NEW' : w.velocity > 0 ? ` +${w.velocity.toFixed(2)}` : ''
        console.log(
          `    ${t.releaseDate}  ${t.title}\n` +
            `        ${w.domain} (${w.match} match on ${w.matchedOn}, ` +
            `score ${w.trendingScore.toFixed(2)}${flag})`,
        )
      }
    }
    // The unmapped list is the point of this section as much as the matches are:
    // these are hot wikis with nothing upcoming behind them.
    console.log(
      `\n  Trending with no upcoming release (${trend.unmappedTotal} total, top ${trend.unmapped.length}):`,
    )
    // Headline number is fpScore because that is what the list is ordered by;
    // printing the level here instead made the ordering look arbitrary.
    for (const w of trend.unmapped) {
      const flag = w.isNew ? 'NEW' : w.velocity > 0 ? `+${w.velocity.toFixed(2)}` : ''
      console.log(
        `    ${w.fpScore.toFixed(2)}  ${flag.padEnd(6)} ${w.name} — ${w.domain} ` +
          `(level ${w.trendingScore.toFixed(2)}, ${w.pageviews14d.toLocaleString('en-US')} views/14d)`,
      )
    }
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
