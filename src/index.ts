#!/usr/bin/env node

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
import * as signals from './signals.js'
import * as store from './store.js'
import * as trending from './trending.js'
import type { MediaType, RadarOutput, Title, TrendingReport } from './types.js'

const OUT_DIR = path.join(ROOT, 'out')

function log(line: string): void {
  if (!process.env.RADAR_QUIET) process.stdout.write(`${line}\n`)
}
const TYPES: MediaType[] = ['movie', 'show']

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      horizon: { type: 'string' },
      today: { type: 'string' },
    },
  })

  const horizonDays = Number(values.horizon ?? HORIZON_DAYS)
  const today = values.today ? new Date(`${values.today}T00:00:00Z`) : new Date()

  if (Number.isNaN(today.getTime())) {
    throw new Error(`--today must be YYYY-MM-DD, got: ${values.today}`)
  }

  const pinned = Boolean(values.today) && values.today !== new Date().toISOString().slice(0, 10)

  const upcoming: Title[] = []
  for (const type of TYPES) {
    const titles = await fetchUpcoming(type)
    log(`[fetch] ${titles.length} upcoming ${type}s`)
    upcoming.push(...titles)
  }

  applyDates(upcoming, today)
  const titles = byReleaseDate(upcoming)

  const previous = await snapshot.loadPrevious(today)
  const changes = snapshot.diff(previous, titles)
  if (previous) {
    const added = changes.filter((c) => c.kind === 'new').length
    const moved = changes.filter((c) => c.kind === 'date-changed').length
    const gone = changes.filter((c) => c.kind === 'removed').length
    log(`[diff] vs ${previous.takenAt.slice(0, 10)}: ${added} new, ${moved} date changes, ${gone} dropped off`)
  } else {
    log('[diff] no previous snapshot — baseline established, no change alerts')
  }

  const wikis = await fandom.load()
  let trendingReport: TrendingReport | null = null
  if (wikis.length === 0) {
    log(`[trend] no first-party export at data/fandom_trending.csv — running without ` + `the wiki signal (see README "First-party data sync")`)
  } else {
    trendingReport = trending.attach(titles, wikis)
    log(`[trend] week ${trendingReport.week}: ${trendingReport.wikis} trending TV/film wikis, ` + `${trendingReport.matched} tied to upcoming titles, ${trendingReport.unmappedTotal} unmapped`)
  }

  const articles = await wikipedia.resolveArticles(titles, today)
  const series = await wikipedia.fetchSeries(
    articles,
    today,
    BUZZ.baselineDays + BUZZ.recentDays + BUZZ.lagDays,
  )
  const scored = buzz.attach(titles, series)
  const spiking = titles.filter((t) => t.buzz?.spiking).length
  const buzzCoverage = { resolved: articles.size, scored, spiking }
  log(`[buzz] ${articles.size}/${titles.length} titles resolved to a Wikipedia article, ` + `${scored} scored, ${spiking} spiking`)

  await collectSignals(titles, today, pinned)

  const attention = signals.attach(titles, {
    news: await store.load('news'),
    youtube: await store.load('youtube'),
    tmdb: await store.load('tmdb'),
  })
  log(
    `[signal] ${attention.measured} titles measurable, ${attention.rising} rising, ` +
      `${attention.confirmed} confirmed by ${SIGNALS.confirmAtSources}+ sources · ` +
      Object.entries(attention.bySource)
        .filter(([, n]) => n > 0)
        .map(([name, n]) => `${name} ${n}`)
        .join(', '),
  )

  const fired = alerts.build(titles, changes)
  log(`[alert] ${fired.length} titles changed inside the alert window`)

  const priority = [...fired.map((alert) => alert.title), ...titles]
  const cachedPosters = await posters.cacheThumbnails(priority)
  for (const title of titles) title.poster = posters.posterSrc(title, cachedPosters)
  log(`[poster] ${titles.filter((t) => t.poster).length}/${titles.length} titles have display art ` + `(${process.env.FASTLY_IMAGE_SECRET ? 'signed resize URLs' : 'local thumbnail cache'})`)

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
    log('[snapshot] --today is pinned to a past date — not persisting a snapshot')
  } else {
    await snapshot.save(titles, generatedAt, today)
  }
  log(`[out] wrote ${titles.length} titles to out/radar.json`)

  await artifact.build(output)
  log('[out] wrote out/dashboard.html + out/dashboard.artifact.html')
}

async function collectSignals(titles: Title[], today: Date, pinned: boolean): Promise<void> {
  if (pinned) {
    log('[signal] --today is pinned — not recording snapshots')
    return
  }

  try {
    const store0 = await store.load('news')
    const result = await news.collect(titles, today, store0)
    await store.save('news', store0, result.readings, today)
    log(`[news] ${result.queried} day-queries, ${result.pending} still to backfill, ` + `${result.skipped} too generic to search, ${result.failed} failed · ` + `${store.mature(store0, 'articles')} titles with ${SIGNALS.minHistoryDays}+ days`)
  } catch (error) {
    log(`[news] skipped: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!YOUTUBE_KEY) {
    log('[yt] no YOUTUBE_API_KEY — skipping (see README "Signal sources")')
  } else {
    try {
      const cache = await youtube.resolveTrailers(titles, today)
      const store0 = await store.load('youtube')
      const result = await youtube.collect(titles, today, cache)
      await store.save('youtube', store0, result.readings, today)
      log(`[yt] ${result.resolved} trailers resolved, ${result.polled} polled · ` + `${store.mature(store0, 'views')} titles with ${SIGNALS.minHistoryDays}+ days`)
    } catch (error) {
      log(`[yt] skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!TMDB_TOKEN) {
    log('[tmdb] no TMDB_ACCESS_TOKEN — skipping (see README "Signal sources")')
  } else {
    try {
      const cache = await tmdb.resolveIds(titles, today)
      const store0 = await store.load('tmdb')
      const result = await tmdb.collect(titles, today, cache)
      await store.save('tmdb', store0, result.readings, today)
      log(`[tmdb] ${result.resolved} ids resolved, ${result.polled} polled · ` + `${store.mature(store0, 'popularity')} titles with ${SIGNALS.minHistoryDays}+ days`)
    } catch (error) {
      log(`[tmdb] skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
