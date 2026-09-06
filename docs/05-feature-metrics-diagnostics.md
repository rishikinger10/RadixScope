# Feature 5 — Metrics collection and diagnostics

## Purpose
Collect, for both the raw and normalized runs, the cache-hit signal, TTFT, tokens/second, and — when supported or locally derivable — the token divergence offset mapped to the responsible prompt-template section. This is the evidence that makes the comparison meaningful rather than just "two runs happened."

## Inputs
- Per-request timing already captured in F2 (start time, first-token time, end time, token counts).
- SGLang's confirmed metrics endpoint (F1).
- The Day 0 verification decision (fast path or fallback) for the KV-cache tree mutation stream and the divergence-offset API.
- F3's record of section boundaries (which sections are static/first vs dynamic/last, and any bypassed section) for mapping divergence offsets back to a named section.

## Outputs
- Per-request metric objects: `{ ttft_ms, tokens_per_second, cache_hit_signal, divergence_offset_tokens, divergence_section }`, stored in Redis alongside F4's run results.
- A short diagnostic string per run pair, e.g. "raw run's shared system prompt was pushed behind dynamic task content in the worker prompt, causing prefix divergence at token 42 (`task_context` section); normalized run kept the shared prefix intact through token 310."

## Minimum implementation needed for the demo
Compute the four metrics per request using whichever path (fast/fallback) Day 0 selected, and produce one plain-language diagnostic sentence per run pair. No dashboards, no visualizations — that's F6.

## Implementation steps
1. **TTFT and tokens/second:** compute directly from F2's captured timestamps and token counts — always available, no verification needed.
2. **Cache-hit signal:**
   - Fast path (if the KV-cache tree mutation stream was verified): read the cache-hit indicator directly from that stream for each request.
   - Fallback: compare TTFT of each request against a cold-cache baseline request with no shared prefix; a substantially lower TTFT plus SGLang's metrics endpoint showing reduced prefill work indicates a cache hit. Treat this as a signal, not a certainty, and label it as such in the diagnostic text.
3. **Divergence offset:**
   - Fast path (if the divergence-offset API was verified): query it directly for each raw-vs-normalized prompt pair.
   - Fallback: tokenize both prompts with the model's tokenizer, walk token ids from the start, and record the index of the first mismatch.
4. **Divergence section mapping:** using F3's section boundary offsets, map the divergence token index to the section name it falls within; if normalization bypassed a section, note that explicitly in the diagnostic ("`role_instructions` was left in place because its eligibility was uncertain").
5. Compose one diagnostic sentence per run pair from the computed values; store it alongside the numeric metrics in Redis.
6. Never claim prompt reordering guarantees semantic equivalence — diagnostic text states what was measured for this run, not a general guarantee.

## Acceptance check
- Every request in both raw and normalized runs has TTFT and tokens/second populated.
- A cache-hit signal (fast or fallback) is present for every request, with a clear label indicating which path produced it.
- The normalized run's divergence offset (relative to its own repeated shared prefix across workers) is measurably later than the raw run's, and the diagnostic text names the correct section for the raw run's earlier divergence.
- Diagnostic text avoids universal claims and describes only the measured run.

## Skip this
Any cross-run historical trending, statistical significance testing, or per-token cache visualization — one clear signal set per run pair is sufficient. A literal cache-tree visualization or scrolling event log is optional and only worth adding after this feature's plain numeric/diagnostic output already works, and only if the fast-path KV-cache stream was verified.

## Fallback if Day 0 verification fails
This entire feature is designed around the Day 0 decision: if either the KV-cache mutation stream or the divergence-offset API is unavailable, use the fallback computations in steps 2–3 above. No other part of the system changes — F4 and F6 consume the same output shape regardless of which path produced it.
