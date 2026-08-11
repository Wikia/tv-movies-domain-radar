import { REASON_LABEL, REASON_STYLE, formatCountdown, formatDate } from '../lib/format'
import type { Alert } from '../types'
import { Empty, Panel, ScoreBadge, TypeBadge } from './Primitives'

/** Alerts are the point of the tool — what would have been missed. Shown first
 * and in full, never truncated behind a "show more". */
export function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Panel
      title="Alerts"
      subtitle={
        alerts.length === 0
          ? 'Nothing meets an alert rule right now'
          : `${alerts.length} title${alerts.length === 1 ? '' : 's'} worth a look`
      }
    >
      {alerts.length === 0 ? (
        <Empty>No alerts. On a first run this is expected — the diff baseline was just set.</Empty>
      ) : (
        <ul className="divide-y divide-border">
          {alerts.map((alert) => (
            <li key={alert.title.id} className="flex gap-4 px-5 py-4">
              <div className="pt-0.5">
                <ScoreBadge title={alert.title} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={alert.title.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium hover:text-accent hover:underline"
                  >
                    {alert.title.title}
                  </a>
                  <TypeBadge type={alert.title.type} />
                </div>

                <div className="mt-1 text-sm text-muted">
                  {formatDate(alert.title.releaseDate)}
                  <span className="mx-1.5">·</span>
                  {formatCountdown(alert.title.daysOut)}
                  {alert.title.genres.length > 0 && (
                    <>
                      <span className="mx-1.5">·</span>
                      {alert.title.genres.slice(0, 3).join(', ')}
                    </>
                  )}
                </div>

                {alert.change?.kind === 'date-changed' && (
                  <div className="mt-1.5 text-sm">
                    <span className="text-muted">moved</span>{' '}
                    <span className="line-through opacity-60">
                      {formatDate(alert.change.from ?? null)}
                    </span>{' '}
                    <span className="text-muted">→</span>{' '}
                    <span className="font-medium">{formatDate(alert.change.to ?? null)}</span>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {alert.reasons.map((reason) => (
                    <span
                      key={reason}
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${REASON_STYLE[reason]}`}
                    >
                      {REASON_LABEL[reason]}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
