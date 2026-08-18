import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ROOT, TRENDING } from '../config.js'
import type { TrendingWiki } from '../types.js'

const TRENDING_CSV = path.join(ROOT, 'data', 'fandom_trending.csv')

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
        field += '"'
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

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

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

function fromDomain(domain: string): string {
  return domain
    .replace('.fandom.com', '')
    .replace(/-/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function fpScore(trending: number, velocity: number, isNew: boolean): number {
  const score = 0.85 * trending + 0.15 * velocity + (isNew ? 0.05 : 0)
  return Math.round(Math.min(1, score) * 1e4) / 1e4
}

function isOurs(vertical: string): boolean {
  return (TRENDING.verticals as readonly string[]).includes(vertical.trim().toLowerCase())
}

export async function load(file = TRENDING_CSV): Promise<TrendingWiki[]> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return []

  const [header, ...records] = parseCsv(text)
  if (!header) return []
  const col = new Map(header.map((name, i) => [name.trim(), i]))
  const get = (record: string[], name: string): string => record[col.get(name) ?? -1] ?? ''

  const wikis: TrendingWiki[] = []
  for (const record of records) {
    if (record.length < header.length) continue
    const vertical = get(record, 'vertical_labels')
    if (!isOurs(vertical)) continue

    const domain = get(record, 'wiki_domain').trim()
    if (!domain) continue

    const trendingScore = num(get(record, 'trending_score'))
    const prior = num(get(record, 'prior_week_trending_score'))
    const week = get(record, 'trending_week').trim()
    const firstWeek = get(record, 'first_trending_week_8w').trim()

    const velocity =
      prior > 0 ? Math.round(Math.max(0, trendingScore - prior) * 1e4) / 1e4 : 0
    const isNew = week !== '' && week === firstWeek

    const installment = get(record, 'installment_title_labels').trim().replace(/_/g, ' ')
    const franchise = get(record, 'franchise_labels').trim().replace(/_/g, ' ')

    const slug = domain.replace('.fandom.com', '')
    const sameThing = (a: string, b: string): boolean =>
      a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
    const name = franchise && sameThing(franchise, slug) ? franchise : fromDomain(domain) || franchise

    wikis.push({
      domain,
      name,
      week,
      trendingScore,
      priorScore: prior > 0 ? prior : null,
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
