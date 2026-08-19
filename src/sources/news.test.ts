import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { countItems, parseItems, tooGeneric, type Item } from './news.js'

const feed = `<?xml version="1.0"?><rss><channel>
<title>Google News</title>
<image><title>Google News</title></image>
<item><title>&#39;Animals&#39; Crime Thriller Stars Ben Affleck - Deadline</title><source url="x">Deadline</source></item>
<item><title>The End of Oak Street review - Sight &amp; Sound</title><source url="y">Sight &amp; Sound</source></item>
<item><title>Animals gets a trailer - Deadline</title><source url="x">Deadline</source></item>
</channel></rss>`

describe('parseItems', () => {
  it('reads only <item> entries, not the channel or image titles', () => {
    assert.equal(parseItems(feed).length, 3)
  })

  it('splits "Headline - Outlet" and decodes entities', () => {
    const [first, second] = parseItems(feed)
    assert.equal(first?.headline, "'Animals' Crime Thriller Stars Ben Affleck")
    assert.equal(first?.outlet, 'Deadline')
    assert.equal(second?.outlet, 'Sight & Sound')
  })

  it('is empty for a feed with no items rather than throwing', () => {
    assert.deepEqual(parseItems('<rss><channel></channel></rss>'), [])
  })
})

describe('countItems', () => {
  it('counts only headlines that name the title', () => {
    const count = countItems(parseItems(feed), 'Animals')
    assert.equal(count.articles, 3, 'everything the query returned')
    assert.equal(count.onTopic, 2, 'the review of another film does not count')
  })

  it('counts distinct outlets, so syndication is one story', () => {
    const count = countItems(parseItems(feed), 'Animals')
    assert.equal(count.onTopic, 2)
    assert.equal(count.outlets, 1, 'both on-topic pieces are Deadline')
  })

  it('ignores punctuation and case when matching', () => {
    const items: Item[] = [{ headline: 'SPIDER-MAN: BRAND NEW DAY drops a teaser', outlet: 'IGN' }]
    assert.equal(countItems(items, 'Spider-Man: Brand New Day').onTopic, 1)
  })

  it('reports zero on-topic without pretending the query was empty', () => {
    const count = countItems(parseItems(feed), 'Some Other Film')
    assert.equal(count.articles, 3)
    assert.equal(count.onTopic, 0)
    assert.equal(count.outlets, 0)
  })
})

describe('tooGeneric', () => {
  // Headline filtering rescues some single words but not common ones: for "War"
  // it keeps "A Cold War Movie…", for "Him" it keeps "…makes him the most
  // residuals". Both look exactly like hits, so the phrase must carry 2+ words.
  it('refuses single-word titles', () => {
    assert.equal(tooGeneric('War'), true)
    assert.equal(tooGeneric('Him'), true)
    assert.equal(tooGeneric('Animals'), true)
  })

  it('accepts short but distinctive phrases', () => {
    assert.equal(tooGeneric('The Deb'), false, 'the old 8-letter floor threw this away')
  })

  it('accepts ordinary multi-word titles', () => {
    assert.equal(tooGeneric('Avengers: Doomsday'), false)
  })
})
