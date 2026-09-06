# RadixScope — Central Implementation Plan

**Sponsor:** SGLang · **Event:** Code2Create hackathon
**Team:** 2 backend/systems developers · **Window:** 4 calendar days (~2.5–3 usable implementation days) · **Deadline:** before Tuesday

## What this is (and isn't)

RadixScope does **not** route or schedule requests — `sgl-model-gateway` already does cache-aware routing and we do not reimplement it. RadixScope shows *why* a prompt fails to benefit from prefix caching and *restructures eligible prompts* so the existing SGLang cache/router can do its job. The demo is a live, side-by-side comparison: the same multi-agent workload run once with raw/unstructured prompts and once with normalized prompts, with diagnostics explaining the difference.

## Component / request-flow overview

```
                         ┌─────────────────────────┐
                         │   React Dashboard (F6)   │
                         │  metrics + chart + diag  │
                         │   single "Run Demo" btn  │
                         └────────────┬─────────────┘
                                      │ POST /run-demo
                         ┌────────────▼─────────────┐
                         │  Express Orchestrator     │
                         │  (F2 workload driver,     │
                         │   F4 comparison runner,   │
                         │   F5 metrics aggregation) │
                         └───────┬───────────┬───────┘
                                 │           │
                    raw prompts  │           │ normalized prompts
                                 │           │ (via F3 normalizer, Python)
                                 ▼           ▼
                         ┌─────────────────────────┐
                         │   SGLang server (F1)     │
                         │  sgl-model-gateway front │
                         │  + one small model       │
                         └────────────┬─────────────┘
                                      │
                              Redis (raw/normalized
                              run results, timing,
                              cache-signal cache)
```

- The Express orchestrator sends the **planner** prompt, then **2–3 worker** prompts, to SGLang through the gateway — first with sections in original/raw order, then with the normalizer's reordered version. Same task inputs, same generation settings, both runs.
- Every request's timing (TTFT, total time, tokens), and whatever cache signal is available (fast path or fallback, see Day 0), is written to Redis keyed by run id + agent + phase (raw/normalized).
- The dashboard polls a `/results/:runId` endpoint and renders numbers, a chart, and diagnostic text once both runs complete.

## Dependency order

1. **F1 SGLang running** — everything needs a reachable endpoint.
2. **F2 Multi-agent workload** — needs F1; defines the planner/worker prompt shapes F3 will operate on.
3. **F3 Prompt normalizer** — can be coded against a fixture prompt as soon as F2's template shape is drafted, in parallel with F1/F2 finishing.
4. **F4 Comparison runner** — needs F1 + F2 + F3 wired together.
5. **F5 Metrics & diagnostics** — instrumentation starts as soon as F1 requests exist (Day 1), but the full diagnostic (cache-hit signal + divergence offset mapped to template section) needs F3's section boundaries and F4's paired runs.
6. **F6 Dashboard** — UI shell can be built any time in parallel; wiring to real data needs F5's output shape finalized.

## Ownership split

**Dev A — SGLang / Python side**
- F1: SGLang setup, gateway config, Day 0 capability verification (all three items).
- F3: Prompt normalizer (Python), including the eligibility/bypass logic.
- F5 (backend half): pulling SGLang's confirmed metrics endpoint, computing local token-prefix divergence when the divergence-offset API isn't available, mapping offsets to template sections.

**Dev B — Node/React side**
- F2: Multi-agent workload driver (Express) — planner + workers, task definition.
- F4: Back-to-back comparison runner, Redis storage of run pairs.
- F6: React dashboard, Chart.js visualization, Run Demo control, results polling.

Both developers pair for Day 0 verification, Day 2 end-to-end wiring, and Day 3 cloud integration/rehearsal.

## Day-by-day plan

### Day 0 (Friday) — Setup + capability verification
- Repo, Docker Compose skeleton (SGLang container, Redis, Express, React dev server), RunPod account created (not launched yet).
- Download/select one small local model runnable on the RTX 4060 (8 GB VRAM) for dev — a quantized ≤1–1.5B model.
- Run the **Day 0 capability checklist** (below) for all three unverified capabilities. Record command, evidence, and fast/fallback decision for each in `verification.md`.
- **Checkpoint:** SGLang server (local, small model) answers one `/generate`-style request; SGLang's metrics endpoint responds; `verification.md` committed with all three decisions made.

### Day 1 (Saturday) — Core SGLang, workload, normalization, comparison
- F1 finalized per Day 0 decisions (fast or fallback path for each capability, no redesign needed either way).
- F2: planner + 2–3 workers complete one concrete, quick task end-to-end against SGLang.
- F3: normalizer implemented against real F2 prompt templates; classification of static-vs-dynamic sections done for this workload only; unsafe/uncertain sections bypass normalization (pass through unchanged).
- F4: raw run and normalized run executable back-to-back from a single script/endpoint, same task inputs, same generation settings; correctness check that both produce the required result.
- **Checkpoint:** running one script performs raw-then-normalized workload end-to-end and prints basic per-agent timing to console; outputs match on task correctness.

### Day 2 (Sunday) — Metrics, diagnostics, dashboard, integration
- F5: cache-hit signal, TTFT, tokens/second collected for every request in both runs; divergence offset computed (fast path if verified, else local prefix comparison) and mapped to the responsible template section; all written to Redis under a run id.
- F6: dashboard built — numeric metrics panel, one chart (raw vs normalized, e.g. TTFT or tok/s bars), diagnostics text panel, single **Run Demo** button that calls the orchestrator and polls for results.
- Full local integration: click Run Demo (local/simulated SGLang) → dashboard shows complete comparison with real numbers, no manual steps in between.
- **Checkpoint:** Run Demo works start-to-finish locally, entirely from the UI.

### Day 3 (Monday) — Cloud benchmark, hardening, rehearsal, freeze
- Launch RunPod 4090 instance (~$20 budget), deploy SGLang with the demo model, point orchestrator at it via config only (no code redesign).
- Run the full comparison on cloud hardware; confirm numbers are sane and the story (raw misses cache, normalized hits it) holds.
- Harden: timeouts, retry-once on transient failure, clear error state on dashboard if a run fails (no silent hang during live demo).
- Rehearse the 90-second flow twice; record a backup video/screenshot set in case of live network issues.
- Freeze: no further feature changes after rehearsal passes twice.
- **Checkpoint:** Run Demo on the RunPod-backed deployment completes the full 90-second flow twice in a row without manual intervention.

## Day 0 capability checklist

| # | Capability to verify | How to check | Evidence to record | If unavailable → fallback |
|---|---|---|---|---|
| 1 | KV-cache tree mutation events over a message stream | Inspect SGLang server docs/source and running server for a streamed event exposing cache-tree hits/mutations; try a repeated-prefix request pair and inspect any diagnostic fields in the response/stream | Command run, raw response/log snippet, doc link or "not found" | Derive cache-hit signal from paired cold/warm TTFT comparison plus local longest-common-prefix check between successive prompts |
| 2 | No-GPU simulated cache mode | Attempt to launch the SGLang server on CPU or with any documented dry-run/simulate flag with the chosen small model | Launch command, success/failure output | Develop against the RTX 4060 GPU directly with a small quantized model; build a thin mock HTTP server (fixed-latency, canned responses) so Node/React work can proceed independently of GPU availability |
| 3 | Divergence-offset API | Check SGLang docs/metrics/source for an endpoint or field returning the token index where two requests' shared prefix ends | Command/query run, response snippet or "not found" | Tokenize both prompts locally with the model's tokenizer, find the first index where token ids diverge, map that index back to template section boundaries recorded by the normalizer |

Rule: a "no" on any row selects the fallback and changes **no other part of the plan**. Both paths feed the same F5 output shape (cache-hit signal, TTFT, tok/s, divergence offset + section), so F6 never needs to know which path was used.

## 90-second demo flow (no manual steps after click)

1. Presenter clicks **Run Demo** once.
2. Orchestrator runs the raw/unstructured workload (planner → workers) against SGLang, capturing metrics per request.
3. Orchestrator runs the identical task with normalized prompts, same inputs and generation settings, capturing the same metrics.
4. Orchestrator computes diagnostics: cache-hit signal per run, TTFT/tok-s comparison, and the divergence offset mapped to the template section responsible for the raw run's cache miss.
5. Dashboard (polling or short websocket) renders: numeric metrics table for both runs, one comparison chart, a diagnostics panel stating which section broke the shared prefix and where reuse resumed, and a correctness confirmation that both runs produced the required task result.
6. Total elapsed time from click to full dashboard render stays within ~90 seconds given the small model and quick task.

## Non-goals (explicit reminders, not for this plan)

No routing/scheduling, no distributed/multi-GPU coordination, no tenant isolation, no threat modeling, no formal data models, no OpenAPI specs, no ADRs, no architecture-consistency tooling, no vLLM baseline, no vulnerability scanning, no kernel optimization, no SGLang source changes, no production-readiness layers. A literal cache-tree visualization, scrolling event log, or router-vs-engine comparison is optional, only after the MVP fully works, and only if Day 0 verification makes it cheap.
