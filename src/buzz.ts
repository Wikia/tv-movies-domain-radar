import { BUZZ } from './config.js'
import type { Buzz, Title } from './types.js'

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

export function bucketOf(daysOut: number | null): string {
  if (daysOut == null) return 'undated'
  const edge = BUZZ.cohortBuckets.find((d) => daysOut <= d)
  return edge != null ? `<=${edge}` : 'far'
}

interface Raw {
  recent: number
  baseline: number
  ratio: number
  momentum: number
}

export function measure(series: number[], minBaseline: number = BUZZ.minBaselineViews): Raw | null {
  if (series.length < BUZZ.baselineDays + BUZZ.recentDays) return null
  const recent = mean(series.slice(-BUZZ.recentDays))
  const baseline = median(series.slice(-(BUZZ.baselineDays + BUZZ.recentDays), -BUZZ.recentDays))
  if (baseline < minBaseline) return null

  const previous = median(
    series.slice(-(BUZZ.momentumDays + BUZZ.recentDays), -BUZZ.recentDays),
  )
  return {
    recent,
    baseline,
    ratio: recent / baseline,
    momentum: previous > 0 ? recent / previous : 1,
  }
}

function toPoints(excess: number): number {
  if (excess <= BUZZ.floorExcess) return 0
  const floor = Math.log10(BUZZ.floorExcess)
  const span = Math.log10(BUZZ.anchorExcess) - floor
  const points = (100 * (Math.log10(excess) - floor)) / span
  return Math.min(100, Math.round(points))
}

function bandOf(points: number): Buzz['band'] {
  if (points >= BUZZ.bands.exceptional) return 'exceptional'
  if (points >= BUZZ.bands.strong) return 'strong'
  if (points >= BUZZ.bands.notable) return 'notable'
  return 'quiet'
}

export function attach(titles: Title[], series: Map<number, number[]>): number {
  const readings: { title: Title; raw: Raw; bucket: string }[] = []
  for (const title of titles) {
    const values = series.get(title.id)
    if (!values) continue
    const raw = measure(values)
    if (raw) readings.push({ title, raw, bucket: bucketOf(title.daysOut) })
  }

  const ratiosByBucket = new Map<string, number[]>()
  for (const { raw, bucket } of readings) {
    const ratios = ratiosByBucket.get(bucket)
    if (ratios) ratios.push(raw.ratio)
    else ratiosByBucket.set(bucket, [raw.ratio])
  }
  const cohortRatio = new Map(
    [...ratiosByBucket].map(([bucket, ratios]) => [bucket, median(ratios) || 1]),
  )

  for (const { title, raw, bucket } of readings) {
    const cohort = cohortRatio.get(bucket) ?? 1
    const relative = raw.ratio / cohort

    const elevated = relative >= BUZZ.spikeRatio
    const phase: Buzz['phase'] = !elevated
      ? 'flat'
      : raw.momentum < BUZZ.fadingBelow
        ? 'fading'
        : 'rising'

    const expected = raw.baseline * cohort
    const excess = Math.max(0, raw.recent - expected)
    const points = toPoints(excess)

    title.buzz = {
      points,
      band: bandOf(points),
      excess: Math.round(excess),
      recent: Math.round(raw.recent),
      baseline: Math.round(raw.baseline),
      ratio: Math.round(raw.ratio * 100) / 100,
      relative: Math.round(relative * 100) / 100,
      momentum: Math.round(raw.momentum * 100) / 100,
      cohort: bucket,
      phase,

      spiking: phase === 'rising',
    }
  }
  return readings.length
}

export function ranked(titles: Title[], limit: number): ScoredTitle[] {
  const risingFirst = (title: ScoredTitle): number => (title.buzz.phase === 'rising' ? 0 : 1)
  return titles
    .filter(isScored)
    .sort((a, b) => b.buzz.points - a.buzz.points || risingFirst(a) - risingFirst(b))
    .slice(0, limit)
}

type ScoredTitle = Title & { buzz: Buzz }

function isScored(title: Title): title is ScoredTitle {
  return title.buzz != null
}
