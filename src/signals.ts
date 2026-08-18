/** Ask every source the same question: is this title above its own normal?
 *
 * The machinery is buzz.ts's, reused rather than reimplemented — same baseline
 * window, same cohort detrend, same momentum gate. What is NOT reused is the
 * 0-100 score: that scale is anchored on The Odyssey's 1.2M pageviews/day and
 * means nothing for article counts or a TMDB popularity index. Inventing a
 * shared score would invent a comparability that doesn't exist.
 *
 * So each source reports the part that does transfer — how far above normal,
 * which way it's moving — and the sources are combined by AGREEMENT, not
 * arithmetic. Two independent sources rising is a broad event; one is a narrow
 * one. That distinction is the entire reason for collecting more than one.
 */
import { bucketOf, measure } from './buzz.js'
import { BUZZ, SIGNALS } from './config.js'
import type { SignalStore } from './store.js'
import { series as storedSeries } from './store.js'
import type { Attention, SignalSource, SourceSignal, Title } from './types.js'

/** How to read each source.
 *
 * `cumulative` is the important one. YouTube reports lifetime views, so the
 * daily rate is the difference between consecutive readings; TMDB popularity is
 * already a level, and a news article count is already a per-day rate. Diffing
 * a level, or failing to diff a counter, would both produce nonsense.
 *
 * `minBaseline` filters out series too small to spike meaningfully — the
 * article-count equivalent of Wikipedia's 50-views floor. A title going from
 * one article a day to three is noise.
 */
const SOURCES: {
  source: SignalSource
  store: 'news' | 'youtube' | 'tmdb'
  metric: string
  cumulative: boolean
  minBaseline: number
}[] = [
  { source: 'news', store: 'news', metric: 'articles', cumulative: false, minBaseline: 2 },
  { source: 'youtube', store: 'youtube', metric: 'views', cumulative: true, minBaseline: 50 },
  { source: 'tmdb', store: 'tmdb', metric: 'popularity', cumulative: false, minBaseline: 1 },
]

/** Consecutive differences of a cumulative counter, in the same order.
 *
 * Gaps are not interpolated: a jump across a missing day is spread over the
 * days it actually covers, because attributing a week of views to one day would
 * manufacture exactly the spike we're trying to detect.
 */
function toDailyRate(dates: string[], values: number[]): { dates: string[]; values: number[] } {
  const outDates: string[] = []
  const outValues: number[] = []
  for (let i = 1; i < values.length; i++) {
    const spanDays = Math.max(
      1,
      Math.round(
        (Date.parse(`${dates[i]!}T00:00:00Z`) - Date.parse(`${dates[i - 1]!}T00:00:00Z`)) /
          86_400_000,
      ),
    )
    const delta = values[i]! - values[i - 1]!
    // A counter that goes backwards means the video or record was replaced.
    // Drop the day rather than record a negative rate.
    if (delta < 0) continue
    outDates.push(dates[i]!)
    outValues.push(delta / spanDays)
  }
  return { dates: outDates, values: outValues }
}

interface Candidate {
  title: Title
  raw: NonNullable<ReturnType<typeof measure>>
  bucket: string
  days: number
  mock: boolean
}

/** True when any reading behind this title/metric was generated rather than
 * observed. Tracked per title so one mocked source can't quietly launder a
 * whole verdict. */
function usedMock(store: SignalStore, titleId: number): boolean {
  return Object.values(store[String(titleId)] ?? {}).some((reading) => reading.mock === 1)
}

/** Score one source across all titles, cohort-detrended within that source. */
function scoreSource(
  titles: Title[],
  store: SignalStore,
  spec: (typeof SOURCES)[number],
): Map<number, SourceSignal> {
  const candidates: Candidate[] = []
  for (const title of titles) {
    const stored = storedSeries(store, title.id, spec.metric)
    if (!stored) continue // below the maturity gate, or no readings at all
    const { dates, values } = spec.cumulative
      ? toDailyRate(stored.dates, stored.values)
      : stored
    const raw = measure(values, spec.minBaseline)
    if (!raw) continue
    candidates.push({
      title,
      raw,
      bucket: bucketOf(title.daysOut),
      days: dates.length,
      mock: usedMock(store, title.id),
    })
  }

  // Cohort median within THIS source. Detrending has to happen per source: a
  // week where the whole calendar gets more press is a property of the press,
  // not of any title in it.
  const byBucket = new Map<string, number[]>()
  for (const c of candidates) {
    const ratios = byBucket.get(c.bucket)
    if (ratios) ratios.push(c.raw.ratio)
    else byBucket.set(c.bucket, [c.raw.ratio])
  }
  const cohort = new Map(
    [...byBucket].map(([bucket, ratios]) => {
      const sorted = [...ratios].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median =
        sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
      return [bucket, median || 1]
    }),
  )

  const out = new Map<number, SourceSignal>()
  for (const c of candidates) {
    const relative = c.raw.ratio / (cohort.get(c.bucket) ?? 1)
    const elevated = relative >= BUZZ.spikeRatio
    const phase: SourceSignal['phase'] = !elevated
      ? 'flat'
      : c.raw.momentum < BUZZ.fadingBelow
        ? 'fading'
        : 'rising'
    out.set(c.title.id, {
      source: spec.source,
      metric: spec.metric,
      recent: Math.round(c.raw.recent * 100) / 100,
      baseline: Math.round(c.raw.baseline * 100) / 100,
      relative: Math.round(relative * 100) / 100,
      momentum: Math.round(c.raw.momentum * 100) / 100,
      phase,
      days: c.days,
      ...(c.mock ? { mock: true } : {}),
    })
  }
  return out
}

/** Wikipedia already has a reading on the title; express it in the same shape
 * so the panel can list all sources side by side. */
function fromBuzz(title: Title): SourceSignal | null {
  if (!title.buzz) return null
  return {
    source: 'wikipedia',
    metric: 'views',
    recent: title.buzz.recent,
    baseline: title.buzz.baseline,
    relative: title.buzz.relative,
    momentum: title.buzz.momentum,
    phase: title.buzz.phase,
    days: BUZZ.baselineDays + BUZZ.recentDays,
  }
}

export interface AttentionSummary {
  /** titles with at least one source able to speak */
  measured: number
  /** titles with at least one source rising */
  rising: number
  /** titles with two or more sources rising */
  confirmed: number
  /** per-source count of titles it could score at all */
  bySource: Record<string, number>
}

/** Attach a multi-source verdict to every title, and summarise coverage. */
export function attach(
  titles: Title[],
  stores: { news: SignalStore; youtube: SignalStore; tmdb: SignalStore },
): AttentionSummary {
  const scored = SOURCES.map((spec) => ({
    spec,
    byTitle: scoreSource(titles, stores[spec.store], spec),
  }))

  const summary: AttentionSummary = {
    measured: 0,
    rising: 0,
    confirmed: 0,
    bySource: { wikipedia: 0, news: 0, youtube: 0, tmdb: 0 },
  }

  for (const title of titles) {
    const sources: SourceSignal[] = []
    const wiki = fromBuzz(title)
    if (wiki) {
      sources.push(wiki)
      summary.bySource.wikipedia = (summary.bySource.wikipedia ?? 0) + 1
    }
    for (const { spec, byTitle } of scored) {
      const signal = byTitle.get(title.id)
      if (!signal) continue
      sources.push(signal)
      summary.bySource[spec.source] = (summary.bySource[spec.source] ?? 0) + 1
    }
    if (sources.length === 0) continue

    const rising = sources.filter((s) => s.phase === 'rising').map((s) => s.source)
    const attention: Attention = {
      // Loudest first, so the panel leads with the strongest claim.
      sources: [...sources].sort((a, b) => b.relative - a.relative),
      rising,
      confirmed: rising.length >= SIGNALS.confirmAtSources,
      mock: sources.some((s) => s.mock === true),
    }
    title.attention = attention

    summary.measured++
    if (rising.length > 0) summary.rising++
    if (attention.confirmed) summary.confirmed++
  }

  return summary
}
