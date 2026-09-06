const { createApplication } = require('../dist');

function dependencies() {
  return {
    runner: {
      startRun: jest.fn().mockResolvedValue({ runId: 'run-1' }),
      isRunning: jest.fn().mockReturnValue(false),
    },
    store: {
      getRunProjection: jest.fn().mockResolvedValue(null),
      listRunSummaries: jest.fn().mockResolvedValue([]),
      ping: jest.fn().mockResolvedValue(true),
    },
    getSglangHealth: jest.fn().mockResolvedValue(true),
  };
}

async function withApplication(callback) {
  const app = createApplication(dependencies());
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

test('allows only the Vite development origin', async () => {
  await withApplication(async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173'
    );

    const disallowed = await fetch(`${baseUrl}/api/health`, {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(disallowed.headers.get('access-control-allow-origin')).toBeNull();
  });
});

test('answers a Vite CORS preflight without adding an API route', async () => {
  await withApplication(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/benchmark`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-methods')).toBe(
      'GET, POST, OPTIONS'
    );
  });
});
