# RadixScope — Integration Guide

> Read this before writing a single line. This is the contract between all four of us.

---

## Ports (fixed, no changes)

| Service | Port | Who runs it | Who calls it |
|---------|------|-------------|--------------|
| SGLang | 30000 | Adi's machine | Abhay (M3 in server) |
| Express | 8080 | Abhay | Deep, Rish (via browser) |
| Redis | 6379 | Abhay | Abhay (M10 only) |
| Vite dev | 5173 | Deep / Rish | Browser |

---

## The 4 API Endpoints

### POST /api/benchmark
Request: `{ "normalizeSecondRun": true }`  
Success (202): `{ "runId": "a1b2c3d4-..." }`  
Conflict (409): `{ "error": "Run already in progress", "code": "RUN_IN_PROGRESS" }`

---

### GET /api/benchmark/:runId
Poll every ~1000ms. Stop on COMPLETE or INVALID.

```json
{
  "runId": "a1b2c3d4-...",
  "phase": "RUN_RAW",
  "records": [
    {
      "runId": "a1b2c3d4-...",
      "mode": "RAW",
      "requestIndex": 0,
      "agent": "planner",
      "native": {
        "promptTokens": 312,
        "completionTokens": 128,
        "cachedTokens": 0,
        "finishReason": "stop",
        "numRetractions": 0
      },
      "measured": {
        "ttftMs": 420,
        "totalLatencyMs": 1840,
        "promptTokenIds": [1, 2, 3],
        "assembledAt": 1725634521000
      },
      "derived": {
        "reuseRatio": 0.0,
        "lcpWithPrevious": 0,
        "firstDivergenceIndex": 0,
        "diagnostics": []
      }
    }
  ],
  "fingerprint": {
    "version": "0.5.18",
    "modelId": "Qwen/Qwen2.5-1.5B-Instruct",
    "contextLength": 8192,
    "attentionBackend": "flashinfer",
    "pageSize": 1,
    "maxTotalNumTokens": 147456
  }
}
```

When INVALID — comparison field is ABSENT (not null, not present at all):
```json
{
  "runId": "...",
  "phase": "INVALID",
  "records": [...],
  "verdict": {
    "valid": false,
    "reason": "WARM_START",
    "evidence": { "observed": 45, "tolerance": 1 }
  }
}
```

When COMPLETE — comparison is present:
```json
{
  "phase": "COMPLETE",
  "verdict": { "valid": true, "evidence": {} },
  "comparison": {
    "runId": "...",
    "rawCachedTokensTotal": 120,
    "normCachedTokensTotal": 380,
    "cachedTokensDelta": 260,
    "reuseRatioDelta": 0.31,
    "lcpRaw": 89,
    "lcpNorm": 240,
    "firstDivergenceIndexRaw": 89,
    "firstDivergenceIndexNorm": 240,
    "diagnostics": [
      {
        "kind": "REUSE_IMPROVEMENT",
        "message": "Normalized run achieved higher average cache-reuse ratio (0.612 vs 0.281).",
        "isInference": true
      }
    ]
  }
}
```

---

### GET /api/health
```json
{ "express": true, "redis": true, "sglang": true }
```

### GET /api/runs
```json
[
  {
    "runId": "...",
    "phase": "COMPLETE",
    "startedAt": 1725634500000,
    "completedAt": 1725634620000,
    "modelId": "Qwen/Qwen2.5-1.5B-Instruct",
    "verdict": { "valid": true }
  }
]
```

---

## Run Phases (in order)

```
QUEUED > PREFLIGHT > FLUSH_RAW > RUN_RAW > VALIDATE_RAW
       > FLUSH_NORM > RUN_NORM > VALIDATE_NORM > COMPARE > COMPLETE
                                                         > INVALID (from any phase)
```

---

## INVALID Reason Codes

| Code | Show to user |
|------|--------------|
| FLUSH_FAILED | Cache flush failed — SGLang server may be busy |
| WARM_START | Cache was not cold at run start — result invalid |
| META_MISSING | SGLang did not return cache metadata |
| SETTINGS_MISMATCH | Sampling settings differed between runs |
| CONTENT_MISMATCH | Prompt content differed between runs |
| SERVER_CHANGED | SGLang server changed between runs |
| RUNTIME_ERROR | Internal error — check server logs |

---

## Provenance Tags (MANDATORY on every displayed number)

| Field path | Tag | Display colour suggestion |
|------------|-----|---------------------------|
| record.native.* | SGLANG_NATIVE | blue |
| record.measured.ttftMs | RADIXSCOPE_MEASURED | amber |
| record.measured.totalLatencyMs | RADIXSCOPE_MEASURED | amber |
| record.derived.* | RADIXSCOPE_DERIVED | purple |
| comparison.* | RADIXSCOPE_DERIVED | purple |

Never show a derived value without its tag. Never call derived values "SGLang cache state".

---

## CORS

Express allows: http://localhost:5173

---

## Git ownership — no overlap

```
server/src/benchmark/runner/   Adi
server/src/sglang/             Adi
ops/                           Adi
server/src/api/                Abhay
server/src/index.ts            Abhay
web/src/hooks/                 Deep
web/src/pages/                 Deep
web/src/components/charts/     Rish
web/src/components/tables/     Rish
web/src/components/badges/     Rish  (provenance tag badges)
```

Shared — coordinate before touching:
```
server/src/contracts/index.ts  all four read, Adi/Abhay modify
web/src/types/                 Deep and Rish coordinate
```
