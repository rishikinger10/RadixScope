import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import {
  RunDocument,
  RunId,
  TelemetryRecord,
  ServerFingerprint,
  RunPhase,
  AssembledPrompt,
  RunMode,
} from '../../contracts';
import { loadConfig, LOCKED_SAMPLING } from '../../config';
import { generate, flushCache, serverInfo, tokenize } from '../../sglang';
import {
  agentSequence,
  componentsFor,
  initialConversationState,
  updateConversation,
} from '../../workload';
import { assemble } from '../../prompt/assemble';
import {
  resolveTolerance,
  assertCold,
  assertSettingsEqual,
  assertContentEqual,
  assertServerUnchanged,
  validVerdict,
  invalidVerdict,
} from '../validity';
import { buildDerivedFields, compare } from '../../analysis';
import {
  createRun,
  updateRunPhase,
  appendRecord,
  putVerdict,
  putComparison,
  putFingerprint,
  markRunActive,
  clearRunActive,
} from '../../store';

export class RunInProgressError extends Error {
  constructor() {
    super('Run already in progress');
    this.name = 'RunInProgressError';
  }
}

// In-process single-flight guard (I-1, M7 rule)
let running = false;
let currentAbortController: AbortController | null = null;
export function isRunning(): boolean {
    return running;
}

/**
 * M7: Benchmark runner state machine
 * Takes the lock, creates the run doc, returns 202, and continues async.
 */
export async function startRun(options: {
    normalizeSecondRun: boolean;
}): Promise<{ runId: RunId }> {
    if (running) {
        throw new RunInProgressError();
    }

    running = true;
    const { normalizeSecondRun } = options;

    const runId = uuidv4() as RunId;
    const doc: RunDocument & { componentHashes?: string[] } = {
        runId,
        phase: "QUEUED",
        startedAt: Date.now(),
        normalizeSecondRun,
        samplingParams: LOCKED_SAMPLING,
    };

    currentAbortController = new AbortController();

    try {
        await createRun(doc);
        await markRunActive(runId);

        // Fire and forget
        setImmediate(() => {
            runBenchmark(runId, normalizeSecondRun, doc, currentAbortController!.signal)
                .catch((err) => handleFatalError(runId, err))
                .finally(async () => {
                    running = false;
                    currentAbortController = null;
                    await clearRunActive();
                });
        });

        return {runId};
    } catch (error) {
        running = false;
        currentAbortController = null;
        throw error;
    }
}

async function handleFatalError(runId: RunId, err: unknown) {
  console.error(`[Runner] Fatal error in run ${runId}:`, err);
  try {
    await updateRunPhase(runId, 'INVALID');
    await putVerdict(
      runId,
      invalidVerdict('RUNTIME_ERROR', { error: String(err) })
    );
  } catch (storeErr) {
    console.error(`[Runner] Failed to store RUNTIME_ERROR for run ${runId}:`, storeErr);
  }
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
}

/**
 * Core state machine
 */
async function runBenchmark(
  runId: RunId,
  normalizeSecondRun: boolean,
  doc: RunDocument & { componentHashes?: string[] },
  signal: AbortSignal
) {
  try {
    // ---------------------------------------------------------
    // PREFLIGHT
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'PREFLIGHT');

    // M3.serverInfo()
    const fingerprint = await serverInfo(signal);
    await putFingerprint(runId, fingerprint);
    doc.fingerprint = fingerprint;

    const tolerance = resolveTolerance(fingerprint);
    if (tolerance === null) {
      // REFUSE TO START (B-4)
      console.warn(`[Runner] Refusing to start run ${runId}: unresolvable tolerance (page_size).`);
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, invalidVerdict('RUNTIME_ERROR', { message: 'Unresolvable tolerance' }));
      return;
    }
    doc.coldStartTolerance = tolerance;

    // ---------------------------------------------------------
    // FLUSH_RAW
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'FLUSH_RAW');
    try {
      await flushCache(signal);
    } catch (err) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, invalidVerdict('FLUSH_FAILED', { phase: 'FLUSH_RAW', error: String(err) }));
      return;
    }

    // ---------------------------------------------------------
    // RUN_RAW
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'RUN_RAW');
    const rawRecords: TelemetryRecord[] = [];
    let conversation = initialConversationState();
    let previousTokenIds: number[] = [];
    doc.componentHashes = [];

    for (const [index, agent] of agentSequence().entries()) {
      const components = componentsFor(agent, conversation);
      const prompt = assemble(components, 'RAW');

      // Hash content for assertContentEqual
      if (index === 0) {
        for (const c of prompt.manifest) {
          doc.componentHashes.push(hashContent(c.content));
        }
      }

      const t0 = performance.now();
      const res = await generate(prompt.text, LOCKED_SAMPLING, { stream: true, signal });
      const totalLatencyMs = performance.now() - t0;

      // Note: firstTokenAt might be missing if streaming is unreliable
      const ttftMs = res.firstTokenAt ? res.firstTokenAt - t0 : undefined;

      const { tokenIds } = await tokenize(prompt.text, signal);

      const record: TelemetryRecord = {
        runId,
        mode: 'RAW',
        requestIndex: index,
        agent,
        native: res.native,
        measured: {
          ttftMs,
          totalLatencyMs,
          promptTokenIds: tokenIds,
          assembledAt: t0,
        },
        derived: {} as any, // assigned below
      };

      record.derived = buildDerivedFields(record, previousTokenIds);
      previousTokenIds = tokenIds;
      rawRecords.push(record);
      await appendRecord(runId, record);

      conversation = updateConversation(conversation, agent, res.text);
    }

    doc.rawFirstCachedTokens = rawRecords[0]?.native.cachedTokens;

    // ---------------------------------------------------------
    // VALIDATE_RAW
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'VALIDATE_RAW');
    const coldVerdictRaw = assertCold(rawRecords[0], tolerance);
    if (!coldVerdictRaw.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, coldVerdictRaw);
      return;
    }

    const settingsVerdictRaw = assertSettingsEqual(LOCKED_SAMPLING, LOCKED_SAMPLING);
    if (!settingsVerdictRaw.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, settingsVerdictRaw);
      return;
    }

    // ---------------------------------------------------------
    // CHECK NORMALIZATION SKIP
    // ---------------------------------------------------------
    if (!normalizeSecondRun) {
      await updateRunPhase(runId, 'COMPLETE');
      await putVerdict(runId, validVerdict({ skippedNormalization: true }));
      return;
    }

    // ---------------------------------------------------------
    // FLUSH_NORM
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'FLUSH_NORM');
    try {
      await flushCache(signal);
    } catch (err) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, invalidVerdict('FLUSH_FAILED', { phase: 'FLUSH_NORM', error: String(err) }));
      return;
    }

    // ---------------------------------------------------------
    // RUN_NORM
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'RUN_NORM');
    const normRecords: TelemetryRecord[] = [];
    conversation = initialConversationState();
    previousTokenIds = [];
    const normDoc: RunDocument & { componentHashes?: string[] } = { ...doc, componentHashes: [] };

    for (const [index, agent] of agentSequence().entries()) {
      const components = componentsFor(agent, conversation);
      const prompt = assemble(components, 'NORMALIZED');

      if (index === 0) {
        // Normalization moves content around, but byte identity across the set must hold
        // so we sort by ID before hashing to prove content didn't change
        const sortedManifest = [...prompt.manifest].sort((a, b) => a.id.localeCompare(b.id));
        for (const c of sortedManifest) {
          normDoc.componentHashes!.push(hashContent(c.content));
        }
      }

      const t0 = performance.now();
      const res = await generate(prompt.text, LOCKED_SAMPLING, { stream: true, signal });
      const totalLatencyMs = performance.now() - t0;
      const ttftMs = res.firstTokenAt ? res.firstTokenAt - t0 : undefined;

      const { tokenIds } = await tokenize(prompt.text, signal);

      const record: TelemetryRecord = {
        runId,
        mode: 'NORMALIZED',
        requestIndex: index,
        agent,
        native: res.native,
        measured: {
          ttftMs,
          totalLatencyMs,
          promptTokenIds: tokenIds,
          assembledAt: t0,
        },
        derived: {} as any,
      };

      record.derived = buildDerivedFields(record, previousTokenIds);
      previousTokenIds = tokenIds;
      normRecords.push(record);
      await appendRecord(runId, record);

      conversation = updateConversation(conversation, agent, res.text);
    }

    doc.normFirstCachedTokens = normRecords[0]?.native.cachedTokens;

    // ---------------------------------------------------------
    // VALIDATE_NORM
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'VALIDATE_NORM');
    const coldVerdictNorm = assertCold(normRecords[0], tolerance);
    if (!coldVerdictNorm.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, coldVerdictNorm);
      return;
    }

    const settingsVerdictNorm = assertSettingsEqual(LOCKED_SAMPLING, LOCKED_SAMPLING);
    if (!settingsVerdictNorm.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, settingsVerdictNorm);
      return;
    }

    // ---------------------------------------------------------
    // COMPARE
    // ---------------------------------------------------------
    await updateRunPhase(runId, 'COMPARE');

    // Sort raw doc's hashes too (to compare with sorted norm hashes)
    if (doc.componentHashes) {
        doc.componentHashes.sort();
    }
    if (normDoc.componentHashes) {
        normDoc.componentHashes.sort();
    }

    const contentVerdict = assertContentEqual(doc, normDoc);
    if (!contentVerdict.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, contentVerdict);
      return;
    }

    const fpEnd = await serverInfo(signal);
    const serverVerdict = assertServerUnchanged(fingerprint, fpEnd);
    if (!serverVerdict.valid) {
      await updateRunPhase(runId, 'INVALID');
      await putVerdict(runId, serverVerdict);
      return;
    }

    const compDoc = compare(runId, rawRecords, normRecords);
    await putComparison(runId, compDoc);

    // COMPLETE
    await updateRunPhase(runId, 'COMPLETE');
    await putVerdict(runId, validVerdict({}));

  } catch (err: any) {
    if (err.name === 'AbortError') {
      return;
    }
    throw err;
  }
}
