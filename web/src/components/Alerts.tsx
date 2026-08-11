import { REASON_LABEL, REASON_TONE, formatCountdown, formatDate } from '../lib/format'
import type { Alert } from '../types'
import { Poster } from './Poster'
import { Empty, Section, Tag } from './Primitives'

/** The bulletin: what would have been missed. Poster-led, because a wall of
 * artwork is scannable in a way a table of titles isn't. */
export function Alerts({ alerts }: { alerts: Alert[] }) {
  return (
    <Section title="Bulletin" aside="what would have been missed">
      {alerts.length === 0 ? (
        <Empty>
          Nothing meets an alert rule. On a first run this is expected — the diff baseline was just
          established.
        </Empty>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-[18px] gap-y-[22px]">
          {alerts.map((alert) => (
            <a
              key={alert.title.id}
              href={alert.title.url}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-2.5"
            >
              <Poster title={alert.title} className="rounded-[10px] shadow-poster" />

              <div className="text-[13.5px] leading-tight font-[550] text-pretty group-hover:text-signal">
                {alert.title.title}
              </div>
              <div className="figure -mt-1.5 text-xs text-ink-3">
                {formatDate(alert.title.releaseDate)} · {formatCountdown(alert.title.daysOut)}
              </div>

              {alert.change?.kind === 'date-changed' && (
                <div className="figure -mt-1.5 text-[11px] text-ink-3">
                  <s className="opacity-70">{formatDate(alert.change.from ?? null)}</s> →{' '}
                  {formatDate(alert.change.to ?? null)}
                </div>
              )}

              <div className="flex flex-wrap gap-1">
                {alert.reasons.map((reason) => (
                  <Tag key={reason} tone={REASON_TONE[reason]}>
                    {REASON_LABEL[reason]}
                  </Tag>
                ))}
              </div>
            </a>
          ))}
        </div>
      )}
    </Section>
  )
}
