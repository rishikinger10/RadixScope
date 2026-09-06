# Feature 1 — Run SGLang with one small model

## Purpose
Provide a single reachable SGLang endpoint (local/simulated for development, cloud GPU for the final run) that every other feature sends prompts to. This is the foundation all other features depend on and is not a routing or scheduling exercise — `sgl-model-gateway`'s cache-aware routing is used as-is.

## Inputs
- A small model (quantized, ≤1–1.5B parameters) that runs on an RTX 4060 with 8 GB VRAM.
- SGLang server + `sgl-model-gateway` installation.
- RunPod 4090-class instance, launched only for Day 3 final integration/benchmark (~$20 budget).

## Outputs
- A running SGLang server (local dev URL and, on Day 3, a RunPod URL) exposing a generation endpoint and a metrics endpoint.
- `verification.md`: the Day 0 capability checklist filled in with commands, evidence, and fast/fallback decisions for all three unverified capabilities.
- A config value (base URL) that F2/F4 read — never hardcoded per-environment.

## Minimum implementation needed for the demo
One SGLang server process, one small model, reachable over HTTP from the Express orchestrator, with the gateway's default cache-aware routing left untouched. Nothing else.

## Implementation steps
1. Stand up SGLang + `sgl-model-gateway` in Docker Compose, pointed at the chosen small model.
2. Confirm a basic `/generate`-style call returns a completion locally.
3. Confirm SGLang's metrics endpoint responds (this is a confirmed capability the fallback path in F5 depends on).
4. Run the Day 0 checklist for the three unverified capabilities (KV-cache tree mutation events, no-GPU simulated cache mode, divergence-offset API): try the fast-path check, record command + evidence, and pick fast path or fallback per item. Write results to `verification.md`.
5. Expose the server's base URL via a single environment variable / config entry consumed by F2 and F4.
6. On Day 3, launch the RunPod 4090 instance, deploy the same SGLang + gateway setup with the same model, and repoint the config value — no code changes elsewhere.

## Acceptance check
- A single request to the local SGLang endpoint returns a valid completion for the chosen model.
- SGLang's metrics endpoint returns data for at least one served request.
- `verification.md` exists with a recorded decision (fast or fallback) for each of the three capabilities.
- Swapping the base URL from local to RunPod requires no code change outside config.

## Skip this
Any GPU scheduling, multi-instance load balancing, or model fine-tuning — a single small model on a single instance is sufficient for the demo.

## Fallback if Day 0 verification fails
If no-GPU simulated cache mode is unavailable, develop directly on the RTX 4060 with the small quantized model instead of a CPU/simulated mode, and stand up a thin mock HTTP server (fixed latency, canned completions) so F2/F4/F6 work can proceed on days the GPU is busy or unavailable. If the KV-cache tree mutation stream or the divergence-offset API is unavailable, this feature is unaffected — those fallbacks live in F5, not here; F1 only needs to guarantee the metrics endpoint and a working generation endpoint.
