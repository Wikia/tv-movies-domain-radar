// What happened on a run, in a shape something else can act on.
//
// The pipeline degrades rather than fails — a bad day at YouTube must not cost
// the calendar — but "degraded" and "fine" then look identical from outside, and
// a cron that quietly stops recording is indistinguishable from a quiet week.
// So every step records an outcome, and the run ends with a verdict.
export type Status = 'ok' | 'degraded' | 'failed' | 'skipped'

export interface Step {
  name: string
  status: Status
  detail: string
}

export interface RunReport {
  startedAt: string
  finishedAt: string
  seconds: number
  today: string
  published: boolean
  status: Status
  steps: Step[]
  warnings: string[]
  counts: Record<string, number>
}

export class Run {
  private readonly started = Date.now()
  private readonly startedAt = new Date().toISOString()
  readonly steps: Step[] = []
  readonly warnings: string[] = []
  readonly counts: Record<string, number> = {}

  step(name: string, status: Status, detail: string): void {
    this.steps.push({ name, status, detail })
  }

  warn(message: string): void {
    this.warnings.push(message)
  }

  count(key: string, value: number): void {
    this.counts[key] = value
  }

  // A failed step is worth waking someone for; a degraded one is worth saying
  // out loud but not worth an alarm. Anything skipped by configuration is fine.
  get status(): Status {
    if (this.steps.some((s) => s.status === 'failed')) return 'failed'
    if (this.steps.some((s) => s.status === 'degraded') || this.warnings.length > 0) {
      return 'degraded'
    }
    return 'ok'
  }

  finish(today: string, published: boolean): RunReport {
    const finishedAt = new Date().toISOString()
    return {
      startedAt: this.startedAt,
      finishedAt,
      seconds: Math.round((Date.now() - this.started) / 100) / 10,
      today,
      published,
      status: this.status,
      steps: this.steps,
      warnings: this.warnings,
      counts: this.counts,
    }
  }
}

// One line per step, plus the verdict. Whatever posts to Slack later can read
// run.json instead and format it however it likes.
export function summarise(report: RunReport): string {
  const lines = [`[run] ${report.status} in ${report.seconds}s`]
  for (const step of report.steps) {
    if (step.status !== 'ok') lines.push(`  ${step.status.padEnd(8)} ${step.name}: ${step.detail}`)
  }
  for (const warning of report.warnings) lines.push(`  warning  ${warning}`)
  return lines.join('\n')
}
