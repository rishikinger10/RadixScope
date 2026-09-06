# Feature 4 — Back-to-back comparison runner

## Purpose
Run the identical multi-agent workload twice in immediate succession — once with raw/unstructured prompts, once with normalized prompts — under fixed task inputs and fixed generation settings, and confirm both runs produce the required task result. This is the controlled comparison the whole demo is built around.

## Inputs
- `runWorkload(promptOrder)` from F2.
- `normalize()` from F3, applied when constructing the "normalized" run's prompts.
- Fixed task inputs and fixed generation settings (temperature, max tokens, etc.), identical across both runs.
- A run id (generated per demo click) to key results in Redis.

## Outputs
- Two sets of per-request results (raw and normalized), each containing the agent responses, timing metadata from F2, and a correctness pass/fail flag — written to Redis under the run id for F5 to read and F6 to poll.
- A single top-level status field (`pending` / `running-raw` / `running-normalized` / `done` / `error`) so the dashboard can show progress without guessing.

## Minimum implementation needed for the demo
One Express endpoint (`POST /run-demo`) that: creates a run id, runs the raw workload, runs the normalized workload, writes both results plus status to Redis, and returns the run id immediately so the dashboard can poll `/results/:runId`.

## Implementation steps
1. Implement `POST /run-demo`: generate a run id, set status `running-raw`, call `runWorkload('raw')`, store its results under `run:<id>:raw`.
2. Update status to `running-normalized`, call `runWorkload('normalized')` (using `normalize()`-reordered prompts internally), store results under `run:<id>:normalized`.
3. Run F2's correctness assertion against both runs' combined output; store a boolean `correct` flag per run.
4. Set status `done` (or `error` with a short message if either run threw or failed correctness) and store a `completedAt` timestamp.
5. Implement `GET /results/:runId` returning current status plus whatever raw/normalized data exists so far (partial results while `running-*`).
6. Keep the whole endpoint synchronous internally (raw then normalized, no parallelism) so timing comparisons aren't muddied by concurrent load on the same SGLang instance.

## Acceptance check
- Calling `POST /run-demo` once returns a run id, and polling `GET /results/:runId` shows status progressing from `running-raw` → `running-normalized` → `done`.
- Both `raw` and `normalized` results carry a `correct: true` flag under fixed task inputs.
- Task inputs and generation settings are provably identical between the two runs (same config object used for both).
- Total time for both runs together fits inside the 90-second demo budget on the target hardware.

## Skip this
Any parallel/concurrent run execution, run history beyond the current run id, or retry/resume logic — one run id, one sequential pass, done.

## Fallback if Day 0 verification fails
Not applicable directly — this feature only orchestrates calls into F2/F3/F1 and doesn't itself depend on the three unverified capabilities. If F1's fallback mock server is in use (GPU unavailable during dev), this runner works unchanged against the mock, since it only depends on F2's interface.
