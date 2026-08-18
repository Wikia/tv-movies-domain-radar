import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { ROOT, SIGNALS } from './config.js'

const DIR = path.join(ROOT, 'data', 'signals')

type Reading = Record<string, number>

type Series = Record<string, Reading>

export type SignalStore = Record<string, Series>

type SourceName = 'news' | 'youtube' | 'tmdb'

function file(source: SourceName): string {
  return path.join(DIR, `${source}.json`)
}

export async function load(source: SourceName): Promise<SignalStore> {
  const raw = await readFile(file(source), 'utf8').catch(() => '{}')
  try {
    return JSON.parse(raw) as SignalStore
  } catch {
    process.stderr.write(`[store] ${source}.json unreadable — starting fresh\n`)
    return {}
  }
}

export async function save(
  source: SourceName,
  store: SignalStore,
  readings: SignalStore,
  today: Date,
): Promise<void> {
  for (const [id, series] of Object.entries(readings)) {
    store[id] = { ...(store[id] ?? {}), ...series }
  }
  prune(store, today)
  await mkdir(DIR, { recursive: true })
  await writeFile(file(source), JSON.stringify(store, null, 2))
}

function prune(store: SignalStore, today: Date): void {
  const cutoff = isoDay(new Date(today.getTime() - SIGNALS.keepDays * 86_400_000))
  for (const [id, series] of Object.entries(store)) {
    for (const day of Object.keys(series)) {
      if (day < cutoff) delete series[day]
    }
    if (Object.keys(series).length === 0) delete store[id]
  }
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// Returns only the days that exist. Never fills a gap with zero.
export function series(
  store: SignalStore,
  titleId: number,
  metric: string,
): { dates: string[]; values: number[] } | null {
  const found = store[String(titleId)] ?? {}
  const dates = Object.keys(found)
    .filter((day) => typeof found[day]?.[metric] === 'number')
    .sort()
  if (dates.length < SIGNALS.minHistoryDays) return null
  return { dates, values: dates.map((day) => found[day]![metric]!) }
}

export function mature(store: SignalStore, metric: string): number {
  return Object.keys(store).filter((id) => series(store, Number(id), metric) !== null).length
}

