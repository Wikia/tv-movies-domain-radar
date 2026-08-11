import { REASON_LABEL, REASON_STYLE, formatCountdown, formatDate } from '../lib/format'
import type { Alert } from '../types'
import { Empty, Panel, ScoreBadge, TypeBadge } from './Primitives'

/** The bulletin: what would have been missed. First on the page, never
 * truncated behind a "show more". */
export function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Panel title="Bulletin" subtitle="what would have been missed">
      <div className="border-l-[3px] border-onair pl-3.5">
        {alerts.length === 0 ? (
          <Empty>
            No titles meet an alert rule. On a first run this is expected — the diff baseline was
            just established.
          </Empty>
        ) : (
          <ul className="divide-y divide-rule-soft">
            {alerts.map((alert) => (
              <li key={alert.title.id} className="flex gap-4 py-3">
                <ScoreBadge title={alert.title} />
                <span className="figure w-16 shrink-0 text-[13px] text-muted">
                  {formatDate(alert.title.releaseDate)}
                </span>

                <div className="min-w-0 flex-1">
                  <a
                    href={alert.title.url}
                    target="_blank"
                    rel="noreferrer"
                    className="border-b border-transparent font-medium hover:border-onair hover:text-onair focus-visible:border-onair"
                  >
                    {alert.title.title}
                  </a>

                  <div className="mt-0.5 text-[11px] text-faint">
                    {alert.title.genres.slice(0, 3).join(' · ') || '—'}
                  </div>

                  {alert.change?.kind === 'date-changed' && (
                    <div className="figure mt-1 text-[11px]">
                      <s className="text-faint">{formatDate(alert.change.from ?? null)}</s>
                      {' → '}
                      {formatDate(alert.change.to ?? null)}
                    </div>
                  )}

                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {alert.reasons.map((reason) => (
                      <span
                        key={reason}
                        className={`eyebrow border px-1.5 py-0.5 text-[9px] ${REASON_STYLE[reason]}`}
                      >
                        {REASON_LABEL[reason]}
                      </span>
                    ))}
                  </div>
                </div>

                <TypeBadge type={alert.title.type} />
                <span className="figure w-16 shrink-0 text-right text-[11px] text-faint">
                  {formatCountdown(alert.title.daysOut)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
