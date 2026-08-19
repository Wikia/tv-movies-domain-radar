## What and why

<!-- What changes, and what problem it solves. -->

## Checks

- [ ] `npm run check` passes locally (format, lint, typecheck, test, web build)
- [ ] If buzz scoring or a signal source changed: `npm run backtest` run and the
      lift compared against the current baseline (87% vs 18% = 5.0x). CI cannot
      check this — it queries Wikipedia live.
- [ ] If a signal was added or changed: both dashboards updated (`src/artifact.ts`
      and `web/src`), plus the hand-written mirror in `web/src/types.ts`.
