import http from 'http';
import { randomUUID } from 'crypto';

const port = 30001;
const runs = new Map();

const PHASES = [
  'QUEUED',
  'PREFLIGHT',
  'FLUSH_RAW',
  'RUN_RAW',
  'VALIDATE_RAW',
  'FLUSH_NORM',
  'RUN_NORM',
  'VALIDATE_NORM',
  'COMPARE',
  'COMPLETE'
];

function generateMockRecord(mode, index) {
  const isNorm = mode === 'NORMALIZED';
  const promptTokens = 500 + index * 100;
  // Normalized has higher cache hit rate
  const cachedTokens = isNorm ? Math.floor(promptTokens * 0.9) : Math.floor(promptTokens * 0.3);
  
  return {
    runId: 'mock',
    mode,
    requestIndex: index,
    agent: index === 0 ? 'planner' : index === 1 ? 'coder' : 'reviewer',
    native: {
      promptTokens,
      cachedTokens,
      completionTokens: 50,
      totalTokens: promptTokens + 50,
      forwardEntryTime: Date.now() - 200,
      prefillFinishedTime: Date.now() - 50,
      numRetractions: 0
    },
    measured: {
      ttftMs: 150,
      totalLatencyMs: 400 + Math.random() * 200,
      promptTokenIds: [],
      assembledAt: Date.now() - 400
    },
    derived: {
      reuseRatio: cachedTokens / promptTokens,
      prefillDurationMs: 150,
      lcpWithPrevious: 0,
      firstDivergenceIndex: 0,
      diagnostics: []
    }
  };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/benchmark') {
    const runId = randomUUID();
    runs.set(runId, {
      id: runId,
      phaseIndex: 0,
      records: [],
      startedAt: Date.now()
    });
    
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runId }));
    
    // Simulate background progress
    const interval = setInterval(() => {
      const state = runs.get(runId);
      if (!state) return clearInterval(interval);
      
      state.phaseIndex++;
      
      const currentPhase = PHASES[state.phaseIndex];
      
      if (currentPhase === 'RUN_RAW' && state.records.length < 3) {
        state.records.push(generateMockRecord('RAW', state.records.length));
        state.phaseIndex--; // Stay in RUN_RAW
      } else if (currentPhase === 'RUN_NORM' && state.records.length < 6) {
        state.records.push(generateMockRecord('NORMALIZED', state.records.length - 3));
        state.phaseIndex--; // Stay in RUN_NORM
      }
      
      if (state.phaseIndex >= PHASES.length - 1) {
        clearInterval(interval);
      }
    }, 1000);
    
    return;
  }

  if (req.method === 'GET' && req.url === '/api/runs') {
    const summaries = Array.from(runs.values()).map(r => {
      return {
        runId: r.id,
        phase: PHASES[r.phaseIndex],
        startTime: r.startedAt
      };
    }).sort((a,b) => b.startTime - a.startTime);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ runs: summaries }));
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/benchmark/')) {
    const runId = req.url.split('/').pop();
    const state = runs.get(runId);
    
    if (!state) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    
    const phase = PHASES[state.phaseIndex];
    const projection = {
      runId,
      phase,
      records: state.records,
      fingerprint: { modelId: 'mock-qwen-1.5b' }
    };
    
    if (phase === 'COMPLETE') {
      projection.comparison = {
        runId,
        rawCachedTokensTotal: state.records.slice(0,3).reduce((acc, r) => acc + r.native.cachedTokens, 0),
        normCachedTokensTotal: state.records.slice(3).reduce((acc, r) => acc + r.native.cachedTokens, 0),
        cachedTokensDelta: 1500, // mock
        reuseRatioDelta: 0.6,    // mock 60%
        lcpRaw: 100,
        lcpNorm: 400,
        diagnostics: []
      };
      projection.verdict = { valid: true };
    }
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(projection));
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, () => {
  console.log(`[Mock Server] Running on http://localhost:${port}`);
  console.log(`Simulating backend API for RadixScope Frontend Demo.`);
});
