/** Alert rules — which titles are worth interrupting someone for.
 *
 * Both rules come from diffing against the previous snapshot, which is the one
 * signal no upstream API exposes. Two earlier rules were removed along with the
 * scoring they depended on: `high-score` ranked on a demand signal covering
 * 32 of 233 titles and no TV, and `trending-and-imminent` never fired once,
 * because the trending feed measures what people watch NOW and so never
 * intersected the release calendar.
 *
 * A title matching both reasons produces ONE alert carrying both, so a title
 * never appears twice.
 */
import { ALERTS } from './config.js'
import type { Alert, AlertReason, Change, Title } from './types.js'

export function build(titles: Title[], changes: Change[]): Alert[] {
  const byId = new Map(titles.map((t) => [t.id, t]))
  const reasons = new Map<number, Set<AlertReason>>()
  const changeById = new Map<number, Change>()

  for (const change of changes) {
    // 'removed' is recorded for the audit trail but never alerts: it almost
    // always just means the title released and fell out of "coming soon".
    if (change.kind === 'removed') continue

    const title = byId.get(change.id)
    if (!title) continue
    if (title.daysOut != null && title.daysOut > ALERTS.changeWindowDays) continue

    const set = reasons.get(change.id) ?? new Set<AlertReason>()
    set.add(change.kind === 'new' ? 'newly-added' : 'date-changed')
    reasons.set(change.id, set)
    changeById.set(change.id, change)
  }

  const alerts: Alert[] = []
  for (const [id, reasonSet] of reasons) {
    const title = byId.get(id)
    if (!title) continue
    const change = changeById.get(id)
    alerts.push({ title, reasons: [...reasonSet], ...(change ? { change } : {}) })
  }

  // Soonest first: an alert about something landing next week matters more than
  // one about something a year out.
  return alerts.sort((a, b) => (a.title.daysOut ?? Infinity) - (b.title.daysOut ?? Infinity))
}

const REASON_LABEL: Record<AlertReason, string> = {
  'newly-added': 'new on the calendar',
  'date-changed': 'release date moved',
}

export function describe(reason: AlertReason): string {
  return REASON_LABEL[reason]
}
