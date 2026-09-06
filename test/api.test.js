const express = require('express');
const { createApiRouter, apiErrorHandler } = require('../dist/api');

function makeDependencies(overrides = {}) {
  return {
    runner: {
      startRun: jest.fn().mockResolvedValue({ runId: 'run-1' }),
    },
    store: {
      getRunProjection: jest.fn().mockResolvedValue(null),
      listRunSummaries: jest.fn().mockResolvedValue([]),
      ping: jest.fn().mockResolvedValue(true),
    },
    getSglangHealth: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

async function withServer(dependencies, callback) {
  const app = express();
  app.use(express.json());
  app.use('/api', createApiRouter(dependencies));
  app.use(apiErrorHandler);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();

  try {
    await callback(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

test('POST /api/benchmark validates and delegates', async () => {
  const dependencies = makeDependencies();
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizeSecondRun: true }),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ runId: 'run-1' });
    expect(dependencies.runner.startRun).toHaveBeenCalledWith({
      normalizeSecondRun: true,
    });
  });
});

test('POST /api/benchmark rejects missing or extra fields', async () => {
  const dependencies = makeDependencies();
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizeSecondRun: true, unexpected: true }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INVALID_REQUEST');
    expect(dependencies.runner.startRun).not.toHaveBeenCalled();
  });
});

test('POST /api/benchmark maps RunInProgressError to 409', async () => {
  const error = new Error('busy');
  error.name = 'RunInProgressError';
  const dependencies = makeDependencies({
    runner: { startRun: jest.fn().mockRejectedValue(error) },
  });

  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ normalizeSecondRun: false }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Run already in progress',
      code: 'RUN_IN_PROGRESS',
    });
  });
});

test('GET /api/benchmark/:runId returns 404 or the projection', async () => {
  const projection = { runId: 'known', phase: 'QUEUED', records: [] };
  const dependencies = makeDependencies();
  dependencies.store.getRunProjection.mockImplementation(async (runId) =>
    runId === 'known' ? projection : null
  );

  await withServer(dependencies, async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/api/benchmark/missing`);
    expect(missing.status).toBe(404);

    const found = await fetch(`${baseUrl}/api/benchmark/known`);
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(projection);
  });
});

test('GET /api/health returns the composite status', async () => {
  const dependencies = makeDependencies({
    getSglangHealth: jest.fn().mockResolvedValue(false),
  });
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      express: true,
      redis: true,
      sglang: false,
    });
  });
});

test('GET /api/runs requests exactly 20 summaries', async () => {
  const dependencies = makeDependencies();
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/runs`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(dependencies.store.listRunSummaries).toHaveBeenCalledWith(20);
  });
});

test('malformed JSON is returned as a bounded 400 response', async () => {
  const dependencies = makeDependencies();
  await withServer(dependencies, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid JSON body',
      code: 'INVALID_JSON',
    });
  });
});
