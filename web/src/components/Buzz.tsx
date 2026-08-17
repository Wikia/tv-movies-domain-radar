import { compact } from '../lib/format'
import type { RadarOutput, Title } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

/** Titles whose Wikipedia attention has broken away from their own normal.
 *
 * This is the only list in the app ordered by a score rather than by date, and
 * it stays defensible because of what the score measures: movement against the
 * title's own baseline, detrended against titles the same distance from
 * release. It ranks what changed, not what's famous — the schedule itself is
 * still chronological. */
export function Buzz({
  titles,
  coverage,
  total,
}: {
  titles: Title[]
  coverage: RadarOutput['buzz']
  total: number
}) {
  // Ordered by `relative`, not `points`: points clamp at 100 and several titles
  // reach it, which would make the order between them arbitrary. Rising events
  // sort above fading ones — a spike still climbing is actionable in a way the
  // tail of a finished one isn't.
  const ranked = titles
    .filter((title) => title.buzz)
    .sort(
      (a, b) =>
        Number(a.buzz!.phase !== 'rising') - Number(b.buzz!.phase !== 'rising') ||
        b.buzz!.relative - a.buzz!.relative,
    )
    .slice(0, 12)

  return (
    <Section
      title="Buzz"
      aside={coverage ? `${coverage.spiking} spiking · ${coverage.scored} measured` : 'no data'}
    >
      {!coverage || ranked.length === 0 ? (
        <Empty>
          No attention data for this run. Titles are scored from Wikipedia pageviews; one that
          isn't scored has no signal rather than a low one.
        </Empty>
      ) : (
        <>
          {ranked.map((title) => {
            const buzz = title.buzz!
            return (
              <SignalRow
                key={title.id}
                name={title.title}
                score={String(buzz.points)}
                percent={buzz.points}
                detail={`${compact(buzz.baseline)} → ${compact(buzz.recent)}/day · ${buzz.relative}× vs similar · ${buzz.momentum}× wk`}
                title={`${buzz.baseline}/day baseline → ${buzz.recent}/day recent, cohort ${buzz.cohort}, momentum ${buzz.momentum}× week over week`}
                badges={
                  // A fading title is still elevated but its event has passed,
                  // so it gets a quiet label rather than the same badge as a
                  // live one.
                  buzz.phase === 'rising' ? (
                    <Tag tone="hot">rising</Tag>
                  ) : buzz.phase === 'fading' ? (
                    <Tag tone="muted">fading</Tag>
                  ) : null
                }
              />
            )
          })}
          {/* State coverage in the panel itself. Without it a top-12 list reads
              as "the 12 hottest titles" when it's really "of the ones we could
              measure at all". */}
          <p className="pt-2.5 text-[11px] text-ink-3">
            Measured for {coverage.scored} of {total} titles — the rest have no Wikipedia article
            or too little traffic to read.
          </p>
        </>
      )}
    </Section>
  )
}
