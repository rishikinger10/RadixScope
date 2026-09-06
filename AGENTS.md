# RadixScope — Agent Guide

**Project:** RadixScope — DevTools for SGLang prefix caching  
**Build window:** 48 hours, two developers  
**Goal:** Demonstrate measurable cache-reuse improvement from prompt normalization on SGLang ``v0.5.18``

---

## 1. Read these first

Before writing any code, read these documents in order:

1. ``Docs/README.md`` — requirements, priorities, acceptance criteria (the law)
2. ``Docs/system-architecture.md`` — components, flows, invariants
3. ``Docs/technical-design.md`` — stack, VRAM budget, module specs, call traces
4. ``Docs/sglang-integration.md`` — pinned v0.5.18 API contract

When the remaining docs arrive, read them too:
- ``Docs/prefix-engine.md``, ``Docs/data-contract.md``, ``Docs/api-contract.md``
- ``Docs/security.md``, ``Docs/deployment.md``, ``Docs/testing.md``, ``Docs/decisions.md``
- ``docs/implementation/48-hour-plan.md``, ``docs/implementation/IMPLEMENTATION_ORDER.md``

---

## 2. Architecture invariants — check before every merge

| # | Invariant |
|---|---|
| I-1 | Exactly one SGLang worker, one Express process, one Redis instance, one frontend. |
| I-2 | Express contains an SGLang **client module** (library). Never call it a gateway, router, proxy, or service. |
| I-3 | The React frontend issues no prompt, holds no invariant, computes no metric. Frontend crash != run corruption. |
| I-4 | Raw and normalized runs are identical in model, task, content, agent sequence, settings, server, measurement code. Structure only differs. |
| I-5 | temperature=0, n=1, max_new_tokens=256, concurrency=1, no speculative decoding, no MTP — asserted at runtime. |
| I-6 | Both runs preceded by POST /flush_cache?timeout=30 -> 200. Cold validated. Otherwise INVALID. |
| I-7 | No SGLang call inside a protected window (flush -> first generate). /health_generate never called. |
| I-8 | Every dashboard numeric carries a provenance tag. No derived value presented as SGLang cache state. |
| I-9 | Prompts unchanged by default. Normalization is opt-in, deterministic, reversible, refuses under uncertainty. |
| I-10 | SYSTEM at position 0 always. Untrusted content never above trusted. Conversation/tool/agent order preserved. |
| I-11 | Redis holds only run, request, poll state. Not a queue, bus, prompt store, or SGLang mirror. |
| I-12 | No cloud, Kubernetes, gateway, WebSocket/SSE to browser, FastAPI, Next.js, quantization, spec decoding, or radix-tree viz. |
| I-13 | SGLang pinned to v0.5.18 by immutable tag. |
| I-14 | 0.5B model only after recorded acceptance-test failure of 1.5B, visible in result. |
| I-15 | Builds and runs on RTX 4060 Mobile + 16 GB RAM laptop within 48 hours. |

---

## 3. Project structure

```
RadixScope/
+-- server/                   # Express orchestrator (Node/TypeScript)
¦   +-- src/
¦       +-- config/           # M1 — load/freeze config + LOCKED_SAMPLING
¦       +-- contracts/        # M2 — shared TypeScript types + Zod validators
¦       +-- sglang/           # M3 — SGLang client module (HTTP + parseMetaInfo)
¦       +-- workload/         # M4 — fixed 3-agent sequence + causality
¦       +-- prompt/
¦       ¦   +-- assemble/     # M5 — prompt assembler
¦       ¦   +-- normalize/    # M6 — deterministic, reversible normalizer
¦       +-- benchmark/
¦       ¦   +-- runner/       # M7 — benchmark state machine (the only sequencer)
¦       ¦   +-- validity/     # M8 — cold/settings/content/server validity gate
¦       +-- analysis/         # M9 — LCP, divergence, reuse ratio, diagnostics
¦       +-- store/            # M10 — Redis access (ONLY module that touches Redis)
¦       +-- api/              # M11 — four HTTP endpoints (parse, delegate, serialize)
+-- web/                      # React + Chart.js dashboard (Vite, port 5173)
+-- ops/
¦   +-- sglang/               # C12 — Docker run command, launch profile
+-- Docs/                     # Architecture and spec documents (read-only)
+-- AGENTS.md                 # This file
```

---

## 4. Module dependency rules

```
M11 api        -> M7, M10 only
M7 runner      -> M1, M2, M3, M4, M5, M8, M9, M10
M5 assembler   -> M2, M6
M6 normalizer  -> M2 only          (pure, no I/O)
M8 validity    -> M2 only          (pure, no I/O)
M9 analysis    -> M2 only          (pure, no I/O)
M3 sglangClient -> M1, M2 only    (only HTTP caller)
M4 workload    -> M2 only
M10 store      -> M2, redis client only
M1 config      -> M2 only
M2 contracts   -> nothing
```

Critical rules:
- M11 never calls M3, M4, M5, M6, M8, M9 directly
- M3 is the ONLY module that knows SGLang exists as HTTP
- M7 is the ONLY sequencer
- M6, M8, M9 are pure functions — no I/O, no clock, no randomness
- M10 is the ONLY Redis importer

---

## 5. API surface

| Method | Path | Response | Notes |
|---|---|---|---|
| POST | /api/benchmark | 202 { runId } or 409 | Starts a run. 409 if one is active. |
| GET | /api/benchmark/:runId | Run projection | Phase, records, verdict, comparison when done. |
| GET | /api/health | Health object | Express + Redis + SGLang reachability. |
| GET | /api/runs | Run summaries | Last N. NICE — cut first if time is short. |

No fifth endpoint. No streaming endpoint. No WebSocket. No SSE.

---

## 6. Provenance tags — non-negotiable

Every numeric must carry one of:
- SGLANG_NATIVE — from SGLang meta_info or server APIs
- RADIXSCOPE_MEASURED — client-side timing (latency, TTFT)
- RADIXSCOPE_DERIVED — computed by RadixScope (ratios, LCP, deltas)

TelemetryRecord shape:
  native:   { promptTokens, completionTokens, cachedTokens, finishReason, numRetractions, weightVersion, forwardEntryTime?, prefillFinishedTime?, queueTime? }
  measured: { ttftMs?, totalLatencyMs, promptTokenIds, assembledAt }
  derived:  { reuseRatio, prefillDurationMs?, lcpWithPrevious, firstDivergenceIndex, diagnostics[] }

---

## 7. Benchmark state machine phases

QUEUED -> PREFLIGHT -> FLUSH_RAW -> RUN_RAW -> VALIDATE_RAW
      -> FLUSH_NORM -> RUN_NORM -> VALIDATE_NORM -> COMPARE -> COMPLETE

Any failure -> INVALID (terminal, absorbing, never rendered as a win)

INVALID reason codes: FLUSH_FAILED, WARM_START, META_MISSING, SETTINGS_MISMATCH,
                      CONTENT_MISMATCH, TASK_DIVERGENCE, SERVER_CHANGED, RUNTIME_ERROR

---

## 8. SGLang client contract (v0.5.18 only)

Verified endpoints:
- POST /generate  { text, sampling_params: { temperature:0, n:1, max_new_tokens:256 }, stream }
- POST /flush_cache?timeout=30  — 200 = success, non-200 = FLUSH_FAILED
- GET  /health  — ONLY health endpoint (NEVER /health_generate)
- GET  /get_server_info  — server fingerprint + page size
- POST /tokenize  — token IDs for LCP analysis
- GET  /metrics  — Prometheus (corroborative only)

NEVER retry /generate or /flush_cache inside a run.
NEVER call /health_generate.

---

## 9. Cold-start tolerance

  tolerance = observed effective page_size (from PREFLIGHT)
  page_size == 1 -> tolerance = 0 -> assertion: cached_tokens == 0
  page_size > 1  -> assertion: cached_tokens <= page_size
  page_size unresolvable -> REFUSE TO START (not INVALID)

---

## 10. Redis key schema (24-hour TTL on all)

  run:{runId}             — Run document (phase, settings, fingerprint)
  run:{runId}:req:{i}     — TelemetryRecord per request
  run:{runId}:comparison  — ComparisonDoc
  run:{runId}:verdict     — ValidityVerdict
  run:{runId}:fingerprint — ServerFingerprint
  lock:benchmark          — Single-flight marker

---

## 11. Explicitly CUT (do not build)

- WebSocket or SSE to browser
- Gateway/router/proxy/scheduler in Express
- Second SGLang worker
- FastAPI, Next.js
- Quantization, speculative decoding, MTP
- Radix-tree visualization or section-boundary token mapping
- LLM-assisted prompt rewriting
- User-editable prompts in UI
- Multiple workloads or task variants
- Auth, TLS, rate limiting, CI/CD, cloud, Kubernetes
- Concurrent benchmark runs

---

## 12. Hardest-to-get-right

- B-4/B-3: Cold-start tolerance comes from runtime page size. Never guess. Refuse to start if unresolvable.
- B-7: Protected window — zero SGLang calls between flush and first generate.
- N-3: Normalizer whitelist — only SHARED_STATIC, AGENT_RULES, DYNAMIC_METADATA may move.
- O-1/O-2: Every numeric on the dashboard must have a provenance tag in the DATA MODEL, not UI decoration.
- A-4: A run that correctly reports no improvement is a PASSING run. Never fabricate a win.
- CONFLICT-2: No oracle for task correctness is defined. TASK_DIVERGENCE code exists but cannot be evaluated.

---

## 13. Stack

- SGLang: lmsysorg/sglang:v0.5.18 in Docker, port 30000
- Model: Qwen/Qwen2.5-1.5B-Instruct, BF16, ctx 8192, --enable-metrics
- Backend: Express (Node/TypeScript), port 8080
- Store: Redis (native, no persistence), port 6379
- Frontend: React 19 + Chart.js 4 + Vite 8, port 5173
- Hardware: RTX 4060 Mobile 8 GB, i7-13650HX, 16 GB RAM
