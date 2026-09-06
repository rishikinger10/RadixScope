# RadixScope — SGLang Integration and Verification

**Artifact:** Prompt 02 output
**Pinned version:** SGLang `v0.5.18`
**Status:** Source verification complete. Runtime verification pending on the target laptop.
**Companion:** `docs/architecture/system-architecture.md` (resolves BLOCKER-1 / V-0 partially — see §10)

---

## 1. What this document is and is not

This is a verification record, not a design. Every claim below carries a classification that states *how* it was established. Two classifications are decisive and must not be conflated:

| Classification | Means |
|---|---|
| `SOURCE_VERIFIED_V0_5_18` | Read directly from the `v0.5.18` tagged tree, or stated in the official documentation for this release. Establishes **intended behaviour**. |
| `RUNTIME_VERIFIED_LAPTOP` | Observed on the RTX 4060 Mobile laptop with the pinned image and model. Establishes **actual behaviour**. No row carries this yet. |
| `RUNTIME_PENDING` | Depends on GPU, driver, memory, kernel backend or observed timing. Cannot be settled by reading code. |
| `VERSION_DEPENDENT` | Behaviour that is known to vary across SGLang versions or configurations; re-verify on any version bump. |
| `UNAVAILABLE` | Does not exist on this version, or exists but cannot be used within RadixScope's locked constraints. |

Source inspection cannot establish GPU compatibility, memory feasibility, runtime response shape, kernel backend selection, cache granularity, or observed timing. Those require a laptop run. Nothing in this document should be treated as settled until the §9 checklist comes back filled in.

### 1.1 Verified source basis

Tagged tree inspected: `v0.5.18`, tagged 2026-08-20, published to PyPI 2026-08-21 as `sglang==0.5.18`. All line references below are to that tag.

Why this tag: the official installation page's from-source method currently reads `git clone -b v0.5.18` — this is the release the documentation itself points at. `v0.5.19` exists (PyPI 2026-09-04) but is two days old at the time of writing; for a 48-hour build, seventeen days of field exposure is worth more than two days of newer fixes.

---

## 2. Environment and image

### 2.1 CUDA and driver

| Item | Classification | Evidence |
|---|---|---|
| `v0.5.18` pins `torch==2.13.0` | `SOURCE_VERIFIED_V0_5_18` | `python/pyproject.toml` L81 |
| Default Docker base is `nvidia/cuda:13.0.3-cudnn-devel-ubuntu24.04` | `SOURCE_VERIFIED_V0_5_18` | `docker/Dockerfile` L1–2 (`ARG CUDA_VERSION=13.0.3`) |
| SGLang ships a CUDA 13 environment by default; CUDA 12 images carry a `-cu12` or `-cu129` suffix | `SOURCE_VERIFIED_V0_5_18` | Official install docs, "Method 3: Using docker" → Notes |
| Requires Python ≥ 3.10 | `SOURCE_VERIFIED_V0_5_18` | `python/pyproject.toml`, `requires-python` |
| **The laptop's NVIDIA driver satisfies CUDA 13's minimum** | `RUNTIME_PENDING` | Cannot be established from source. **This is the single most likely Day-0 blocker.** |

### 2.2 Image tags

| Item | Classification | Notes |
|---|---|---|
| `lmsysorg/sglang:v0.5.18` — immutable version tag, CUDA 13 | `RUNTIME_PENDING` (existence assumed from the documented convention; confirm by pull) | Docs: `latest` and `dev` are **mutable**; pin an immutable version tag such as `lmsysorg/sglang:v0.5.18` for reproducible deployments. |
| `lmsysorg/sglang:latest` / `:dev` | `UNAVAILABLE` for RadixScope | Mutable. A benchmark pinned to a moving image is not a benchmark. |
| A CUDA 12.9 variant of `v0.5.18` | `RUNTIME_PENDING` | The `-cu129` suffix convention is documented and demonstrably used on past releases (e.g. `v0.5.3-cu129`, `v0.5.4.post2-cu129-arm64` appear on Docker Hub). **Whether a CUDA 12.9 image exists for `v0.5.18` specifically is not verified.** Do not write a tag name into scripts until §9 step 1b confirms it by pull. |

**Rule:** if the driver check fails, the team's next action is to *look up* the actual CUDA 12 tag list for v0.5.18 on Docker Hub and record the exact tag string observed. Do not construct one by pattern.

### 2.3 Deployment shape

Native Ubuntu on the external HDD is primary; Docker with NVIDIA GPU passthrough is the preferred launch method within it; Windows 11 + WSL2 is fallback only. HDD I/O will make first model download and container pull slow — budget for it, it is not a fault condition.

---

## 3. Launch configuration

### 3.1 Verified launch command

```bash
docker run --gpus all \
  --shm-size 8g \
  -p 30000:30000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  --ipc=host \
  lmsysorg/sglang:v0.5.18 \
  python3 -m sglang.launch_server \
    --model-path Qwen/Qwen2.5-1.5B-Instruct \
    --context-length 8192 \
    --mem-fraction-static 0.85 \
    --host 0.0.0.0 \
    --port 30000 \
    --enable-metrics
```

Every flag, and why it is there:

| Flag | Classification | Evidence | Note |
|---|---|---|---|
| `--model-path` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L492 | Locked value. |
| `--context-length 8192` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L581; default `None` → uses model `config.json` | Truncation of the model's native 32,768 window. Legitimate and locked. |
| `--mem-fraction-static 0.85` | `RUNTIME_PENDING` | `server_args.py` L774; default is `None` (auto-computed) | 0.85 is the supplied baseline's own choice, not a default. On 8 GB it must be validated empirically — see §9 step 5. |
| `--host 0.0.0.0` / `--port 30000` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L1277–1278 | `0.0.0.0` is required for container port mapping. |
| `--enable-metrics` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L1547 (default `False`); mounts `/metrics` via `utils/common.py:2538` | **Added to the baseline.** Without it there is no `/metrics` and no scheduler timing in `meta_info`. |
| `--shm-size 8g` | `RUNTIME_PENDING` | Docs example uses 32g for an 8B model | Reduced for a 1.5B model on a 16 GB-RAM laptop. Raise if the container reports shared-memory errors. |

**Not added, deliberately:** no `--attention-backend`, no `--page-size`, no `--schedule-policy`, no `--disable-radix-cache`. Adding any of these without evidence would change what the benchmark measures. The backend and page size are to be *observed* (§9 step 4), not forced.

### 3.2 Defaults that matter

| Setting | Value at v0.5.18 | Classification | Evidence | Consequence for RadixScope |
|---|---|---|---|---|
| `disable_radix_cache` | `False` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L937 | RadixAttention is **on** with the command above. This is the whole premise. |
| `schedule_policy` | `"fcfs"` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L843 (choices include `lpm`, `fcfs`, `lof`, `dfs-weight`, `random`, `priority`, `routing-key`) | Not `lpm`. At `concurrency=1` the waiting queue is never contended, so the policy is inert. **RadixScope's demonstration therefore rests entirely on the radix cache, never on cache-aware scheduling.** State this on the dashboard. |
| `page_size` | `None` → resolves to `1` on non-HIP, non-MUSA platforms | `SOURCE_VERIFIED_V0_5_18` / effective value `RUNTIME_PENDING` | `arg_groups/overrides.py:2378` `_page_size_default` | The resolver's generic branch gives 1, but model- and backend-specific overrides elsewhere in the same file can snap it to 16/64/128. **The effective value must be read at runtime.** It sets the cold-start tolerance (§6.3). |
| Attention backend | `RUNTIME_PENDING` | — | Install docs state FlashInfer is the default kernel backend (sm75+). Backend-specific overrides in `arg_groups/overrides.py` are registered per model family; no override is registered for `Qwen2ForCausalLM`. | Must be read from the startup log. Backend determines page size, which determines the tolerance. |
| `enable_metrics` | `False` | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L1547 | Why `--enable-metrics` is mandatory in the launch command. |

### 3.3 Model

| Item | Classification | Evidence |
|---|---|---|
| Qwen2.5-1.5B-Instruct: 1.54B params (1.31B non-embedding), 28 layers, GQA 12 Q / 2 KV heads, full 32,768 context, 8,192 generation | `SOURCE_VERIFIED_V0_5_18` (model card) | Official Qwen model card spec block, consistent across `Qwen/Qwen2.5-1.5B-Instruct` and its Qwen-published GGUF/AWQ variants |
| BF16 is the checkpoint's native tensor type | `SOURCE_VERIFIED_V0_5_18` | Model card: tensor type BF16, model size 1.54B |
| `--dtype` default `"auto"` uses BF16 for BF16 models | `SOURCE_VERIFIED_V0_5_18` | `server_args.py` L640–648 |
| 8192 context is supported by this checkpoint | `SOURCE_VERIFIED_V0_5_18` | 8192 < 32768 native |
| Weights (~3.1 GB BF16) + KV cache + CUDA context fit in 8 GB with usable KV headroom | `RUNTIME_PENDING` | The binding constraint. See §9 step 5. |
| Fallback `Qwen/Qwen2.5-0.5B-Instruct` | `RUNTIME_PENDING` | Used **only** after a recorded primary-model acceptance failure. No other substitution is permitted — not quantization, not another family. |

---

## 4. Capability register

Each capability below follows the required nine-field form.

### C-1 · Text generation with per-request cache accounting

- **Capability:** Generate a completion and read per-request prefix-cache reuse.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for schema and semantics; `RUNTIME_PENDING` for observed response shape and cold-start values.
- **Interface:** `POST /generate` (also accepts `PUT`).
- **Request format:**
  ```json
  {
    "text": "<assembled prompt string>",
    "sampling_params": {
      "temperature": 0,
      "n": 1,
      "max_new_tokens": 256
    },
    "stream": false
  }
  ```
  Fields confirmed on `GenerateReqInput` (`managers/io_struct.py` L160+): `rid`, `text`, `input_ids`, `sampling_params`, `stream`, `return_logprob`, `log_metrics`, `session_params`, `lora_path`. `SamplingParams` (`sampling/sampling_params.py`) confirms `temperature` (default 1.0), `n` (default 1), `max_new_tokens` (default 128), `stop`, `top_p`, `top_k`, `ignore_eos`, `skip_special_tokens`.
- **Response format (non-streaming):** a JSON object containing `text` and `meta_info`. `meta_info` for a generation request is assembled in `managers/tokenizer_manager.py` (~L2241–2295) and always carries:
  - `id` — the request id (`rid`)
  - `finish_reason`
  - `prompt_tokens`
  - `weight_version`
  - `num_retractions`
  - `reasoning_tokens`
  - `completion_tokens`
  - `cached_tokens`
  - `cached_tokens_details` — present only when populated (HiCache tiering); not relied upon
  - Under `--enable-metrics`, additionally: `forward_entry_time`, `prefill_finished_time`, `queue_time` (`observability/req_time_stats.py:1167`, `SchedulerReqTimeStats.convert_to_output_meta_info`)
- **Evidence/source:** `entrypoints/http_server.py` L889–893 (route); `managers/io_struct.py` L160+ (request); `managers/tokenizer_manager.py` ~L2241–2295 (`meta_info` construction).
- **RadixScope usage:** the only prompt-issuing call in the system. One call per agent, three per run, six per benchmark. `cached_tokens`, `prompt_tokens`, `completion_tokens`, `finish_reason` and `num_retractions` are recorded as `SGLANG_NATIVE`.
- **Limitations:** `n > 1` and batch inputs are outside the locked settings and untested here. `cached_tokens` semantics are subject to cache granularity (see C-2).
- **Runtime verification command:**
  ```bash
  curl -s -X POST localhost:30000/generate \
    -H 'Content-Type: application/json' \
    -d '{"text":"probe","sampling_params":{"temperature":0,"n":1,"max_new_tokens":256}}' \
    | jq '.meta_info'
  ```
- **Fallback behavior:** if `meta_info` is absent or malformed, the run is `INVALID / META_MISSING`. No substitute is computed.

### C-2 · `meta_info.cached_tokens` semantics

- **Capability:** Native measurement of prompt-prefix tokens served from the radix cache.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for the computation; `RUNTIME_PENDING` for granularity and observed cold value; `VERSION_DEPENDENT` — re-verify on any version change.
- **Interface:** `meta_info.cached_tokens` on the `/generate` response.
- **Request format:** n/a (response field).
- **Response format:** integer, tokens.
- **Evidence/source:** `managers/schedule_batch.py` L2474–2477:
  ```python
  # Only calculate cached_tokens once. Once retracted, the 'retracted_stain'
  # flag will always True
  if not req.retracted_stain:
      new_cached = pre_len - req.already_computed
      req.cached_tokens += new_cached
  ```
  It is matched-prefix length (`pre_len`) minus what this request had already computed, accumulated once, and frozen for a retracted request.
- **RadixScope usage:** the headline metric. Tagged `SGLANG_NATIVE`. Cache-reuse ratio (`cached_tokens / prompt_tokens`) is tagged `RADIXSCOPE_DERIVED`.
- **Limitations, all material:**
  1. **Granularity.** The matched prefix is a function of the effective `page_size`. Until §9 step 4 returns a number, "approximately zero" has no defined width.
  2. **Retraction.** A request retracted under memory pressure stops accumulating and will *understate* actual reuse. On 8 GB this is a live risk, not a theoretical one. Mitigated by C-3.
  3. It is not a readout of the radix tree. It is what the scheduler matched for this request under this run's conditions.
- **Runtime verification command:** §9 steps 9–11 (cold, repeat, partial-prefix).
- **Fallback behavior:** if the field is missing or its cold value cannot be made to behave (steps 9–11 fail), then per §7: native per-request cache measurement is marked unavailable, LCP analysis remains explicitly `RADIXSCOPE_DERIVED` and is never called a cache hit, and the product states plainly that the benchmark cannot prove native cache reuse.

### C-3 · `meta_info.num_retractions`

- **Capability:** Detect whether a request was retracted, which would corrupt its `cached_tokens`.
- **Classification:** `SOURCE_VERIFIED_V0_5_18`.
- **Interface:** `meta_info.num_retractions` on `/generate`.
- **Request format:** n/a. **Response format:** integer.
- **Evidence/source:** `managers/tokenizer_manager.py` ~L2246 — included unconditionally in the base `meta_info` dict for generation requests.
- **RadixScope usage:** recorded per request as `SGLANG_NATIVE`. Any run where a measured request reports `num_retractions > 0` is flagged; the retraction is surfaced next to the affected `cached_tokens` value rather than silently averaged in.
- **Limitations:** tells you retraction happened, not how much reuse was lost.
- **Runtime verification command:** included in the C-1 `jq` output.
- **Fallback behavior:** if absent, the retraction risk from C-2 becomes undetectable and must be disclosed on the dashboard.

### C-4 · Cache flush

- **Capability:** Reset the radix cache to a known-cold state before each run.
- **Classification:** `SOURCE_VERIFIED_V0_5_18`.
- **Interface:** `POST /flush_cache?timeout=30` (route accepts `GET` and `POST`).
- **Request format:** query parameter `timeout` — float, seconds, default `0`, minimum `0`. Documented meaning: wait time for idle state before flushing; `0` means fail fast if not idle.
- **Response format:** plain text body. **HTTP 200 on success**, **HTTP 400 on failure**. The success body notes that when running or waiting requests exist the operation is not performed. Failure bodies observed in source include `"Another flush_cache is already in progress."` and `"Timed out waiting for idle state."`.
- **Evidence/source:** `entrypoints/http_server.py` L966–981 (route, status codes); `managers/scheduler_components/flush_wrapper.py` (deferral, deadline, messages); `managers/scheduler.py` L4251 `flush_cache()` gated on L4083 `is_fully_idle()`, which resets `tree_cache`, `req_to_token_pool`, `token_to_kv_pool_allocator` and grammar cache; official docs, "Flush Cache" section, for the `timeout` parameter.
- **RadixScope usage:** called before both the raw and the normalized workload. The benchmark runner treats a non-200 as terminal.
- **Limitations:** the flush only proceeds when the scheduler is fully idle. This is precisely why `concurrency=1` and the single-flight benchmark lock are structural, not cosmetic — they are what makes the flush satisfiable. `timeout=30` converts a fail-fast into a bounded wait.
- **Runtime verification command:**
  ```bash
  curl -s -X POST "localhost:30000/flush_cache?timeout=30" -w ' [%{http_code}]\n'
  ```
- **Fallback behavior:** non-200 → `INVALID / FLUSH_FAILED`. The run stops. There is no "flush probably worked" path.

### C-5 · Health check

- **Capability:** Confirm the server is up without disturbing cache state.
- **Classification:** `SOURCE_VERIFIED_V0_5_18`.
- **Interface:** `GET /health` — **and only `/health`**.
- **Request format:** none. **Response format:** HTTP 200 empty body when healthy; 503 during startup or graceful shutdown.
- **Evidence/source:** `entrypoints/http_server.py` L654–700. `/health` and `/health_generate` share a handler; the handler returns 200 immediately for the `/health` path unless `SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION` is set. Otherwise it issues a real generation with `input_ids=[0]`, `max_new_tokens=1`, `temperature=0.0`.
- **RadixScope usage:** `/api/health` liveness only.
- **Limitations:** **`/health_generate` is `UNAVAILABLE` to RadixScope.** It performs generation and therefore writes into the cache. Any use of it between a flush and the first measured request destroys the cold-start premise. The same prohibition covers warm-up generation, tokenization calls, and any other SGLang request in that window. The environment variable `SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION` must remain unset.
- **Runtime verification command:** `curl -s -o /dev/null -w '%{http_code}\n' localhost:30000/health`
- **Fallback behavior:** non-200 → server not ready; benchmark start is refused before any flush is attempted.

### C-6 · Tokenization

- **Capability:** Obtain token IDs from the served checkpoint's exact tokenizer.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for existence and schema; `RUNTIME_PENDING` for observed response.
- **Interface:** `POST /tokenize` (alias of `POST /v1/tokenize`).
- **Request format:** `{"model": "<model>", "prompt": "<text>", "add_special_tokens": false}`. `TokenizeRequest` (`entrypoints/openai/protocol.py` L1377+) accepts `model`, `prompt`, `messages`, `tools`, `tool_choice`, `chat_template_kwargs` and permits extra fields.
- **Response format:** documented fields `tokens` (list of ids), `count`, `max_model_len`.
- **Evidence/source:** `entrypoints/http_server.py` L1756–1771; official docs, "Tokenize/Detokenize Example (Round Trip)".
- **RadixScope usage:** produces the token arrays for longest-common-prefix and first-divergence analysis, eliminating any drift between RadixScope's tokenizer and the server's. Output is `RADIXSCOPE_MEASURED`; anything computed from it is `RADIXSCOPE_DERIVED`.
- **Limitations:** **This call is itself an SGLang request and is therefore forbidden between a successful flush and the first measured request.** Tokenize *before* the flush, or *after* the run completes. It does not touch the KV cache, but the prohibition is absolute and simpler to obey than to reason about.
- **Runtime verification command:**
  ```bash
  curl -s -X POST localhost:30000/tokenize \
    -H 'Content-Type: application/json' \
    -d '{"model":"Qwen/Qwen2.5-1.5B-Instruct","prompt":"probe","add_special_tokens":false}'
  ```
- **Fallback behavior:** if unavailable, fall back to a local `transformers` tokenizer loaded from the same checkpoint, and record in the run document that token IDs are locally derived rather than server-sourced.

### C-7 · Server and model introspection

- **Capability:** Read effective configuration for the run fingerprint.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for existence; `RUNTIME_PENDING` for which fields carry the values RadixScope needs.
- **Interface:** `GET /get_server_info` (alias `/server_info`), `GET /get_model_info` (alias `/model_info`).
- **Request format:** none.
- **Response format:** `/get_model_info` returns exactly `model_path`, `is_generation`, `tokenizer_path`, `preferred_sampling_params`, `weight_version`, `has_image_understanding`, `has_audio_understanding`, `model_type`, `architectures`, `embedding`. `/get_server_info` returns resolved CLI arguments, token limits and memory-pool sizes; source (`managers/scheduler.py` `get_internal_state`) shows it includes `memory_usage` (weight GB, KV-cache GB, token capacity) and `last_gen_throughput`.
- **Evidence/source:** `entrypoints/http_server.py` L728, L786; official docs "Get Model Info" / "Get Server Info".
- **RadixScope usage:** the run fingerprint (model, weight version, resolved args) recorded once per run and compared between raw and normalized to satisfy the `SERVER_CHANGED` gate. Also the intended source of the effective `page_size` and attention backend.
- **Limitations:** whether `page_size` and `attention_backend` appear as readable keys in this response is `RUNTIME_PENDING`. If they do not, the startup log is the source of record.
- **Runtime verification command:**
  ```bash
  curl -s localhost:30000/get_server_info | jq 'keys'
  curl -s localhost:30000/get_model_info | jq
  ```
- **Fallback behavior:** if the fields are absent, read backend and page size from the container startup log and record them manually in the run document.

### C-8 · Aggregate Prometheus metrics

- **Capability:** Server-wide counters and histograms.
- **Classification:** `SOURCE_VERIFIED_V0_5_18`.
- **Interface:** `GET /metrics` — present only with `--enable-metrics`.
- **Request format:** none. **Response format:** Prometheus text exposition.
- **Evidence/source:** `entrypoints/http_server.py` L285–286 → `utils/common.py:2544` mounts `/metrics`; official Production Metrics documentation lists the names. Confirmed names include `sglang:prompt_tokens_total`, `sglang:generation_tokens_total`, `sglang:cache_hit_rate`, `sglang:token_usage`, `sglang:time_to_first_token_seconds`, `sglang:e2e_request_latency_seconds`, `sglang:time_per_output_token_seconds`, `sglang:num_running_reqs`, `sglang:num_queue_reqs`, `sglang:gen_throughput`. A `sglang:cached_tokens_total` counter also exists in `observability/metrics_collector.py`.
- **RadixScope usage:** **secondary and corroborative only.** These are server-lifetime aggregates, not per-request values. They may be shown alongside the per-request table under their actual documented meanings — `sglang:cache_hit_rate` is "the cache hit rate" for the server, not for a run.
- **Limitations:** aggregates cannot be attributed to a single request, and they do not reset per run (`flush_cache` does call `metrics_reporter.reset_metrics()`, but relying on that as a benchmark boundary is `RUNTIME_PENDING` and not part of the locked protocol). Never present an aggregate as a per-request cache measurement.
- **Runtime verification command:** `curl -s localhost:30000/metrics | grep -E 'cache_hit_rate|cached_tokens|prompt_tokens_total'`
- **Fallback behavior:** if `/metrics` is missing, confirm `--enable-metrics` is present. Metrics are not load-bearing; their absence does not invalidate a run.

### C-9 · Streaming generation for client-observed TTFT

- **Capability:** Measure time to first token as observed by Express.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for the transport; `RUNTIME_PENDING` for whether the first event reliably carries generated output.
- **Interface:** `POST /generate` with `"stream": true`.
- **Request format:** identical to C-1 plus `"stream": true`.
- **Response format:** `StreamingResponse` with `media_type="text/event-stream"`; frames are `data: <json>\n\n`, terminated by `data: [DONE]\n\n`. Errors arrive as a `data:` frame containing an `error` object with `message`, `type`, `code`, `retryable`.
- **Evidence/source:** `entrypoints/http_server.py` L897–930.
- **RadixScope usage:** Express consumes this internally to measure `ttft_ms`. **This is not a frontend feature.** React continues to use ordinary HTTP polling against Express; no SSE or WebSocket reaches the browser, and no new architectural component is created. The SGLang client module (C-1's owner) handles both the streaming and non-streaming paths.
- **Limitations:** `ttft_ms` includes HTTP and framing overhead and is a client-side observation, not a server-internal measurement. Whether the first streamed frame reliably contains generated output — rather than an empty or metadata-only chunk — is `RUNTIME_PENDING` (§9 step 12).
- **Runtime verification command:**
  ```bash
  curl -N -s -X POST localhost:30000/generate \
    -H 'Content-Type: application/json' \
    -d '{"text":"probe","stream":true,"sampling_params":{"temperature":0,"n":1,"max_new_tokens":256}}' \
    | head -5
  ```
- **Fallback behavior:** if streaming cannot be implemented reliably, **`ttft_ms` is dropped and not replaced.** Report the server-side timing under its own accurate name (C-10). Do not relabel a server field as client-observed TTFT.

### C-10 · Server-side prefill timing

- **Capability:** Server-reported prefill boundary.
- **Classification:** `SOURCE_VERIFIED_V0_5_18` for the fields; `RUNTIME_PENDING` for values and units.
- **Interface:** `meta_info.forward_entry_time`, `meta_info.prefill_finished_time`, `meta_info.queue_time` — present only with `--enable-metrics`.
- **Request format:** n/a. **Response format:** numeric timestamps / duration.
- **Evidence/source:** `managers/tokenizer_manager.py` ~L2249–2252 merges `recv_obj.time_stats[i].convert_to_output_meta_info()`; `observability/req_time_stats.py:1167` (`SchedulerReqTimeStats`) defines exactly those three keys.
- **RadixScope usage:** `prefill_duration_ms`, tagged `SGLANG_NATIVE` where taken directly and `RADIXSCOPE_DERIVED` where computed as a difference between two reported timestamps.
- **Limitations:** **`prefill_finished_time` is not TTFT.** It is a server-side prefill boundary and must be displayed under the name `prefill_duration_ms`, never as `ttft_ms`. Absolute timestamp semantics (`convert_time_to_realtime`) need runtime confirmation before differences are computed.
- **Runtime verification command:** included in the C-1 `jq` output; confirm the three keys appear.
- **Fallback behavior:** if absent, omit `prefill_duration_ms` entirely rather than estimating it.

### C-11 · Explicitly excluded interfaces

| Interface | Classification | Reason |
|---|---|---|
| `/health_generate` | `UNAVAILABLE` | Performs generation; contaminates the cold-cache premise. |
| `/v1/chat/completions`, `/v1/completions` | `UNAVAILABLE` for measurement | Chat templating would sit between RadixScope's prompt assembler and the tokens actually sent, breaking the guarantee that structure is the only difference between runs. RadixScope applies its own template and sends `text` to `/generate`. |
| `/update_weights_from_disk` | `UNAVAILABLE` | Out of scope; also triggers an implicit cache flush. |
| HiCache endpoints (`/hicache/*`, `/clear_hicache_storage_backend`) | `UNAVAILABLE` | HiCache is not configured; tiering is out of scope. |
| Session APIs (`/open_session`, `/close_session`) | `UNAVAILABLE` | RadixScope manages conversation state itself; sessions would reconstruct prompts outside its control. |
| gRPC, router, gateway, PD-disaggregation interfaces | `UNAVAILABLE` | Excluded by the locked architecture. |

---

## 5. Data provenance

| Value | Tag | Source |
|---|---|---|
| `prompt_tokens`, `completion_tokens`, `cached_tokens`, `finish_reason`, `num_retractions`, `weight_version` | `SGLANG_NATIVE` | `meta_info` |
| `forward_entry_time`, `prefill_finished_time`, `queue_time` | `SGLANG_NATIVE` | `meta_info` under `--enable-metrics` |
| Server fingerprint, effective page size, attention backend | `SGLANG_NATIVE` | `/get_server_info` or startup log |
| `tokens`, `count` from `/tokenize` | `SGLANG_NATIVE` | `/tokenize` |
| `ttft_ms` | `RADIXSCOPE_MEASURED` | Express clock, dispatch → first streamed frame carrying output |
| `total_latency_ms` | `RADIXSCOPE_MEASURED` | Express clock, dispatch → completion |
| `prefill_duration_ms` | `SGLANG_NATIVE` (direct) / `RADIXSCOPE_DERIVED` (difference) | C-10 |
| `reuse_ratio` | `RADIXSCOPE_DERIVED` | `cached_tokens / prompt_tokens` |
| Longest common token prefix, first divergence index | `RADIXSCOPE_DERIVED` | RadixScope arithmetic over token arrays |
| Variability diagnostics | `RADIXSCOPE_DERIVED` | Heuristic; labelled as inference |

The derived longest-common-prefix is RadixScope's own arithmetic. It is never described as an SGLang cache hit, it may legitimately disagree with `cached_tokens` because of page granularity and eviction, and where it disagrees both values are shown with the disagreement labelled as expected.

---

## 6. Benchmark protocol against verified interfaces

### 6.1 Locked settings

`temperature: 0`, `n: 1`, `max_new_tokens: 256`, `concurrency: 1`, no speculative decoding, no MTP. Identical model and settings for raw and normalized. Asserted at runtime in both modes and recorded in the run document.

### 6.2 Sequence

```
 1. POST /flush_cache?timeout=30
 2. Assert HTTP 200 ......................... else INVALID / FLUSH_FAILED
    ── no SGLang request of any kind in this window ──
 3. Run RAW: planner → worker1 → worker2, sequential
 4. Assert first RAW request cached_tokens <= tolerance ... else INVALID / WARM_START
 5. Collect RAW results
 6. POST /flush_cache?timeout=30
 7. Assert HTTP 200 ......................... else INVALID / FLUSH_FAILED
    ── no SGLang request of any kind in this window ──
 8. Run NORMALIZED: same three agents, sequential
 9. Assert first NORMALIZED request cached_tokens <= tolerance ... else INVALID / WARM_START
10. Collect NORMALIZED results
11. Compare ONLY if both cold assertions passed
```

Steps 2→3 and 7→8 are protected windows. No health generation, no warm-up, no tokenization, no `/get_server_info`, nothing. The fingerprint and token arrays are gathered before step 1 or after step 10.

### 6.3 Cold-start tolerance

Literal zero is **not** required, because `cached_tokens` may be page-aligned and the effective page size is not yet known.

```
tolerance = observed_page_size    (from §9 step 4)
```

Until step 4 returns a value, the runner refuses to start rather than guessing. Once it returns:

- If `page_size == 1`, tolerance is 0 and the assertion is `cached_tokens == 0`.
- If `page_size > 1`, tolerance is `page_size` and the assertion is `cached_tokens <= page_size`.
- Step 9's observed cold value (§9) is recorded as the empirical floor. If the measured floor exceeds the derived tolerance, the tolerance is **not** widened to accommodate it — that is a finding to investigate, not a threshold to relax.

The observed first-request value is recorded verbatim in every run document, valid or not. Any run exceeding the validated tolerance is `INVALID / WARM_START`, terminal, and never rendered as an improvement.

---

## 7. Fallback if `cached_tokens` proves unusable

If the field is missing, or steps 9–11 show it does not behave as a prefix-reuse measure:

1. **Do not fabricate per-request cache reuse.** No estimate, no proxy, no back-calculation from latency.
2. Mark native per-request cache measurement **unavailable** in the run document and on the dashboard.
3. Keep longest-common-prefix and divergence analysis, explicitly labelled `RADIXSCOPE_DERIVED`. Do not call any of it a cache hit.
4. Use aggregate SGLang metrics only under their actual documented meanings, clearly marked as server-wide rather than per-request.
5. State plainly, in the product itself, that **the core benchmark cannot prove native cache reuse** under this configuration.

This is a demotion of the product's claim, not a workaround. It is preferable to a number nobody can defend.

If the 1.5B model cannot run reliably, switch to `Qwen/Qwen2.5-0.5B-Instruct` and record the trigger. No quantization, no other model family, no cloud, no gateway, no router, no WebSockets, no FastAPI, no cache-tree visualization.

---

## 8. Version dependence

Re-verify all of the following on any change from `v0.5.18`:

- Presence and semantics of `meta_info.cached_tokens` and `num_retractions`.
- `/flush_cache` status codes and the `timeout` parameter.
- The three `--enable-metrics` timing keys in `meta_info`.
- The default of `disable_radix_cache` and `schedule_policy`.
- `_page_size_default` resolution and any model- or backend-specific page-size override.
- `/health` non-generating behaviour and the `SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION` gate.
- `/tokenize` response field names.

A version bump invalidates this document. It does not invalidate the architecture.

---

## 9. Day 0 laptop verification checklist

Run in order on the target machine. Stop at the first hard failure.

| # | Step | Command | Pass condition |
|---|---|---|---|
| 1 | NVIDIA driver | `nvidia-smi` | Driver version meets CUDA 13's minimum. Record the version. |
| 1b | *(only if 1 fails)* CUDA 12 image exists | Look up the v0.5.18 tag list on Docker Hub for `lmsysorg/sglang` | Record the **exact observed tag string**. Do not construct one. |
| 2 | Docker GPU passthrough | `docker run --rm --gpus all nvidia/cuda:13.0.3-base-ubuntu24.04 nvidia-smi` | GPU visible inside the container. |
| 3 | Container startup | The §3.1 `docker run` command | Server reaches ready state; record wall time (HDD will make this slow). |
| 4 | **Backend and page size** | `curl -s localhost:30000/get_server_info \| jq` + read startup log | Record the effective `attention_backend` and `page_size`. **This sets the §6.3 tolerance and gates everything downstream.** |
| 5 | VRAM and KV capacity | `nvidia-smi` during idle + `curl -s localhost:30000/get_server_info \| jq '.memory_usage'` | Weights load; KV token capacity is large enough to hold a shared prefix across three sequential requests. Record `max_total_num_tokens`. |
| 6 | Health | `curl -s -o /dev/null -w '%{http_code}\n' localhost:30000/health` | `200`. |
| 7 | Metrics | `curl -s localhost:30000/metrics \| grep -E 'cache_hit_rate\|cached_tokens\|prompt_tokens_total'` | Endpoint responds; names match §C-8. |
| 8 | Tokenize | C-6 command | Returns `tokens`, `count`, `max_model_len`. |
| 9 | **Cold first request** | flush (C-4) → immediately C-1 | Record `meta_info.cached_tokens` verbatim. Expect ≤ page size from step 4. |
| 10 | Repeated identical request | Re-send the exact step 9 prompt without flushing | `cached_tokens` rises to approximately the full prompt length. This is the positive control. |
| 11 | Partial shared prefix | Send a prompt sharing a long prefix but diverging late | `cached_tokens` lands near the shared prefix length, page-aligned. Compare against RadixScope's own LCP over the step 8 token arrays and **record the delta** — that delta is the granularity. |
| 12 | Streaming / TTFT | C-9 command | Confirm frame format and that the first frame carries generated output. If not, C-9 fallback applies. |
| 13 | Flush failure and success | Success: idle flush → 200. Failure: issue a long generation, then `POST /flush_cache?timeout=0` concurrently | 200 idle; 400 with a message when busy. Record both bodies. |
| 14 | Fallback model startup | §3.1 command with `--model-path Qwen/Qwen2.5-0.5B-Instruct` | Starts cleanly. Confirms the fallback is real before it is needed at 3 a.m. |

Steps 9, 10 and 11 together are the actual product risk. If step 10 does not show a large jump, nothing else in RadixScope matters.

---

## 10. Effect on prior artifacts

`docs/architecture/system-architecture.md` ledger entries:

| ID | Prior status | Now |
|---|---|---|
| V-0 (pinned version) | `UNVERIFIED` / BLOCKER-1 | **Resolved for pinning** — `v0.5.18` is fixed. Runtime confirmation is §9 step 3. |
| V-1 (`cached_tokens`) | `SRC-VERIFIED` on `main` | `SOURCE_VERIFIED_V0_5_18`. Runtime granularity remains open (§9 steps 9–11). |
| V-2 (`/flush_cache`) | `SRC-VERIFIED` on `main` | `SOURCE_VERIFIED_V0_5_18`, including the `timeout` parameter and 200/400 codes. |
| V-3 (page size) | `UNVERIFIED` | `RUNTIME_PENDING`, §9 step 4. Tolerance rule now defined (§6.3). |
| V-4 (radix cache / scheduling) | `UNVERIFIED` | `SOURCE_VERIFIED_V0_5_18` — radix cache on by default; scheduling is FCFS and inert at `concurrency=1`. |
| V-5 (VRAM headroom) | `UNVERIFIED` | `RUNTIME_PENDING`, §9 step 5. |
| V-6 (TTFT) | `UNVERIFIED` | Resolved in principle: streaming permitted Express-internally; `RUNTIME_PENDING` on reliability, §9 step 12. |
| V-7 (task correctness) | `UNVERIFIED` | Unchanged; not an SGLang question. |

No architecture change follows from this document. Component boundaries, flows and invariants stand.

---

## 11. Evidence to paste back after laptop verification

Fill this in and hand it back. Each line converts a `RUNTIME_PENDING` row to `RUNTIME_VERIFIED_LAPTOP`.

```
[ ] 1.  nvidia-smi driver version:                    ______
[ ] 1b. CUDA 12 tag used (if any, exact string):      ______
[ ] 2.  GPU visible in container (y/n):               ______
[ ] 3.  Image tag pulled + startup wall time:         ______
[ ] 4.  attention_backend:                            ______
[ ] 4.  page_size:                                    ______
[ ] 5.  weights GB / KV GB / max_total_num_tokens:    ______
[ ] 5.  peak VRAM at idle:                            ______
[ ] 6.  /health status code:                          ______
[ ] 7.  /metrics reachable (y/n) + names present:     ______
[ ] 8.  /tokenize response keys:                      ______
[ ] 9.  COLD first-request cached_tokens:             ______
[ ] 9.  full meta_info keys observed:                 ______
[ ] 10. repeat-request cached_tokens / prompt_tokens: ______
[ ] 11. partial-prefix cached_tokens:                 ______
[ ] 11. RadixScope LCP for same pair:                 ______
[ ] 11. delta (granularity in tokens):                ______
[ ] 12. first stream frame (first 200 chars):         ______
[ ] 12. first frame carries output (y/n):             ______
[ ] 13. flush success body + code:                    ______
[ ] 13. flush busy body + code:                       ______
[ ] 14. 0.5B fallback starts cleanly (y/n):           ______
[ ] --  num_retractions observed non-zero anywhere:   ______
[ ] --  mem-fraction-static 0.85 held, or adjusted to: ______
```

Once steps 4, 9, 10 and 11 are filled in, the cold-start tolerance in §6.3 becomes a number and the benchmark can be trusted. Until then it cannot.

---

# Part B — Express → SGLang Integration Contract

Part A established *what the pinned version does*. Part B specifies *exactly how Express talks to it*. Nothing here introduces an endpoint beyond the five verified in §4. There is no generic client, no passthrough, no gateway.

All of Part B is scoped to **SGLang `v0.5.18`**. A version bump invalidates it.

---

## 12. Base configuration

One local worker, reached over loopback. There is no service discovery, no pool, no failover.

```ts
interface SglangConfig {
  baseUrl: string;              // "http://127.0.0.1:30000" — loopback only
  model: string;                // "Qwen/Qwen2.5-1.5B-Instruct" | fallback, from /get_model_info
  timeouts: TimeoutPolicy;
  maxResponseBytes: number;     // hard cap; abort past it
}
```

`baseUrl` is loopback by construction. The container publishes `-p 30000:30000`; SGLang binds `0.0.0.0` *inside* the container only. Express never resolves a hostname and never leaves the machine (requirement S-7).

The model string is **read from `/get_model_info` at startup, not configured**. If the launch profile and the running server disagree, the running server wins and the discrepancy is recorded — this is what makes the 0.5B fallback visible in every result (D-5) instead of trusting a config file.

### 12.1 Immutable benchmark configuration

One frozen object. One importer (`benchmarkRunner`). No override path, no environment variable, no request parameter.

```ts
const LOCKED_SAMPLING = Object.freeze({
  temperature: 0,
  n: 1,
  max_new_tokens: 256,
}) satisfies SglangSamplingParams;

const CONCURRENCY = 1;   // structural: the runner awaits each request
```

**No speculative or MTP flag is sent.** Speculative decoding is a server-launch concern, not a request parameter; the client sends no field that could enable it, and the launch profile sets none. `concurrency` is not a wire field — it is the property that the runner never has two `/generate` calls outstanding.

This object appears verbatim in the run document for both modes, which is how B-1 is evidenced rather than asserted.

---

## 13. Generation

### 13.1 Which path, and why both exist

Two call shapes, one endpoint. The choice is made per run, not per request, and is recorded on the run document.

| Path | When | Gives |
|---|---|---|
| **Streaming** (`stream: true`) | Default, when TTFT is being measured | `ttft_ms` **and** final `meta_info` from one call |
| **Non-streaming** (`stream: false`) | When streaming is unverified or has failed | Final `meta_info` only; no `ttft_ms` |

**The reconciliation that matters:** a run uses *one* call per request, never two. Issuing a non-streaming call to recover `meta_info` after a streaming call would be a duplicate execution of the same prompt — it would warm the cache and destroy the benchmark's meaning. This is stated as a prohibition, not a preference (§13.6).

### 13.2 Request

```ts
interface GenerateRequest {
  rid: string;                          // RadixScope-generated; echoed back (§13.5)
  text: string;                         // the assembled prompt, exactly as built
  sampling_params: SglangSamplingParams;// always LOCKED_SAMPLING
  stream: boolean;
}

interface SglangSamplingParams {
  temperature: number;
  n: number;
  max_new_tokens: number;
}
```

`SOURCE_VERIFIED_V0_5_18` — `GenerateReqInput` (`managers/io_struct.py` L160+) accepts `rid`, `text`, `sampling_params`, `stream`. `SamplingParams` accepts `temperature`, `n`, `max_new_tokens`.

Verified example:

```http
POST /generate HTTP/1.1
Host: 127.0.0.1:30000
Content-Type: application/json

{
  "rid": "rs-3f2a91c4-raw-0",
  "text": "<assembled prompt>",
  "sampling_params": { "temperature": 0, "n": 1, "max_new_tokens": 256 },
  "stream": false
}
```

Fields deliberately **not** sent: `input_ids` (we send `text` so SGLang applies its own tokenizer, matching `/tokenize`), `return_logprob`, `session_params`, `lora_path`, `input_embeds`, `log_metrics`, `background`. Sending a field we have not verified is how a benchmark acquires an unexplained variable.

### 13.3 Non-streaming response

```ts
interface GenerateResponse {
  text: string;
  meta_info: MetaInfo;
}
```

```ts
interface MetaInfo {
  // always present on a generation response — SOURCE_VERIFIED_V0_5_18
  id: string;                    // SGLANG_NATIVE — echo of rid
  finish_reason: unknown;        // SGLANG_NATIVE
  prompt_tokens: number;         // SGLANG_NATIVE
  completion_tokens: number;     // SGLANG_NATIVE
  cached_tokens: number;         // SGLANG_NATIVE — the primary observation
  reasoning_tokens: number;      // SGLANG_NATIVE — unused by RadixScope
  num_retractions: number;       // SGLANG_NATIVE
  weight_version: string | null; // SGLANG_NATIVE — part of the run fingerprint

  // present only with --enable-metrics — SOURCE_VERIFIED_V0_5_18
  forward_entry_time?: number;   // SGLANG_NATIVE
  prefill_finished_time?: number;// SGLANG_NATIVE
  queue_time?: number;           // SGLANG_NATIVE

  // present only when populated; not relied upon
  cached_tokens_details?: unknown;
}
```

Parsing is strict on the fields RadixScope depends on and indifferent to the rest:

- `cached_tokens` absent or non-numeric → throw `MetaInfoMissingError`. **Never defaulted to 0.** A missing value must invalidate a run; a zero would silently read as a perfect cold start.
- `prompt_tokens`, `completion_tokens`, `num_retractions` absent → same treatment.
- Unknown extra fields → ignored, not rejected. A future version adding a field must not break the client.

### 13.4 Streaming response and TTFT

`SOURCE_VERIFIED_V0_5_18` — `entrypoints/http_server.py` L897–930. The response is `media_type: text/event-stream`; frames are `data: <json>\n\n`; the stream ends with `data: [DONE]\n\n`. Errors arrive as a `data:` frame whose payload contains an `error` object (`message`, `type`, `code`, `retryable`).

`server_args.py` L1465–1469: `stream_interval` defaults to `1`, i.e. one token per emission. This is why the first frame is expected to carry real output rather than a metadata preamble — but "expected" is not "verified" (§13.7).

**Exact timing rule.**

```
t0  = monotonic clock immediately before the fetch is issued          RADIXSCOPE_MEASURED
t1  = monotonic clock at the first `data:` frame that parses AND
      whose cumulative `text` is non-empty                            RADIXSCOPE_MEASURED
t2  = monotonic clock when `data: [DONE]` is received                 RADIXSCOPE_MEASURED

ttft_ms          = t1 - t0     RADIXSCOPE_MEASURED
total_latency_ms = t2 - t0     RADIXSCOPE_MEASURED
```

A frame that parses but carries an empty `text` does **not** stop the TTFT clock. If no qualifying frame ever arrives, `ttft_ms` is `undefined` — omitted from the record, never zero and never backfilled.

**Where final `meta_info` comes from.** The `meta_info` of the **last `data:` frame received before `[DONE]`** is the authoritative one. The client retains only the most recent parsed frame's `meta_info`, overwriting as frames arrive, and validates that retained object once the stream terminates. `[DONE]` itself carries no payload and is not parsed as JSON.

If the terminal frame's `meta_info` fails the §13.3 strictness check, the run is `INVALID / META_MISSING`. **The client does not re-issue the request** (§13.6).

### 13.5 Request IDs and correlation

RadixScope generates the `rid` and SGLang echoes it. This is verified, not assumed: `managers/tokenizer_manager.py` L2242 sets `meta_info["id"] = rid`, where `rid` is the value supplied on `GenerateReqInput` (`managers/io_struct.py` L163) or generated during normalization when omitted.

```
rid format (proposed — Prompt 12 to formalize):
  rs-{runId}-{mode}-{requestIndex}      e.g.  rs-3f2a91c4-norm-2
```

The client asserts `meta_info.id === request.rid` on every response. A mismatch is a correlation failure and produces `INVALID / RUNTIME_ERROR` — at `concurrency=1` it should be impossible, which is exactly why it is worth checking.

No other field is assumed to be echoed. Nothing is correlated by position, timing or prompt content.

### 13.6 Retry, replay and abort

**The prohibition, first.** `/generate` and `/flush_cache` are **never automatically retried or replayed.** Replaying a generation would execute the same prompt twice against the same cache. The second execution would report near-total reuse, and any run containing it would be measuring RadixScope's own retry rather than prompt structure. This is not a resilience trade-off; it is a correctness rule.

| Call | Retry | Rationale |
|---|---|---|
| `/generate` | **Never** | Duplicate execution corrupts benchmark semantics |
| `/flush_cache` | **Never** | A retry would mask a busy server and a failed precondition |
| `/health` | Yes — 3 attempts, only outside a run | Idempotent, no cache effect |
| `/get_server_info`, `/get_model_info` | Yes — 3 attempts, only outside a run | Idempotent, read-only |
| `/tokenize` | Yes — 3 attempts, only outside a protected window | No cache effect, but never inside a protected window (B-7) |

**Abort.** One `AbortController` per run; its signal is passed into every call. It fires on process shutdown or a timeout. On abort the run goes terminal `INVALID / RUNTIME_ERROR`.

Aborting the HTTP connection does not stop SGLang generating. The scheduler stays busy, so the *next* `/flush_cache` may be refused. The specified behaviour is to let the verified `?timeout=30` absorb this: the next run's flush waits for idle and reports honestly if it cannot reach it. `/abort_request` exists in `v0.5.18` source but is **not** part of this verified contract and is not called.

### 13.7 Malformed responses and bounded size

| Condition | Handling |
|---|---|
| Non-2xx from `/generate` | `SglangHttpError(status)` → `INVALID / RUNTIME_ERROR` |
| Body is not valid JSON (non-streaming) | `MalformedResponseError` → `INVALID / RUNTIME_ERROR` |
| A `data:` frame is not valid JSON | Frame skipped, counted; if the terminal frame is unparseable → `INVALID / RUNTIME_ERROR` |
| A `data:` frame contains an `error` object | `SglangHttpError(error.code)` → terminal. `retryable` is **ignored** — see §13.6 |
| `[DONE]` never arrives before the total timeout | Abort → `INVALID / RUNTIME_ERROR` |
| Required `meta_info` field missing | `MetaInfoMissingError` → `INVALID / META_MISSING` |
| `meta_info.id !== rid` | Correlation failure → `INVALID / RUNTIME_ERROR` |
| Response exceeds `maxResponseBytes` | Abort mid-read → `INVALID / RUNTIME_ERROR` |

`maxResponseBytes` is set to **1 MiB**. At `max_new_tokens: 256` a legitimate response is a few kilobytes; a megabyte means something is wrong, and reading it into a 16 GB laptop unbounded is a needless risk. The cap applies to the accumulated stream, not to a single frame.

### 13.8 Timeouts

```ts
interface TimeoutPolicy {
  connectMs: number;      //  2_000  — loopback; slower than this means nothing is listening
  firstByteMs: number;    // 60_000  — covers cold prefill at 8192 context on the 4060
  idleMs: number;         // 30_000  — max gap between streamed frames
  totalMs: number;        // 120_000 — hard ceiling per generate
}
```

`RUNTIME_PENDING` — every value is a proposal until the Day-0 wall times exist (§9 step 3). `firstByteMs` in particular must exceed the worst observed cold prefill; if it does not, the benchmark will time out precisely on the runs that matter most (the cold first request of each run).

`idleMs` applies only to streaming. Non-streaming uses `connectMs` + `totalMs`.

Flush and introspection carry their own budgets: `/flush_cache` 45 s total (server-side wait is 30 s, so the client must outlast it), `/health` and `/get_server_info` 5 s.

---

## 14. Flush

### 14.1 Request

```
POST /flush_cache?timeout=30
```

No body. The `timeout` query parameter is `SOURCE_VERIFIED_V0_5_18` — a float in seconds, default `0`, minimum `0`, documented as the wait time for idle state before flushing, where `0` means fail fast if not idle.

`30` is chosen because the scheduler must be fully idle for the flush to proceed, and after a completed generation there can be a short settling period. Fail-fast (`0`) would convert a normal settle into a `FLUSH_FAILED`.

### 14.2 Response

`SOURCE_VERIFIED_V0_5_18` — `entrypoints/http_server.py` L966–981. Plain-text body, not JSON.

| Status | Meaning | Client action |
|---|---|---|
| **200** | Flushed. Body notes that the operation is skipped when running or waiting requests exist. | Proceed |
| **400** | Refused. Bodies seen in source: `"Another flush_cache is already in progress."`, `"Timed out waiting for idle state."` | `INVALID / FLUSH_FAILED` |

```ts
interface FlushResult {
  ok: boolean;          // RADIXSCOPE_MEASURED — derived from HTTP status
  status: number;       // SGLANG_NATIVE
  body: string;         // SGLANG_NATIVE — recorded verbatim as evidence
  requestedAt: number;  // RADIXSCOPE_MEASURED
}
```

**The status code is the verdict.** The body is recorded as evidence and is never parsed for meaning — its wording is not a documented contract and must not be pattern-matched.

### 14.3 Verification and ordering

A flush precedes each of the two runs. `ok !== true` is terminal for that run.

```
flushCache(?timeout=30)  →  200
╔════ protected window opens ════╗
   no /generate, /tokenize, /health, /get_server_info, or any other SGLang call
   until the first measured request of this run
first /generate of the run       →  cached_tokens checked against tolerance
╚════ protected window closes ═══╝
```

`/health_generate` is never called at any point in the process lifetime. `SGLANG_ENABLE_HEALTH_ENDPOINT_GENERATION` must remain unset.

### 14.4 Cold tolerance

Evidence-based, resolved at PREFLIGHT, never guessed:

```
tolerance = observed effective page_size    (from /get_server_info or the startup log)

page_size == 1  ⇒  assert cached_tokens === 0
page_size  > 1  ⇒  assert cached_tokens <= page_size
unresolved      ⇒  REFUSE TO START  (not INVALID — a refused start is a distinct state)
```

The observed first-request `cached_tokens` is recorded verbatim on every run, valid or not. A value above tolerance yields `INVALID / WARM_START`, which is terminal and absorbing.

**A warm first request suppresses improvement calculation entirely.** The comparison document is not computed, not stored, and not serialized. The API payload for an invalid run omits `comparison` and every improvement field — they are absent, not present-and-null, so no frontend can render a number that was never produced.

---

## 15. Health, readiness and inspection

```ts
interface ServerFingerprint {
  modelPath: string;            // SGLANG_NATIVE — /get_model_info
  tokenizerPath: string;        // SGLANG_NATIVE
  isGeneration: boolean;        // SGLANG_NATIVE
  architectures: string[];      // SGLANG_NATIVE
  weightVersion: string | null; // SGLANG_NATIVE
  pageSize: number | null;      // SGLANG_NATIVE — null ⇒ refuse to start
  attentionBackend: string | null; // SGLANG_NATIVE
  maxTotalNumTokens: number | null;// SGLANG_NATIVE
  capturedAt: number;           // RADIXSCOPE_MEASURED
}
```

`/get_model_info` field names are `SOURCE_VERIFIED_V0_5_18` from the official documentation. Which `/get_server_info` keys carry `pageSize`, `attentionBackend` and `maxTotalNumTokens` is `RUNTIME_PENDING` (§9 step 4); if absent, they come from the startup log and are recorded manually.

**Startup readiness** is the ordered gate in `system-architecture.md` §9. Express refuses to accept `POST /api/benchmark` until `/health` returns 200, the fingerprint is captured, and the tolerance resolves.

**During a run**, `/health` is polled only outside protected windows. It is a liveness check and never a benchmark input.

The fingerprint is captured once per run and compared across the two modes; a difference is `INVALID / SERVER_CHANGED`.

`/metrics` is read only for corroborative display (`sglang:cache_hit_rate`, `sglang:prompt_tokens_total` and the rest are server-lifetime aggregates). It is never a per-request measurement and never a validity input. If `--enable-metrics` is missing the endpoint is absent; that omits a display, not a run.

---

## 16. Provenance of every field on the wire

| Field | Source | Tag |
|---|---|---|
| `meta_info.cached_tokens` | `/generate` | `SGLANG_NATIVE` |
| `meta_info.prompt_tokens`, `.completion_tokens` | `/generate` | `SGLANG_NATIVE` |
| `meta_info.num_retractions`, `.finish_reason`, `.weight_version`, `.id` | `/generate` | `SGLANG_NATIVE` |
| `meta_info.forward_entry_time`, `.prefill_finished_time`, `.queue_time` | `/generate` + `--enable-metrics` | `SGLANG_NATIVE` |
| `/flush_cache` status and body | `/flush_cache` | `SGLANG_NATIVE` |
| `/get_model_info`, `/get_server_info` fields | inspection | `SGLANG_NATIVE` |
| `/tokenize` `tokens`, `count`, `max_model_len` | `/tokenize` | `SGLANG_NATIVE` |
| `/metrics` counters | `/metrics` | `SGLANG_NATIVE`, server-wide aggregate |
| `ttft_ms` | Express clock | `RADIXSCOPE_MEASURED` |
| `total_latency_ms` | Express clock | `RADIXSCOPE_MEASURED` |
| `flushResult.ok`, `requestedAt`, `capturedAt` | Express | `RADIXSCOPE_MEASURED` |
| `prefill_duration_ms` | direct field, or a difference of two reported timestamps | `SGLANG_NATIVE` / `RADIXSCOPE_DERIVED` |
| `reuse_ratio` | `cached_tokens / prompt_tokens` | `RADIXSCOPE_DERIVED` |
| `longest_common_prefix`, `first_divergence_index` | Express arithmetic over `/tokenize` arrays | `RADIXSCOPE_DERIVED` |
| raw↔normalized deltas, diagnostics | Express | `RADIXSCOPE_DERIVED` |

**The line that must not blur.** `longest_common_prefix` is RadixScope's own arithmetic over two token arrays. It is not a readout of SGLang's radix tree, is never labelled a cache hit, and may legitimately disagree with `cached_tokens` because of page granularity and eviction. Where the two disagree, both are shown and the disagreement is labelled expected. `prefill_finished_time` is never displayed as client-observed TTFT.

---

## 17. Divergence fallbacks

What to do when the pinned version does not behave as Part A found. Each is a demotion of a claim, never a substitution of a number.

| Divergence | Fallback |
|---|---|
| `cached_tokens` absent or non-numeric | `INVALID / META_MISSING`. If persistent across the Day-0 probes: mark native per-request cache measurement **unavailable** for the build; keep LCP explicitly `RADIXSCOPE_DERIVED` and never call it a cache hit; use `/metrics` aggregates only under their documented server-wide meanings; state in the product that the benchmark **cannot prove native cache reuse**. |
| `cached_tokens` present but doesn't behave as prefix reuse (§9 steps 9–11) | Same demotion. Record the observed cold / repeat / partial-prefix triple as the evidence for the claim being withdrawn. |
| `num_retractions` absent | Retraction becomes undetectable. Disclose on the dashboard that `cached_tokens` may understate reuse under memory pressure. |
| First streamed frame never carries output, or streaming is unreliable | Switch the run to `stream: false`. **Drop `ttft_ms`; do not substitute.** Report `prefill_duration_ms` under its own name. Never re-issue a request to recover a timing value. |
| Terminal streamed frame lacks complete `meta_info` | Switch subsequent runs to `stream: false` (losing `ttft_ms`). The affected run is `INVALID / META_MISSING`; it is not re-run automatically within the same benchmark. |
| `--enable-metrics` timing fields absent | Omit `prefill_duration_ms` entirely. Do not estimate it from client timings. |
| `/metrics` absent | Omit the corroborative panel. Not a validity failure. |
| `/flush_cache` `timeout` parameter unsupported | Fall back to bare `POST /flush_cache` and treat 400 as `FLUSH_FAILED` immediately. Expect more spurious failures; do not retry. |
| `/tokenize` absent or shape differs | Load a local tokenizer from the same checkpoint and record on the run that token IDs are locally derived rather than server-sourced. |
| `page_size` unresolvable | Refuse to start. Do not fall back to a looser tolerance. |
| Model reported by `/get_model_info` is the 0.5B fallback | Proceed, record the substitution, and surface it in the result. Never compare a 0.5B run to a 1.5B run. |

---

## 18. Log privacy

No production security infrastructure — just three rules that cost nothing:

1. **Prompt and completion bodies are never logged.** Logs record `sha256(prompt).slice(0, 12)` as `promptHash`, plus `rid`, `mode`, `agentId`, token counts and timings. The hash is enough to prove two prompts were identical without storing either.
2. **Full bodies exist only in Redis**, namespaced under `run:{runId}:*`, with a TTL (default 24 h) and a manual purge path.
3. **Error paths obey the same rule.** A `MalformedResponseError` logs the byte length and the first 200 characters of the *response*, never the request prompt. This is the path most likely to leak a body by accident.

The `rid` correlates a log line to a stored record. That is the whole mechanism.

---

## 19. Design-contract summary

```ts
interface SglangClient {
  generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResult>;
  flushCache(signal: AbortSignal): Promise<FlushResult>;
  health(): Promise<boolean>;                    // GET /health — never /health_generate
  serverInfo(): Promise<ServerFingerprint>;
  tokenize(text: string): Promise<TokenizeResult>;
  parseMetaInfo(raw: unknown): NativeFields;     // pure, exported for tests
}

interface GenerateResult {
  text: string;              // SGLANG_NATIVE
  native: NativeFields;      // SGLANG_NATIVE  — from the terminal frame or the body
  ttftMs?: number;           // RADIXSCOPE_MEASURED — absent if not measurable
  totalLatencyMs: number;    // RADIXSCOPE_MEASURED
  rid: string;               // asserted equal to meta_info.id
}
```

Five methods and one pure parser. Every one maps to a verified endpoint in §4. There is no `request()`, no `post()`, no generic passthrough — adding one would make this a proxy, which the architecture forbids.
