# RadixScope — Agent Context

## Project (stable — don't rewrite unless scope changes)
RadixScope is a benchmark orchestration tool designed to evaluate the impact of prompt component normalization (deterministic reordering) on SGLang's RadixAttention KV cache reuse. The MVP involves a single-flight backend that runs raw and normalized workloads, compares cache performance (reusing derived metrics rather than just relying on generic SGLang outputs), and a dynamic frontend UI that clearly distinguishes between SGLANG_NATIVE, RADIXSCOPE_MEASURED, and RADIXSCOPE_DERIVED metrics to visually prove cache efficiency gains.

## Stack (stable)
- Backend: Node.js/Express, port 30001
- Frontend: Vite/React, port 5173
- SGLang: Docker, port 30000
- Redis: port 6379

## Conventions & Non-Negotiables (stable)
- 11-module strict boundaries with one-way imports (documented in AGENTS.md).
- Single-flight benchmark execution only (M7 is the sole orchestrator, using in-process guard).
- All display metrics must be provenance-tagged (`SGLANG_NATIVE`, `MEASURED`, `DERIVED`).
- No WebSockets or SSE for the UI; frontend must use strict stateless polling against the backend projection.
- Do not build cache-aware routing (SGLang already has it).
- Normalizer must never change agent behavior, only token order.
- Invalid runs are terminal; there is no degraded/presentable mode for broken runs.

## Commands (stable)
- Start backend: `cd server && npm run dev`
- Start frontend: `cd web && npm run dev`
- Start Mock Backend: `cd web && npm run mock`
- Start SGLang: `bash ops/sglang/launch.sh`
- Test health: `curl http://localhost:30001/api/health`

---

## LIVE STATUS (update after every work session — this is what matters most)

**Last updated:** 2026-09-07T00:04:00+05:30

### Currently working
- Backend foundation is complete: Config, Contracts, SGLang client, Workload definition, Assembler, Normalizer, Validity, Analysis, and Store modules are implemented.
- **M7 Runner**: Core state machine (`server/src/benchmark/runner/index.ts`) is fully built and respects all phases (`PREFLIGHT` -> `COMPARE`).
- **API**: Express server (`server/src/index.ts`) and API router (`server/src/api/index.ts`) are built and integrated with M7/M10.
- **Frontend**: Full React polling dashboard is built (`web/src/App.tsx`, `index.css`) with premium glassmorphic dark-mode styling.
- **Mock Server**: `web/mock-server.mjs` is fully functional for UI-only demos.
- **Ops**: SGLang GPU script is ready at `ops/sglang/launch.sh`. `.gitignore` has been correctly configured.

### Currently broken
- Nothing explicitly broken in the codebase.
- We have not yet run the full end-to-end test on the GPU hardware (waiting for Adi's environment).

### Recent decisions
- Added `type: "module"` to `web/package.json` to fix Vite configuration parsing errors.
- Included a `mock-server.mjs` in the `web` directory so the frontend can be developed and demoed without needing Redis or the GPU-heavy SGLang container running.
- Backend uses `crypto` to hash prompt components at `RUN_RAW` and `RUN_NORM` to structurally verify content equality during `COMPARE`.

### Do NOT repeat these mistakes
- Do not run `npm run dev` in `web/` without ensuring `package.json` has `"type": "module"`, otherwise Vite will fail to parse `vite.config.ts`.
- Do not forget to CD into `RadixScope` before running commands.
- Do not run SGLang without `--enable-metrics`; the runner requires this for telemetry.
