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
 * And one honesty rule the old score didn't have: a title with no data scores
 * `null`, never 0. "No signal" and "cold" are different claims and the UI has
 * to keep them apart.
 */
import { BUZZ } from './config.js'
import type { Buzz, Title } from './types.js'

/** Middle value of a sorted copy. Median rather than mean throughout: these
 * series are spiky by nature and one past spike shouldn't blind the detector
 * for a month afterwards. */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

/** Which days-out bucket a title falls in. Undated titles get their own bucket
 * rather than being lumped with the imminent ones. */
function bucketOf(daysOut: number | null): string {
  if (daysOut == null) return 'undated'
  const edge = BUZZ.cohortBuckets.find((d) => daysOut <= d)
  return edge != null ? `<=${edge}` : 'far'
}

/** Raw, per-title reading before any cohort adjustment. */
interface Raw {
  recent: number
  baseline: number
  ratio: number
  momentum: number
}

function measure(series: number[]): Raw | null {
  // Need a full baseline window plus the recent window, or the comparison is
  // between two different amounts of evidence.
  if (series.length < BUZZ.baselineDays + BUZZ.recentDays) return null
  const recent = mean(series.slice(-BUZZ.recentDays))
  const baseline = median(series.slice(-(BUZZ.baselineDays + BUZZ.recentDays), -BUZZ.recentDays))
  if (baseline < BUZZ.minBaselineViews) return null // too small to spike meaningfully

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
 * Doubling is +15 points: normal = 50, 2x = 65, 4x = 80, 10x = 100. Log scaled
 * because attention is multiplicative — 1,000 -> 2,000 views is the same kind
 * of event as 10,000 -> 20,000, and a linear scale would disagree.
 *
 * 15 rather than 25 per doubling because at 25 the scale topped out at only 4x
 * and eight titles piled up on exactly 100, discarding the ordering between a
 * 4x move and a 17x one. Rank on `relative`, which never saturates; `points`
 * exists to be readable at a glance.
 */
function toPoints(ratio: number): number {
  const points = 50 + 15 * Math.log2(Math.max(ratio, 0.01))
  return Math.max(0, Math.min(100, Math.round(points)))
}

/**
 * Attach a buzz reading to every title we have enough data for.
 *
 * Mutates `titles`, like the other enrichment steps. Returns how many scored,
 * so the caller can report coverage rather than quietly implying full coverage.
 */
export function attach(titles: Title[], series: Map<number, number[]>): number {
  // Pass 1: raw readings.
  const raws = new Map<number, Raw>()
  for (const title of titles) {
    const values = series.get(title.id)
    if (!values) continue
    const raw = measure(values)
    if (raw) raws.set(title.id, raw)
  }

  // Pass 2: the cohort baseline — the median ratio among titles at a similar
  // distance from release. This is what strips out the release ramp, and it
  // also absorbs anything that moved the whole calendar at once (a holiday, a
  // Wikipedia outage), since that shifts every ratio together.
  const byBucket = new Map<string, number[]>()
  for (const title of titles) {
    const raw = raws.get(title.id)
    if (!raw) continue
    const bucket = bucketOf(title.daysOut)
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), raw.ratio])
  }
  const cohortRatio = new Map(
    [...byBucket.entries()].map(([bucket, ratios]) => [bucket, median(ratios) || 1]),
  )

  // Pass 3: detrend and score.
  let scored = 0
  for (const title of titles) {
    const raw = raws.get(title.id)
    if (!raw) continue
    const bucket = bucketOf(title.daysOut)
    const cohort = cohortRatio.get(bucket) ?? 1
    const relative = raw.ratio / cohort

    const elevated = relative >= BUZZ.spikeRatio
    const phase: Buzz['phase'] = !elevated
      ? 'flat'
      : raw.momentum < BUZZ.fadingBelow
        ? 'fading'
        : 'rising'

    const buzz: Buzz = {
      points: toPoints(relative),
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
    title.buzz = buzz
    scored++
  }
  return scored
}

/** Titles worth showing in the buzz panel.
 *
 * Ordered by `relative` rather than `points` because points clamp at 100 and
 * several titles reach it, which would make the ordering between them
 * arbitrary. Rising events sort above fading ones at equal size — a spike
 * still climbing is actionable in a way that the tail of a dead one isn't.
 *
 * Deliberately NOT applied to the schedule, which stays chronological.
 */
export function ranked(titles: Title[], limit: number): Title[] {
  const rank = (t: Title): number => (t.buzz!.phase === 'rising' ? 0 : 1)
  return titles
    .filter((t) => t.buzz)
    .sort((a, b) => rank(a) - rank(b) || b.buzz!.relative - a.buzz!.relative)
    .slice(0, limit)
}
