import { useEffect, useMemo, useState } from 'react'

import { Tile } from './components/Primitives'
import { Schedule, type Filter } from './components/Schedule'
import { Changes, Trending } from './components/Sidebar'
import { formatTimestamp } from './lib/format'
import type { AlertReason, RadarOutput } from './types'
import { hasDemandSignal } from './types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'ready'; data: RadarOutput }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch('/api/radar')
        const body = await response.json()
        if (cancelled) return

        if (!response.ok) {
          setState({
            status: 'error',
            message: body?.error ?? `Request failed (${response.status})`,
            hint: body?.hint,
          })
          return
        }
        setState({ status: 'ready', data: body as RadarOutput })
      } catch (error) {
        if (cancelled) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not reach the radar server.',
          hint: 'Is the server running? `npm run serve`',
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const data = state.status === 'ready' ? state.data : null

  /** Alert reasons keyed by title id — lets the schedule mark and filter to
   * alerted titles without a separate section duplicating the same rows. */
  const reasons = useMemo(() => {
    const map = new Map<number, AlertReason[]>()
    for (const alert of data?.alerts ?? []) map.set(alert.title.id, alert.reasons)
    return map
  }, [data])

  if (state.status === 'loading') return <Centered>Loading radar…</Centered>

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="font-medium text-live">{state.message}</p>
        {state.hint && <p className="mt-2 text-sm text-ink-2">{state.hint}</p>}
      </Centered>
    )
  }

  if (!data) return null
  const withDemand = data.titles.filter(hasDemandSignal).length

  /** Clicking an active tile clears it, so a tile is a toggle, not a trap. */
  const toggle = (next: Filter) => setFilter((current) => (current === next ? 'all' : next))

  return (
    <div className="mx-auto max-w-[1140px] px-7 py-10">
      <header className="mb-9 flex flex-wrap items-end gap-5">
        <div>
          <p className="mb-1.5 text-[13px] text-ink-2">Fandom · TV &amp; Movies domain</p>
          <h1 className="text-[clamp(28px,4.4vw,40px)] leading-[1.05] font-[650] tracking-tight text-balance">
            Release Radar
          </h1>
          <p className="figure mt-1.5 text-[11.5px] text-ink-3">
            <span className="inline-flex items-center gap-1.5 font-semibold text-live">
              <span className="inline-block size-[7px] rounded-full bg-live" />
              {data.counts.alerts} on watch
            </span>
            {' · '}generated {formatTimestamp(data.generatedAt)} · source: neutron-api
          </p>
        </div>

        <div className="ml-auto flex flex-wrap gap-2.5">
          <Tile
            label="Alerts"
            value={data.counts.alerts}
            active={filter === 'alerts'}
            onClick={() => toggle('alerts')}
          />
          <Tile label={`Next ${data.horizonDays} days`} value={data.counts.inHorizon} />
          <Tile label="Upcoming" value={data.counts.upcoming} />
          <Tile
            label="With demand signal"
            value={withDemand}
            active={filter === 'demand'}
            onClick={() => toggle('demand')}
          />
        </div>
      </header>

      <div className="grid items-start gap-11 lg:grid-cols-[1fr_300px]">
        <Schedule
          titles={data.titles}
          horizonDays={data.horizonDays}
          filter={filter}
          onFilter={setFilter}
          reasons={reasons}
        />
        <aside className="flex flex-col gap-10">
          <Trending titles={data.trending} />
          <Changes changes={data.changes} />
        </aside>
      </div>

      {/* Coverage is thin enough that stating it plainly is honest rather than
          apologetic — a dash means "no corroboration", not "unwanted". */}
      <section className="mt-12 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-2">
        <h2 className="section-label mb-2.5 text-ink">How to read this</h2>
        <p className="max-w-[74ch] rounded-r-lg border-l-[3px] border-signal bg-signal/10 px-3.5 py-2.5 text-ink">
          <b>
            Only {withDemand} of {data.counts.upcoming} upcoming titles carry a real demand signal,
            and no upcoming TV does
          </b>{' '}
          — the upstream popularity ranking excludes unreleased shows. Titles without one show{' '}
          <span className="figure">—</span> rather than a score: a capped number is an absence of
          evidence, not a measurement.
        </p>
        <p className="mt-2.5 max-w-[74ch]">
          A title is <b>on watch</b> if any of these fire: trending and landing within 30 days ·
          score ≥ 70 · newly added to the calendar · release date moved. The last two come from
          diffing against the previous run — a signal the upstream API doesn't expose. Click the
          Alerts tile to see just those.
        </p>
      </section>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>{children}</div>
    </div>
  )
}
