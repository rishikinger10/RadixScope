/**
 * M3 — SGLang client module
 *
 * THE ONLY MODULE THAT KNOWS SGLANG EXISTS AS HTTP.
 * No other module holds a URL, header, status code, or meta_info shape.
 *
 * Verified contract: SGLang v0.5.18 only.
 * Never retry /generate or /flush_cache inside a run (B-7).
 * Never call /health_generate (§4.2).
 */

import { loadConfig } from '../config';
import type {
  NativeFields,
  GenerateResult,
  FlushResult,
  ServerFingerprint,
  TokenizeResult,
  SamplingParams,
} from '../contracts';

// ─── Custom errors ───────────────────────────────────────────────────────────
export class SglangUnreachableError extends Error {
  constructor(cause: unknown) {
    super(`SGLang unreachable: ${String(cause)}`);
    this.name = 'SglangUnreachableError';
  }
}

export class SglangHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly endpoint: string
  ) {
    super(`SGLang ${endpoint} returned HTTP ${status}`);
    this.name = 'SglangHttpError';
  }
}

export class FlushRefusedError extends Error {
  constructor(status: number, body: string) {
    super(`/flush_cache returned HTTP ${status}: ${body}`);
    this.name = 'FlushRefusedError';
  }
}

export class MetaInfoMissingError extends Error {
  constructor(field: string) {
    super(`meta_info.${field} is absent or non-numeric — run must be INVALID`);
    this.name = 'MetaInfoMissingError';
  }
}

// ─── parseMetaInfo — pure, exported for unit tests ──────────────────────────
export function parseMetaInfo(raw: unknown): NativeFields {
  if (typeof raw !== 'object' || raw === null) {
    throw new MetaInfoMissingError('(object)');
  }
  const m = raw as Record<string, unknown>;

  const cachedTokens = m['cached_tokens'];
  if (typeof cachedTokens !== 'number') {
    // B-3/B-5: missing or non-numeric must invalidate, never default to 0
    throw new MetaInfoMissingError('cached_tokens');
  }

  return {
    promptTokens: numberOrThrow(m, 'prompt_tokens'),
    completionTokens: numberOrThrow(m, 'completion_tokens'),
    cachedTokens,
    finishReason: String(m['finish_reason'] ?? 'unknown'),
    numRetractions: typeof m['num_retractions'] === 'number' ? m['num_retractions'] : 0,
    weightVersion: typeof m['weight_version'] === 'string' ? m['weight_version'] : undefined,
    forwardEntryTime: optionalNumber(m, 'forward_entry_time'),
    prefillFinishedTime: optionalNumber(m, 'prefill_finished_time'),
    queueTime: optionalNumber(m, 'queue_time'),
  };
}

function numberOrThrow(m: Record<string, unknown>, key: string): number {
  if (typeof m[key] !== 'number') throw new MetaInfoMissingError(key);
  return m[key] as number;
}

function optionalNumber(m: Record<string, unknown>, key: string): number | undefined {
  return typeof m[key] === 'number' ? (m[key] as number) : undefined;
}

// ─── fetchWithTimeout ────────────────────────────────────────────────────────
async function fetchWithTimeout(
  url: string,
  opts: RequestInit & { signal?: AbortSignal },
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Merge caller's signal
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(url, { ...opts, signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw new SglangUnreachableError(err);
  }
}

// ─── generate ────────────────────────────────────────────────────────────────
export async function generate(
  promptText: string,
  samplingParams: SamplingParams,
  opts: { stream: boolean; signal: AbortSignal }
): Promise<GenerateResult> {
  const cfg = loadConfig();
  const url = `${cfg.sglangUrl}/generate`;

  const body = JSON.stringify({
    text: promptText,
    sampling_params: samplingParams,
    stream: opts.stream,
  });

  const dispatchAt = performance.now();
  let firstTokenAt: number | undefined;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: opts.signal,
    },
    cfg.generateTimeoutMs
  );

  if (!res.ok) {
    const text = await res.text();
    throw new SglangHttpError(res.status, text, '/generate');
  }

  let responseText: string;
  let rawMeta: unknown;

  if (opts.stream) {
    // Consume streaming response internally to capture firstTokenAt (O-8)
    const reader = res.body?.getReader();
    if (!reader) throw new SglangUnreachableError('No response body reader');

    const decoder = new TextDecoder();
    let fullText = '';
    let metaBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });

      // Record first frame time (O-8)
      if (firstTokenAt === undefined && chunk.trim()) {
        firstTokenAt = performance.now();
      }

      metaBuffer += chunk;
      fullText += chunk;
    }

    // SGLang streaming: last line is the full JSON with meta_info
    const lines = metaBuffer.trim().split('\n').filter(Boolean);
    const lastLine = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastLine ?? '{}') as { text?: string; meta_info?: unknown };
      responseText = parsed.text ?? fullText;
      rawMeta = parsed.meta_info;
    } catch {
      responseText = fullText;
      rawMeta = undefined;
    }
  } else {
    const parsed = (await res.json()) as { text?: string; meta_info?: unknown };
    responseText = parsed.text ?? '';
    rawMeta = parsed.meta_info;
  }

  const native = parseMetaInfo(rawMeta);

  return {
    text: responseText,
    native,
    firstTokenAt,
  };
}

// ─── flushCache ──────────────────────────────────────────────────────────────
// B-2: POST /flush_cache?timeout=30 — never retried inside a run
export async function flushCache(signal: AbortSignal): Promise<FlushResult> {
  const cfg = loadConfig();
  const url = `${cfg.sglangUrl}/flush_cache?timeout=30`;

  const res = await fetchWithTimeout(
    url,
    { method: 'POST', signal },
    cfg.flushTimeoutMs
  );

  if (!res.ok) {
    const body = await res.text();
    throw new FlushRefusedError(res.status, body);
  }

  return { success: true };
}

// ─── health ──────────────────────────────────────────────────────────────────
// Only retried outside a run. NEVER calls /health_generate.
export async function health(): Promise<boolean> {
  const cfg = loadConfig();
  try {
    const res = await fetchWithTimeout(
      `${cfg.sglangUrl}/health`,
      { method: 'GET' },
      cfg.healthTimeoutMs
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ─── serverInfo ──────────────────────────────────────────────────────────────
export async function serverInfo(signal?: AbortSignal): Promise<ServerFingerprint> {
  const cfg = loadConfig();
  const res = await fetchWithTimeout(
    `${cfg.sglangUrl}/get_server_info`,
    { method: 'GET', signal },
    cfg.healthTimeoutMs
  );

  if (!res.ok) {
    const body = await res.text();
    throw new SglangHttpError(res.status, body, '/get_server_info');
  }

  const data = (await res.json()) as Record<string, unknown>;

  // Extract effective page size — drives cold-start tolerance (B-4, §5.3)
  const pageSize =
    typeof data['page_size'] === 'number'
      ? data['page_size']
      : 1; // default per v0.5.18 source for non-HIP/non-MUSA

  return {
    version: String(data['version'] ?? 'unknown'),
    modelId: String(data['model_path'] ?? data['model_id'] ?? 'unknown'),
    contextLength: typeof data['context_length'] === 'number' ? data['context_length'] : 0,
    attentionBackend: String(data['attention_backend'] ?? 'unknown'),
    pageSize,
    maxTotalNumTokens:
      typeof data['max_total_num_tokens'] === 'number' ? data['max_total_num_tokens'] : 0,
  };
}

// ─── tokenize ────────────────────────────────────────────────────────────────
export async function tokenize(text: string, signal?: AbortSignal): Promise<TokenizeResult> {
  const cfg = loadConfig();
  const res = await fetchWithTimeout(
    `${cfg.sglangUrl}/tokenize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal,
    },
    cfg.healthTimeoutMs
  );

  if (!res.ok) {
    const body = await res.text();
    throw new SglangHttpError(res.status, body, '/tokenize');
  }

  const data = (await res.json()) as { input_ids?: number[] };
  return { tokenIds: data.input_ids ?? [] };
}
