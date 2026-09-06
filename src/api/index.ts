/**
 * M11 — HTTP API
 *
 * Four routes only. This module parses, delegates, and serializes; benchmark
 * sequencing and persistence decisions remain in M7 and M10 respectively.
 */

import { Router, type ErrorRequestHandler, type RequestHandler } from 'express';
import { z } from 'zod';
import type { RunId, RunProjection, RunSummary } from '../contracts';

const StartRunBodySchema = z
  .object({
    normalizeSecondRun: z.boolean(),
  })
  .strict();

export interface ApiRunner {
  startRun(options: { normalizeSecondRun: boolean }): Promise<{ runId: RunId }>;
}

export interface ApiStore {
  getRunProjection(runId: RunId): Promise<RunProjection | null>;
  listRunSummaries(limit: number): Promise<RunSummary[]>;
  ping(): Promise<boolean>;
}

export interface ApiDependencies {
  runner: ApiRunner;
  store: ApiStore;
  /**
   * Supplied by the entry-point integration layer. It must not issue an SGLang
   * call during a benchmark protected window.
   */
  getSglangHealth(): Promise<boolean>;
}

interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

function errorBody(error: string, code: string, details?: unknown): ApiErrorBody {
  return details === undefined ? { error, code } : { error, code, details };
}

function isRunInProgressError(error: unknown): boolean {
  return error instanceof Error && error.name === 'RunInProgressError';
}

export function createApiRouter(dependencies: ApiDependencies): Router {
  const router = Router();

  router.post('/benchmark', (async (request, response, next) => {
    const parsed = StartRunBodySchema.safeParse(request.body);
    if (!parsed.success) {
      response.status(400).json(
        errorBody('Invalid request body', 'INVALID_REQUEST', parsed.error.flatten())
      );
      return;
    }

    try {
      const result = await dependencies.runner.startRun(parsed.data);
      response.status(202).json({ runId: result.runId });
    } catch (error) {
      if (isRunInProgressError(error)) {
        response
          .status(409)
          .json(errorBody('Run already in progress', 'RUN_IN_PROGRESS'));
        return;
      }
      next(error);
    }
  }) as RequestHandler);

  router.get('/benchmark/:runId', (async (request, response, next) => {
    try {
      const runId = request.params.runId;
      if (typeof runId !== 'string') {
        response.status(400).json(errorBody('Invalid run ID', 'INVALID_RUN_ID'));
        return;
      }

      const projection = await dependencies.store.getRunProjection(runId);
      if (projection === null) {
        response.status(404).json(errorBody('Run not found', 'RUN_NOT_FOUND'));
        return;
      }
      response.status(200).json(projection);
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/health', (async (_request, response, next) => {
    try {
      const [redis, sglang] = await Promise.all([
        dependencies.store.ping(),
        dependencies.getSglangHealth(),
      ]);
      response.status(200).json({ express: true, redis, sglang });
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  router.get('/runs', (async (_request, response, next) => {
    try {
      response.status(200).json(await dependencies.store.listRunSummaries(20));
    } catch (error) {
      next(error);
    }
  }) as RequestHandler);

  return router;
}

export const apiErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  // Express marks malformed JSON with status 400. Keep parser details private.
  if (
    error instanceof SyntaxError &&
    'status' in error &&
    (error as SyntaxError & { status?: number }).status === 400
  ) {
    response.status(400).json(errorBody('Invalid JSON body', 'INVALID_JSON'));
    return;
  }

  console.error('[api] Unhandled request error:', error);
  response.status(500).json(errorBody('Internal server error', 'INTERNAL_ERROR'));
};
