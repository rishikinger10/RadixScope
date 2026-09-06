import { z } from 'zod';

// ─── Run identifiers ────────────────────────────────────────────────────────
export type RunId = string;

// ─── Enum-like literals ─────────────────────────────────────────────────────
export const RunModeSchema = z.enum(['RAW', 'NORMALIZED']);
export type RunMode = z.infer<typeof RunModeSchema>;

export const AgentIdSchema = z.enum(['planner', 'worker1', 'worker2']);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const ComponentKindSchema = z.enum([
  'SYSTEM',
  'SHARED_STATIC',
  'AGENT_RULES',
  'DYNAMIC_METADATA',
  'TASK',
]);
export type ComponentKind = z.infer<typeof ComponentKindSchema>;

// Normalizer may only move these three kinds (N-3)
export const MOVABLE_KINDS: ReadonlySet<ComponentKind> = new Set([
  'SHARED_STATIC',
  'AGENT_RULES',
  'DYNAMIC_METADATA',
]);

// ─── Run phases ─────────────────────────────────────────────────────────────
export const RunPhaseSchema = z.enum([
  'QUEUED',
  'PREFLIGHT',
  'FLUSH_RAW',
  'RUN_RAW',
  'VALIDATE_RAW',
  'FLUSH_NORM',
  'RUN_NORM',
  'VALIDATE_NORM',
  'COMPARE',
  'COMPLETE',
  'INVALID',
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

// ─── INVALID reason codes ───────────────────────────────────────────────────
export const ReasonCodeSchema = z.enum([
  'FLUSH_FAILED',
  'WARM_START',
  'META_MISSING',
  'SETTINGS_MISMATCH',
  'CONTENT_MISMATCH',
  'TASK_DIVERGENCE',
  'SERVER_CHANGED',
  'RUNTIME_ERROR',
]);
export type ReasonCode = z.infer<typeof ReasonCodeSchema>;

// ─── Provenance ──────────────────────────────────────────────────────────────
export const ProvenanceSchema = z.enum([
  'SGLANG_NATIVE',
  'RADIXSCOPE_MEASURED',
  'RADIXSCOPE_DERIVED',
]);
export type Provenance = z.infer<typeof ProvenanceSchema>;

// ─── Prompt components ───────────────────────────────────────────────────────
export interface PromptComponent {
  id: string;
  kind: ComponentKind;
  content: string;
}

export interface AssembledPrompt {
  text: string;
  manifest: PromptComponent[];
  normalizationApplied: boolean;
  refusals: Refusal[];
}

export interface Refusal {
  componentId: string;
  reason: string;
}

// ─── SGLang native fields (SGLANG_NATIVE) ───────────────────────────────────
export interface NativeFields {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;         // The authoritative cache-reuse figure
  finishReason: string;
  numRetractions: number;
  weightVersion?: string;
  forwardEntryTime?: number;    // --enable-metrics only
  prefillFinishedTime?: number; // --enable-metrics only
  queueTime?: number;           // --enable-metrics only
}

// ─── Measured fields (RADIXSCOPE_MEASURED) ──────────────────────────────────
export interface MeasuredFields {
  ttftMs?: number;              // Dropped if streaming unreliable; never substituted
  totalLatencyMs: number;
  promptTokenIds: number[];
  assembledAt: number;          // monotonic timestamp
}

// ─── Derived fields (RADIXSCOPE_DERIVED) ─────────────────────────────────────
export interface DerivedFields {
  reuseRatio: number;           // cachedTokens / promptTokens
  prefillDurationMs?: number;   // from SGLang timing fields, or computed difference
  lcpWithPrevious: number;      // longest common token prefix with previous request
  firstDivergenceIndex: number;
  diagnostics: Diagnostic[];
}

export interface Diagnostic {
  kind: string;
  message: string;
  isInference: true;            // All diagnostics are labelled as inference (O-10)
}

// ─── Telemetry record ───────────────────────────────────────────────────────
// Three named sub-objects — provenance is part of the schema (O-1)
export interface TelemetryRecord {
  runId: RunId;
  mode: RunMode;
  requestIndex: number;
  agent: AgentId;
  native: NativeFields;    // SGLANG_NATIVE
  measured: MeasuredFields; // RADIXSCOPE_MEASURED
  derived: DerivedFields;   // RADIXSCOPE_DERIVED
}

// ─── Validity verdict ────────────────────────────────────────────────────────
export interface ValidityVerdict {
  valid: boolean;
  reason?: ReasonCode;
  evidence: Record<string, unknown>;
}

// ─── Server fingerprint ──────────────────────────────────────────────────────
export interface ServerFingerprint {
  version: string;
  modelId: string;
  contextLength: number;
  attentionBackend: string;
  pageSize: number;           // Effective KV page size — drives cold-start tolerance
  maxTotalNumTokens: number;
}

// ─── Sampling settings ───────────────────────────────────────────────────────
export interface SamplingParams {
  temperature: 0;       // LOCKED — must always be 0
  n: 1;                 // LOCKED — must always be 1
  max_new_tokens: 256;  // LOCKED — must always be 256
}

// ─── Comparison document ─────────────────────────────────────────────────────
export interface ComparisonDoc {
  runId: RunId;
  rawCachedTokensTotal: number;
  normCachedTokensTotal: number;
  cachedTokensDelta: number;
  reuseRatioDelta: number;
  lcpRaw: number;
  lcpNorm: number;
  firstDivergenceIndexRaw: number;
  firstDivergenceIndexNorm: number;
  diagnostics: Diagnostic[];
  // provenance: all RADIXSCOPE_DERIVED
}

// ─── Run document ────────────────────────────────────────────────────────────
export interface RunDocument {
  runId: RunId;
  phase: RunPhase;
  startedAt: number;
  completedAt?: number;
  normalizeSecondRun: boolean;
  samplingParams: SamplingParams;
  fingerprint?: ServerFingerprint;
  coldStartTolerance?: number;
  rawFirstCachedTokens?: number;   // B-5: recorded verbatim, valid or not
  normFirstCachedTokens?: number;
  modelId?: string;                // B-9: recorded in fingerprint
  verdict?: ValidityVerdict;
  comparison?: ComparisonDoc;
}

// ─── Run projection (poll response) ─────────────────────────────────────────
export interface RunProjection {
  runId: RunId;
  phase: RunPhase;
  records: TelemetryRecord[];
  verdict?: ValidityVerdict;
  comparison?: ComparisonDoc;     // Absent (not null) when INVALID
  fingerprint?: ServerFingerprint;
}

// ─── Run summary (for /api/runs list) ───────────────────────────────────────
export interface RunSummary {
  runId: RunId;
  phase: RunPhase;
  startedAt: number;
  completedAt?: number;
  modelId?: string;
  verdict?: { valid: boolean; reason?: ReasonCode };
}

// ─── SGLang client outputs ───────────────────────────────────────────────────
export interface GenerateResult {
  text: string;
  native: NativeFields;
  firstTokenAt?: number; // monotonic; used for ttftMs
}

export interface FlushResult {
  success: true;
}

export interface TokenizeResult {
  tokenIds: number[];
}

// ─── Normalizer result ───────────────────────────────────────────────────────
export interface NormalizeResult {
  ordered: PromptComponent[];
  moved: string[];        // component IDs that were moved
  refusals: Refusal[];
}

// ─── Validator helpers ───────────────────────────────────────────────────────
export function isValidPhase(phase: unknown): phase is RunPhase {
  return RunPhaseSchema.safeParse(phase).success;
}

export function isValidReasonCode(code: unknown): code is ReasonCode {
  return ReasonCodeSchema.safeParse(code).success;
}
