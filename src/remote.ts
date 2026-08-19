import { SCRIPTLR } from './config.js'
import { sleep } from './pool.js'

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

// Pandora is secure-by-default: every route is blocked unless it carries this
// header, except the handful annotated @PublicResource. The retrieve endpoint is
// public; registering an app and uploading are not, so without it every write
// 403s. The filter only checks the header is present, not its value.
function headers(): Record<string, string> {
  return {
    'X-Wikia-Internal-Request': '1',
    ...(SCRIPTLR.token ? { Authorization: `Bearer ${SCRIPTLR.token}` } : {}),
  }
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

// Objects are write-once in the deployed bucket: re-POSTing a path that already
// exists returns a 500, not a 200 or a 409. Verified against the live service —
// the code has no precondition, so this is the bucket's or the service account's
// doing, and it cannot be worked around from here.
//
// So a day's snapshot is written once. A second run on the same date leaves the
// published copy alone and says so, rather than failing a build that did nothing
// wrong. Returns true when it actually wrote.
export async function put(
  folder: string,
  version: string,
  filename: string,
  body: unknown,
): Promise<boolean> {
  const existing = await get(folder, filename, version)
  if (existing.kind === 'found') return false

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
      return true
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

