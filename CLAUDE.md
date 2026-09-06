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

**Last updated:** 2026-09-07T00:30:00+05:30

### Currently working
- **All 11 backend modules written and `tsc --noEmit` passes with 0 errors** (fixed: analysis map type, validity import depths, cors missing types).
- **Abhay's test suite merged** (PR #1): `test/api.test.js`, `test/application.test.js`, `test/store.integration.test.js`, `test/startup.test.js` all committed.
- **`REDIS_SETUP.md`** added by Abhay — follow it to boot Redis locally without Docker.
- **Frontend mock demo** fully working: `cd web && npm run mock` + `npm run dev` → http://localhost:5173 shows live benchmark UI with provenance badges.
- **Git in sync**: All changes pushed to `origin/main` (rebased over Abhay's Redis-Branch PR).

### Currently broken / Not yet validated
- Real E2E not tested yet (needs Redis running + SGLang on GPU).
- Server `npm run dev` not smoke-tested with live Redis.
- Frontend run-history page not built yet (Deep/Rish task).
- Chart.js cache reuse chart not rendered yet (Deep/Rish task).

### Team status snapshot
| Person | Assigned | Done | Remaining |
|--------|----------|------|-----------|
| Adi | M7 runner, ops/sglang | ✅ Code complete | E2E test on GPU |
| Abhay | M11 API, entry point, Redis, tests | ✅ Code + tests complete | Smoke test with live Redis |
| Deep/Rish | Frontend UI | ~40% (basic table done) | Run-list page, charts, INVALID polish |

### Recent decisions
- Added `type: "module"` to `web/package.json` to fix Vite config parsing.
- Backend uses sorted SHA-256 hashes of component content (not order) for `assertContentEqual`.
- Repo moved notice from GitHub: new canonical URL is `https://github.com/rishikinger10/RadixScope.git`.

### Do NOT repeat these mistakes
- Do not use `&&` in PowerShell — use `;` to chain commands.
- Do not run `npm install` in `web/` without `--legacy-peer-deps` (Vite v8 peer conflict with plugin-react v4).
- Do not run SGLang without `--enable-metrics`.
- Do not forget to `cd RadixScope` before any command — the project is NOT at `C2C/` root.
