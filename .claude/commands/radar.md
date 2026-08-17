---
description: Regenerate the TV & movies release calendar (schedule + what changed)
---

Regenerate the release radar. All commands run from the repo root.

## Steps

1. **Refresh the first-party trending signal.** Pull the latest
   **"Trending Data Workbook"** sheet via the Google Drive MCP:

   - Call `download_file_content` with
     `fileId=1jQ6iuOxhSnZK674t-H7MLGI74oZSpHoDfMAHZ_kPlfc` and
     `exportMimeType=text/csv`.
   - Base64-decode the returned `content` and write it verbatim to
     `data/fandom_trending.csv` (overwrite). No per-row editing —
     `src/sources/fandom.ts` tolerates the sheet's percent-formatted scores and
     mixed-case vertical labels, and filters to TV/film wikis itself.

   **If the download fails or Drive isn't connected, do NOT fall back to the
   file already on disk** — there's deliberately no committed copy, and a stale
   trending week rendered as this week's is worse than none. Either delete
   `data/fandom_trending.csv` and run without the signal (the pipeline handles
   that and says so), or ask the user to export the tab manually via
   **File → Download → Comma-separated values** and give you the path. Say which
   of the two you did, and note the file's `trending_week` in your summary so
   the user knows how fresh the signal is.

2. **Run the pipeline.** No keys, no setup, no VPN — it reads the public
   neutron-api endpoint directly:

   ```bash
   npm install   # first time only
   npm run radar
   ```

   Flags: `--horizon N` (forward window, default 90), `--top N` (rows to print),
   `--today YYYY-MM-DD` (pin the date to reproduce a past run — this deliberately
   does **not** write a snapshot, so it can't corrupt the diff history).

3. **Read the run header before trusting the output.** It prints:

   ```
   [fetch]  N upcoming movies / M upcoming shows
   [diff]   vs YYYY-MM-DD: A new, B date changes, C dropped off
   [trend]  week YYYY-MM-DD: W trending TV/film wikis, M tied to titles, U unmapped
   [buzz]   R/N titles resolved to a Wikipedia article, S scored, P spiking
   [alert]  K titles changed inside the alert window
   [poster] X/Y titles have display art
   ```

   The diff line names the day it compared against — always a **previous** day,
   so re-running is idempotent and won't erase the day's changes. If it says
   "no previous snapshot", this is the first run on record: it establishes the
   baseline and legitimately reports nothing.

   The `[trend]` line names the export's week. If it says "no first-party
   export", the wiki signal is absent from this run — say so rather than
   implying nothing is trending.

4. **Report the results.** Everything lands in `out/radar.json`. Lead with:
   - **What changed** (`changes` / `alerts`) — titles added to the calendar or
     whose date moved. This is the point of the tool and the one signal the
     upstream API doesn't expose.
   - **What's hot on our own wikis** (`trending`) — both the titles tied to a
     trending wiki *and* `trending.unmapped`, the hot wikis with no upcoming
     release behind them. The second list is where a back-catalog surge shows
     up, and it's easy to forget because it isn't about the calendar.
   - **What's spiking** (`titles[].buzz`, `buzz` coverage) — Wikipedia attention
     that has broken away from a title's own normal. Quote the movement
     (`baseline` → `recent`) rather than just the points; "3.1k → 32k views/day"
     lands where "100 points" doesn't.
   - **What's landing soon** from `titles`, which is chronological.

   Outputs also include `out/dashboard.html` (self-contained) and
   `out/dashboard.artifact.html` (publishable as a shareable Artifact). Offer to
   publish the latter if the user wants a link to share.

## Caveats to carry into any summary

- **There is no demand or popularity score, on purpose.** It was built and
  removed: the popularity signal covered 32 of 233 titles and no TV at all, and
  the *upstream* trending feed never intersected the release calendar. Don't
  present the ordering as anything other than chronological, and don't
  reintroduce a score. The first-party wiki signal is attached evidence, not a
  ranking — don't describe it as one.
- **Most wiki ties are franchise-level, not title-level.** "franchise hot" means
  the franchise hub is drawing an audience, which is not the same claim as this
  specific title being hot. Keep that distinction in any summary.
- **Buzz coverage is partial and must be stated.** Roughly 150 of 211 titles
  resolve to a Wikipedia article and ~138 score. A title with no `buzz` has no
  signal, not a low one — never present the scored set as if it were the whole
  calendar, and never rank the schedule by points.
- **A cold first run under-resolves** (~89) because failed lookups are retried
  rather than cached; a second run converges to ~150. If the `[buzz]` line looks
  low, re-run before drawing conclusions.
- **Few wiki matches is the expected result**, not a bug. The export measures what
  our audience reads *now*, which is mostly catalog; a handful of ties out of
  200+ upcoming titles is normal. A title with no tag has **no signal**, which
  is not the same as being cold.
- **`MC` is the Metascore**, and most upcoming titles have none. That's normal
  before release, not missing data.
- The first run of a **new day** diffs against the previous day and will report
  changes; only a run with no earlier day on record reports nothing.

$ARGUMENTS
