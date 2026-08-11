/** Alert rules — which titles are worth interrupting someone for.
 *
 * Three independent triggers (any one fires):
 *   1. trending AND landing soon  — high precision, the "this is about to matter"
 *   2. high computed score        — adaptive, no list to maintain
 *   3. newly added / date moved   — the true "don't miss anything" trigger
 *
 * A title matching several reasons produces ONE alert carrying all of them, so
 * the Slack post never repeats a title.
 */
import { ALERTS } from './config.js'
import type { Alert, AlertReason, Change, Title } from './types.js'

export function build(titles: Title[], changes: Change[]): Alert[] {
  const byId = new Map(titles.map((t) => [t.id, t]))
  const reasons = new Map<number, Set<AlertReason>>()
  const changeById = new Map<number, Change>()

  const add = (id: number, reason: AlertReason) => {
    const set = reasons.get(id) ?? new Set<AlertReason>()
    set.add(reason)
    reasons.set(id, set)
  }

  for (const title of titles) {
    const daysOut = title.daysOut

    // Rule 1 — trending and imminent.
    if (
      title.trendingRank != null &&
      daysOut != null &&
      daysOut >= 0 &&
      daysOut <= ALERTS.trendingImminentDays
    ) {
      add(title.id, 'trending-and-imminent')
    }

    // Rule 2 — high computed demand.
    if (title.score >= ALERTS.scoreThreshold) add(title.id, 'high-score')
  }

  // Rule 3 — schedule churn. Windowed so a date shuffle years out stays quiet,
  // and 'removed' is skipped: it almost always just means the title released.
  for (const change of changes) {
    if (change.kind === 'removed') continue
    const title = byId.get(change.id)
    if (!title) continue
    if (title.daysOut != null && title.daysOut > ALERTS.changeWindowDays) continue

    add(change.id, change.kind === 'new' ? 'newly-added' : 'date-changed')
    changeById.set(change.id, change)
  }

  const alerts: Alert[] = []
  for (const [id, reasonSet] of reasons) {
    const title = byId.get(id)
    if (!title) continue
    const change = changeById.get(id)
    alerts.push({ title, reasons: [...reasonSet], ...(change ? { change } : {}) })
  }

  // Most urgent first: highest score, then soonest.
  return alerts.sort(
    (a, b) =>
      b.title.score - a.title.score ||
      (a.title.daysOut ?? Infinity) - (b.title.daysOut ?? Infinity),
  )
}

const REASON_LABEL: Record<AlertReason, string> = {
  'trending-and-imminent': 'trending + landing soon',
  'high-score': 'high demand score',
  'newly-added': 'new on the calendar',
  'date-changed': 'release date moved',
}

export function describe(reason: AlertReason): string {
  return REASON_LABEL[reason]
}
