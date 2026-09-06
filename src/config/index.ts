/**
 * M1 — Config
 * Loads, validates and freezes all configuration at boot.
 * Exposes locked benchmark settings as immutable constants.
 * Never throws after boot.
 */

import { SamplingParams } from '../contracts';

export interface Config {
  readonly sglangUrl: string;
  readonly redisUrl: string;
  readonly port: number;
  readonly runTtlSeconds: number;
  readonly debugPromptBodies: boolean;
  readonly generateTimeoutMs: number;
  readonly flushTimeoutMs: number;
  readonly healthTimeoutMs: number;
}

// B-1: Locked benchmark settings — frozen, never mutable
export const LOCKED_SAMPLING: Readonly<SamplingParams> = Object.freeze({
  temperature: 0 as const,
  n: 1 as const,
  max_new_tokens: 256 as const,
});

// B-1: Structural concurrency lock
export const CONCURRENCY = 1 as const;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const config: Config = {
    sglangUrl: process.env['SGLANG_URL'] ?? 'http://127.0.0.1:30000',
    redisUrl: process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379',
    port: parseInt(process.env['PORT'] ?? '8080', 10),
    runTtlSeconds: parseInt(process.env['RUN_TTL_SECONDS'] ?? '86400', 10),
    debugPromptBodies: process.env['DEBUG_PROMPT_BODIES'] === 'true',
    generateTimeoutMs: 120_000,
    flushTimeoutMs: 45_000,  // 30s server-side + 15s margin
    healthTimeoutMs: 5_000,
  };

  // Validate
  if (isNaN(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error(`Invalid PORT: ${process.env['PORT']}`);
  }
  if (!config.sglangUrl.startsWith('http')) {
    throw new Error(`Invalid SGLANG_URL: ${config.sglangUrl}`);
  }

  _config = Object.freeze(config);
  return _config;
}
