/**
 * M9 — Prefix analyzer
 *
 * PURE — no I/O, no clock, no randomness.
 * All output is RADIXSCOPE_DERIVED — never presented as SGLang cache state.
 * O-3: LCP is NOT called a "cache hit". Never maps token index to component name.
 */

import type { TelemetryRecord, ComparisonDoc, Diagnostic, DerivedFields, RunId } from '../contracts';

// ─── longestCommonPrefix ──────────────────────────────────────────────────────
export function longestCommonPrefix(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

// ─── firstDivergenceIndex ─────────────────────────────────────────────────────
export function firstDivergenceIndex(a: number[], b: number[]): number {
  return longestCommonPrefix(a, b);
}

// ─── reuseRatio ───────────────────────────────────────────────────────────────
// cachedTokens / promptTokens — RADIXSCOPE_DERIVED even though inputs are SGLANG_NATIVE
export function reuseRatio(native: TelemetryRecord['native']): number {
  if (native.promptTokens === 0) return 0;
  return native.cachedTokens / native.promptTokens;
}

// ─── diagnose ─────────────────────────────────────────────────────────────────
// O-10: Diagnostics are heuristic and explicitly labelled as inference
export function diagnose(
  rawRecords: TelemetryRecord[],
  normRecords: TelemetryRecord[]
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Compare per-request reuse ratios
  const rawAvgReuse =
    rawRecords.reduce((s, r) => s + reuseRatio(r.native), 0) / (rawRecords.length || 1);
  const normAvgReuse =
    normRecords.reduce((s, r) => s + reuseRatio(r.native), 0) / (normRecords.length || 1);

  if (normAvgReuse > rawAvgReuse) {
    diagnostics.push({
      kind: 'REUSE_IMPROVEMENT',
      message: `Normalized run achieved higher average cache-reuse ratio (${normAvgReuse.toFixed(3)} vs ${rawAvgReuse.toFixed(3)}). This is RADIXSCOPE_DERIVED from SGLANG_NATIVE cached_tokens values.`,
      isInference: true,
    });
  } else if (normAvgReuse < rawAvgReuse) {
    diagnostics.push({
      kind: 'REUSE_REGRESSION',
      message: `Normalized run achieved lower average cache-reuse ratio (${normAvgReuse.toFixed(3)} vs ${rawAvgReuse.toFixed(3)}). This is a valid measurement — normalization did not improve reuse for this workload.`,
      isInference: true,
    });
  } else {
    diagnostics.push({
      kind: 'REUSE_UNCHANGED',
      message: `Both runs achieved the same average cache-reuse ratio (${rawAvgReuse.toFixed(3)}). Prompt structure difference may not have affected KV cache reuse on this run.`,
      isInference: true,
    });
  }

  // Flag retractions
  const retractedRaw = rawRecords.filter((r) => r.native.numRetractions > 0);
  const retractedNorm = normRecords.filter((r) => r.native.numRetractions > 0);
  if (retractedRaw.length > 0 || retractedNorm.length > 0) {
    diagnostics.push({
      kind: 'RETRACTIONS_PRESENT',
      message: `num_retractions > 0 detected: ${retractedRaw.length} raw request(s), ${retractedNorm.length} normalized request(s). Retraction causes cached_tokens to understate actual reuse.`,
      isInference: true,
    });
  }

  return diagnostics;
}

// ─── buildDerivedFields ───────────────────────────────────────────────────────
export function buildDerivedFields(
  record: TelemetryRecord,
  previousTokenIds: number[]
): DerivedFields {
  const currentIds = record.measured.promptTokenIds;
  const lcp = longestCommonPrefix(currentIds, previousTokenIds);
  const fdi = firstDivergenceIndex(currentIds, previousTokenIds);

  let prefillDurationMs: number | undefined;
  const { forwardEntryTime, prefillFinishedTime } = record.native;
  if (
    typeof forwardEntryTime === 'number' &&
    typeof prefillFinishedTime === 'number' &&
    prefillFinishedTime >= forwardEntryTime
  ) {
    // RADIXSCOPE_DERIVED when computed as a difference
    prefillDurationMs = prefillFinishedTime - forwardEntryTime;
  }

  return {
    reuseRatio: reuseRatio(record.native),
    prefillDurationMs,
    lcpWithPrevious: lcp,
    firstDivergenceIndex: fdi,
    diagnostics: [],
  };
}

// ─── compare ─────────────────────────────────────────────────────────────────
// Only called when both verdicts are valid (B-6)
export function compare(
  runId: RunId,
  rawRecords: TelemetryRecord[],
  normRecords: TelemetryRecord[]
): ComparisonDoc {
  const rawTotal = rawRecords.reduce((s, r) => s + r.native.cachedTokens, 0);
  const normTotal = normRecords.reduce((s, r) => s + r.native.cachedTokens, 0);

  const rawRatios = rawRecords.map(reuseRatio.bind(null));
  const normRatios = normRecords.map(reuseRatio.bind(null));

  const rawAvgRatio = rawRatios.reduce((s, r) => s + r, 0) / (rawRatios.length || 1);
  const normAvgRatio = normRatios.reduce((s, r) => s + r, 0) / (normRatios.length || 1);

  // LCP between first requests of each run (cross-run comparison)
  const rawFirstIds = rawRecords[0]?.measured.promptTokenIds ?? [];
  const normFirstIds = normRecords[0]?.measured.promptTokenIds ?? [];

  return {
    runId,
    rawCachedTokensTotal: rawTotal,
    normCachedTokensTotal: normTotal,
    cachedTokensDelta: normTotal - rawTotal,
    reuseRatioDelta: normAvgRatio - rawAvgRatio,
    lcpRaw: longestCommonPrefix(rawFirstIds, rawRecords[1]?.measured.promptTokenIds ?? []),
    lcpNorm: longestCommonPrefix(normFirstIds, normRecords[1]?.measured.promptTokenIds ?? []),
    firstDivergenceIndexRaw: firstDivergenceIndex(
      rawFirstIds,
      rawRecords[1]?.measured.promptTokenIds ?? []
    ),
    firstDivergenceIndexNorm: firstDivergenceIndex(
      normFirstIds,
      normRecords[1]?.measured.promptTokenIds ?? []
    ),
    diagnostics: diagnose(rawRecords, normRecords),
  };
}
