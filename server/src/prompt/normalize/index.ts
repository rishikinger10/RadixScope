/**
 * M6 — Normalizer
 *
 * PURE — no I/O, no clock, no randomness.
 * N-2: Same input always produces same output.
 * N-3: Only SHARED_STATIC, AGENT_RULES, DYNAMIC_METADATA may move.
 * N-4: Reversible — invert(normalize(x).ordered, manifest) === x.
 * N-5: Uncertainty → Refusal (not exception, not silent pass-through).
 * N-6: Never rewrites content, only reorders.
 * S-1: SYSTEM stays at position 0.
 * S-2: Untrusted content never rises above trusted.
 */

import type { PromptComponent, NormalizeResult, Refusal } from '../../contracts';
import { MOVABLE_KINDS } from '../../contracts';

// Trust ordering: SYSTEM > SHARED_STATIC = AGENT_RULES = DYNAMIC_METADATA > TASK
// Movable components are ranked relative to each other only.
const MOVABLE_ORDER: Record<string, number> = {
  SHARED_STATIC: 0,
  AGENT_RULES: 1,
  DYNAMIC_METADATA: 2,
};

/**
 * normalize — deterministic reorder of eligible components.
 * Immovable components (SYSTEM, TASK, unclassified) stay in their original
 * slots; movable components are sorted by MOVABLE_ORDER among themselves.
 */
export function normalize(components: PromptComponent[]): NormalizeResult {
  const refusals: Refusal[] = [];
  const moved: string[] = [];

  // Validate: SYSTEM must be first (S-1)
  if (components.length > 0 && components[0]?.kind !== 'SYSTEM') {
    refusals.push({
      componentId: components[0]?.id ?? '?',
      reason: 'SYSTEM block is not at position 0 — normalization refused entirely',
    });
    return { ordered: [...components], moved: [], refusals };
  }

  // Separate movable from fixed
  const fixedSlots: Array<{ index: number; component: PromptComponent }> = [];
  const movableComponents: PromptComponent[] = [];

  components.forEach((c, i) => {
    if (MOVABLE_KINDS.has(c.kind)) {
      movableComponents.push(c);
    } else {
      fixedSlots.push({ index: i, component: c });
    }
  });

  // Sort movable by canonical order (N-2: deterministic)
  const sortedMovable = [...movableComponents].sort((a, b) => {
    const orderA = MOVABLE_ORDER[a.kind] ?? 999;
    const orderB = MOVABLE_ORDER[b.kind] ?? 999;
    return orderA - orderB;
  });

  // Detect which components actually moved
  movableComponents.forEach((original, i) => {
    if (sortedMovable[i]?.id !== original.id) {
      moved.push(original.id);
    }
  });

  // Rebuild the ordered array, slotting movables back into movable positions
  const result: PromptComponent[] = new Array(components.length);
  let movableIdx = 0;

  components.forEach((c, i) => {
    if (MOVABLE_KINDS.has(c.kind)) {
      result[i] = sortedMovable[movableIdx++]!;
    } else {
      result[i] = c;
    }
  });

  return {
    ordered: result,
    moved,
    refusals,
  };
}

/**
 * invert — reconstruct original order from a normalized array + manifest.
 * Satisfies N-4: invert(normalize(x).ordered, x) deep-equals x.
 */
export function invert(
  normalized: PromptComponent[],
  originalManifest: PromptComponent[]
): PromptComponent[] {
  // Build id → component map from normalized
  const byId = new Map(normalized.map((c) => [c.id, c]));

  // Restore by original order
  return originalManifest.map((orig) => {
    const found = byId.get(orig.id);
    if (!found) {
      throw new Error(`invert: component ${orig.id} missing from normalized array`);
    }
    return found;
  });
}
