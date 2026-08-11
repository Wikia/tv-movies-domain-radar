import { useEffect, useState } from 'react'

import { Alerts } from './components/Alerts'
import { StatTile } from './components/Primitives'
import { Schedule } from './components/Schedule'
import { Changes, Trending } from './components/Sidebar'
import { formatTimestamp } from './lib/format'
import type { RadarOutput } from './types'
import { hasDemandSignal } from './types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'ready'; data: RadarOutput }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

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

  if (state.status === 'loading') {
    return <Centered>Loading radar…</Centered>
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <p className="font-medium text-onair">{state.message}</p>
        {state.hint && <p className="mt-2 text-sm text-muted">{state.hint}</p>}
      </Centered>
    )
  }

  const { data } = state
  const withDemand = data.titles.filter(hasDemandSignal).length

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-7 border-t-2 border-ink pt-3.5">
        <p className="eyebrow mb-1.5 text-muted">Fandom · TV &amp; Movies domain</p>
        <h1 className="font-display text-[clamp(30px,5vw,46px)] leading-[0.96] font-bold tracking-tight uppercase">
          Release Radar
        </h1>
        <p className="figure mt-2.5 text-[11px] text-faint">
          <span className="eyebrow inline-flex items-center gap-1.5 text-onair">
            <span className="inline-block size-1.5 rounded-full bg-onair" />
            {data.counts.alerts} on watch
          </span>
          {' · '}generated {formatTimestamp(data.generatedAt)} · source: neutron-api
        </p>
      </header>

      <div className="mb-7 grid grid-cols-2 border-y border-rule lg:grid-cols-4">
        <StatTile label="Alerts" value={data.counts.alerts} hint="meet an alert rule" />
        <StatTile
          label={`Next ${data.horizonDays} days`}
          value={data.counts.inHorizon}
          hint="titles landing"
        />
        <StatTile label="Upcoming" value={data.counts.upcoming} hint="full calendar" />
        <StatTile
          label="Demand signal"
          value={
            <>
              {withDemand}
              <span className="text-faint">/{data.counts.upcoming}</span>
            </>
          }
          hint="rest are schedule-only"
        />
      </div>

      {/* Coverage is thin enough that stating it plainly is honest rather than
          apologetic — a dash means "no corroboration", not "unwanted". */}
      <p className="mb-8 border-l-2 border-onair py-1 pl-3 text-xs leading-relaxed text-muted">
        <strong className="font-semibold text-ink">Reading the scores:</strong> only {withDemand} of{' '}
        {data.counts.upcoming} upcoming titles carry a real demand signal, and no upcoming TV does —
        the upstream popularity ranking excludes unreleased shows. Titles without one show{' '}
        <span className="figure text-ink">—</span> rather than a score, because a capped number
        would invite ranking on noise.
      </p>

      <div className="grid gap-9 lg:grid-cols-[1fr_310px]">
        <div className="flex min-w-0 flex-col gap-9">
          <Alerts alerts={data.alerts} />
          <Schedule titles={data.titles} horizonDays={data.horizonDays} />
        </div>
        <aside className="flex flex-col gap-9">
          <Trending titles={data.trending} />
          <Changes changes={data.changes} />
        </aside>
      </div>
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
