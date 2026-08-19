import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { versionFor } from './remote.js'

describe('versionFor', () => {
  // scriptlr's regex is ^(0|[1-9]\d*) per component, so a zero-padded month or
  // day is a 400 — the whole publish fails on a leading zero.
  it('never zero-pads', () => {
    assert.equal(versionFor('2026-08-09'), '2026.8.9')
    assert.equal(versionFor('2026-01-01'), '2026.1.1')
  })

  it('leaves two-digit components alone', () => {
    assert.equal(versionFor('2026-12-31'), '2026.12.31')
  })

  it("orders correctly by scriptlr's numeric comparison", () => {
    // `latest` picks the highest version by comparing each component as an int,
    // so a later day must produce larger numbers — the trap being that 9 < 18
    // numerically but "9" > "18" as strings.
    const parse = (v: string) => v.split('.').map(Number)
    const [, m1, d1] = parse(versionFor('2026-08-09'))
    const [, m2, d2] = parse(versionFor('2026-08-18'))
    assert.equal(m1, m2)
    assert.ok((d1 ?? 0) < (d2 ?? 0), '9 must sort before 18')
  })

  it('rolls over months and years in the right order', () => {
    const [y1, m1] = versionFor('2026-12-31').split('.').map(Number)
    const [y2, m2] = versionFor('2027-01-01').split('.').map(Number)
    assert.ok((y1 ?? 0) < (y2 ?? 0))
    assert.ok((m1 ?? 0) > (m2 ?? 0), 'year is compared first, so a smaller month is fine')
  })
})
