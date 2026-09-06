# Feature 6 — Live React dashboard

## Purpose
Give the 90-second demo a single, driveable surface: one **Run Demo** button, numeric metrics for both runs, one chart comparing them, and a diagnostics panel explaining the result in plain language.

## Inputs
- `POST /run-demo` and `GET /results/:runId` from F4.
- The metric objects and diagnostic strings from F5.

## Outputs
- A React app (Chart.js for the chart) with:
  - One **Run Demo** button.
  - A numeric metrics panel showing TTFT, tokens/second, and cache-hit signal for both the raw and normalized runs, side by side.
  - One chart comparing raw vs normalized (e.g. grouped bars for TTFT and tokens/second).
  - A diagnostics panel showing F5's plain-language explanation and the divergence-offset/section detail.
  - A correctness confirmation ("both runs produced the required result") or a clear error state if either run failed.

## Minimum implementation needed for the demo
One page, one button, one poll loop, one chart. No routing, no auth, no historical run browser.

## Implementation steps
1. Build the page shell: title, **Run Demo** button, empty metrics panel, empty chart, empty diagnostics panel.
2. On click, call `POST /run-demo`, store the returned run id, and disable the button while a run is in progress.
3. Poll `GET /results/:runId` on a short interval; update a status label (`Running raw…`, `Running normalized…`, `Done`) as the status field changes.
4. When both raw and normalized results are present, render the metrics panel (two columns or two rows: raw vs normalized) and populate the Chart.js chart with TTFT and tokens/second for both.
5. Render F5's diagnostic text and divergence/section detail in the diagnostics panel.
6. Render the correctness confirmation; if either run's `correct` flag is false or status is `error`, show a clear error message instead of partial/misleading numbers, and re-enable the **Run Demo** button.
7. Re-enable the button after a completed or errored run so the demo can be re-run live if needed.

## Acceptance check
- Clicking **Run Demo** once, with no other interaction, results in the full metrics panel, chart, and diagnostics panel populating automatically within the 90-second budget.
- The chart clearly shows a visual difference between raw and normalized runs on at least one metric (TTFT or tokens/second).
- An error in either run surfaces as a visible error state, not a silent hang or stale/partial numbers.
- The button can be clicked again after a run completes without a page reload.

## Skip this
Any settings/configuration UI, run history list, or user accounts. A router-vs-engine comparison view or a literal cache-tree visualization is optional and only worth adding after this page fully works end-to-end.

## Fallback if Day 0 verification fails
Not applicable — the dashboard only consumes F5's already-normalized output shape and doesn't know or care whether fast-path or fallback metrics produced it.
