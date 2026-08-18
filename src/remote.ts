import { SCRIPTLR } from './config.js'

// scriptlr stores files at /{appId}/{folder}/{version}/{filename}. `version` is
// a semver segment and we use the date, so `latest` resolves to the newest day.
// The regex is ^(0|[1-9]\d*) per component, so months and days must NOT be
// zero-padded: 2026.8.9, never 2026.08.09.
export function versionFor(day: string): string {
  const [year, month, date] = day.split('-')
  return `${Number(year)}.${Number(month)}.${Number(date)}`
}

export const canRead = (): boolean => SCRIPTLR.readUrl !== ''
export const canWrite = (): boolean => SCRIPTLR.writeUrl !== ''

// Three outcomes, never two. A request that failed is not a file that is absent:
// collapsing them is what would let a network blip look like "no history" and
// publish a one-day store over sixty days of readings.
export type Fetched<T> = { kind: 'found'; body: T } | { kind: 'absent' }

function url(base: string, folder: string, version: string, filename: string): string {
  return `${base.replace(/\/$/, '')}/${SCRIPTLR.appId}/${folder}/${version}/${filename}`
}

function headers(): Record<string, string> {
  return SCRIPTLR.token ? { Authorization: `Bearer ${SCRIPTLR.token}` } : {}
}

export async function get<T>(
  folder: string,
  filename: string,
  version = 'latest',
): Promise<Fetched<T>> {
  const target = url(SCRIPTLR.readUrl, folder, version, filename)
  let lastError: unknown
  for (let attempt = 1; attempt <= SCRIPTLR.retries; attempt++) {
    try {
      const res = await fetch(target, { headers: headers() })
      if (res.status === 404) return { kind: 'absent' }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return { kind: 'found', body: (await res.json()) as T }
    } catch (error) {
      lastError = error
      if (attempt < SCRIPTLR.retries) await sleep(attempt * 500)
    }
  }
  throw new Error(
    `[remote] GET ${folder}/${version}/${filename} failed: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

export async function put(
  folder: string,
  version: string,
  filename: string,
  body: unknown,
): Promise<void> {
  const target = url(SCRIPTLR.writeUrl, folder, version, filename)
  const payload = JSON.stringify(body)
  let lastError: unknown
  for (let attempt = 1; attempt <= SCRIPTLR.retries; attempt++) {
    try {
      const res = await fetch(target, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: payload,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
      return
    } catch (error) {
      lastError = error
      if (attempt < SCRIPTLR.retries) await sleep(attempt * 500)
    }
  }
  throw new Error(
    `[remote] POST ${folder}/${version}/${filename} failed: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
