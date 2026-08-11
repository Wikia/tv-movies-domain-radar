---
description: Regenerate the TV & movies release radar (schedule + traction + alerts)
---

Regenerate the release radar. All commands run from the repo root.

## Steps

1. **Run the pipeline.** No keys, no setup, no VPN — it reads the public
   neutron-api endpoints directly:

   ```bash
   npm install   # first time only
   npm run radar
   ```

   Useful flags: `--horizon N` (forward window, default 90), `--top N` (rows to
   print), `--today YYYY-MM-DD` (pin the date for a reproducible run),
   `--no-trending` (schedule only).

2. **Read the run header before trusting the output.** It prints how many titles
   carry a real demand signal, e.g.
   `[score] 31/217 titles have a real demand signal`. If that ratio collapses to
   near zero, the popularity query has probably broken upstream — say so rather
   than presenting an imminence-only ranking as if it were demand.

3. **Report the results.** Everything lands in `out/radar.json`. Summarize:
   - **Alerts first** — these are the point. Group by reason
     (`newly-added`, `date-changed`, `trending-and-imminent`, `high-score`).
   - **What changed since the last run** (`changes`) — new titles on the
     calendar and moved dates are the "don't miss anything" payload.
   - **The next few weeks** from `titles`, which is chronological.

   Note the first run of the day establishes the diff baseline, so a *first ever*
   run legitimately reports zero changes. Don't describe that as "nothing
   happened" — say the baseline was established.

## Caveats to carry into any summary

- **TV has no demand signal at all** and movies only partial (~32 of ~220). A
  title without one is capped at 40, so a low score means "no corroboration",
  **not** "nobody wants this". Don't rank TV by score and imply it means demand.
- **The first-party Fandom signal is not wired yet.** If the ranking looks thin,
  that's why — it's the reserved heaviest-weight slot, not a bug.

$ARGUMENTS
