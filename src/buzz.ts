/** The buzz score — "is this title actually being talked about right now?"
 *
 * This is the point system, and it is built to avoid the two failures that got
 * the ORIGINAL demand score deleted (see types.ts):
 *
 * 1. It measures a title against ITSELF, not against other titles. A score that
 *    ranks the calendar by absolute attention just re-discovers which franchises
 *    are famous. What's actionable is a title departing from its own normal, so
 *    a mid-budget horror film breaking out is visible next to Marvel.
 *
 * 2. It removes the release ramp before scoring. Attention rises as a release
 *    approaches for EVERY title, so scoring raw growth would flag the whole
 *    calendar in release week — a calendar fact wearing a score's clothing,
 *    which is precisely what the deleted score turned into. Each title is
 *    compared against the median growth of titles at the same distance from
 *    release, so only *unusual* movement survives.
 *
 * And one honesty rule the old score didn't have: a title with no data gets no
 * reading at all, rather than a 0. "No signal" and "cold" are different claims
 * and the UI has to keep them apart.
 */
import { BUZZ } from './config.js'
import type { Buzz, Title } from './types.js'

/** Middle value of a sorted copy. Median rather than mean throughout: these
 * series are spiky by nature and one past spike shouldn't blind the detector
 * for a month afterwards. Exported so the backtest measures with the same
 * statistic the detector uses. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

/** Which days-out bucket a title falls in. Undated titles get their own bucket
 * rather than being lumped with the imminent ones.
 *
 * Exported so every source buckets identically — a cohort computed two ways is
 * not a cohort. */
export function bucketOf(daysOut: number | null): string {
  if (daysOut == null) return 'undated'
  const edge = BUZZ.cohortBuckets.find((d) => daysOut <= d)
  return edge != null ? `<=${edge}` : 'far'
}

/** Raw, per-title reading before any cohort adjustment. */
export interface Raw {
  recent: number
  baseline: number
  ratio: number
  momentum: number
}

/** Reduce a daily series to recent-vs-baseline plus momentum.
 *
 * Exported because every source is measured this way. Only `minBaseline`
 * differs: 50 views/day is a sensible floor for Wikipedia and meaningless for
 * article counts, so the caller supplies it.
 */
export function measure(series: number[], minBaseline: number = BUZZ.minBaselineViews): Raw | null {
  // Need a full baseline window plus the recent window, or the comparison is
  // between two different amounts of evidence.
  if (series.length < BUZZ.baselineDays + BUZZ.recentDays) return null
  const recent = mean(series.slice(-BUZZ.recentDays))
  const baseline = median(series.slice(-(BUZZ.baselineDays + BUZZ.recentDays), -BUZZ.recentDays))
  if (baseline < minBaseline) return null // too small to spike meaningfully

  // Momentum compares the recent window against the days immediately before it
  // — a much shorter memory than the 28-day baseline. That short memory is the
  // point: it's what distinguishes "climbing right now" from "still well above
  // a month-old normal, but falling".
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

/** Map a detrended ratio onto 0..100.
 *
 * Points measure the SIZE of the anomaly — excess daily views over what the
 * title would be getting anyway — not the multiple. That change matters:
 * scoring the multiple made a small article going 200 -> 3,700 outrank a big
 * one going 3,000 -> 32,000, when the second is by far the larger event.
 *
 * Using *excess* rather than raw views keeps this from becoming the fame score
 * that was deleted: a huge title sitting at its normal level has excess ~0 and
 * scores ~0. Only a surge scores, whoever it belongs to.
 *
 * Log-scaled because attention is multiplicative, and anchored so 100 is The
 * Odyssey's 1.2M/day peak — a real once-a-year event, not a threshold an
 * ordinary trailer can reach.
 */
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

/**
 * Attach a buzz reading to every title we have enough data for.
 *
 * Mutates `titles`, like the other enrichment steps. Returns how many scored,
 * so the caller can report coverage rather than quietly implying full coverage.
 */
export function attach(titles: Title[], series: Map<number, number[]>): number {
  // Pass 1: raw readings, each tagged with its cohort. Bucketing here rather
  // than again in pass 3 keeps the two passes from ever disagreeing about which
  // cohort a title belongs to.
  const readings: { title: Title; raw: Raw; bucket: string }[] = []
  for (const title of titles) {
    const values = series.get(title.id)
    if (!values) continue
    const raw = measure(values)
    if (raw) readings.push({ title, raw, bucket: bucketOf(title.daysOut) })
  }

  // Pass 2: the cohort baseline — the median ratio among titles at a similar
  // distance from release. This is what strips out the release ramp, and it
  // also absorbs anything that moved the whole calendar at once (a holiday, a
  // Wikipedia outage), since that shifts every ratio together.
  const ratiosByBucket = new Map<string, number[]>()
  for (const { raw, bucket } of readings) {
    const ratios = ratiosByBucket.get(bucket)
    if (ratios) ratios.push(raw.ratio)
    else ratiosByBucket.set(bucket, [raw.ratio])
  }
  const cohortRatio = new Map(
    [...ratiosByBucket].map(([bucket, ratios]) => [bucket, median(ratios) || 1]),
  )

  // Pass 3: detrend and score.
  for (const { title, raw, bucket } of readings) {
    const cohort = cohortRatio.get(bucket) ?? 1
    const relative = raw.ratio / cohort

    const elevated = relative >= BUZZ.spikeRatio
    const phase: Buzz['phase'] = !elevated
      ? 'flat'
      : raw.momentum < BUZZ.fadingBelow
        ? 'fading'
        : 'rising'

    // Excess is measured against what the cohort says this title should be
    // doing at its age, not against its own flat baseline — so the release
    // ramp is removed from the magnitude too, not just from the multiple.
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
      // "Spiking" now means elevated AND not already on the way down. A title
      // whose event finished a fortnight ago is still elevated against a
      // 28-day baseline, but it is not news and should not be tagged as if it
      // were.
      spiking: phase === 'rising',
    }
  }
  return readings.length
}

/** Titles worth showing in the buzz panel, strictly by points.
 *
 * The panel prints `points` beside every row, so points must be what orders it.
 * An earlier version sorted rising titles ahead of everything else, which put a
 * 64 below an 11 and made the column look broken — the same mistake as showing
 * one quantity while sorting by another, which this project has now made three
 * times. Phase is still visible as a tag; it just doesn't reorder anything.
 *
 * Rising wins a tie, since a surge still climbing is the more actionable of two
 * equal readings.
 *
 * Deliberately NOT applied to the schedule, which stays chronological.
 */
export function ranked(titles: Title[], limit: number): ScoredTitle[] {
  const risingFirst = (title: ScoredTitle): number => (title.buzz.phase === 'rising' ? 0 : 1)
  return titles
    .filter(isScored)
    .sort((a, b) => b.buzz.points - a.buzz.points || risingFirst(a) - risingFirst(b))
    .slice(0, limit)
}

/** A title that actually has a reading. Callers get this back from `ranked()`
 * so they can read `.buzz` without a non-null assertion at every use. */
export type ScoredTitle = Title & { buzz: Buzz }

export function isScored(title: Title): title is ScoredTitle {
  return title.buzz != null
}
