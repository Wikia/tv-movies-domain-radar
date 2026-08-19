import { SCRIPTLR } from './config.js'
import { sleep } from './pool.js'

// Files live at /{appId}/{folder}/{version}/{filename}. `version` is a semver
// segment holding the date, so `latest` resolves to the newest day — and months
// and days must NOT be zero-padded: the regex is ^(0|[1-9]\d*) per component.
export function versionFor(day: string): string {
  const [year, month, date] = day.split('-')
  return `${Number(year)}.${Number(month)}.${Number(date)}`
}

export const canRead = (): boolean => SCRIPTLR.readUrl !== ''
export const canWrite = (): boolean => SCRIPTLR.writeUrl !== ''

// Three outcomes, never two: a request that failed is not a file that is absent.
type Fetched<T> = { kind: 'found'; body: T } | { kind: 'absent' }

function url(base: string, folder: string, version: string, filename: string): string {
  return `${base.replace(/\/$/, '')}/${SCRIPTLR.appId}/${folder}/${version}/${filename}`
}

// Pandora blocks every route that isn't annotated @PublicResource unless the
// request carries this header. Retrieval is public; uploading is not.
function headers(): Record<string, string> {
  return {
    'X-Wikia-Internal-Request': '1',
    ...(SCRIPTLR.token ? { Authorization: `Bearer ${SCRIPTLR.token}` } : {}),
  }
}

async function withRetries<T>(what: string, attempt: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let tries = 1; tries <= SCRIPTLR.retries; tries++) {
    try {
      return await attempt()
    } catch (error) {
      lastError = error
      if (tries < SCRIPTLR.retries) await sleep(tries * 500)
    }
  }
  throw new Error(
    `[remote] ${what} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
}

export async function get<T>(
  folder: string,
  filename: string,
  version = 'latest',
): Promise<Fetched<T>> {
  const target = url(SCRIPTLR.readUrl, folder, version, filename)
  return withRetries(`GET ${folder}/${version}/${filename}`, async () => {
    const res = await fetch(target, { headers: headers() })
    if (res.status === 404) return { kind: 'absent' as const }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { kind: 'found' as const, body: (await res.json()) as T }
  })
}

// Unconditional write. Callers that have already established the slot is free
// use this; everything else uses put(), which checks first.
export async function post(
  folder: string,
  version: string,
  filename: string,
  body: unknown,
): Promise<void> {
  const target = url(SCRIPTLR.writeUrl, folder, version, filename)
  const payload = JSON.stringify(body)
  await withRetries(`POST ${folder}/${version}/${filename}`, async () => {
    const res = await fetch(target, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: payload,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  })
}

// Objects are write-once in the deployed bucket — re-POSTing an existing path
// returns a 500, verified against the live service — so a day's snapshot is
// written once and a second run leaves it alone. True when it actually wrote.
export async function put(
  folder: string,
  version: string,
  filename: string,
  body: unknown,
): Promise<boolean> {
  const existing = await get(folder, filename, version)
  if (existing.kind === 'found') return false
  await post(folder, version, filename, body)
  return true
}
