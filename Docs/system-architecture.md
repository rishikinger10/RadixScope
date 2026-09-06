# RadixScope — System Architecture

**Status:** Accepted for build
**Revision:** v2 — supersedes the pre-verification draft
**Scope:** Local single-node RadixScope demonstration system
**Audience:** The two developers building this in the 48-hour window
**Inputs:** `docs/architecture/sglang-integration.md` (SGLang v0.5.18 interface verification), `docs/architecture/technical-design.md` §2 (stack feasibility)
**Depends on:** The locked RadixScope product definition and the accepted confirmation of understanding.

---

## 0. What changed, and what still blocks

The previous revision of this document opened with **BLOCKER-1: the pinned SGLang version is not chosen and no verification report exists.** That blocker is **closed**. SGLang is pinned to `v0.5.18`, its interfaces have been read against the tagged source, and the stack has been assessed against the target hardware.

Two items remain open. Neither is a design problem and neither is resolved by redesign.

**BLOCKER-A — NVIDIA driver floor (`RUNTIME_PENDING`).** The pinned image is a CUDA 13 image and requires a host driver ≥ 580.65.06. GeForce parts have no forward-compatibility package, so the floor is hard. Resolution is a driver upgrade, or the CUDA 12.9 image variant whose existence for `v0.5.18` is itself unverified. See `technical-design.md` §2.2. This blocks *starting*, not the architecture.

**BLOCKER-B — effective KV page size (`RUNTIME_PENDING`).** The cold-start tolerance in §5.3 is defined as a function of the runtime page size. Until it is observed, the benchmark runner refuses to start rather than guessing a threshold. See §9 step 4. This blocks *trusting a number*, not the architecture.

Everything below is structurally stable under either outcome. No component appears or disappears depending on the answer.

---

## 1. System boundaries

RadixScope is one process group on one laptop. It has three boundaries.

### 1.1 Inside the trust boundary

The workload generator, the Express orchestrator, the SGLang client module, Redis, and the React dashboard. All on the developer's machine, on loopback interfaces.

### 1.2 The SGLang boundary

The local SGLang HTTP server is **external and read-only from an architecture standpoint**. RadixScope calls it, reads what it returns, and treats its responses as ground truth about SGLang's own cache state. RadixScope does not patch it, wrap it, fork it, or infer its internals.

This is the single most important line in the system. Data crossing it inbound is `SGLANG_NATIVE`. Data computed on the RadixScope side is `RADIXSCOPE_MEASURED` or `RADIXSCOPE_DERIVED`. The distinction lives in the data model (§8.2), not in prose on a dashboard.

Only one component is containerised: SGLang, because it alone has a hard CUDA/cuDNN/PyTorch/FlashInfer dependency chain. Express, Redis and the frontend run natively on the host. This is not a microservice split.

### 1.3 The inference-path boundary

The React frontend is **outside the inference path**. It never issues a prompt, never holds a benchmark invariant, never computes a metric. It polls, renders, and offers one button. A frontend crash mid-run must not affect a run in progress or its recorded result.

**Streaming clarification.** The no-WebSocket/no-SSE exclusion governs the frontend↔Express link, which is ordinary HTTP polling and nothing else. Express is permitted to consume SGLang's native streaming `/generate` response internally, on the Express↔SGLang link, to measure client-observed TTFT. This creates no frontend feature and no new component; it is one branch inside the existing SGLang client module.

### 1.4 Explicitly not in the system

No gateway, router, proxy service, load balancer, scheduler, microservice, second SGLang worker, cloud resource, Kubernetes, WebSocket or SSE channel to the browser, FastAPI, Next.js, cache-tree renderer, section-boundary token mapper, quantized model, or speculative decoding. Express contains an SGLang **client module** — a library of typed HTTP calls inside the orchestrator process. It is not a gateway and must not be named or diagrammed as one.

---

## 2. Component diagram

```
┌──────────────────── Developer laptop — native Ubuntu on external HDD ─────────────────────┐
│                                                                                            │
│   ┌────────────────────────────────┐                                                       │
│   │  React + Chart.js dashboard    │   OUTSIDE the inference path                          │
│   │  (Vite, port 5173)             │   HTTP polling only — no SSE, no WebSocket            │
│   └──────────────┬─────────────────┘                                                       │
│                  │  POST /api/benchmark  ×1 per demo                                       │
│                  │  GET  /api/benchmark/:runId  every ~1 s                                 │
│                  ▼                                                                         │
│   ┌────────────────────────────────────────────────────────────────────────┐              │
│   │  Express orchestrator   (single Node process, port 8080)                │              │
│   │                                                                        │              │
│   │   ┌───────────────┐  ┌──────────────┐  ┌────────────────────────┐      │              │
│   │   │ C1 Workload   │→ │ C5 Benchmark │← │ C2 Prompt assembler    │      │              │
│   │   │ generator     │  │    runner    │  │ C3 Normalizer (opt-in) │      │              │
│   │   │ planner,w1,w2 │  │ (state m/c)  │  └────────────────────────┘      │              │
│   │   └───────────────┘  └──────┬───────┘  ┌────────────────────────┐      │              │
│   │                             │          │ C7 Prefix analyzer     │      │              │
│   │   ┌───────────────┐         │          │ LCP, divergence, diag  │      │              │
│   │   │ C4 SGLang     │◄────────┤          └────────────────────────┘      │              │
│   │   │ client module │         │          ┌────────────────────────┐      │              │
│   │   │ LIBRARY, not  │         └─────────►│ C6 Validity gate       │      │              │
│   │   │ a gateway     │                    └────────────────────────┘      │              │
│   │   └───────┬───────┘         C8 Telemetry recorder · C9 HTTP API        │              │
│   └───────────┼─────────────────────────────────┬──────────────────────────┘              │
│               │                                 │ run / request / poll state              │
│   HTTP        │ 127.0.0.1                       ▼                                          │
│               │                     ┌──────────────────────┐                              │
│               │                     │ C10 Redis (single,   │                              │
│               │                     │ local, port 6379)    │                              │
│               │                     └──────────────────────┘                              │
│               ▼                                                                            │
│   ╔════════════════════════════════════════════════════════╗                              │
│   ║  SGLang v0.5.18  — EXTERNAL, in Docker, port 30000      ║  ← trust boundary            │
│   ║  one worker · Qwen2.5-1.5B-Instruct · BF16 · ctx 8192   ║    inbound = SGLANG_NATIVE   │
│   ║  --enable-metrics                                       ║                              │
│   ║  /generate  /flush_cache  /tokenize  /health            ║                              │
│   ║  /get_server_info  /get_model_info  /metrics            ║                              │
│   ║  RTX 4060 Mobile · 8 GB VRAM                            ║                              │
│   ╚════════════════════════════════════════════════════════╝                              │
│                                                                                            │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Four processes. Three host ports plus Redis. One container. No other network participants.

---

## 3. Components and ownership

One owning document per component; if the component's behaviour changes, that document changes with it.

| # | Component | Responsibility | Owning document | Repository area |
|---|---|---|---|---|
| C1 | **Workload generator** | Produces the planner → worker1 → worker2 sequence for one fixed task. Deterministic. Owns agent causality. | `docs/spec/workload.md` | `server/src/workload/` |
| C2 | **Prompt assembler** | Builds a prompt from classified components (system, shared-static, agent-rules, dynamic-metadata, task). Emits the component manifest. | `docs/spec/prompt-model.md` | `server/src/prompt/assemble/` |
| C3 | **Normalizer** | Opt-in, deterministic reordering of *eligible* components only. Reversible. Refuses on uncertainty. | `docs/spec/normalization-rules.md` | `server/src/prompt/normalize/` |
| C4 | **SGLang client module** | Typed calls to `/generate` (streaming and non-streaming), `/flush_cache`, `/tokenize`, `/health`, `/get_server_info`, `/get_model_info`, `/metrics`. Parses `meta_info`. Owns timeout and retry policy for that one dependency. **Library, not a service.** | `docs/spec/sglang-interface.md` → `docs/architecture/sglang-integration.md` | `server/src/sglang/` |
| C5 | **Benchmark runner** | The run state machine (§5). Sequences flush → raw → flush → normalized → compare. Single-flight. Owns the protected windows. | `docs/spec/benchmark-protocol.md` | `server/src/benchmark/runner/` |
| C6 | **Validity gate** | Enforces cold-start, settings-equality, content-equality and metadata-availability. Sole authority to emit `BENCHMARK_INVALID`. | `docs/spec/validity-rules.md` | `server/src/benchmark/validity/` |
| C7 | **Prefix analyzer** | Longest common token prefix, first divergence index, diagnostics. All output `RADIXSCOPE_DERIVED`. | `docs/spec/prefix-analysis.md` | `server/src/analysis/` |
| C8 | **Telemetry recorder** | Per-request records with provenance tags and timing. Append-only within a run. | `docs/spec/telemetry-model.md` | `server/src/telemetry/` |
| C9 | **HTTP API layer** | The four endpoints in §4.3. Serialization and status codes only; no benchmark logic. | `docs/spec/http-api.md` | `server/src/api/` |
| C10 | **Redis store** | Run state, per-request records, poll projection, single-flight lock. Nothing else. | `docs/spec/state-model.md` | `server/src/store/` |
| C11 | **React dashboard** | One Run Demo button, poll loop, Chart.js comparisons, provenance-labelled tables, invalid-run banner. | `docs/spec/dashboard.md` | `web/src/` |
| C12 | **SGLang launch profile** | Pinned image, flags, model config, acceptance test, fallback trigger. Configuration we own, not code. | `docs/ops/sglang-launch.md` → `technical-design.md` §2 | `ops/sglang/` |

The frontend holds no invariant. That is invariant I-3 (§12).

---

## 4. Request flow

### 4.1 One agent request, end to end

```
C5 Benchmark runner
  → C1 selects the next agent (planner | worker1 | worker2)
  → C2 assembles classified components into an ordered prompt
      · mode = RAW        : authored order, unchanged
      · mode = NORMALIZED : C3 reorders eligible components only
  → C4 POST /generate  (stream=true when measuring ttft_ms)
        sampling_params: {temperature: 0, n: 1, max_new_tokens: 256}
  → SGLang returns text + meta_info
  → C8 records SGLANG_NATIVE fields + RADIXSCOPE_MEASURED timings
  → C6 checks per-request conditions (coldness on request index 0)
  → runner appends the completion to shared conversation state for the next agent
```

`concurrency = 1` is structural, not a tuning knob. The runner awaits each request before issuing the next. This is what makes agent causality enforceable **and** what makes the flush precondition satisfiable — `/flush_cache` only proceeds when the scheduler is fully idle.

### 4.2 Protected windows

Between a successful flush and the first measured request of that run, **no SGLang request of any kind is issued.** Not health generation, not warm-up, not tokenization, not introspection. Token arrays (`/tokenize`) and the run fingerprint (`/get_server_info`) are gathered before the first flush or after the last request.

`/health_generate` is never called at all. It performs a real generation and would contaminate the cold-cache premise. `/health` is the only permitted health endpoint, and `SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION` must remain unset.

### 4.3 HTTP surface (Express → frontend)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/benchmark` | Start one demo. Returns `{ runId }`. `409` if a run is active. |
| `GET` | `/api/benchmark/:runId` | Phase, per-request records so far, validity verdict, comparison when complete. |
| `GET` | `/api/health` | Express + Redis + SGLang reachability. |
| `GET` | `/api/runs` | Last N run summaries. Optional; drop it if the 48 hours get tight. |

Four endpoints. No streaming endpoint of any kind.

### 4.4 Instruction precedence and ordering guarantees

Enforced in C2/C3, not configurable:

1. **System precedence.** The system instruction block occupies position 0 in every assembled prompt, in both modes. Normalization may not move it, split it, or place anything above it.
2. **Trust ordering.** Untrusted content — task input, retrieved text, tool results — is never moved above trusted instruction content.
3. **Conversation order.** Turn order preserved exactly. History is never reordered.
4. **Tool ordering.** Tool calls and their results keep relative order and adjacency.
5. **Causality.** Worker 1 runs after the planner and may consume its output; worker 2 after worker 1. Agents are never reordered or parallelised.

Normalization operates on a whitelist: only `SHARED_STATIC`, `AGENT_RULES` and `DYNAMIC_METADATA` are movable, and only relative to each other. Unclassified content is immovable. On ambiguous classification C3 declines and records the refusal in the run record. A declined normalization is a visible outcome, not a silent pass-through.

Prompts are forwarded unchanged by default. Normalization is explicit and opt-in.

---

## 5. Benchmark state flow

### 5.1 State machine

```
                    POST /api/benchmark
                            │
                            ▼
                    ┌───────────────┐
                    │    QUEUED     │  runId minted, single-flight lock taken
                    └───────┬───────┘
                            ▼
                    ┌───────────────┐  GET /health → 200
                    │  PREFLIGHT    │  GET /get_server_info → fingerprint, page_size
                    │               │  settings frozen; tolerance resolved (§5.3)
                    └───────┬───────┘
                     fail ──┴── ok
                       │        ▼
                       │  ┌───────────────┐  POST /flush_cache?timeout=30
                       │  │  FLUSH_RAW    │  require HTTP 200
                       │  └───────┬───────┘
                       │   fail ──┴── ok
                       │     │        ▼   ╔══ protected window opens ══╗
                       │     │  ┌───────────────┐  planner → worker1 → worker2
                       │     │  │   RUN_RAW     │  sequential, concurrency 1
                       │     │  └───────┬───────┘  temp 0, n 1, max_new_tokens 256
                       │     │          ▼
                       │     │  ┌───────────────┐  req[0].cached_tokens <= tolerance?
                       │     │  │ VALIDATE_RAW  │  settings == locked set?
                       │     │  └───────┬───────┘  meta_info present?
                       │     │   fail ──┴── ok
                       │     │     │        ▼
                       │     │     │  ┌───────────────┐  POST /flush_cache?timeout=30
                       │     │     │  │  FLUSH_NORM   │  require HTTP 200
                       │     │     │  └───────┬───────┘
                       │     │     │   fail ──┴── ok
                       │     │     │     │        ▼  ╔══ protected window opens ══╗
                       │     │     │     │  ┌───────────────┐  same task, same content,
                       │     │     │     │  │   RUN_NORM    │  approved structure only
                       │     │     │     │  └───────┬───────┘
                       │     │     │     │          ▼
                       │     │     │     │  ┌───────────────┐
                       │     │     │     │  │ VALIDATE_NORM │
                       │     │     │     │  └───────┬───────┘
                       │     │     │     │   fail ──┴── ok
                       │     │     │     │     │        ▼
                       │     │     │     │     │  ┌───────────────┐  cross-run equality:
                       │     │     │     │     │  │   COMPARE     │  model, task, content,
                       │     │     │     │     │  │               │  sequence, settings,
                       │     │     │     │     │  └───────┬───────┘  server fingerprint
                       │     ▼     ▼     ▼     ▼   fail ──┴── ok
                    ┌──────────────────────────────┐      ▼
                    │        INVALID               │  ┌───────────────┐
                    │  reason code + evidence      │  │   COMPLETE    │
                    │  NEVER rendered as a win     │  │  comparison   │
                    └──────────────────────────────┘  └───────────────┘
```

`INVALID` is terminal and absorbing. There is no path from `INVALID` to `COMPLETE` and no partial-credit rendering. The dashboard shows the reason code and the evidence that produced it.

### 5.2 Reason codes

| Code | Condition |
|---|---|
| `FLUSH_FAILED` | `/flush_cache?timeout=30` returned non-200. |
| `WARM_START` | First request of a run reported `cached_tokens` above the resolved tolerance. |
| `META_MISSING` | `meta_info.cached_tokens` absent or non-numeric on any request. |
| `SETTINGS_MISMATCH` | Effective sampling parameters differed between modes or from the locked set. |
| `CONTENT_MISMATCH` | Raw and normalized runs did not carry identical component content. |
| `TASK_DIVERGENCE` | Output correctness check passed for one mode and not the other. |
| `SERVER_CHANGED` | `/get_server_info` fingerprint differs between the two runs. |
| `RUNTIME_ERROR` | Unhandled failure from SGLang, Redis or the runner. |

`num_retractions > 0` on any measured request is recorded and surfaced beside that request's `cached_tokens`, since a retracted request understates reuse. It is a flag on the value, not an invalidation of the run.

### 5.3 Cold-start tolerance

Literal zero is not required, because `cached_tokens` may be page-aligned.

```
tolerance = observed effective page_size   (from PREFLIGHT / startup log)
```

- `page_size == 1` → tolerance 0 → assertion is `cached_tokens == 0`.
- `page_size > 1` → assertion is `cached_tokens <= page_size`.
- If the page size cannot be resolved at PREFLIGHT, the runner **refuses to start**. It does not guess and does not fall back to a looser threshold.
- The observed first-request value is recorded verbatim in every run document, valid or not. If an empirical floor exceeds the derived tolerance, that is a finding to investigate, never a reason to widen the tolerance.

---

## 6. Telemetry flow

```
per request:
   t0 = monotonic clock before POST /generate           RADIXSCOPE_MEASURED
   t1 = first streamed frame carrying output            RADIXSCOPE_MEASURED  → ttft_ms
   t2 = response complete                               RADIXSCOPE_MEASURED  → total_latency_ms
   meta_info.{prompt_tokens, completion_tokens,
              cached_tokens, finish_reason,
              num_retractions, weight_version}          SGLANG_NATIVE
   meta_info.{forward_entry_time, prefill_finished_time,
              queue_time}   (--enable-metrics only)     SGLANG_NATIVE       → prefill_duration_ms
        ↓
   C8 writes one immutable TelemetryRecord to run:{runId}:req:{i}
        ↓
after both runs (outside every protected window):
   C7 computes LCP, first divergence index, reuse ratios,
      raw↔norm deltas, diagnostics                      RADIXSCOPE_DERIVED
        ↓
   C5 writes one Comparison document; C6 stamps the verdict
```

### 6.1 Three timing values, kept apart

| Value | Meaning | Provenance |
|---|---|---|
| `ttft_ms` | Express clock, dispatch → first streamed frame containing generated output | `RADIXSCOPE_MEASURED` |
| `prefill_duration_ms` | Server-side prefill boundary from SGLang timing fields | `SGLANG_NATIVE` direct, `RADIXSCOPE_DERIVED` when computed as a difference |
| `total_latency_ms` | Express clock, dispatch → generation complete | `RADIXSCOPE_MEASURED` |

`prefill_finished_time` is **never** labelled as client-observed TTFT. If reliable streaming cannot be implemented, `ttft_ms` is dropped and not replaced; the server-side value is reported under its own accurate name.

### 6.2 The hard rule on derived analysis

The longest-common-prefix and the divergence index are RadixScope's own token-level arithmetic over `/tokenize` output. They are **not** a readout of SGLang's radix tree, they are not claimed to match it, and they may legitimately disagree with `cached_tokens` because of page granularity, eviction and scheduling. Where they disagree, both are shown and the disagreement is labelled as expected, not as an error. No component maps derived prefix positions onto SGLang-internal boundaries.

Every numeric on the dashboard carries its provenance tag. A reuse ratio is `RADIXSCOPE_DERIVED` even though both its inputs are native.

---

## 7. Polling flow

```
Frontend                          Express                       Redis
   │  POST /api/benchmark            │                             │
   │────────────────────────────────►│  take single-flight lock    │
   │◄──── 202 { runId } ─────────────│─────── write run:{id} ─────►│
   │                                 │                             │
   │  GET /api/benchmark/{runId}     │                             │
   │────────── every ~1000 ms ──────►│◄──── read run + records ────│
   │◄──── { phase, records, verdict }│                             │
   │  render progressively           │                             │
   │  stop on COMPLETE or INVALID    │                             │
```

Fixed 1-second interval, backing off to 3 s after five consecutive unchanged responses. Polling is idempotent and stateless server-side; the response is a projection of Redis computed fresh each time. Closing the browser does not stop or corrupt a run; reopening and polling the same `runId` resumes the view.

No WebSocket. No SSE to the browser. No long-polling.

---

## 8. Data ownership

### 8.1 Who owns what

| Data | Owner | Lifetime | Store |
|---|---|---|---|
| Run state and phase | C5 | Run + retention window | Redis `run:{runId}` |
| Per-request telemetry | C8 | Run + retention window | Redis `run:{runId}:req:{i}` |
| Comparison document | C5 | Run + retention window | Redis `run:{runId}:comparison` |
| Validity verdict + evidence | C6 | Run + retention window | Redis `run:{runId}:verdict` |
| Server fingerprint | C5 | Run | Redis `run:{runId}:fingerprint` |
| Single-flight lock | C5 | Duration of run | Redis `lock:benchmark` |
| Prompt component definitions | C2 | Static, in repo | Source files, never Redis |
| Model weights, KV cache, radix tree | **SGLang** | Server lifetime | Not ours; never mirrored |
| Rendered view state | C11 | Browser session | Browser memory only |

Redis holds application, benchmark and request state. It is not a cache of SGLang state, not a prompt store, not a queue, not a message bus. Every key must be justifiable against that sentence. Persistence stays at defaults: run state is disposable, and the correct response to a Redis restart is to run the benchmark again.

### 8.2 Provenance is part of the schema

```
TelemetryRecord {
  runId, mode: RAW|NORMALIZED, requestIndex, agent,
  native:   { promptTokens, completionTokens, cachedTokens, finishReason,
              numRetractions, weightVersion,
              forwardEntryTime?, prefillFinishedTime?, queueTime? }   // SGLANG_NATIVE
  measured: { ttftMs?, totalLatencyMs, promptTokenIds, assembledAt }  // RADIXSCOPE_MEASURED
  derived:  { reuseRatio, prefillDurationMs?, lcpWithPrevious,
              firstDivergenceIndex, diagnostics[] }                   // RADIXSCOPE_DERIVED
}
```

Three named sub-objects, not a flat bag with a comment. A value cannot be rendered without traversing its provenance tag.

### 8.3 Privacy and tenant/session separation

Single-user and local, so "tenant" means the minimum that keeps runs from contaminating each other:

- Every key is namespaced under `run:{runId}`. Nothing is global except the single-flight lock and the run index.
- Prompts and completions live only within their run's namespace, with a 24-hour TTL and a manual purge path.
- No telemetry, prompt or completion leaves the machine. The only outbound calls are to `127.0.0.1:30000` and Redis.
- Logs redact prompt bodies by default and record component hashes instead. Full bodies only under an explicit debug flag.
- SGLang session APIs are not used; RadixScope owns conversation state so that prompt construction stays entirely under its control.

---

## 9. Startup dependencies

Strict order, each step gated.

```
0. NVIDIA driver ≥ 580.65.06     gate: nvidia-smi            ← BLOCKER-A
1. Container GPU passthrough     gate: --gpus all shows the GPU
2. Redis up                      gate: PING → PONG
3. SGLang container up           gate: GET /health → 200      (never /health_generate)
4. Version check                 gate: reported version == v0.5.18
5. Interface probe               gate: /generate returns meta_info.cached_tokens;
                                       /flush_cache?timeout=30 returns 200;
                                       /tokenize returns tokens
6. Backend + page size read      gate: effective page_size resolved  ← BLOCKER-B
                                       (sets the §5.3 tolerance)
7. Model acceptance test         gate: Qwen2.5-1.5B-Instruct loads BF16 at ctx 8192
                                       within VRAM budget; an 8192-context request
                                       completes; max_total_num_tokens >= 24,576
                                       → on failure only, fall back to
                                         Qwen2.5-0.5B-Instruct and record the trigger
8. Express up                    gate: /api/health green on all of the above
9. Frontend up                   gate: none; degrades to an error banner
```

Steps 4–6 are what make the two open blockers tractable: the system refuses to benchmark against an unverified interface or an unresolved tolerance rather than producing a number nobody can defend. Step 7's fallback is a recorded event with a reason, never a silent substitution — the dashboard states which model produced a result.

The VRAM budget behind step 7 is estimated at roughly 3.08 GB of weights and ~28 KB per KV token, giving about five times the headroom needed for three sequential 8192-token requests at `--mem-fraction-static 0.85`. The mitigation ladder before the model fallback fires is in `technical-design.md` §2.3.

---

## 10. Failure boundaries

| Boundary | Failure | Containment | Effect on run |
|---|---|---|---|
| Frontend ↔ Express | Browser closed, poll fails, JS error | Frontend is outside the inference path | None. Run continues; view resumes on reload. |
| Express ↔ Redis | Connection lost mid-run | Runner catches; state cannot be persisted | `INVALID / RUNTIME_ERROR`. No partial result published. |
| Express ↔ SGLang | Timeout, 5xx, connection refused | C4 retries **only** idempotent introspection calls (`/health`, `/get_server_info`). `/generate` and `/flush_cache` are **never** retried inside a run. | `INVALID / RUNTIME_ERROR`. Retrying a generate would corrupt the cold-start premise. |
| SGLang internal | OOM, worker death | Surfaces as connection failure | Run invalidated; `/api/health` goes red. |
| Flush | HTTP 400 — busy, or timed out waiting for idle | Runner is single-flight, so a busy server should be impossible; if it happens it is a real bug | `FLUSH_FAILED`. |
| Validity | Warm first request | C6 | `WARM_START`. Terminal. |
| Tolerance | Page size unresolved | C5 PREFLIGHT | Run refused before any flush. Not an invalid run — a refused start. |
| Normalizer | Ambiguous classification | C3 declines the move | Run continues; refusal recorded and shown. |
| Streaming | First frame carries no output, or stream unreliable | C4 | `ttft_ms` omitted for that run. Not an invalidation. Never substituted with a server-side value. |
| Concurrency | Second `POST /api/benchmark` during a run | Single-flight lock | `409`. No queueing. |

The general rule: **a run either satisfies every precondition or it is invalid.** There is no degraded-but-presentable mode. This costs nothing at demo time and is the only thing that makes the demo honest.

---

## 11. SGLang-native versus RadixScope-derived

| Quantity | Provenance | Note |
|---|---|---|
| `prompt_tokens`, `completion_tokens` | `SGLANG_NATIVE` | `meta_info` |
| `cached_tokens` | `SGLANG_NATIVE` | The single authoritative cache-reuse figure. Matched-prefix length, accumulated once, frozen on retraction. |
| `num_retractions` | `SGLANG_NATIVE` | Detects the case where `cached_tokens` understates reuse. |
| `finish_reason`, `weight_version` | `SGLANG_NATIVE` | Correctness check and fingerprint. |
| `forward_entry_time`, `prefill_finished_time`, `queue_time` | `SGLANG_NATIVE` | Requires `--enable-metrics`. |
| Server fingerprint, page size, attention backend | `SGLANG_NATIVE` | `/get_server_info` or startup log. |
| `/tokenize` token IDs | `SGLANG_NATIVE` | The served checkpoint's own tokenizer. |
| `ttft_ms` | `RADIXSCOPE_MEASURED` | Client-observed; includes HTTP and framing overhead. |
| `total_latency_ms` | `RADIXSCOPE_MEASURED` | Same caveat. |
| `prefill_duration_ms` | `SGLANG_NATIVE` / `RADIXSCOPE_DERIVED` | Direct field, or a difference between reported timestamps. Never called TTFT. |
| Cache-reuse ratio | `RADIXSCOPE_DERIVED` | `cached_tokens / prompt_tokens`. |
| Tokens per second | `RADIXSCOPE_DERIVED` | Reported only when the timing basis is sound; otherwise omitted, not estimated. |
| Longest common token prefix, first divergence index | `RADIXSCOPE_DERIVED` | RadixScope arithmetic. Not SGLang's tree. |
| Raw↔normalized deltas, variability diagnostics | `RADIXSCOPE_DERIVED` | Diagnostics are heuristic and labelled as inference. |
| Aggregate `/metrics` counters | `SGLANG_NATIVE`, server-wide | Corroborative only. Never presented as a per-request cache measurement. |

**If `cached_tokens` proves unusable:** do not fabricate per-request reuse. Mark native per-request measurement unavailable, keep LCP analysis explicitly `RADIXSCOPE_DERIVED` and never call it a cache hit, use aggregate metrics only under their documented meanings, and state plainly in the product that the benchmark cannot prove native cache reuse. That is a demotion of the claim, not a workaround.

---

## 12. Architecture-invariant checklist

Check every one before merging any change. A violation is a redesign, not a refactor.

- [ ] **I-1** Exactly one SGLang worker, one Express process, one Redis instance, one frontend. No component added.
- [ ] **I-2** Express contains an SGLang *client module*. Nothing in code, docs or diagrams calls it a gateway, router, proxy or service.
- [ ] **I-3** The frontend issues no prompt, holds no invariant, and computes no metric that appears in a result.
- [ ] **I-4** Raw and normalized runs are identical in model, task, component content, agent sequence, sampling settings, server instance and measurement code. Structure is the only difference.
- [ ] **I-5** `temperature=0`, `n=1`, `max_new_tokens=256`, `concurrency=1`, speculative decoding and MTP off — asserted at runtime in both modes and recorded in the run document.
- [ ] **I-6** Both runs preceded by `POST /flush_cache?timeout=30` returning 200, and both first requests within the resolved tolerance. Otherwise `INVALID`, never rendered as an improvement.
- [ ] **I-7** No SGLang request of any kind inside a protected window. `/health_generate` is never called.
- [ ] **I-8** Every numeric on the dashboard carries a provenance tag; no derived value is presented as SGLang cache state; `prefill_finished_time` is never labelled TTFT.
- [ ] **I-9** Prompts unchanged by default. Normalization opt-in, deterministic, reversible, refuses under uncertainty.
- [ ] **I-10** System instructions stay first; untrusted content never rises above trusted instructions; conversation, tool and agent order preserved.
- [ ] **I-11** Redis holds only run, request and poll state. No prompt library, queue, bus or SGLang-state mirror.
- [ ] **I-12** No cloud, Kubernetes, gateway, router, scheduler, second worker, WebSocket or SSE to the browser, FastAPI, Next.js, quantization, speculative decoding, radix-tree visualization or section-boundary token mapping.
- [ ] **I-13** SGLang pinned to `v0.5.18` by immutable tag. Every dependent behaviour appears in `sglang-integration.md` with a current classification.
- [ ] **I-14** The 0.5B model is used only after a recorded acceptance-test failure, and the substitution is visible in the result.
- [ ] **I-15** Still builds and runs on the 4060 laptop, natively, inside the 48-hour window.

---

## 13. Open items

| ID | Item | Status | Where it is resolved |
|---|---|---|---|
| **BLOCKER-A** | Host NVIDIA driver ≥ 580.65.06 | `RUNTIME_PENDING` | `technical-design.md` §2.2, Day-0 step 1 |
| **BLOCKER-B** | Effective KV page size → cold-start tolerance | `RUNTIME_PENDING` | `sglang-integration.md` §9 step 4 |
| A-1 | VRAM headroom and `--mem-fraction-static` value that holds | `RUNTIME_PENDING` | `technical-design.md` §2.3 ladder |
| A-2 | Streaming first-frame reliability for `ttft_ms` | `RUNTIME_PENDING` | `sglang-integration.md` §9 step 12 |
| A-3 | `cached_tokens` granularity vs RadixScope LCP | `RUNTIME_PENDING` | `sglang-integration.md` §9 step 11 |
| A-4 | Existence of a CUDA 12.9 `v0.5.18` image, if BLOCKER-A forces it | Unverified | `technical-design.md` §2.2.3 — record the observed tag, never construct one |
| A-5 | Task-correctness decidability at `temperature=0` | Open | Not an SGLang question; `docs/spec/validity-rules.md` |

None of these changes the architecture. All of them change what the numbers mean or whether the system may start.

---

## 14. Document map

| Document | Covers | Components |
|---|---|---|
| `docs/architecture/system-architecture.md` | This document. Boundaries, components, flows, invariants. | All |
| `docs/architecture/sglang-integration.md` | Pinned-version interface verification and classifications. | C4, C12 |
| `docs/architecture/technical-design.md` §2 | Stack feasibility, VRAM budget, execution path, thresholds. | C12 |
| `docs/spec/workload.md` | Agent sequence, fixed task, causality | C1 |
| `docs/spec/prompt-model.md` | Component classification and assembly | C2 |
| `docs/spec/normalization-rules.md` | Eligibility, moves, refusals, reversibility | C3 |
| `docs/spec/benchmark-protocol.md` | State machine, phases, protected windows | C5 |
| `docs/spec/validity-rules.md` | Gates, reason codes, tolerance resolution | C6 |
| `docs/spec/prefix-analysis.md` | LCP, divergence, diagnostics and their limits | C7 |
| `docs/spec/telemetry-model.md` | Record schema, provenance tags | C8 |
| `docs/spec/http-api.md` | The four endpoints | C9 |
| `docs/spec/state-model.md` | Redis keys, TTLs, per-key justification | C10 |
| `docs/spec/dashboard.md` | Views, charts, provenance rendering, invalid banner | C11 |
| `docs/ops/sglang-launch.md` | Image, flags, model config, acceptance test, fallback trigger | C12 |

One document per component, one component per document. If a change needs edits in three spec documents, the component boundary is probably wrong.
