import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { toDailyRate } from './signals.js'

describe('toDailyRate', () => {
  // YouTube reports lifetime views, so the daily rate is the difference between
  // consecutive readings. Failing to difference makes a big back catalogue look
  // like a permanent spike.
  it('differences a cumulative counter', () => {
    const { dates, values } = toDailyRate(
      ['2026-08-01', '2026-08-02', '2026-08-03'],
      [1000, 1200, 1500],
    )
    assert.deepEqual(dates, ['2026-08-02', '2026-08-03'])
    assert.deepEqual(values, [200, 300])
  })

  it('drops the first reading, which has nothing to difference against', () => {
    const { values } = toDailyRate(['2026-08-01'], [1000])
    assert.deepEqual(values, [])
  })

  it('spreads a jump across the days it actually covers', () => {
    // A three-day gap must not book three days of views as one day's surge.
    const { values } = toDailyRate(['2026-08-01', '2026-08-04'], [1000, 1600])
    assert.deepEqual(values, [200], '600 over 3 days, not 600 in one')
  })

  it('drops a day where the counter went backwards', () => {
    // The video was replaced; a negative rate is not a reading.
    const { dates, values } = toDailyRate(
      ['2026-08-01', '2026-08-02', '2026-08-03'],
      [5000, 100, 400],
    )
    assert.equal(dates.includes('2026-08-02'), false)
    assert.equal(
      values.every((v) => v >= 0),
      true,
    )
  })

  it('keeps dates and values the same length', () => {
    const { dates, values } = toDailyRate(
      ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'],
      [10, 5, 20, 30],
    )
    assert.equal(dates.length, values.length)
  })
})
