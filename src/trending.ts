import { TRENDING } from './config.js'
import type { Title, TitleTrend, TrendingReport, TrendingWiki, WikiMatch } from './types.js'

function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface Candidate {
  on: TitleTrend['matchedOn']
  key: string
}

function candidates(wiki: TrendingWiki): Candidate[] {
  const slug = wiki.domain.replace('.fandom.com', '')
  return (
    [
      { on: 'domain', key: key(slug) },
      { on: 'franchise', key: key(wiki.franchise) },
      { on: 'installment', key: key(wiki.installment) },
    ] as Candidate[]
  ).filter((c) => c.key.length >= TRENDING.minKey)
}

function strength(titleKey: string, wikiKey: string): WikiMatch | null {
  if (titleKey === wikiKey) return 'exact'
  const min = TRENDING.minPrefixKey
  if (wikiKey.length >= min && titleKey.startsWith(wikiKey)) return 'franchise'
  if (titleKey.length >= min && wikiKey.startsWith(titleKey)) return 'franchise'
  return null
}

function better(a: TitleTrend, b: TitleTrend | null): boolean {
  if (!b) return true
  if (a.match !== b.match) return a.match === 'exact'
  return a.pageviews14d > b.pageviews14d
}

export function attach(titles: Title[], wikis: TrendingWiki[]): TrendingReport {
  const mapped = new Set<string>()

  const searchable = wikis.map((wiki) => ({ wiki, keys: candidates(wiki) }))

  for (const title of titles) {
    const titleKey = key(title.title)

    if (titleKey.length < TRENDING.minKey) continue

    let best: TitleTrend | null = null
    for (const { wiki, keys } of searchable) {
      for (const candidate of keys) {
        const match = strength(titleKey, candidate.key)
        if (!match) continue
        const trend: TitleTrend = {
          domain: wiki.domain,
          name: wiki.name,
          match,
          matchedOn: candidate.on,
          fpScore: wiki.fpScore,
          trendingScore: wiki.trendingScore,
          velocity: wiki.velocity,
          isNew: wiki.isNew,
          pageviews14d: wiki.pageviews14d,
        }
        if (better(trend, best)) best = trend
      }
    }

    if (best) {
      title.trend = best
      mapped.add(best.domain)
    }
  }

  const unmapped = wikis.filter((w) => !mapped.has(w.domain))
  return {
    week: wikis[0]?.week ?? null,
    wikis: wikis.length,
    matched: titles.filter((t) => t.trend).length,
    unmapped: unmapped.slice(0, TRENDING.topUnmapped),
    unmappedTotal: unmapped.length,
  }
}

export function isNewsworthy(trend: TitleTrend): boolean {
  return trend.isNew || trend.velocity >= TRENDING.velocityAlert
}
