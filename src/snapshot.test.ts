import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diff, type Snapshot } from './snapshot.js'
import type { Title } from './types.js'

function title(id: number, name: string, releaseDate: string | null): Title {
  return {
    id,
    type: 'movie',
    title: name,
    slug: name.toLowerCase(),
    url: '',
    releaseDate,
    daysOut: 10,
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

function snapshot(entries: [number, string, string | null][]): Snapshot {
  return {
    takenAt: '2026-08-18T00:00:00.000Z',
    entries: entries.map(([id, t, d]) => ({
      id,
      type: 'movie' as const,
      title: t,
      releaseDate: d,
    })),
  }
}

describe('diff', () => {
  it('reports nothing without a baseline, rather than calling everything new', () => {
    assert.deepEqual(diff(null, [title(1, 'Wicked', '2026-09-01')]), [])
  })

  it('finds a title added to the calendar', () => {
    const changes = diff(snapshot([[1, 'Wicked', '2026-09-01']]), [
      title(1, 'Wicked', '2026-09-01'),
      title(2, 'Dune 3', '2026-10-01'),
    ])
    assert.equal(changes.length, 1)
    assert.equal(changes[0]?.kind, 'new')
    assert.equal(changes[0]?.id, 2)
  })

  it('finds a release date that moved, and carries both dates', () => {
    const changes = diff(snapshot([[1, 'Wicked', '2026-09-01']]), [
      title(1, 'Wicked', '2026-11-20'),
    ])
    assert.equal(changes.length, 1)
    const change = changes[0]
    assert.equal(change?.kind, 'date-changed')
    if (change?.kind === 'date-changed') {
      assert.equal(change.from, '2026-09-01')
      assert.equal(change.to, '2026-11-20')
    }
  })

  it('finds a title that dropped off', () => {
    const changes = diff(
      snapshot([
        [1, 'Wicked', '2026-09-01'],
        [2, 'Gone', '2026-09-05'],
      ]),
      [title(1, 'Wicked', '2026-09-01')],
    )
    assert.equal(changes.length, 1)
    assert.equal(changes[0]?.kind, 'removed')
    assert.equal(changes[0]?.id, 2)
  })

  it('says nothing when nothing changed', () => {
    const same = [title(1, 'Wicked', '2026-09-01')]
    assert.deepEqual(diff(snapshot([[1, 'Wicked', '2026-09-01']]), same), [])
  })

  it('treats a date appearing or disappearing as a change', () => {
    const gained = diff(snapshot([[1, 'Wicked', null]]), [title(1, 'Wicked', '2026-09-01')])
    assert.equal(gained[0]?.kind, 'date-changed')
    const lost = diff(snapshot([[1, 'Wicked', '2026-09-01']]), [title(1, 'Wicked', null)])
    assert.equal(lost[0]?.kind, 'date-changed')
  })
})
