# RadixScope — Backend Agent Guide (Adi + Abhay)

> Attach alongside: AGENTS.md, INTEGRATION.md, Docs/README.md,
> Docs/system-architecture.md, Docs/technical-design.md, Docs/sglang-integration.md

---

## Adi — Your Scope

You own the two hardest pieces:

### 1. ops/sglang/launch.sh
The Docker run command. Do this FIRST on Day 0 before any code.

```bash
docker run --gpus all \
  --shm-size 8g \
  -p 30000:30000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -v ~/.cache/flashinfer:/root/.cache/flashinfer \
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

Verify sequence (run in order, stop at first failure):
```bash
nvidia-smi                                                          # driver >= 580.65.06
curl -s http://localhost:30000/health                               # 200
curl -s http://localhost:30000/get_server_info | jq .page_size     # record this value
curl -s http://localhost:30000/get_server_info | jq .version       # must be 0.5.18
redis-cli ping                                                      # PONG
```

### 2. server/src/benchmark/runner/index.ts — M7

This is the state machine. It is the ONLY module that sequences anything.
Read system-architecture.md §5 (state machine diagram) and technical-design.md §3.7
(call trace) before writing a line.

Key rules:
- Take the in-process single-flight guard BEFORE returning runId to M11
- Route returns 202 AFTER lock is taken; run continues in background async
- Protected window: after flushCache() succeeds, NO M3 call until first generate()
- Never retry generate() or flushCache()
- On any error from M3 or M10 -> terminal INVALID/RUNTIME_ERROR
- resolveTolerance() returning null -> REFUSE TO START (not INVALID, different state)
- Comparison only computed if BOTH validity verdicts are valid

Call order (from technical-design.md §3.7):
```
PREFLIGHT:  M3.health() -> M3.serverInfo() -> M8.resolveTolerance() -> M3.tokenize()
FLUSH_RAW:  M3.flushCache()
RUN_RAW:    for each agent: M4.componentsFor() -> M5.assemble(RAW) -> M3.generate() -> M10.appendRecord()
VALIDATE_RAW: M8.assertCold() -> M8.assertSettingsEqual()
FLUSH_NORM: M3.flushCache()
RUN_NORM:   for each agent: M4.componentsFor() -> M5.assemble(NORMALIZED) -> M3.generate() -> M10.appendRecord()
VALIDATE_NORM: M8.assertCold() -> M8.assertSettingsEqual()
COMPARE:    M8.assertContentEqual() -> M8.assertServerUnchanged() -> M9.compare() -> M10.putComparison()
```

---

## Abhay — Your Scope

### 1. server/src/index.ts — Express entry point

```typescript
// Boot order:
// 1. loadConfig()
// 2. Connect Redis (M10.getClient())
// 3. Detect orphan run from previous crash (getActiveRunId -> mark INVALID)
// 4. Mount routes from M11
// 5. Start listening

// CORS: allow http://localhost:5173
// Middleware: express.json(), error handler
// On SIGTERM: close Redis, exit cleanly
```

### 2. server/src/api/index.ts — M11 (four endpoints only)

```typescript
// POST /api/benchmark
//   - parse { normalizeSecondRun: boolean }
//   - call runner.startRun() 
//   - 202 { runId } or 409

// GET /api/benchmark/:runId
//   - call store.getRunProjection(runId)
//   - 404 if null, 200 with projection

// GET /api/health
//   - store.ping() + sglangClient.health()
//   - { express: true, redis: bool, sglang: bool }

// GET /api/runs
//   - store.listRunSummaries(20)
```

Rules for M11:
- NO benchmark logic in routes
- NO direct Redis commands
- NO SGLang calls (health check goes through a runner helper or M3 directly — but only M3)
- Map RunInProgressError -> 409, unknown runId -> 404, else -> 500

---

## Shared Backend Rules

- `server/src/contracts/index.ts` is the source of truth for all types
- If you need a new type, add it there and tell the other person
- Never import from each other's module directories
- M7 (Adi) imports M3, M4, M5, M8, M9, M10 — M11 (Abhay) imports only M7 and M10
- Test pure modules (M6, M8, M9) with jest — they have no I/O so tests are trivial
- Use `performance.now()` for timing, not `Date.now()`

## Environment variables (.env)

```
SGLANG_URL=http://127.0.0.1:30000
REDIS_URL=redis://127.0.0.1:6379
PORT=8080
RUN_TTL_SECONDS=86400
DEBUG_PROMPT_BODIES=false
```

Copy this to `server/.env` — it's gitignored but needed to run locally.
