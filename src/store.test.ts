import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SIGNALS } from './config.js'
import { isoDay, mature, series, type SignalStore } from './store.js'

/** A store holding `days` consecutive readings for one title, ending yesterday. */
function store(days: number, metric = 'articles', value = 10): SignalStore {
  const out: SignalStore = { '1': {} }
  for (let back = days; back >= 1; back--) {
    const day = isoDay(new Date(Date.UTC(2026, 7, 20) - back * 86_400_000))
    out['1']![day] = { [metric]: value }
  }
  return out
}

describe('isoDay', () => {
  it('is a plain YYYY-MM-DD', () => {
    assert.equal(isoDay(new Date('2026-08-09T23:30:00Z')), '2026-08-09')
  })
})

describe('series', () => {
  it('withholds a series below the maturity gate', () => {
    assert.equal(series(store(SIGNALS.minHistoryDays - 1), 1, 'articles'), null)
  })

  it('returns one that just reaches it', () => {
    assert.notEqual(series(store(SIGNALS.minHistoryDays), 1, 'articles'), null)
  })

  it('returns only the days that exist, never filling a gap with zero', () => {
    const withHole = store(12)
    delete withHole['1']!['2026-08-14']
    const got = series(withHole, 1, 'articles')
    assert.ok(got)
    assert.equal(got.dates.includes('2026-08-14'), false)
    assert.equal(got.values.includes(0), false, 'a missing day must not become a 0 reading')
    assert.equal(got.dates.length, got.values.length)
  })

  it('ignores days missing the metric it was asked for', () => {
    const mixed = store(12, 'articles')
    mixed['1']!['2026-08-15'] = { outlets: 3 }
    const got = series(mixed, 1, 'articles')
    assert.ok(got)
    assert.equal(got.dates.includes('2026-08-15'), false)
  })

  it('returns dates in ascending order', () => {
    const got = series(store(12), 1, 'articles')
    assert.ok(got)
    assert.deepEqual(got.dates, [...got.dates].sort())
  })

  it('has nothing to say about an unknown title', () => {
    assert.equal(series(store(12), 999, 'articles'), null)
  })
})

describe('mature', () => {
  it('counts only titles past the gate', () => {
    const mixed = { ...store(12), '2': store(2)['1']! }
    assert.equal(mature(mixed, 'articles'), 1)
  })
})
