/** First-party signal — Fandom's own audience — from the internal trending export.
 *
 * Reads the "Auto-refreshed trending" tab of the internal Trending Data Workbook
 * (data/fandom_trending.csv), whose columns are:
 *   trending_week, wiki_domain, pageviews_14d, trending_score,
 *   prior_week_trending_score, first_trending_week_8w, traffic_tier,
 *   vertical_labels, genre_labels, theme_labels, franchise_labels,
 *   installment_type_labels, installment_title_labels
 *
 * Why this source and no other: every external option (Google Trends, Reddit,
 * YouTube, Wikipedia pageviews) measures somebody else's audience and needs keys
 * or tolerates a ToS grey area. This measures ours, weekly, for free. It is also
 * the one demand signal README.md sanctions after the old score was removed.
 *
 * The file is NOT committed and has no seeded fallback — a stale trending signal
 * presented as current is worse than none, so the /radar skill pulls it fresh
 * each run (Google Drive MCP) and stops if it can't. The pipeline itself simply
 * reports that it had no first-party signal and carries on.
 *
 * Ported from the Gaming domain's radar (gaming-domain-tools/tools/radar,
 * radar/sources/fandom.py), which solved this first.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT, TRENDING } from '../config.js'
import type { TrendingWiki } from '../types.js'

export const TRENDING_CSV = path.join(ROOT, 'data', 'fandom_trending.csv')

/** Minimal RFC-4180 reader.
 *
 * Node has no CSV parser and this repo has no runtime dependencies, so we own
 * one. It has to be quote-aware rather than a `split(',')`: `genre_labels`,
 * `theme_labels` and friends are themselves comma-separated lists *inside* a
 * quoted field ("Drama, Crime, Comedy"), and splitting naively shreds every row
 * from that column onward.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') {
        field += '"' // an escaped quote inside a quoted field
        i++
      } else quoted = false
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (c !== '\r') field += c
  }
  // Only emit a trailing record if there actually is one; the export ends with
  // CRLF, which would otherwise append a phantom empty row.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** Tolerant score parser: the committed gaming snapshots carry raw floats
 * (0.9579) but the live workbook formats trending_score as a percent string
 * ("95.79%"). Accept both so the export drops in with no transformation. */
function num(value: string | undefined): number {
  const s = (value ?? '').trim()
  if (!s) return 0
  const parsed = s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s)
  return Number.isFinite(parsed) ? parsed : 0
}

function int(value: string | undefined): number {
  const parsed = Number.parseInt((value ?? '').trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Title-case a wiki domain for display: shindo-life-rell -> Shindo Life Rell. */
function fromDomain(domain: string): string {
  return domain
    .replace('.fandom.com', '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Composite first-party signal, 0..1.
 *
 * The trend LEVEL is the core of it (0.85), with a small measurable-velocity
 * bonus (0.15) and a flat bump for a wiki appearing in trending for the very
 * first time — the strongest early signal there is, because it means an
 * audience just formed rather than merely persisting.
 */
function fpScore(trending: number, velocity: number, isNew: boolean): number {
  const score = 0.85 * trending + 0.15 * velocity + (isNew ? 0.05 : 0)
  return Math.round(Math.min(1, score) * 1e4) / 1e4
}

/** True for wikis belonging to this domain team.
 *
 * Case-insensitive because the export mixes cases for the same vertical — this
 * single sheet carries both `tv` (37 rows) and `TV` (4), `movies` (15) and
 * `Movies` (3). Matching case-sensitively would silently drop a tenth of them.
 */
function isOurs(vertical: string): boolean {
  return (TRENDING.verticals as readonly string[]).includes(vertical.trim().toLowerCase())
}

/** Load the export, filtered to this domain's wikis.
 *
 * Returns [] when the file is absent — the caller reports "no first-party
 * signal" rather than failing the run, so the calendar still regenerates.
 */
export async function load(file = TRENDING_CSV): Promise<TrendingWiki[]> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return []

  const [header, ...records] = parseCsv(text)
  if (!header) return []
  const col = new Map(header.map((name, i) => [name.trim(), i]))
  const get = (record: string[], name: string): string => record[col.get(name) ?? -1] ?? ''

  const wikis: TrendingWiki[] = []
  for (const record of records) {
    if (record.length < header.length) continue // truncated trailing line
    const vertical = get(record, 'vertical_labels')
    if (!isOurs(vertical)) continue

    const domain = get(record, 'wiki_domain').trim()
    if (!domain) continue

    const trendingScore = num(get(record, 'trending_score'))
    const prior = num(get(record, 'prior_week_trending_score'))
    const week = get(record, 'trending_week').trim()
    const firstWeek = get(record, 'first_trending_week_8w').trim()

    // A prior of exactly 0 is ambiguous — it nearly always means "absent from
    // last week's export", not a true zero — so velocity is only trusted when
    // there IS a prior week. Genuine first appearance is detected separately
    // and precisely, via first_trending_week_8w.
    const velocity =
      prior > 0 ? Math.round(Math.max(0, trendingScore - prior) * 1e4) / 1e4 : 0
    const isNew = week !== '' && week === firstWeek

    const installment = get(record, 'installment_title_labels').trim().replace(/_/g, ' ')
    const franchise = get(record, 'franchise_labels').trim().replace(/_/g, ' ')

    // Display name. The gaming radar prefers the installment title here; for
    // TV/film that is actively wrong, because the installment column is where
    // videogame tie-ins land — this sheet labels frozen.fandom.com as "Disney
    // Infinity" and camprock.fandom.com as "Disney Camp Rock: The Final Jam".
    //
    // So: use the franchise label only when it IS the same thing as the domain
    // (same normalized key), which means it's the same wiki with human
    // punctuation — devilsrejects -> "Devil's Rejects", kiminonawa -> "Kimi No
    // Na Wa.". Otherwise the de-slugged domain, which at least always names the
    // wiki you'd actually open.
    const slug = domain.replace('.fandom.com', '')
    const sameThing = (a: string, b: string): boolean =>
      a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
    const name = franchise && sameThing(franchise, slug) ? franchise : fromDomain(domain) || franchise

    wikis.push({
      domain,
      name,
      week,
      trendingScore,
      velocity,
      isNew,
      fpScore: fpScore(trendingScore, velocity, isNew),
      pageviews14d: int(get(record, 'pageviews_14d')),
      tier: get(record, 'traffic_tier').trim(),
      vertical: vertical.trim(),
      genres: get(record, 'genre_labels')
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      franchise,
      installment,
    })
  }

  return wikis.sort((a, b) => b.fpScore - a.fpScore)
}
