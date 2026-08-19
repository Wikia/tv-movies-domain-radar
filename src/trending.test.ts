import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { attach } from './trending.js'
import type { Title, TrendingWiki } from './types.js'

function title(name: string, id = 1): Title {
  return {
    id,
    type: 'movie',
    title: name,
    slug: name.toLowerCase().replace(/\W+/g, '-'),
    url: '',
    releaseDate: '2026-09-01',
    daysOut: 20,
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

function wiki(domain: string, extra: Partial<TrendingWiki> = {}): TrendingWiki {
  return {
    domain,
    name: domain,
    week: '2026-08-16',
    trendingScore: 0.9,
    priorScore: 0.5,
    velocity: 0.4,
    isNew: false,
    fpScore: 0.9,
    pageviews14d: 5000,
    tier: 'a',
    vertical: 'movies',
    genres: [],
    franchise: '',
    installment: '',
    ...extra,
  }
}

describe('attach', () => {
  it('ties a title to its own wiki on an exact domain match', () => {
    const titles = [title('Wicked')]
    const report = attach(titles, [wiki('wicked.fandom.com')])
    assert.equal(report.matched, 1)
    assert.equal(titles[0]?.trend?.match, 'exact')
    assert.equal(titles[0]?.trend?.matchedOn, 'domain')
  })

  it('matches a franchise hub by prefix, and says so rather than claiming the title', () => {
    const titles = [title('Godzilla x Kong: Supernova')]
    const report = attach(titles, [wiki('godzilla.fandom.com')])
    assert.equal(report.matched, 1)
    assert.equal(titles[0]?.trend?.match, 'franchise', 'a hub is weaker evidence than a title wiki')
  })

  it('refuses a short prefix — "Coco" must not claim "Cocomelon: The Movie"', () => {
    const titles = [title('Cocomelon: The Movie')]
    const report = attach(titles, [wiki('x.fandom.com', { franchise: 'Coco' })])
    assert.equal(report.matched, 0)
    assert.equal(titles[0]?.trend, undefined)
  })

  it('refuses a coincidence of wording — "The Musical" is not sixthemusical', () => {
    const titles = [title('The Musical')]
    const report = attach(titles, [wiki('sixthemusical.fandom.com')])
    assert.equal(report.matched, 0, 'contained is not the same as matching')
  })

  it('prefers an exact wiki over a franchise hub for the same title', () => {
    const titles = [title('Wicked')]
    attach(titles, [
      wiki('wickedfranchise.fandom.com', { franchise: 'Wicked' }),
      wiki('wicked.fandom.com'),
    ])
    assert.equal(titles[0]?.trend?.match, 'exact')
  })

  it('reports wikis with nothing upcoming behind them as unmapped', () => {
    const report = attach(
      [title('Wicked')],
      [wiki('wicked.fandom.com'), wiki('someothershow.fandom.com')],
    )
    assert.equal(report.matched, 1)
    assert.equal(report.unmappedTotal, 1)
  })

  it('ignores wikis from other verticals', () => {
    const report = attach([title('Wicked')], [wiki('wicked.fandom.com', { vertical: 'games' })])
    assert.equal(report.wikis, 1, 'still counted as trending')
  })
})
