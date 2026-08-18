import { ALERTS } from './config.js'
import { isNewsworthy } from './trending.js'
import type { Alert, AlertReason, Change, Title } from './types.js'

export function build(titles: Title[], changes: Change[]): Alert[] {
  const byId = new Map(titles.map((t) => [t.id, t]))
  const reasons = new Map<number, Set<AlertReason>>()
  const changeById = new Map<number, Change>()

  for (const change of changes) {
    if (change.kind === 'removed') continue

    const title = byId.get(change.id)
    if (!title) continue
    if (title.daysOut != null && title.daysOut > ALERTS.changeWindowDays) continue

    const set = reasons.get(change.id) ?? new Set<AlertReason>()
    set.add(change.kind === 'new' ? 'newly-added' : 'date-changed')
    reasons.set(change.id, set)
    changeById.set(change.id, change)
  }

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

  return alerts.sort((a, b) => (a.title.daysOut ?? Infinity) - (b.title.daysOut ?? Infinity))
}
