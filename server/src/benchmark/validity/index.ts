/**
 * M8 — Validity gate
 *
 * PURE — no I/O, no clock, no randomness.
 * SOLE AUTHORITY to produce INVALID verdicts.
 * Never widens tolerances. Never infers when unresolved.
 */

import type {
  ValidityVerdict,
  TelemetryRecord,
  ServerFingerprint,
  SamplingParams,
  RunDocument,
} from '../../contracts';
import { LOCKED_SAMPLING } from '../../config';

// ─── resolveTolerance ────────────────────────────────────────────────────────
// B-4: Returns null if page size cannot be resolved → runner must REFUSE to start
export function resolveTolerance(fingerprint: ServerFingerprint): number | null {
  const { pageSize } = fingerprint;
  if (typeof pageSize !== 'number' || pageSize <= 0) {
    return null; // Cannot resolve → runner refuses to start
  }
  // §5.3: page_size == 1 → tolerance 0; page_size > 1 → tolerance = page_size
  return pageSize === 1 ? 0 : pageSize;
}

// ─── assertCold ──────────────────────────────────────────────────────────────
// B-3: First request cached_tokens must be within resolved tolerance
export function assertCold(
  firstRecord: TelemetryRecord,
  tolerance: number
): ValidityVerdict {
  const observed = firstRecord.native.cachedTokens;

  if (observed <= tolerance) {
    return {
      valid: true,
      evidence: { observed, tolerance },
    };
  }

  return {
    valid: false,
    reason: 'WARM_START',
    evidence: {
      observed,
      tolerance,
      agent: firstRecord.agent,
      requestIndex: firstRecord.requestIndex,
    },
  };
}

// ─── assertSettingsEqual ──────────────────────────────────────────────────────
// B-1: Effective sampling params must match the locked set in both runs
export function assertSettingsEqual(
  rawSettings: SamplingParams,
  normSettings: SamplingParams
): ValidityVerdict {
  const locked = LOCKED_SAMPLING;

  const rawMatch =
    rawSettings.temperature === locked.temperature &&
    rawSettings.n === locked.n &&
    rawSettings.max_new_tokens === locked.max_new_tokens;

  const normMatch =
    normSettings.temperature === locked.temperature &&
    normSettings.n === locked.n &&
    normSettings.max_new_tokens === locked.max_new_tokens;

  if (rawMatch && normMatch) {
    return { valid: true, evidence: { raw: rawSettings, norm: normSettings } };
  }

  return {
    valid: false,
    reason: 'SETTINGS_MISMATCH',
    evidence: {
      locked,
      raw: rawSettings,
      norm: normSettings,
      rawMatch,
      normMatch,
    },
  };
}

// ─── assertContentEqual ──────────────────────────────────────────────────────
// F-5: Component content must be byte-identical between raw and normalized runs
export function assertContentEqual(
  rawRun: RunDocument & { componentHashes?: string[] },
  normRun: RunDocument & { componentHashes?: string[] }
): ValidityVerdict {
  // Hashes are computed by the runner at assembly time
  const rawHashes = rawRun.componentHashes ?? [];
  const normHashes = normRun.componentHashes ?? [];

  const match =
    rawHashes.length === normHashes.length &&
    rawHashes.every((h, i) => h === normHashes[i]);

  if (match) {
    return { valid: true, evidence: { hashCount: rawHashes.length } };
  }

  // Find first mismatch
  const firstMismatch = rawHashes.findIndex((h, i) => h !== normHashes[i]);

  return {
    valid: false,
    reason: 'CONTENT_MISMATCH',
    evidence: {
      firstMismatchIndex: firstMismatch,
      rawLength: rawHashes.length,
      normLength: normHashes.length,
    },
  };
}

// ─── assertServerUnchanged ────────────────────────────────────────────────────
// B-9: Server fingerprint must match between raw and normalized runs
export function assertServerUnchanged(
  fpA: ServerFingerprint,
  fpB: ServerFingerprint
): ValidityVerdict {
  const fields: (keyof ServerFingerprint)[] = ['version', 'modelId', 'attentionBackend', 'pageSize'];
  const mismatches: Record<string, unknown> = {};

  for (const field of fields) {
    if (fpA[field] !== fpB[field]) {
      mismatches[field] = { raw: fpA[field], norm: fpB[field] };
    }
  }

  if (Object.keys(mismatches).length === 0) {
    return { valid: true, evidence: { version: fpA.version, modelId: fpA.modelId } };
  }

  return {
    valid: false,
    reason: 'SERVER_CHANGED',
    evidence: mismatches,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function invalidVerdict(
  reason: ValidityVerdict['reason'],
  evidence: Record<string, unknown>
): ValidityVerdict {
  return { valid: false, reason, evidence };
}

export function validVerdict(evidence: Record<string, unknown>): ValidityVerdict {
  return { valid: true, evidence };
}
