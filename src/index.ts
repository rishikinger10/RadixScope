/** RadixScope Express entry point and integration glue. */

import express, { type Express, type RequestHandler } from 'express';
import type { Server } from 'node:http';
import { loadConfig } from './config';
import { apiErrorHandler, createApiRouter, type ApiRunner } from './api';
import * as store from './store';
import * as sglangClient from './sglang';

const FRONTEND_ORIGIN = 'http://localhost:5173';

interface RunnerModule extends ApiRunner {
  isRunning(): boolean;
  shutdown?(): Promise<void> | void;
}

export interface ApplicationDependencies {
  runner: RunnerModule;
  store: Pick<
    typeof store,
    'getRunProjection' | 'listRunSummaries' | 'ping'
  >;
  getSglangHealth(): Promise<boolean>;
}

const corsMiddleware: RequestHandler = (request, response, next) => {
  const origin = request.header('Origin');
  if (origin === FRONTEND_ORIGIN) {
    response.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
    response.setHeader('Vary', 'Origin');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  if (request.method === 'OPTIONS') {
    response.sendStatus(204);
    return;
  }
  next();
};

export function createApplication(dependencies: ApplicationDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(corsMiddleware);
  app.use(express.json());
  app.use('/api', createApiRouter(dependencies));
  app.use(apiErrorHandler);
  return app;
}

export async function reconcileOrphanRun(): Promise<void> {
  const activeRunId = await store.getActiveRunId();
  if (activeRunId === null) return;

  const projection = await store.getRunProjection(activeRunId);
  const isTerminal =
    projection?.phase === 'COMPLETE' || projection?.phase === 'INVALID';

  if (projection !== null && !isTerminal) {
    await store.putVerdict(activeRunId, {
      valid: false,
      reason: 'RUNTIME_ERROR',
      evidence: { recovery: 'PROCESS_RESTART' },
    });
    await store.updateRunPhase(activeRunId, 'INVALID');
    console.warn(`[boot] Marked orphaned run ${activeRunId} INVALID`);
  }

  await store.clearRunActive();
  if ((await store.getActiveRunId()) !== null) {
    throw new Error('Failed to clear orphaned benchmark marker');
  }
}

function loadRunner(): RunnerModule {
  // M7 is owned by Adi and may arrive independently. Using a runtime boundary
  // lets Abhay's M11 compile and test before that module is merged.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const candidate = require('./benchmark/runner') as Partial<RunnerModule>;
  if (
    typeof candidate.startRun !== 'function' ||
    typeof candidate.isRunning !== 'function'
  ) {
    throw new Error('M7 runner must export startRun() and isRunning()');
  }
  return candidate as RunnerModule;
}

export async function startServer(): Promise<Server> {
  const config = loadConfig();

  await store.connect();
  await reconcileOrphanRun();

  const runner = loadRunner();
  // Cache the last verified value. While a run is active, returning this value
  // prevents /api/health polling from making an SGLang call inside a protected
  // cold-cache window.
  let lastSglangHealth = await sglangClient.health();
  const getSglangHealth = async (): Promise<boolean> => {
    if (runner.isRunning()) return lastSglangHealth;
    lastSglangHealth = await sglangClient.health();
    return lastSglangHealth;
  };

  const app = createApplication({ runner, store, getSglangHealth });
  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(config.port, '127.0.0.1', () => {
      console.info(`[boot] RadixScope listening on http://127.0.0.1:${config.port}`);
      resolve(listeningServer);
    });
    listeningServer.once('error', reject);
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    try {
      await runner.shutdown?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      await store.close();
    } catch (error) {
      console.error('[shutdown] Graceful shutdown failed:', error);
      process.exitCode = 1;
    }
  };

  process.once('SIGTERM', () => {
    void shutdown();
  });

  return server;
}

if (require.main === module) {
  void startServer().catch(async (error: unknown) => {
    console.error('[boot] Failed to start RadixScope:', error);
    process.exitCode = 1;
    try {
      await store.close();
    } catch {
      // The original boot error is authoritative.
    }
  });
}
