# RadixScope — Architecture Documentation

**Product:** DevTools for SGLang prefix caching
**Build window:** 48 hours, two developers
**This document owns:** the authoritative MVP requirements (§2). Design lives elsewhere.

| Document | Owns |
|---|---|
| `README.md` (this file) | Requirements, priorities, acceptance criteria, traceability |
| `system-architecture.md` | Boundaries, components, flows, invariants |
| `sglang-integration.md` | Pinned-version interface verification (`v0.5.18`) |
| `technical-design.md` §2 | Stack feasibility, VRAM budget, execution path, thresholds |

---

## 1. The one action

Every MUST below traces to a single user action. Pressing **Run Demo** causes exactly this:

```
flush → raw (planner, worker1, worker2, sequential) → collect
      → flush → normalized (equivalent workload, sequential) → collect
      → compare → render
```

A requirement that cannot be traced to a step in that line is not a MUST. This is the discipline that keeps the build inside 48 hours.

---

# 2. Requirements

## 2.0 Priority definitions

| Priority | Meaning |
|---|---|
| **MUST HAVE** | The demo is not the product without it. Traces to a step in §1. Build first. |
| **SHOULD HAVE** | Materially improves honesty or usefulness. Build if the MUSTs land with time to spare. |
| **NICE TO HAVE** | Build only if everything else is finished and stable. Assume it will not happen. |
| **CUT** | Explicitly excluded. Listed so nobody rediscovers it at hour 30. |

---

## 2.1 Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| **F-1** | A single **Run Demo** control triggers the full sequence in §1 server-side. No other user input is required to produce a result. | MUST |
| **F-2** | The workload comprises exactly three agents — one planner, then worker 1, then worker 2 — executing one fixed task sequentially against one SGLang instance. | MUST |
| **F-3** | Prompts are assembled from developer-classified components: `SYSTEM`, `SHARED_STATIC`, `AGENT_RULES`, `DYNAMIC_METADATA`, `TASK`. | MUST |
| **F-4** | The raw run emits components in authored order. The normalized run applies the approved reordering to eligible components only. | MUST |
| **F-5** | The two runs are identical in model, task, component content, agent sequence, sampling settings, server instance, and measurement code. Structure is the only permitted difference. | MUST |
| **F-6** | Worker 1 executes after the planner and may consume its output; worker 2 after worker 1. Agents are never reordered or parallelised. | MUST |
| **F-7** | The system compares raw against normalized and renders the comparison. | MUST |
| **F-8** | A run in progress is observable — phase and per-request results appear as they are produced, not only at the end. | SHOULD |
| **F-9** | A completed run is retrievable by `runId` after a page reload. | SHOULD |
| **F-10** | The last N run summaries are listable. | NICE |
| **F-11** | A second workload or task variant. | CUT |
| **F-12** | User-editable prompts in the UI. | CUT |

## 2.2 Benchmark requirements

| ID | Requirement | Priority |
|---|---|---|
| **B-1** | Both runs use `temperature=0`, `n=1`, `max_new_tokens=256`, `concurrency=1`, no speculative decoding, no MTP. Asserted at runtime in both modes and recorded in the run document. | MUST |
| **B-2** | Each run is preceded by `POST /flush_cache?timeout=30` returning HTTP 200. A non-200 marks the run `INVALID / FLUSH_FAILED`. | MUST |
| **B-3** | The first request of each run must report `meta_info.cached_tokens` within the resolved cold-start tolerance. Exceeding it marks the run `INVALID / WARM_START`. | MUST |
| **B-4** | The cold-start tolerance is derived at runtime from the observed effective KV page size. If it cannot be resolved, the runner **refuses to start**; it never guesses a threshold. | MUST |
| **B-5** | The observed first-request `cached_tokens` value is recorded verbatim in every run document, valid or not. | MUST |
| **B-6** | Comparison is performed **only** if both cold-start assertions pass. An `INVALID` result is never rendered as a performance improvement. | MUST |
| **B-7** | No SGLang request of any kind is issued between a successful flush and the first measured request of that run — no health generation, warm-up, tokenization or introspection. | MUST |
| **B-8** | `INVALID` is terminal and absorbing. There is no partial-credit rendering and no path back to a valid result. | MUST |
| **B-9** | Runs are never compared across different models. A 0.5B fallback run is not comparable to a 1.5B run. | MUST |
| **B-10** | `meta_info.num_retractions > 0` on a measured request is recorded and surfaced beside that request's `cached_tokens`, since retraction causes the value to understate reuse. | SHOULD |
| **B-11** | Repeat the benchmark N times and report variance. | NICE |
| **B-12** | Concurrency sweeps, batch-size sweeps, throughput benchmarking. | CUT |

## 2.3 Normalization requirements

| ID | Requirement | Priority |
|---|---|---|
| **N-1** | Prompts pass through unchanged by default. Normalization is off unless explicitly enabled. | MUST |
| **N-2** | Normalization is deterministic — the same input produces the same output every time. | MUST |
| **N-3** | Normalization is restricted to a whitelist: only `SHARED_STATIC`, `AGENT_RULES` and `DYNAMIC_METADATA` may move, and only relative to each other. Unclassified content is immovable. | MUST |
| **N-4** | Normalization is reversible — the original prompt is recoverable from the normalized one plus the component manifest. | MUST |
| **N-5** | Where classification or semantic equivalence is uncertain, the normalizer **declines** the move and records the refusal in the run record. A declined normalization is a visible outcome, not a silent pass-through. | MUST |
| **N-6** | Normalization never rewrites content, only reorders eligible components and stabilises formatting. Arbitrary prompt rewriting is excluded. | MUST |
| **N-7** | A per-run diff showing exactly which components moved. | SHOULD |
| **N-8** | Automatic classification of prompt components. | CUT — classification is developer-supplied. |
| **N-9** | LLM-assisted prompt rewriting or optimisation. | CUT |

## 2.4 Safety requirements

| ID | Requirement | Priority |
|---|---|---|
| **S-1** | The `SYSTEM` block occupies position 0 in every assembled prompt, in both modes. Normalization may not move it, split it, or place anything above it. | MUST |
| **S-2** | Untrusted content — task input, retrieved text, tool results — is never moved above trusted instruction content. | MUST |
| **S-3** | Conversation turn order is preserved exactly. History is never reordered. | MUST |
| **S-4** | Tool calls and tool results keep their relative order and adjacency. | MUST |
| **S-5** | Agent causality is preserved (see F-6). | MUST |
| **S-6** | Normalization does not change task meaning, weaken instructions, or alter agent behaviour. | MUST |
| **S-7** | Prompts and completions never leave the machine. The only outbound calls are to the local SGLang port and local Redis. | MUST |
| **S-8** | All run data is namespaced per `runId`. Nothing is global except the single-flight lock and the run index. This is minimal session separation, not multi-tenancy. | MUST |
| **S-9** | Stored prompts and completions carry a TTL (default 24 hours) and a manual purge path. | SHOULD |
| **S-10** | Logs redact prompt bodies by default, recording component hashes instead; full bodies only under an explicit debug flag. | SHOULD |
| **S-11** | Authentication, authorisation, TLS, rate limiting, audit logging, secret management. | CUT — production security infrastructure is out of scope for a local single-user demo. |

## 2.5 Observability requirements

Provenance tagging is the load-bearing requirement in this category. Without it the product is a claim rather than a measurement.

| ID | Requirement | Priority |
|---|---|---|
| **O-1** | Every recorded value carries one of three provenance tags: `SGLANG_NATIVE`, `RADIXSCOPE_MEASURED`, `RADIXSCOPE_DERIVED`. The tag is part of the schema, not a UI annotation. | MUST |
| **O-2** | Every numeric rendered on the dashboard displays its provenance tag. | MUST |
| **O-3** | A `RADIXSCOPE_DERIVED` value is never presented as SGLang internal cache state. Longest-common-prefix is never called a cache hit. | MUST |
| **O-4** | Per request, record `SGLANG_NATIVE`: `prompt_tokens`, `completion_tokens`, `cached_tokens`, `finish_reason`, `num_retractions`, `weight_version`. | MUST |
| **O-5** | Per request, record `RADIXSCOPE_MEASURED`: `total_latency_ms`, prompt token IDs. | MUST |
| **O-6** | Per run, compute `RADIXSCOPE_DERIVED`: cache-reuse ratio, longest common token prefix, first divergence index, raw↔normalized deltas. | MUST |
| **O-7** | Chart.js renders the raw-versus-normalized comparison. | MUST |
| **O-8** | Record `ttft_ms` as `RADIXSCOPE_MEASURED`, from dispatch to the first streamed frame carrying generated output. Express may consume SGLang's native streaming response internally for this; no SSE reaches the browser. | SHOULD |
| **O-9** | Record `prefill_duration_ms` from SGLang server timing fields, under that name. `prefill_finished_time` is never labelled as client-observed TTFT. If streaming is unreliable, `ttft_ms` is dropped and not replaced. | SHOULD |
| **O-10** | Diagnostic explanations for likely prompt variability, labelled as inference. | SHOULD |
| **O-11** | Tokens per second, reported only where the timing basis is sound; omitted rather than estimated. | NICE |
| **O-12** | Aggregate `/metrics` counters shown alongside, under their actual documented server-wide meanings. | NICE |
| **O-13** | Radix-tree visualization; mapping divergence positions back to named prompt sections. | CUT |

## 2.6 Non-functional requirements

| ID | Requirement | Priority |
|---|---|---|
| **NF-1** | The whole system runs locally on the target laptop: RTX 4060 Mobile 8 GB, i7-13650HX, 16 GB RAM. | MUST |
| **NF-2** | Exactly one SGLang worker, one Express process, one Redis instance, one React frontend. | MUST |
| **NF-3** | The frontend is outside the inference path: it issues no prompt, holds no benchmark invariant, and computes no metric that appears in a result. A frontend crash does not affect a run in progress. | MUST |
| **NF-4** | Frontend↔Express communication is HTTP polling only. | MUST |
| **NF-5** | Redis holds only run, request and poll state. Not a prompt store, queue, message bus, or mirror of SGLang state. | MUST |
| **NF-6** | Express contains an SGLang client module — a library of typed HTTP calls inside the orchestrator process. It is not a gateway, router or proxy, and is not described as one. | MUST |
| **NF-7** | Implementable by two developers within 48 hours. Prefer the smallest implementation that produces a reliable and honest demonstration. | MUST |
| **NF-8** | A full demo run completes within a few minutes on the target hardware. | SHOULD |
| **NF-9** | Run state survives an Express restart mid-session. | NICE |
| **NF-10** | High availability, horizontal scaling, containerised deployment of Express/Redis/frontend, CI/CD. | CUT |

## 2.7 Deployment requirements

| ID | Requirement | Priority |
|---|---|---|
| **D-1** | SGLang is pinned to `v0.5.18` by immutable tag. Mutable tags (`latest`, `dev`) are not used. | MUST |
| **D-2** | The primary model is `Qwen/Qwen2.5-1.5B-Instruct`, BF16, no quantization, context length 8192, using the served checkpoint's own tokenizer. | MUST |
| **D-3** | SGLang launches with `--enable-metrics`. | MUST |
| **D-4** | Primary execution path: native Ubuntu on the external HDD, with SGLang in the pinned Docker container via NVIDIA GPU passthrough. Express, Redis and the frontend run natively. | MUST |
| **D-5** | `Qwen/Qwen2.5-0.5B-Instruct` is used only after a recorded acceptance-test failure of the primary model, and the substitution is visible in the result. | MUST |
| **D-6** | Windows 11 + WSL2 is a time-boxed recovery path, entered only on a native-Ubuntu driver or passthrough failure. It is not a parallel environment to maintain. | MUST |
| **D-7** | Hugging Face and FlashInfer caches are persisted via bind mounts so models and JIT artefacts download and compile once. No repartitioning or destructive disk changes. | SHOULD |
| **D-8** | Cloud deployment, Kubernetes, multi-node, distributed SGLang, gateway/router/load balancer, second worker. | CUT |

---

## 2.8 Conflicts — reported, not resolved

Four items where the locked requirements underdetermine the answer. Each needs a decision before implementation; none is resolved here.

### CONFLICT-1 — Who performs the "explicit opt-in" to normalization?

**N-1** requires normalization to be off by default and enabled explicitly. **F-1** requires one action to produce both runs, of which the second is normalized by definition.

If pressing Run Demo silently enables normalization for run 2, the opt-in is implicit and N-1 is weakened. If it does not, the demo cannot complete in one action and F-1 is weakened.

Candidate readings, for a decision: (a) the demo harness is itself the explicit opt-in, scoped to run 2 only, with the runtime pass-through default unchanged for any other caller; (b) the UI carries a visible, pre-checked "normalize run 2" control, making the opt-in explicit at the cost of one extra click's worth of surface. **Not decided here.**

### CONFLICT-2 — No correctness oracle is defined

Multiple locked requirements state that raw and normalized outputs must be validated for task correctness, and the state machine carries a `TASK_DIVERGENCE` reason code. No oracle is specified.

At `temperature=0` the two prompts are different token sequences, so their outputs may legitimately differ without either being wrong. An implementation that tests for string equality would invalidate correct runs; an implementation that tests nothing would let a semantic regression pass as a cache win.

This is a genuine gap, not an oversight to paper over. Until an oracle is defined, `TASK_DIVERGENCE` cannot be evaluated and the correctness guarantee is weaker than the locked text implies. **Owner: `docs/spec/validity-rules.md`.**

### CONFLICT-3 — Diagnostics versus the section-mapping cut

**O-10** requires diagnostic explanations for prompt variability. Section-boundary token mapping is a hard cut.

A first-divergence *token index* is permitted — it is arithmetic over token arrays. Reporting which named prompt component that index falls inside would be section-boundary mapping and is excluded. The line is narrow and easy to cross by accident while writing a helpful diagnostic. **Recommend an explicit rule in `docs/spec/prefix-analysis.md`: diagnostics may cite token indices and may cite component identity supplied by the developer's own classification, but must not derive a mapping from token position to component.**

### CONFLICT-4 — A MUST depends on an unresolved runtime fact

**B-3** and **B-6** (cold validation, comparison) depend on **B-4** (runtime-derived tolerance), which depends on an observation not yet made. This is a dependency rather than a contradiction, and B-4 handles it correctly by refusing to start. It is listed so that nobody treats "the demo doesn't run" on Day 0 as a bug.

---

## 2.9 Assumptions requiring verification

Every one is `RUNTIME_PENDING` on the target laptop. None can be settled by reading code.

| ID | Assumption | If false |
|---|---|---|
| **V-A** | Host NVIDIA driver ≥ 580.65.06, so the CUDA 13 pinned image runs. | Nothing starts. Upgrade the driver, or confirm a CUDA 12.9 `v0.5.18` tag actually exists before using one. |
| **V-B** | The effective KV page size is observable at startup. | B-4 fires; the runner refuses to start. |
| **V-C** | Qwen2.5-1.5B BF16 at 8192 context fits in 8 GB with KV capacity ≥ 24,576 tokens after the `mem-fraction-static` mitigation ladder. | D-5 fires; 0.5B fallback, recorded. |
| **V-D** | `meta_info.cached_tokens` behaves as prefix reuse: near-zero when cold, near-full on an identical repeat, near the shared length on a partial-prefix repeat. | Per-request native cache measurement is marked unavailable. LCP stays `RADIXSCOPE_DERIVED` and is not called a cache hit. The product states plainly that it cannot prove native cache reuse. |
| **V-E** | The first streamed frame reliably carries generated output. | O-8 is dropped. `ttft_ms` is omitted, not substituted. |
| **V-F** | Ports 30000 / 8080 / 6379 / 5173 are free. | Change the port. Not an architecture change. |

Version dependence: **every SGLang claim in this document is verified against `v0.5.18` only.** A version bump invalidates `sglang-integration.md` and requires re-verification of `cached_tokens`, `num_retractions`, `/flush_cache` semantics, the `--enable-metrics` timing fields, the radix-cache and scheduling defaults, page-size resolution, and `/health` non-generating behaviour.

---

## 2.10 Acceptance criteria

The MVP is accepted when all of the following are demonstrably true on the target laptop.

| ID | Criterion | Measurable outcome |
|---|---|---|
| **A-1** | One action, full sequence | A single click produces flush → raw → collect → flush → normalized → collect → compare → render with no further input. |
| **A-2** | Cold starts verified | Both runs preceded by a 200 from `/flush_cache?timeout=30`; both first requests within the resolved tolerance; both observed values recorded. |
| **A-3** | Settings equality | The run document shows `temperature=0`, `n=1`, `max_new_tokens=256`, `concurrency=1`, speculative decoding off, for both modes. |
| **A-4** | Reuse difference is visible | The normalized run reports a higher total `cached_tokens` than the raw run, with both per-request values shown. *If it does not, the demo has still succeeded as a measurement — but the product's claim must be reported as unproven, not restated as a win.* |
| **A-5** | Provenance is complete | Every numeric on the dashboard carries a tag. Spot-check: no `RADIXSCOPE_DERIVED` value is described as SGLang cache state anywhere in the UI. |
| **A-6** | Invalid runs fail loudly | Deliberately skipping a flush produces `INVALID / WARM_START` with the observed value and reason code shown, and no comparison rendered. |
| **A-7** | Default is pass-through | With normalization disabled, the assembled prompt is byte-identical to the authored prompt. |
| **A-8** | Precedence and ordering hold | In both modes, `SYSTEM` is at position 0; conversation, tool and agent order match the authored sequence. |
| **A-9** | Frontend is not in the path | Closing the browser mid-run does not affect the recorded result; reopening and polling the same `runId` shows the completed run. |
| **A-10** | Locality | No outbound network call other than to the local SGLang port and local Redis during a run. |
| **A-11** | Scope discipline | No gateway, router, second worker, WebSocket/SSE to the browser, quantization, or speculative decoding exists in the codebase. |

**A-4 deserves emphasis.** The acceptance bar is a *valid, honestly-labelled measurement*, not a favourable one. A run that correctly reports no improvement is a passing run. A run that reports an improvement it cannot substantiate is a failure regardless of the number.

---

## 2.11 Non-goals

Stated so they are not rediscovered mid-build:

- Beating, replacing, or competing with SGLang's router or cache-aware routing.
- Optimising inference performance in any way.
- Visualising SGLang's radix tree, or mapping token positions to prompt sections.
- Rewriting prompts with an LLM, or optimising them automatically.
- Serving multiple users, multiple workers, or multiple models simultaneously.
- Production readiness: auth, TLS, HA, scaling, CI/CD, monitoring stacks, secret management.
- Generalising beyond the one fixed multi-agent workload.
- Proving a specific percentage improvement. The product proves that the difference is *observable and measurable*, not that it reaches any particular size.

---

## 2.12 Traceability

| ID | Category | Priority | Demo evidence | Owning future document |
|---|---|---|---|---|
| F-1 | Functional | MUST | One click runs the full §1 sequence | `docs/spec/http-api.md` |
| F-2 | Functional | MUST | Three agent records per run, in order | `docs/spec/workload.md` |
| F-3 | Functional | MUST | Component manifest in the run document | `docs/spec/prompt-model.md` |
| F-4 | Functional | MUST | Raw and normalized prompts both stored | `docs/spec/normalization-rules.md` |
| F-5 | Functional | MUST | Cross-run equality check passes | `docs/spec/validity-rules.md` |
| F-6 | Functional | MUST | Agent timestamps strictly increasing | `docs/spec/workload.md` |
| F-7 | Functional | MUST | Comparison document + rendered chart | `docs/spec/dashboard.md` |
| F-8 | Functional | SHOULD | Records appear during the run | `docs/spec/dashboard.md` |
| F-9 | Functional | SHOULD | Reload resumes the view | `docs/spec/http-api.md` |
| B-1 | Benchmark | MUST | Settings recorded for both modes | `docs/spec/benchmark-protocol.md` |
| B-2 | Benchmark | MUST | Two 200s from `/flush_cache` per demo | `docs/spec/benchmark-protocol.md` |
| B-3 | Benchmark | MUST | Two cold assertions logged | `docs/spec/validity-rules.md` |
| B-4 | Benchmark | MUST | Tolerance value in the run document | `docs/spec/validity-rules.md` |
| B-5 | Benchmark | MUST | First-request value present in every run | `docs/spec/telemetry-model.md` |
| B-6 | Benchmark | MUST | No comparison rendered on INVALID | `docs/spec/benchmark-protocol.md` |
| B-7 | Benchmark | MUST | Request log shows no calls in the window | `docs/spec/benchmark-protocol.md` |
| B-8 | Benchmark | MUST | INVALID has no exit transition | `docs/spec/benchmark-protocol.md` |
| B-9 | Benchmark | MUST | Model recorded in the run fingerprint | `docs/spec/validity-rules.md` |
| B-10 | Benchmark | SHOULD | `num_retractions` beside each value | `docs/spec/telemetry-model.md` |
| N-1 | Normalization | MUST | Pass-through byte-identical (A-7) | `docs/spec/normalization-rules.md` |
| N-2 | Normalization | MUST | Repeated run yields identical prompt | `docs/spec/normalization-rules.md` |
| N-3 | Normalization | MUST | Only whitelisted components moved | `docs/spec/normalization-rules.md` |
| N-4 | Normalization | MUST | Original recoverable from manifest | `docs/spec/normalization-rules.md` |
| N-5 | Normalization | MUST | Refusals visible in the run record | `docs/spec/normalization-rules.md` |
| N-6 | Normalization | MUST | Diff shows moves only, no rewrites | `docs/spec/normalization-rules.md` |
| N-7 | Normalization | SHOULD | Per-run component diff rendered | `docs/spec/dashboard.md` |
| S-1 | Safety | MUST | `SYSTEM` at index 0 in both modes | `docs/spec/prompt-model.md` |
| S-2 | Safety | MUST | Whitelist rejects trust-inverting moves | `docs/spec/normalization-rules.md` |
| S-3 | Safety | MUST | Turn order matches authored order | `docs/spec/prompt-model.md` |
| S-4 | Safety | MUST | Tool call/result adjacency preserved | `docs/spec/prompt-model.md` |
| S-5 | Safety | MUST | Same as F-6 | `docs/spec/workload.md` |
| S-6 | Safety | MUST | Correctness check (see CONFLICT-2) | `docs/spec/validity-rules.md` |
| S-7 | Safety | MUST | No non-local outbound calls (A-10) | `docs/spec/state-model.md` |
| S-8 | Safety | MUST | All keys namespaced by `runId` | `docs/spec/state-model.md` |
| S-9 | Safety | SHOULD | TTL set on run keys | `docs/spec/state-model.md` |
| S-10 | Safety | SHOULD | Logs show hashes, not bodies | `docs/spec/telemetry-model.md` |
| O-1 | Observability | MUST | Three tagged sub-objects per record | `docs/spec/telemetry-model.md` |
| O-2 | Observability | MUST | Tags visible on every dashboard numeric | `docs/spec/dashboard.md` |
| O-3 | Observability | MUST | UI copy review (A-5) | `docs/spec/dashboard.md` |
| O-4 | Observability | MUST | Native fields present per request | `docs/spec/telemetry-model.md` |
| O-5 | Observability | MUST | Measured fields present per request | `docs/spec/telemetry-model.md` |
| O-6 | Observability | MUST | Derived fields in the comparison | `docs/spec/prefix-analysis.md` |
| O-7 | Observability | MUST | Chart renders both modes | `docs/spec/dashboard.md` |
| O-8 | Observability | SHOULD | `ttft_ms` present or explicitly absent | `docs/spec/telemetry-model.md` |
| O-9 | Observability | SHOULD | `prefill_duration_ms` named correctly | `docs/spec/telemetry-model.md` |
| O-10 | Observability | SHOULD | Diagnostics labelled as inference | `docs/spec/prefix-analysis.md` |
| NF-1 | Non-functional | MUST | Runs on the target laptop | `technical-design.md` §2 |
| NF-2 | Non-functional | MUST | Process inventory (A-11) | `system-architecture.md` §12 |
| NF-3 | Non-functional | MUST | Browser-close test (A-9) | `system-architecture.md` §1.3 |
| NF-4 | Non-functional | MUST | Network tab shows polling only | `docs/spec/dashboard.md` |
| NF-5 | Non-functional | MUST | Redis key audit | `docs/spec/state-model.md` |
| NF-6 | Non-functional | MUST | Naming review across code and docs | `system-architecture.md` §3 |
| NF-7 | Non-functional | MUST | Delivered inside the window | — |
| NF-8 | Non-functional | SHOULD | Demo wall time recorded | `docs/spec/benchmark-protocol.md` |
| D-1 | Deployment | MUST | Immutable tag in the launch profile | `docs/ops/sglang-launch.md` |
| D-2 | Deployment | MUST | `/get_model_info` matches the lock | `docs/ops/sglang-launch.md` |
| D-3 | Deployment | MUST | `/metrics` reachable | `docs/ops/sglang-launch.md` |
| D-4 | Deployment | MUST | Startup checklist completed | `technical-design.md` §2.9 |
| D-5 | Deployment | MUST | Model named in every result | `docs/ops/sglang-launch.md` |
| D-6 | Deployment | MUST | WSL2 time box respected | `technical-design.md` §2.10 |
| D-7 | Deployment | SHOULD | Second startup materially faster | `docs/ops/sglang-launch.md` |

**Count:** 50 MUST, 11 SHOULD, 5 NICE, 9 CUT across §2.1–2.7. The 50 MUSTs are the 48-hour build; everything else is optional. The traceability table above lists MUST and SHOULD only — NICE and CUT items have no demo evidence to trace.
