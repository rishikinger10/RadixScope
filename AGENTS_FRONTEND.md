# RadixScope — Frontend Agent Guide (Deep + Rish)

> Attach alongside: INTEGRATION.md (the most important one for you)
> Optional: Docs/README.md §2.5 (observability) and §2.6 (NF-3, NF-4)

---

## Stack

- React 19 + TypeScript
- Chart.js 4 + react-chartjs-2
- Vite dev server, port 5173
- Vanilla CSS (no Tailwind)
- HTTP polling only — NO WebSocket, NO SSE, NO EventSource

---

## Dev Before Backend is Ready — Use the Mock Server

Before Abhay's Express is running, use this mock to develop against.
Save as `web/mock-server.mjs` and run with `node web/mock-server.mjs`.

```javascript
// web/mock-server.mjs
import http from 'http';

const PHASES = [
  'QUEUED','PREFLIGHT','FLUSH_RAW','RUN_RAW',
  'VALIDATE_RAW','FLUSH_NORM','RUN_NORM','VALIDATE_NORM','COMPARE','COMPLETE'
];

let run = null;
let phaseIdx = 0;
let ticker = null;

const mockRecord = (mode, idx, agent, cached) => ({
  runId: run?.runId,
  mode, requestIndex: idx, agent,
  native: { promptTokens: 312, completionTokens: 128, cachedTokens: cached,
            finishReason: 'stop', numRetractions: 0 },
  measured: { ttftMs: 420, totalLatencyMs: 1840, promptTokenIds: [], assembledAt: Date.now() },
  derived: { reuseRatio: cached/312, lcpWithPrevious: cached, firstDivergenceIndex: cached, diagnostics: [] }
});

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, 'http://localhost:3999');

  if (req.method === 'POST' && url.pathname === '/api/benchmark') {
    if (run && !['COMPLETE','INVALID'].includes(run.phase)) {
      res.writeHead(409); res.end(JSON.stringify({ error: 'Run in progress', code: 'RUN_IN_PROGRESS' })); return;
    }
    run = { runId: crypto.randomUUID(), phase: 'QUEUED', records: [], startedAt: Date.now() };
    phaseIdx = 0;
    clearInterval(ticker);
    ticker = setInterval(() => {
      if (phaseIdx < PHASES.length - 1) {
        phaseIdx++;
        run.phase = PHASES[phaseIdx];
        // Add mock records at appropriate phases
        if (run.phase === 'VALIDATE_RAW') {
          run.records.push(mockRecord('RAW', 0, 'planner', 0));
          run.records.push(mockRecord('RAW', 1, 'worker1', 89));
          run.records.push(mockRecord('RAW', 2, 'worker2', 89));
        }
        if (run.phase === 'VALIDATE_NORM') {
          run.records.push(mockRecord('NORMALIZED', 0, 'planner', 0));
          run.records.push(mockRecord('NORMALIZED', 1, 'worker1', 240));
          run.records.push(mockRecord('NORMALIZED', 2, 'worker2', 310));
        }
        if (run.phase === 'COMPLETE') {
          run.verdict = { valid: true, evidence: {} };
          run.comparison = {
            runId: run.runId,
            rawCachedTokensTotal: 178, normCachedTokensTotal: 550,
            cachedTokensDelta: 372, reuseRatioDelta: 0.31,
            lcpRaw: 89, lcpNorm: 240,
            firstDivergenceIndexRaw: 89, firstDivergenceIndexNorm: 240,
            diagnostics: [{ kind: 'REUSE_IMPROVEMENT', message: 'Normalized run achieved higher reuse (0.59 vs 0.28).', isInference: true }]
          };
          clearInterval(ticker);
        }
      }
    }, 1200);
    res.writeHead(202); res.end(JSON.stringify({ runId: run.runId })); return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/benchmark/')) {
    if (!run) { res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return; }
    const projection = { runId: run.runId, phase: run.phase, records: run.records,
      fingerprint: { version: '0.5.18', modelId: 'Qwen/Qwen2.5-1.5B-Instruct',
        contextLength: 8192, attentionBackend: 'flashinfer', pageSize: 1, maxTotalNumTokens: 147456 } };
    if (run.verdict) projection.verdict = run.verdict;
    if (run.phase === 'COMPLETE' && run.verdict?.valid) projection.comparison = run.comparison;
    res.writeHead(200); res.end(JSON.stringify(projection)); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    res.writeHead(200); res.end(JSON.stringify({ express: true, redis: true, sglang: true })); return;
  }

  if (req.method === 'GET' && url.pathname === '/api/runs') {
    res.writeHead(200); res.end(JSON.stringify(run ? [{
      runId: run.runId, phase: run.phase, startedAt: run.startedAt,
      modelId: 'Qwen/Qwen2.5-1.5B-Instruct',
      verdict: run.verdict ? { valid: run.verdict.valid } : undefined
    }] : [])); return;
  }

  res.writeHead(404); res.end('{}');
});

server.listen(3999, () => console.log('Mock server on http://localhost:3999'));
```

Run it: `node web/mock-server.mjs`
Then in your `.env`: `VITE_API_URL=http://localhost:3999`

---

## Deep — Your Scope

### Polling hook: web/src/hooks/useRunPoller.ts

```typescript
// Poll /api/benchmark/:runId every 1000ms
// Back off to 3000ms after 5 consecutive unchanged phases
// Stop on COMPLETE or INVALID
// On poll error: show error state, keep trying
// NEVER open a WebSocket or EventSource
```

### Pages
- `web/src/pages/HomePage.tsx` — "Run Demo" button, current run status, phase indicator
- `web/src/pages/RunPage.tsx` — full detail view for a runId (loadable by URL for F-9)

### Run state logic
- Track: runId, phase, records[], verdict, comparison, health
- `COMPLETE` + `verdict.valid === true` = show comparison
- `INVALID` = show INVALID banner with reason code + evidence, NO comparison rendered
- Records appear progressively as they arrive (F-8)

---

## Rish — Your Scope

### Provenance badge: web/src/components/badges/ProvenanceBadge.tsx

Every number on the page must have one of these:
```tsx
<ProvenanceBadge tag="SGLANG_NATIVE" />     // blue
<ProvenanceBadge tag="RADIXSCOPE_MEASURED" /> // amber  
<ProvenanceBadge tag="RADIXSCOPE_DERIVED" />  // purple
```

### Charts: web/src/components/charts/

- `CacheReuseChart.tsx` — bar chart: raw vs normalized cachedTokens per request (Chart.js)
- `LatencyChart.tsx` — totalLatencyMs per request, both modes

### Tables: web/src/components/tables/

- `RequestTable.tsx` — per-request table with all fields + provenance badges
- `ComparisonTable.tsx` — summary delta table (cachedTokensDelta, reuseRatioDelta, etc.)

### Invalid banner: web/src/components/InvalidBanner.tsx

Shows when phase === INVALID:
- Reason code (human-readable from INTEGRATION.md reason codes table)
- Evidence object (show key values)
- NO comparison data, NO chart — completely absent

---

## Shared Frontend Rules

- `VITE_API_URL` env var for the API base URL (defaults to `http://localhost:8080`)
- All API calls go through a single `web/src/api/client.ts` — not scattered fetch() calls
- Types come from `web/src/types/` — mirror the shapes in INTEGRATION.md, don't import from server
- Never show a number without its provenance badge
- Never render a comparison when verdict.valid === false
- The "Run Demo" button is disabled while phase is not COMPLETE or INVALID

## web/src/types/index.ts (copy these — don't share server code)

```typescript
export type RunPhase = 'QUEUED'|'PREFLIGHT'|'FLUSH_RAW'|'RUN_RAW'|'VALIDATE_RAW'
  |'FLUSH_NORM'|'RUN_NORM'|'VALIDATE_NORM'|'COMPARE'|'COMPLETE'|'INVALID';
export type RunMode = 'RAW' | 'NORMALIZED';
export type AgentId = 'planner' | 'worker1' | 'worker2';
export type Provenance = 'SGLANG_NATIVE' | 'RADIXSCOPE_MEASURED' | 'RADIXSCOPE_DERIVED';
export type ReasonCode = 'FLUSH_FAILED'|'WARM_START'|'META_MISSING'|'SETTINGS_MISMATCH'
  |'CONTENT_MISMATCH'|'TASK_DIVERGENCE'|'SERVER_CHANGED'|'RUNTIME_ERROR';

export interface NativeFields {
  promptTokens: number; completionTokens: number; cachedTokens: number;
  finishReason: string; numRetractions: number; weightVersion?: string;
}
export interface MeasuredFields {
  ttftMs?: number; totalLatencyMs: number; promptTokenIds: number[]; assembledAt: number;
}
export interface DerivedFields {
  reuseRatio: number; prefillDurationMs?: number;
  lcpWithPrevious: number; firstDivergenceIndex: number;
  diagnostics: Array<{ kind: string; message: string; isInference: true }>;
}
export interface TelemetryRecord {
  runId: string; mode: RunMode; requestIndex: number; agent: AgentId;
  native: NativeFields; measured: MeasuredFields; derived: DerivedFields;
}
export interface ValidityVerdict {
  valid: boolean; reason?: ReasonCode; evidence: Record<string, unknown>;
}
export interface ComparisonDoc {
  runId: string;
  rawCachedTokensTotal: number; normCachedTokensTotal: number;
  cachedTokensDelta: number; reuseRatioDelta: number;
  lcpRaw: number; lcpNorm: number;
  firstDivergenceIndexRaw: number; firstDivergenceIndexNorm: number;
  diagnostics: Array<{ kind: string; message: string; isInference: true }>;
}
export interface RunProjection {
  runId: string; phase: RunPhase; records: TelemetryRecord[];
  verdict?: ValidityVerdict;
  comparison?: ComparisonDoc; // absent when INVALID
  fingerprint?: { version: string; modelId: string; contextLength: number;
    attentionBackend: string; pageSize: number; maxTotalNumTokens: number; };
}
```
