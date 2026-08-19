import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { attach, bucketOf, measure, median, ranked } from './buzz.js'
import { BUZZ } from './config.js'
import type { Title } from './types.js'

function title(id: number, daysOut: number | null = 30): Title {
  return {
    id,
    type: 'movie',
    title: `Title ${id}`,
    slug: `title-${id}`,
    url: '',
    releaseDate: '2026-09-01',
    daysOut,
    genres: [],
    network: null,
    rating: null,
    description: null,
    image: null,
    poster: null,
    criticScore: null,
    userScore: null,
  }
}

/** `days` of `base`, then `spike` for the recent window. */
function series(base: number, spike: number, days = 40): number[] {
  return [...Array<number>(days).fill(base), ...Array<number>(BUZZ.recentDays).fill(spike)]
}

describe('median', () => {
  it('takes the middle of an odd-length set', () => {
    assert.equal(median([3, 1, 2]), 2)
  })

  it('averages the two middles of an even-length set', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5)
  })

  it('is 0 for an empty set rather than NaN', () => {
    assert.equal(median([]), 0)
  })
})

describe('bucketOf', () => {
  it('puts undated titles in their own bucket', () => {
    assert.equal(bucketOf(null), 'undated')
  })

  it('buckets by the first edge the title falls under', () => {
    assert.equal(bucketOf(3), '<=7')
    assert.equal(bucketOf(7), '<=7')
    assert.equal(bucketOf(8), '<=30')
  })

  it('sends anything past the last edge to `far`', () => {
    assert.equal(bucketOf(9999), 'far')
  })
})

describe('measure', () => {
  it('returns null below the baseline floor, so absent is not zero', () => {
    const short = Array<number>(BUZZ.minBaselineDays + BUZZ.recentDays - 1).fill(1000)
    assert.equal(measure(short), null)
  })

  it('reads a series that only just clears the floor', () => {
    const justEnough = Array<number>(BUZZ.minBaselineDays + BUZZ.recentDays).fill(1000)
    assert.notEqual(measure(justEnough), null)
  })

  it('refuses a baseline too small to spike meaningfully', () => {
    // 3 -> 30 is a 10x rise on numbers that mean nothing.
    assert.equal(measure(series(3, 30)), null)
  })

  it('caps the baseline window even when far more history exists', () => {
    // 200 days of 100 then a step to 1000: the baseline must come from the last
    // 28 days only, so it stays 100 rather than being diluted.
    const raw = measure(series(100, 1000, 200))
    assert.ok(raw)
    assert.equal(raw.baseline, 100)
    assert.equal(raw.recent, 1000)
  })

  it('reports momentum against the immediately preceding days', () => {
    const raw = measure(series(100, 1000))
    assert.ok(raw)
    assert.equal(raw.ratio, 10)
    assert.equal(raw.momentum, 10)
  })

  it('sees a fading title as elevated but not climbing', () => {
    // Peaked well above the baseline, now on the way down.
    const values = [...Array<number>(28).fill(100), 5000, 5000, 5000, 5000, 400, 400, 400]
    const raw = measure(values)
    assert.ok(raw)
    assert.ok(raw.ratio > 1, 'still above its own normal')
    assert.ok(raw.momentum < BUZZ.fadingBelow, 'but falling week over week')
  })
})

describe('attach', () => {
  it('gives no reading at all to a title with no data', () => {
    const titles = [title(1)]
    const scored = attach(titles, new Map())
    assert.equal(scored, 0)
    assert.equal(titles[0]?.buzz, undefined, 'undefined, never a 0 score')
  })

  it('divides out the release ramp, so a whole cohort rising scores nobody', () => {
    // Every title in the bucket triples. That is the ramp, not news.
    const titles = [title(1), title(2), title(3), title(4)]
    const data = new Map(titles.map((t) => [t.id, series(1000, 3000)]))
    attach(titles, data)
    for (const t of titles) {
      assert.equal(t.buzz?.spiking, false, `${t.title} should not be spiking`)
      assert.equal(t.buzz?.points, 0, 'no excess over what its cohort is doing')
    }
  })

  it('flags the one title moving against its cohort', () => {
    const titles = [title(1), title(2), title(3), title(4)]
    const data = new Map(titles.map((t) => [t.id, series(1000, 1000)]))
    data.set(1, series(1000, 20_000))
    attach(titles, data)
    assert.equal(titles[0]?.buzz?.spiking, true)
    assert.ok((titles[0]?.buzz?.points ?? 0) > 0)
    for (const t of titles.slice(1)) assert.equal(t.buzz?.spiking, false)
  })

  it('scores the size of the surge, not the multiple', () => {
    // A small article multiplying hard must not outrank a big one moving more.
    const small = title(1)
    const big = title(2)
    const filler = [title(3), title(4)]
    const titles = [small, big, ...filler]
    const data = new Map(filler.map((t) => [t.id, series(1000, 1000)]))
    data.set(small.id, series(200, 3700))
    data.set(big.id, series(3000, 32_000))
    attach(titles, data)
    assert.ok(
      (big.buzz?.points ?? 0) > (small.buzz?.points ?? 0),
      `3,000 -> 32,000 (${big.buzz?.points}) should beat 200 -> 3,700 (${small.buzz?.points})`,
    )
  })

  it('scores a huge title sitting at its normal level at ~0', () => {
    const titles = [title(1), title(2), title(3)]
    const data = new Map(titles.map((t) => [t.id, series(500_000, 500_000)]))
    attach(titles, data)
    assert.equal(titles[0]?.buzz?.points, 0, 'fame is not buzz')
  })

  it('does not let a fading title count as spiking', () => {
    const titles = [title(1), title(2), title(3)]
    const data = new Map(titles.map((t) => [t.id, series(1000, 1000)]))
    data.set(1, [...Array<number>(28).fill(1000), 90_000, 90_000, 90_000, 90_000, 6000, 6000, 6000])
    attach(titles, data)
    assert.equal(titles[0]?.buzz?.phase, 'fading')
    assert.equal(titles[0]?.buzz?.spiking, false, 'elevated but on the way out')
  })
})

describe('ranked', () => {
  it('orders strictly by points, because points is what the panel prints', () => {
    const titles = [title(1), title(2), title(3), title(4)]
    const data = new Map(titles.map((t) => [t.id, series(1000, 1000)]))
    data.set(1, series(1000, 4000))
    data.set(2, series(1000, 40_000))
    attach(titles, data)
    const order = ranked(titles, 10)
    const points = order.map((t) => t.buzz.points)
    assert.deepEqual(
      points,
      [...points].sort((a, b) => b - a),
    )
  })
})
