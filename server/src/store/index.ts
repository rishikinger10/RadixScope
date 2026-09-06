/**
 * M10 — Redis store
 *
 * THE ONLY MODULE THAT IMPORTS A REDIS CLIENT.
 * NF-5: Redis holds only run, request, and poll state.
 * S-8: All keys namespaced under run:{runId}.
 * S-9: 24-hour TTL on all keys.
 * Not a queue, bus, prompt store, or SGLang mirror.
 */

import Redis from 'ioredis';
import type {
  RunId,
  RunDocument,
  RunPhase,
  TelemetryRecord,
  ValidityVerdict,
  ComparisonDoc,
  RunProjection,
  RunSummary,
  ServerFingerprint,
} from '../contracts';
import { loadConfig } from '../config';

// ─── Custom error ─────────────────────────────────────────────────────────────
export class StoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Redis unavailable: ${String(cause)}`);
    this.name = 'StoreUnavailableError';
  }
}

// ─── Connection ───────────────────────────────────────────────────────────────
let _client: Redis | null = null;

export function getClient(): Redis {
  if (_client) return _client;
  const cfg = loadConfig();
  _client = new Redis(cfg.redisUrl);
  _client.on('error', (err) => {
    console.error('[store] Redis error:', err);
  });
  return _client;
}

// ─── Key builders ─────────────────────────────────────────────────────────────
const k = {
  run: (id: RunId) => `run:${id}`,
  req: (id: RunId, i: number) => `run:${id}:req:${i}`,
  verdict: (id: RunId) => `run:${id}:verdict`,
  comparison: (id: RunId) => `run:${id}:comparison`,
  fingerprint: (id: RunId) => `run:${id}:fingerprint`,
  active: () => `lock:benchmark`,
  index: () => `run:index`,
};

function ttl(): number {
  return loadConfig().runTtlSeconds;
}

// ─── createRun ────────────────────────────────────────────────────────────────
export async function createRun(doc: RunDocument): Promise<void> {
  try {
    const client = getClient();
    const pipe = client.pipeline();
    pipe.set(k.run(doc.runId), JSON.stringify(doc), 'EX', ttl());
    pipe.lpush(k.index(), doc.runId);
    pipe.ltrim(k.index(), 0, 49); // keep last 50 run IDs
    await pipe.exec();
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── updateRunPhase ───────────────────────────────────────────────────────────
export async function updateRunPhase(runId: RunId, phase: RunPhase): Promise<void> {
  try {
    const client = getClient();
    const raw = await client.get(k.run(runId));
    if (!raw) throw new StoreUnavailableError(`Run ${runId} not found`);
    const doc = JSON.parse(raw) as RunDocument;
    doc.phase = phase;
    if (phase === 'COMPLETE' || phase === 'INVALID') {
      doc.completedAt = Date.now();
    }
    await client.set(k.run(runId), JSON.stringify(doc), 'EX', ttl());
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── appendRecord ─────────────────────────────────────────────────────────────
export async function appendRecord(runId: RunId, record: TelemetryRecord): Promise<void> {
  try {
    await getClient().set(
      k.req(runId, record.requestIndex + (record.mode === 'NORMALIZED' ? 100 : 0)),
      JSON.stringify(record),
      'EX',
      ttl()
    );
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── putVerdict ───────────────────────────────────────────────────────────────
export async function putVerdict(runId: RunId, verdict: ValidityVerdict): Promise<void> {
  try {
    await getClient().set(k.verdict(runId), JSON.stringify(verdict), 'EX', ttl());
    // Also update the run doc's verdict
    const raw = await getClient().get(k.run(runId));
    if (raw) {
      const doc = JSON.parse(raw) as RunDocument;
      doc.verdict = verdict;
      await getClient().set(k.run(runId), JSON.stringify(doc), 'EX', ttl());
    }
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── putComparison ────────────────────────────────────────────────────────────
export async function putComparison(runId: RunId, comparison: ComparisonDoc): Promise<void> {
  try {
    await getClient().set(k.comparison(runId), JSON.stringify(comparison), 'EX', ttl());
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── putFingerprint ───────────────────────────────────────────────────────────
export async function putFingerprint(runId: RunId, fp: ServerFingerprint): Promise<void> {
  try {
    await getClient().set(k.fingerprint(runId), JSON.stringify(fp), 'EX', ttl());
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── markRunActive / clearRunActive ──────────────────────────────────────────
// Single-flight marker — in-process guard in M7 is primary; this enables orphan detection
export async function markRunActive(runId: RunId): Promise<void> {
  try {
    await getClient().set(k.active(), runId, 'EX', 7200); // 2h max run time
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

export async function clearRunActive(): Promise<void> {
  try {
    await getClient().del(k.active());
  } catch (err) {
    // Best-effort
    console.error('[store] Failed to clear active run lock:', err);
  }
}

export async function getActiveRunId(): Promise<RunId | null> {
  try {
    return await getClient().get(k.active());
  } catch {
    return null;
  }
}

// ─── getRunProjection ─────────────────────────────────────────────────────────
// Computes the poll response fresh on each call — polling is stateless server-side
export async function getRunProjection(runId: RunId): Promise<RunProjection | null> {
  try {
    const client = getClient();
    const rawDoc = await client.get(k.run(runId));
    if (!rawDoc) return null;

    const doc = JSON.parse(rawDoc) as RunDocument;

    // Gather all request records
    const keys = await client.keys(`run:${runId}:req:*`);
    const records: TelemetryRecord[] = [];
    if (keys.length > 0) {
      const values = await client.mget(...keys);
      for (const v of values) {
        if (v) records.push(JSON.parse(v) as TelemetryRecord);
      }
    }
    records.sort((a, b) => {
      const modeOrder = a.mode === 'RAW' ? 0 : 1;
      const modeOrderB = b.mode === 'RAW' ? 0 : 1;
      if (modeOrder !== modeOrderB) return modeOrder - modeOrderB;
      return a.requestIndex - b.requestIndex;
    });

    const projection: RunProjection = {
      runId,
      phase: doc.phase,
      records,
      fingerprint: doc.fingerprint,
    };

    if (doc.verdict) {
      projection.verdict = doc.verdict;
    }

    // Comparison only present when COMPLETE and valid — never on INVALID (B-6)
    if (doc.phase === 'COMPLETE' && doc.verdict?.valid) {
      const rawComp = await client.get(k.comparison(runId));
      if (rawComp) {
        projection.comparison = JSON.parse(rawComp) as ComparisonDoc;
      }
    }

    return projection;
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── listRunSummaries ─────────────────────────────────────────────────────────
export async function listRunSummaries(n: number): Promise<RunSummary[]> {
  try {
    const client = getClient();
    const ids = await client.lrange(k.index(), 0, n - 1);
    if (ids.length === 0) return [];

    const values = await client.mget(...ids.map(k.run));
    const summaries: RunSummary[] = [];
    for (const v of values) {
      if (!v) continue;
      const doc = JSON.parse(v) as RunDocument;
      summaries.push({
        runId: doc.runId,
        phase: doc.phase,
        startedAt: doc.startedAt,
        completedAt: doc.completedAt,
        modelId: doc.fingerprint?.modelId,
        verdict: doc.verdict
          ? { valid: doc.verdict.valid, reason: doc.verdict.reason }
          : undefined,
      });
    }
    return summaries;
  } catch (err) {
    throw new StoreUnavailableError(err);
  }
}

// ─── Health check ─────────────────────────────────────────────────────────────
export async function ping(): Promise<boolean> {
  try {
    const result = await getClient().ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
