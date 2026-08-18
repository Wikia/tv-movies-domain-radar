import { compact } from '../lib/format'
import type { Buzz as BuzzReading, RadarOutput, Title } from '../types'
import { Empty, Section, SignalRow, Tag } from './Primitives'

/** Four steps so a 34 and a 60 don't land on the same colour — which is exactly
 * what happened when the ramp had only two coloured bands. */
const BAND_TONE = {
  exceptional: 'band1',
  strong: 'band2',
  notable: 'band3',
  quiet: 'band4',
} as const satisfies Record<BuzzReading['band'], string>

const PANEL_SIZE = 12

type ScoredTitle = Title & { buzz: BuzzReading }

const risingFirst = (title: ScoredTitle): number => (title.buzz.phase === 'rising' ? 0 : 1)

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
  // Rising events first, then by points — i.e. by the SIZE of the surge. Must
  // match `ranked()` in src/buzz.ts, which the static dashboard uses; the two
  // sorted differently for one build and the panel came out visibly unordered.
  const ranked = titles
    .filter((title): title is ScoredTitle => title.buzz != null)
    .sort(
      (a, b) => risingFirst(a) - risingFirst(b) || b.buzz.points - a.buzz.points,
    )
    .slice(0, PANEL_SIZE)

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
            const buzz = title.buzz
            return (
              <SignalRow
                key={title.id}
                name={title.title}
                score={String(buzz.points)}
                percent={buzz.points}
                tone={BAND_TONE[buzz.band]}
                detail={`+${compact(buzz.excess)}/day over normal · ${compact(buzz.baseline)} → ${compact(buzz.recent)} · ${buzz.momentum}× wk`}
                title={`+${buzz.excess}/day beyond normal for its age (${buzz.baseline} → ${buzz.recent}), cohort ${buzz.cohort}, momentum ${buzz.momentum}× week over week`}
                badges={
                  <>
                    {/* Band colour never travels without the band's name. */}
                    <Tag tone={BAND_TONE[buzz.band]}>{buzz.band}</Tag>
                    {/* A fading title is still elevated but its event has
                        passed, so it gets a quiet label. */}
                    {buzz.phase === 'rising' ? (
                      <Tag tone="hot">rising</Tag>
                    ) : buzz.phase === 'fading' ? (
                      <Tag tone="muted">fading</Tag>
                    ) : null}
                  </>
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
