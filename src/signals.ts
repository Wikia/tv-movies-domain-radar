import { bucketOf, measure } from './buzz.js'
import { BUZZ, SIGNALS } from './config.js'
import type { SignalStore } from './store.js'
import { series as storedSeries } from './store.js'
import type { Attention, SignalSource, SourceSignal, Title } from './types.js'

const SOURCES: {
  source: SignalSource
  store: 'news' | 'youtube' | 'tmdb'
  metric: string
  cumulative: boolean
  minBaseline: number
}[] = [
  { source: 'news', store: 'news', metric: 'onTopic', cumulative: false, minBaseline: 2 },
  { source: 'youtube', store: 'youtube', metric: 'views', cumulative: true, minBaseline: 50 },
  { source: 'tmdb', store: 'tmdb', metric: 'popularity', cumulative: false, minBaseline: 1 },
]

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
}

function scoreSource(
  titles: Title[],
  store: SignalStore,
  spec: (typeof SOURCES)[number],
): Map<number, SourceSignal> {
  const candidates: Candidate[] = []
  for (const title of titles) {
    const stored = storedSeries(store, title.id, spec.metric)
    if (!stored) continue
    const { dates, values } = spec.cumulative ? toDailyRate(stored.dates, stored.values) : stored
    const raw = measure(values, spec.minBaseline)
    if (!raw) continue
    candidates.push({
      title,
      raw,
      bucket: bucketOf(title.daysOut),
      days: dates.length,
    })
  }

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
      const median = sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
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
    })
  }
  return out
}

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

interface AttentionSummary {
  measured: number

  rising: number

  confirmed: number

  bySource: Record<string, number>
}

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
      sources: [...sources].sort((a, b) => b.relative - a.relative),
      rising,
      confirmed: rising.length >= SIGNALS.confirmAtSources,
    }
    title.attention = attention

    summary.measured++
    if (rising.length > 0) summary.rising++
    if (attention.confirmed) summary.confirmed++
  }

  return summary
}
