# RadixScope — Architecture

RadixScope is DevTools for SGLang prefix caching. It shows a developer why a given
prompt is or is not reusable by SGLang's radix prefix cache, and what happens to
cache hit rate when prompt structure is normalized.

RadixScope does not replace, wrap, or attempt to outperform SGLang's router,
scheduler, or cache-aware load balancer. It observes and reports.

---

## 1. Scope

### 1.1 What the system does

A single **Run Demo** action executes a fixed, sequential pipeline:

```
flush → RAW run → measure → flush → NORMALIZED run → measure → validate → compare → display
```

The workload is one planner agent and two worker agents executing one task,
sequentially, against one SGLang instance.

### 1.2 Invariance requirement

The RAW and NORMALIZED runs must be identical in every respect except approved
prompt structure. Specifically identical: model and revision, task content, agent
sequence, generation settings, hardware, SGLang instance, and measurement logic.

Any divergence outside the approved structural set invalidates the comparison.
Enforcement is described in §5 (Validity Gate).

### 1.3 Out of scope

Cloud deployment, SGLang gateway, cache-aware routing, scheduler modification,
load balancing, multiple workers, distributed inference, FastAPI, Next.js,
WebSocket/SSE transport to the frontend, radix-tree visualization, section-boundary
token mapping, quantization (AWQ/GPTQ/GGUF), speculative and MTP decoding, other
inference engines, arbitrary prompt rewriting, Kubernetes, production
infrastructure, and any unverified SGLang API.

---

## 2. Module Decomposition

Eleven modules. Each has one responsibility and one owner document under
`docs/spec/`.

| ID | Module | Responsibility |
|----|--------|----------------|
| M1 | Web UI | React SPA, Chart.js rendering, HTTP polling. No client-side measurement. |
| M2 | API Layer | Express HTTP surface. Request validation, run lifecycle endpoints, polling responses. |
| M3 | Run Orchestrator | Executes the fixed pipeline in §1.1. Owns ordering; owns nothing else. |
| M4 | Workload Driver | Constructs and issues the planner + two-worker agent sequence for one task. |
| M5 | Prompt Normalizer | Opt-in, deterministic, reversible restructuring of prompt segments. |
| M6 | SGLang Client | Sole owner of HTTP contact with SGLang: `/generate`, `/flush_cache`, `/health`. |
| M7 | Single-Flight Controller | Guarantees exactly one demo run is in flight, process-wide. See §4. |
| M8 | Measurement Collector | Captures `cached_tokens`, `ttft_ms`, `prefill_duration_ms`, `total_latency_ms`. |
| M9 | Validity Gate | Cold-start check and SHA-256 invariance check. Can veto a run. See §5. |
| M10 | State Store | Redis. Run records, single-flight lock, measurement payloads. |
| M11 | Comparison & Reporting | Computes deltas, applies provenance tags, produces the display payload. |

### 2.1 Dependency direction

```
M1 ──HTTP──▶ M2 ──▶ M3 ──▶ M4 ──▶ M5
                     │       │
                     │       └──▶ M6 ──HTTP──▶ SGLang
                     │              │
                     ├──▶ M7        └──▶ M8
                     ├──▶ M9
                     └──▶ M11
                            │
             all modules ───┴──▶ M10 (Redis)
```

M6 is the only module permitted to issue an SGLang request. This is not a style
preference: the measurement guarantees in §4 and §5 depend on a single
chokepoint through which every request to the engine is observable.

---

## 3. Measurement and Provenance

### 3.1 Primary metric

`meta_info.cached_tokens`, returned by `/generate`. It is used only after the
pinned SGLang version has been confirmed to return the field with the expected
semantics. Absence of the field is a hard failure, not a fallback condition.

### 3.2 Timing metrics are not interchangeable

Three distinct quantities are recorded and never conflated:

- **`ttft_ms`** — measured by Express, from request dispatch to first streamed
  token. Includes network and framework overhead.
- **`prefill_duration_ms`** — reported by the SGLang server. Server-side prefill
  time only.
- **`total_latency_ms`** — Express-measured wall clock for the full response.

`prefill_finished_time` is never labelled as TTFT.

### 3.3 Streaming exception

The WebSocket/SSE prohibition applies to the frontend↔Express boundary only. M6
may consume SGLang's native streaming `/generate` internally, because `ttft_ms`
cannot otherwise be measured. The frontend still polls.

### 3.4 Provenance tags

Every metric carries exactly one tag:

| Tag | Meaning |
|-----|---------|
| `SGLANG_NATIVE` | Returned by SGLang. Not computed by RadixScope. |
| `RADIXSCOPE_MEASURED` | Observed by RadixScope at its own boundary. |
| `RADIXSCOPE_DERIVED` | Computed by RadixScope from other values. |

Derived prefix-matching estimates are never presented as internal SGLang cache
state. This distinction is load-bearing for the product's honesty claim, and the
UI renders the tag alongside the number rather than in a footnote.

---

## 4. M7 — Single-Flight Execution Model

### 4.1 Problem

Cache measurement is destructive to itself. A single stray request between a
successful `flush_cache` and the first measured request will populate the radix
cache and silently inflate the next run's hit rate. A second concurrent demo run
does exactly this.

### 4.2 Guarantee

At most one demo run exists in flight per RadixScope deployment, across all
connected clients.

### 4.3 Mechanism

M7 holds a single lock key in Redis with a TTL exceeding the maximum expected run
duration. Acquisition is atomic (`SET key value NX PX ttl`).

- Acquired → the run proceeds and receives a run ID.
- Not acquired → the request returns the **existing** run ID and its current
  status. It does not queue, and it does not start a second run.

The caller therefore cannot distinguish "I started this run" from "I joined the
run already underway" except by the returned status, which is intentional. Both
outcomes yield the same polling behaviour in M1.

### 4.4 Lock release

The lock is released on terminal states only: `COMPLETED`, `INVALID`, `FAILED`.
TTL expiry is a backstop for process death, not a normal path. A run that loses
its lock to TTL expiry mid-execution is marked `INVALID` on completion, because
another run may have contaminated the cache in the interval.

### 4.5 Quiet period

Between a successful flush and the first measured request of a run, M6 issues no
SGLang request of any kind — no health generation, no warm-up, no tokenization
probe. `/health` is used for liveness; `/health_generate` is never called,
because it performs inference and would populate the cache.

Note that SGLang itself runs a warm-up `/generate` at startup before advertising
readiness. The cache is therefore non-empty when the server becomes available.
This is precisely why the flush before the RAW run is mandatory rather than
defensive.

---

## 5. M9 — The Validity Gate

The gate runs after both runs complete and before any comparison is displayed.
It can veto. A vetoed run is reported as **BENCHMARK INVALID** and is never
rendered as an improvement.

### 5.1 Check 1 — Cold start

The first request of each run must show approximately zero cached tokens.
"Approximately" is derived at runtime from the observed page size of the pinned
build, not hardcoded to literal zero.

The observed first-request `cached_tokens` is recorded for both runs. If either
exceeds the validated tolerance, the run is invalid — the flush did not take
effect, or something contacted the engine during the quiet period.

### 5.2 Check 2 — SHA-256 invariance

The two runs are proven identical by construction, byte-for-byte, over the
invariant set.

**Canonicalization.** For each run, M9 assembles an invariant record and
serializes it deterministically: keys sorted lexicographically, no insignificant
whitespace, UTF-8, integers unquoted, floats in fixed representation. The
serialization is byte-stable across processes and machines.

**Invariant set** (hashed as `invariant_hash`):

- Model path and revision
- Tokenizer identity and revision
- Generation settings: `temperature=0`, `n=1`, `max_new_tokens=256`,
  concurrency `1`, speculative decoding disabled
- Agent sequence: ordered list of agent roles and their invocation order
- Task content
- Measurement code version
- Pinned SGLang version and launch arguments

**Excluded set** (hashed separately as `structure_hash`): the prompt segment
layout — the only thing normalization is permitted to change.

**Gate condition:**

```
invariant_hash(RAW) == invariant_hash(NORMALIZED)     → required
structure_hash(RAW) != structure_hash(NORMALIZED)     → expected when normalization is on
```

Equal invariant hashes mean the two runs differed in nothing but approved
structure. Unequal hashes mean the comparison is meaningless, and M9 says so
rather than reporting a delta.

Splitting the hash in two is deliberate. A single hash over everything would
prove the runs identical and prove nothing useful. Two hashes localize the
difference to the one dimension under test, and make the excluded set an explicit,
auditable list rather than an implicit gap.

### 5.3 Normalization constraints

M5 is off by default. When enabled it must be deterministic, auditable, and
reversible, and it is skipped whenever semantic equivalence is uncertain.

It must never: rewrite arbitrary content, weaken or dilute system instructions,
move untrusted content above trusted content, or reorder conversation history,
tool calls, or causally dependent requests. Instruction precedence, tool-result
ordering, and agent causality are preserved. Minimal tenant and session separation
is maintained.

---

## 6. Runtime Environment

### 6.1 Primary path — Ubuntu + pinned container

The supported execution path is native Ubuntu running the pinned SGLang container.

| Component | Pinned value |
|-----------|--------------|
| SGLang | `v0.5.18` |
| Image | `lmsysorg/sglang:v0.5.18` |
| Model | `Qwen/Qwen2.5-1.5B-Instruct` |
| Precision | BF16, no quantization |
| Context length | 8192 |
| GPU access | NVIDIA Container Toolkit passthrough |
| Launch flag | `--enable-metrics` |

Fallback to `Qwen/Qwen2.5-0.5B-Instruct` is permitted only after the primary
model fails a defined runtime acceptance test — not on suspicion, and not for
convenience.

Hardware: RTX 4060 Mobile (8 GB VRAM), i7-13650HX, 16 GB RAM. Ubuntu runs from an
external HDD.

### 6.2 Recovery path — WSL2

Windows 11 with WSL2 is a time-boxed recovery path, used when the Ubuntu boot
volume is unavailable. It is not a supported target and results obtained on it are
classified separately.

Native Windows execution is impossible, for two independent reasons:

1. `flashinfer_python` and `apache-tvm-ffi` are core, unconditional dependencies
   in SGLang's `pyproject.toml`, published as Linux wheels only. Windows falls
   back to a source build that requires a CUDA toolchain.
2. `sglang/srt/entrypoints/http_server.py` imports `uvloop` unconditionally and
   installs its event loop policy at module load. uvloop does not support
   Windows. This blocks the server even if dependency (1) were resolved.

Additional core dependencies published for manylinux x86_64 only: `sglang-kernel`,
`sgl-deep-gemm`, `sgl-deep-ep`, `quack-kernels`, `torch_memory_saver`,
`tokenspeed_mla`, `humming-kernels`, `tilelang`.

`--attention-backend triton` selects a runtime kernel and does not remove the
install-time dependency. There is no SGLang release, pin, or backend flag that
enables native Windows execution.

Setup procedure: [`docs/ops/wsl2-setup.md`](docs/ops/wsl2-setup.md).

### 6.3 Mock proxy

A mock SGLang proxy exists for frontend and orchestration development when no GPU
is available. It exercises M1–M5 and M7–M11 against synthetic responses.

Runs executed against the mock are tagged `MOCK` at the run record level and are
excluded from any cache-behaviour claim. The mock demonstrates the validation
workflow; it does not measure SGLang, and no number originating from it is
presented as a cache measurement.

---

## 7. Verification Status

Every claim in this repository carries one of the following classifications.
They are recorded per-component in `docs/architecture/sglang-integration.md`.

| Classification | Meaning |
|----------------|---------|
| `SOURCE_VERIFIED_V0_5_18` | Confirmed by reading pinned SGLang source. |
| `RUNTIME_VERIFIED_LAPTOP` | Confirmed by execution on the target hardware. |
| `RUNTIME_PENDING` | Not yet executed. Design intent only. |
| `VERSION_DEPENDENT` | Behaviour varies across SGLang versions. |
| `UNAVAILABLE` | Required capability absent. |

Evidence is separated into **measured**, **cited**, and **estimated** classes.
Model file size on disk is never presented as VRAM consumption.

Components not yet executed against a live SGLang instance are `RUNTIME_PENDING`.
That classification is not a defect to be hidden; it is the reason the Validity
Gate exists.

---

## 8. Document Map

| Path | Contents |
|------|----------|
| `docs/architecture/system-architecture.md` | Module interaction detail |
| `docs/architecture/technical-design.md` | §2 Stack verification |
| `docs/architecture/sglang-integration.md` | SGLang API verification record |
| `docs/architecture/README.md` | §2 MVP requirements (F-/B-/N-/S-/O-/NF-/D-/A-) |
| `docs/spec/` | One document per module, M1–M11 |
| `docs/ops/wsl2-setup.md` | Recovery-path environment setup |
| `server/src/` | Express backend |
| `web/src/` | React SPA |
| `ops/sglang/` | SGLang launch configuration |
