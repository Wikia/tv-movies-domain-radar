import { useEffect, useMemo, useState } from 'react'

import { Changes } from './components/Changes'
import { Tile } from './components/Primitives'
import { Schedule, type Filter } from './components/Schedule'
import { ThemeToggle } from './components/ThemeToggle'
import { formatTimestamp } from './lib/format'
import type { AlertReason, RadarOutput } from './types'

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

  /** Change reasons keyed by title id — lets the schedule tag and filter to
   * changed titles without a second section duplicating the same rows. */
  const reasons = useMemo(() => {
    const map = new Map<number, AlertReason[]>()
    for (const alert of data?.alerts ?? []) map.set(alert.title.id, alert.reasons)
    return map
  }, [data])

  if (state.status === 'loading') return <Centered>Loading radar…</Centered>

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="font-medium text-accent">{state.message}</p>
        {state.hint && <p className="mt-2 text-sm text-ink-2">{state.hint}</p>}
      </Centered>
    )
  }

  if (!data) return null

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
            generated {formatTimestamp(data.generatedAt)} · source: neutron-api
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-stretch gap-2.5">
          <Tile label={`Next ${data.horizonDays} days`} value={data.counts.inHorizon} />
          <Tile label="Upcoming" value={data.counts.upcoming} />
          <Tile
            label="Changed"
            value={data.counts.alerts}
            active={filter === 'changed'}
            onClick={() => toggle('changed')}
          />
          <ThemeToggle />
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
        <Changes changes={data.changes} />
      </div>

      <section className="mt-12 border-t border-line pt-5 text-[13px] leading-relaxed text-ink-2">
        <h2 className="section-label mb-2.5 text-ink">How to read this</h2>
        <p className="max-w-[74ch]">
          The full forward calendar of film and TV releases from the Metacritic catalog, in date
          order. <b className="text-ink">Changed</b> titles are ones added to the calendar or moved
          since the previous run — that comes from diffing against our own stored snapshot, and it's
          a signal the upstream API doesn't expose.
        </p>
        <p className="mt-2.5 max-w-[74ch] text-ink-3">
          <span className="figure">MC</span> is the Metascore where one exists; most titles have
          none before release, which is normal rather than missing data. This tool deliberately
          carries no demand or popularity ranking — the available signals covered too few titles,
          and none of the TV ones, to rank on honestly.
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
