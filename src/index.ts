#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

import * as alerts from './alerts.js'
import * as artifact from './artifact.js'
import * as buzz from './buzz.js'
import { BUZZ, HORIZON_DAYS, ROOT, SCRIPTLR, SIGNALS, TMDB_TOKEN, YOUTUBE_KEY } from './config.js'
import * as posters from './posters.js'
import * as publish from './publish.js'
import * as remote from './remote.js'
import { Run, summarise } from './report.js'
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
      publish: { type: 'boolean' },
      'no-render': { type: 'boolean' },
    },
  })

  const horizonDays = Number(values.horizon ?? HORIZON_DAYS)
  const today = values.today ? new Date(`${values.today}T00:00:00Z`) : new Date()

  if (Number.isNaN(today.getTime())) {
    throw new Error(`--today must be YYYY-MM-DD, got: ${values.today}`)
  }

  const pinned = Boolean(values.today) && values.today !== new Date().toISOString().slice(0, 10)

  // Publishing is opt-in so a local run can never overwrite shared history, and
  // a pinned --today never publishes for the same reason it writes no snapshot:
  // today's numbers filed under a past date would corrupt the series for good.
  const run = new Run()
  const publishing = Boolean(values.publish) && !pinned
  if (publishing && !remote.canWrite()) {
    throw new Error('--publish needs SCRIPTLR_WRITE_URL')
  }
  if (remote.canRead()) {
    const filled = await publish.hydrateCaches()
    log(`[remote] reading from ${SCRIPTLR.readUrl}${filled ? ` · seeded ${filled} id caches` : ''}`)
  }

  const upcoming: Title[] = []
  for (const type of TYPES) {
    const titles = await fetchUpcoming(type)
    log(`[fetch] ${titles.length} upcoming ${type}s`)
    upcoming.push(...titles)
  }

  applyDates(upcoming, today)
  const titles = byReleaseDate(upcoming)
  run.count('titles', titles.length)
  run.step('calendar', 'ok', `${titles.length} upcoming titles`)

  const previous = await snapshot.loadPrevious(today)
  const changes = snapshot.diff(previous, titles)
  if (previous) {
    const added = changes.filter((c) => c.kind === 'new').length
    const moved = changes.filter((c) => c.kind === 'date-changed').length
    const gone = changes.filter((c) => c.kind === 'removed').length
    log(`[diff] vs ${previous.takenAt.slice(0, 10)}: ${added} new, ${moved} date changes, ${gone} dropped off`)
    run.step('diff', 'ok', `vs ${previous.takenAt.slice(0, 10)}: ${added} new, ${moved} moved, ${gone} dropped`)
  } else {
    log('[diff] no previous snapshot — baseline established, no change alerts')
    // Expected on a first run; on any later one it means yesterday is missing,
    // which silently turns "what changed" into "nothing changed".
    run.step('diff', 'degraded', 'no previous snapshot — no change detection this run')
  }

  let wikis = await fandom.load()
  if (wikis.length === 0) wikis = await publish.loadTrending()
  else if (publishing) await publish.publishTrending(wikis)
  let trendingReport: TrendingReport | null = null
  if (wikis.length === 0) {
    log(`[trend] no first-party export at data/fandom_trending.csv — running without ` + `the wiki signal (see README "First-party data sync")`)
    run.step('trending', 'degraded', 'no first-party export — running without the wiki signal')
  } else {
    trendingReport = trending.attach(titles, wikis)
    log(`[trend] week ${trendingReport.week}: ${trendingReport.wikis} trending TV/film wikis, ` + `${trendingReport.matched} tied to upcoming titles, ${trendingReport.unmappedTotal} unmapped`)
    const weeksOld = Math.floor((today.getTime() - Date.parse(`${trendingReport.week}T00:00:00Z`)) / 604_800_000)
    run.step('trending', weeksOld > 1 ? 'degraded' : 'ok', `week ${trendingReport.week}, ${trendingReport.matched} matched`)
    if (weeksOld > 1) run.warn(`trending export is ${weeksOld} weeks old — a stale signal shown as this week's is worse than none`)
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
  run.count('buzzScored', scored)
  run.count('spiking', spiking)
  run.step('buzz', scored === 0 ? 'failed' : 'ok', `${articles.size} resolved, ${scored} scored, ${spiking} spiking`)

  await collectSignals(titles, today, pinned, publishing, run)

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

  run.count('measured', attention.measured)
  run.count('rising', attention.rising)
  run.count('confirmed', attention.confirmed)
  for (const [source, n] of Object.entries(attention.bySource)) run.count(`source.${source}`, n)

  const fired = alerts.build(titles, changes)
  run.count('alerts', fired.length)
  log(`[alert] ${fired.length} titles changed inside the alert window`)

  // Thumbnails are written to local disk and referenced as /thumbs/{id}.jpg, so
  // they only mean anything to a reader on the same machine. A publishing run on
  // an ephemeral container would ship 197 paths to files nobody can fetch, so it
  // skips the download entirely and leaves those titles without art — absent
  // beats broken. Signed Fastly URLs work everywhere and are used when present.
  const signedArt = Boolean(process.env.FASTLY_IMAGE_SECRET)
  const cachedPosters =
    publishing && !signedArt
      ? new Set<number>()
      : await posters.cacheThumbnails([...fired.map((alert) => alert.title), ...titles])
  for (const title of titles) title.poster = posters.posterSrc(title, cachedPosters)
  const withArt = titles.filter((t) => t.poster).length
  run.count('posters', withArt)
  log(`[poster] ${withArt}/${titles.length} titles have display art ` + `(${signedArt ? 'signed resize URLs' : 'local thumbnail cache'})`)
  if (publishing && !signedArt) {
    run.warn('FASTLY_IMAGE_SECRET is unset, so published titles carry no poster — local thumbnails cannot be read by anything else')
    run.step('posters', 'degraded', 'no signed URLs; skipped the local thumbnail cache')
  } else {
    run.step('posters', 'ok', `${withArt}/${titles.length} with art`)
  }

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

  if (publishing) {
    // A failed publish is a real failure: the readings are on local disk, but
    // nothing downstream will see today at all.
    try {
      await publish.publishRadar(output)
      await publish.publishCaches(output.today)
      log(`[remote] published ${remote.versionFor(output.today)} to ${SCRIPTLR.writeUrl}`)
      run.step('publish', 'ok', `${remote.versionFor(output.today)}`)
    } catch (error) {
      run.step('publish', 'failed', error instanceof Error ? error.message : String(error))
      log(`[remote] publish FAILED: ${error instanceof Error ? error.message : String(error)}`)
    }
  } else {
    run.step('publish', 'skipped', pinned ? 'pinned --today' : 'no --publish')
  }

  // 15 MB of HTML that nothing in the hosted flow reads — the app consumes
  // radar.json. Kept for local runs, where it is how you look at the result.
  if (values['no-render']) {
    run.step('render', 'skipped', '--no-render')
  } else {
    await artifact.build(output)
    run.step('render', 'ok', 'dashboard.html + dashboard.artifact.html')
    log('[out] wrote out/dashboard.html + out/dashboard.artifact.html')
  }

  const report = run.finish(output.today, publishing)
  await writeFile(path.join(OUT_DIR, 'run.json'), JSON.stringify(report, null, 2))
  log(summarise(report))

  // Non-zero on a failed step so a scheduler notices. `degraded` stays 0: the
  // calendar shipped, and waking someone for a flat YouTube day trains them to
  // ignore the alert.
  if (report.status === 'failed') process.exitCode = 1
}

async function collectSignals(
  titles: Title[],
  today: Date,
  pinned: boolean,
  publishing: boolean,
  run: Run,
): Promise<void> {
  if (pinned) {
    log('[signal] --today is pinned — not recording snapshots')
    for (const name of ['news', 'youtube', 'tmdb']) run.step(name, 'skipped', 'pinned --today')
    return
  }

  try {
    const store0 = await store.load('news')
    const result = await news.collect(titles, today, store0)
    await store.save('news', store0, result.readings, today, publishing)
    log(`[news] ${result.queried} day-queries, ${result.pending} still to backfill, ` + `${result.skipped} too generic to search, ${result.failed} failed · ` + `${store.mature(store0, 'onTopic')} titles with ${SIGNALS.minHistoryDays}+ days`)
    run.step('news', result.failed > 0 ? 'degraded' : 'ok', `${result.queried} queries, ${result.failed} failed, ${result.pending} pending`)
    if (result.pending > 0) run.warn(`news backfill incomplete — ${result.pending} day-queries still owed`)
  } catch (error) {
    log(`[news] skipped: ${error instanceof Error ? error.message : String(error)}`)
    run.step('news', 'failed', error instanceof Error ? error.message : String(error))
  }

  if (!YOUTUBE_KEY) {
    log('[yt] no YOUTUBE_API_KEY — skipping (see README "Signal sources")')
    run.step('youtube', 'skipped', 'no YOUTUBE_API_KEY')
  } else {
    try {
      const cache = await youtube.resolveTrailers(titles, today)
      const store0 = await store.load('youtube')
      const result = await youtube.collect(titles, today, cache)
      await store.save('youtube', store0, result.readings, today, publishing)
      log(`[yt] ${result.resolved} trailers resolved, ${result.polled} polled · ` + `${store.mature(store0, 'views')} titles with ${SIGNALS.minHistoryDays}+ days`)
      run.step('youtube', result.polled === 0 ? 'degraded' : 'ok', `${result.resolved} resolved, ${result.polled} polled`)
    } catch (error) {
      log(`[yt] skipped: ${error instanceof Error ? error.message : String(error)}`)
      run.step('youtube', 'failed', error instanceof Error ? error.message : String(error))
    }
  }

  if (!TMDB_TOKEN) {
    log('[tmdb] no TMDB_ACCESS_TOKEN — skipping (see README "Signal sources")')
    run.step('tmdb', 'skipped', 'no TMDB_ACCESS_TOKEN')
  } else {
    try {
      const cache = await tmdb.resolveIds(titles, today)
      const store0 = await store.load('tmdb')
      const result = await tmdb.collect(titles, today, cache)
      await store.save('tmdb', store0, result.readings, today, publishing)
      log(`[tmdb] ${result.resolved} ids resolved, ${result.polled} polled · ` + `${store.mature(store0, 'popularity')} titles with ${SIGNALS.minHistoryDays}+ days`)
      run.step('tmdb', result.polled === 0 ? 'degraded' : 'ok', `${result.resolved} ids, ${result.polled} polled`)
    } catch (error) {
      log(`[tmdb] skipped: ${error instanceof Error ? error.message : String(error)}`)
      run.step('tmdb', 'failed', error instanceof Error ? error.message : String(error))
    }
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`[fatal] ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
