const { randomUUID } = require('node:crypto');

process.env.REDIS_URL ??= 'redis://127.0.0.1:6379';
process.env.RUN_TTL_SECONDS ??= '5';

const store = require('../dist/store');
const { LOCKED_SAMPLING } = require('../dist/config');

const enabled =
    process.env.RUN_REDIS_INTEGRATION === "1" || process.env.npm_lifecycle_event === "test:redis";
const redisTest = enabled ? test : test.skip;

afterAll(async () => {
  if (enabled) await store.close();
});

redisTest('persists and projects one bounded run', async () => {
  await store.connect();

  const runId = randomUUID();
  await store.createRun({
    runId,
    phase: 'QUEUED',
    startedAt: Date.now(),
    normalizeSecondRun: true,
    samplingParams: LOCKED_SAMPLING,
  });

  await store.putFingerprint(runId, {
    version: '0.5.18',
    modelId: 'Qwen/Qwen2.5-1.5B-Instruct',
    contextLength: 8192,
    attentionBackend: 'flashinfer',
    pageSize: 1,
    maxTotalNumTokens: 147456,
  });

  await store.appendRecord(runId, {
    runId,
    mode: 'RAW',
    requestIndex: 0,
    agent: 'planner',
    native: {
      promptTokens: 10,
      completionTokens: 2,
      cachedTokens: 0,
      finishReason: 'stop',
      numRetractions: 0,
    },
    measured: {
      totalLatencyMs: 25,
      promptTokenIds: [1, 2],
      assembledAt: 1,
    },
    derived: {
      reuseRatio: 0,
      lcpWithPrevious: 0,
      firstDivergenceIndex: 0,
      diagnostics: [],
    },
  });

  const projection = await store.getRunProjection(runId);
  expect(projection).toMatchObject({
    runId,
    phase: 'QUEUED',
    fingerprint: { version: '0.5.18' },
  });
  expect(projection.records).toHaveLength(1);

  await store.markRunActive(runId);
  expect(await store.getActiveRunId()).toBe(runId);
  await store.clearRunActive();
  expect(await store.getActiveRunId()).toBeNull();

  expect((await store.listRunSummaries(20)).some((run) => run.runId === runId)).toBe(true);
});
