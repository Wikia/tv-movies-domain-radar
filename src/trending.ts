/** Tie trending Fandom wikis to the release calendar.
 *
 * Two outputs, and the second matters as much as the first:
 *
 *   matched  — upcoming titles whose wiki is trending. Small by construction:
 *              the export measures what our audience is reading NOW, and most
 *              of what's hot now is catalog, not unreleased.
 *   unmapped — trending wikis with no upcoming release behind them. This is the
 *              "are we missing something?" list, and for TV/film it is arguably
 *              the more valuable half: a back-catalog show surging on a
 *              streamer is invisible to a release calendar by construction.
 *
 * Matching is deliberately STRICT. A false tie is worse than a miss, because it
 * attributes real audience heat to the wrong title and nothing downstream would
 * catch it. Whatever we can't tie confidently falls through to `unmapped` for a
 * human rather than being guessed at.
 */
import { TRENDING } from './config.js'
import type { Title, TitleTrend, TrendingReport, TrendingWiki, WikiMatch } from './types.js'

/** Normalize to a comparison key: lower-case, alphanumerics only.
 * "Godzilla x Kong: Supernova" -> "godzillaxkongsupernova" */
function key(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

interface Candidate {
  on: TitleTrend['matchedOn']
  key: string
}

/** The keys a wiki can be matched on.
 *
 * The domain leads because the export's labels are noisy in ways the domain is
 * not: this sheet has `frozen.fandom.com` — a film wiki — carrying an
 * installment label of "Disney Infinity", a video game. The domain is what the
 * wiki actually is.
 */
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

/** Does a title key tie to a wiki key, and how confidently?
 *
 * `exact` is the whole key matching. `franchise` is one key PREFIXING the other,
 * which is how sequels tie to their hub ("Godzilla" -> "Godzilla x Kong:
 * Supernova") — but only above `minPrefixKey`, and only as a prefix.
 *
 * Both restrictions come from real false positives in the live export:
 *  - free substring matching tied "The Musical" to sixthemusical.fandom.com —
 *    contained, but not a prefix, so a coincidence of wording rather than a
 *    franchise;
 *  - a 4-character key let franchise "Coco" claim "Cocomelon: The Movie".
 */
function strength(titleKey: string, wikiKey: string): WikiMatch | null {
  if (titleKey === wikiKey) return 'exact'
  const min = TRENDING.minPrefixKey
  if (wikiKey.length >= min && titleKey.startsWith(wikiKey)) return 'franchise'
  if (titleKey.length >= min && wikiKey.startsWith(titleKey)) return 'franchise'
  return null
}

/** Prefer an exact tie over a franchise one, then the biggest audience — so a
 * broad franchise attaches to the real hub rather than to whichever small fan
 * wiki happened to come first in the export. */
function better(a: TitleTrend, b: TitleTrend | null): boolean {
  if (!b) return true
  if (a.match !== b.match) return a.match === 'exact'
  return a.pageviews14d > b.pageviews14d
}

/** Attach the first-party signal to every title we can tie, and report the rest.
 *
 * Mutates `titles` (setting `.trend`), mirroring how the pipeline already fills
 * in `.daysOut` and `.poster`.
 */
export function attach(titles: Title[], wikis: TrendingWiki[]): TrendingReport {
  const mapped = new Set<string>()
  // Built once, not once per title: this loop is titles x wikis, and rebuilding
  // the key list inside it allocated ~12,000 throwaway arrays per run.
  const searchable = wikis.map((wiki) => ({ wiki, keys: candidates(wiki) }))

  for (const title of titles) {
    const titleKey = key(title.title)
    // An empty or near-empty key is a substring of everything. Without this
    // guard a title that normalizes to "" (an all-non-ASCII name, say) matches
    // every wiki and silently steals the highest-traffic one — the exact bug
    // the gaming radar shipped and had to fix.
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

/** Is this title's wiki signal newsworthy *today*?
 *
 * Only a change qualifies. A wiki trending at a steady level is a standing
 * fact — true again next week, and next week — so alerting on it would produce
 * the same list every run until people stopped reading it. A wiki that has just
 * appeared in trending, or has climbed measurably, is news.
 */
export function isNewsworthy(trend: TitleTrend): boolean {
  return trend.isNew || trend.velocity >= TRENDING.velocityAlert
}
