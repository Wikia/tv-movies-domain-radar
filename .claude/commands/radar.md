---
description: Regenerate the TV & movies release calendar (schedule + what changed)
---

Regenerate the release radar. All commands run from the repo root.

## Steps

1. **Run the pipeline.** No keys, no setup, no VPN — it reads the public
   neutron-api endpoint directly:

   ```bash
   npm install   # first time only
   npm run radar
   ```

   Flags: `--horizon N` (forward window, default 90), `--top N` (rows to print),
   `--today YYYY-MM-DD` (pin the date to reproduce a past run — this deliberately
   does **not** write a snapshot, so it can't corrupt the diff history).

2. **Read the run header before trusting the output.** It prints:

   ```
   [fetch]  N upcoming movies / M upcoming shows
   [diff]   vs YYYY-MM-DD: A new, B date changes, C dropped off
   [alert]  K titles changed inside the alert window
   [poster] X/Y titles have display art
   ```

   The diff line names the day it compared against — always a **previous** day,
   so re-running is idempotent and won't erase the day's changes. If it says
   "no previous snapshot", this is the first run on record: it establishes the
   baseline and legitimately reports nothing.

3. **Report the results.** Everything lands in `out/radar.json`. Lead with:
   - **What changed** (`changes` / `alerts`) — titles added to the calendar or
     whose date moved. This is the point of the tool and the one signal the
     upstream API doesn't expose.
   - **What's landing soon** from `titles`, which is chronological.

   Outputs also include `out/dashboard.html` (self-contained) and
   `out/dashboard.artifact.html` (publishable as a shareable Artifact). Offer to
   publish the latter if the user wants a link to share.

## Caveats to carry into any summary

- **There is no demand or popularity score, on purpose.** It was built and
  removed: the popularity signal covered 32 of 233 titles and no TV at all, and
  the trending feed never intersected the release calendar. Don't present the
  ordering as anything other than chronological, and don't reintroduce a score.
- **`MC` is the Metascore**, and most upcoming titles have none. That's normal
  before release, not missing data.
- The first run of a **new day** diffs against the previous day and will report
  changes; only a run with no earlier day on record reports nothing.

$ARGUMENTS
