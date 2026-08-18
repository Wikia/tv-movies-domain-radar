/** Alert rules — which titles are worth interrupting someone for.
 *
 * Two rules come from diffing against the previous snapshot, which is the one
 * signal no upstream API exposes. The third, `wiki-trending`, comes from the
 * first-party export: our own audience turning up for a title.
 *
 * Every rule is a CHANGE, deliberately. An earlier `high-score` rule ranked on
 * a demand signal covering 32 of 233 titles and no TV, and was removed with the
 * scoring it depended on; an earlier `trending-and-imminent` used the upstream
 * trending feed, which measures what people watch NOW and so never intersected
 * the release calendar at all. The first-party export succeeds where that one
 * failed because it is keyed on wikis, which exist long before a release does.
 *
 * A title matching several reasons produces ONE alert carrying all of them, so
 * a title never appears twice.
 */
import { ALERTS } from './config.js'
import { isNewsworthy } from './trending.js'
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

  // The wiki signal is independent of the snapshot diff: a title already on the
  // calendar, unmoved, can still be the thing whose audience just showed up.
  // Same alert window as the date rules — heat around a release three years out
  // isn't actionable yet.
  for (const title of titles) {
    if (!title.trend || !isNewsworthy(title.trend)) continue
    if (title.daysOut != null && title.daysOut > ALERTS.changeWindowDays) continue
    const set = reasons.get(title.id) ?? new Set<AlertReason>()
    set.add('wiki-trending')
    reasons.set(title.id, set)
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
  'wiki-trending': 'wiki trending on Fandom',
}

export function describe(reason: AlertReason): string {
  return REASON_LABEL[reason]
}
