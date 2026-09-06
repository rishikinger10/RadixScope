/**
 * M5 — Prompt assembler
 *
 * PURE — no I/O, no clock.
 * S-1: SYSTEM always at position 0.
 * N-1: RAW mode never touches M6. Pass-through is byte-identical.
 * A-7: In RAW mode, assemble(components, 'RAW').text === authored text.
 */

import type { AssembledPrompt, PromptComponent, RunMode } from '../../contracts';
import { normalize } from '../normalize';

// ─── Custom errors ───────────────────────────────────────────────────────────
export class SystemPrecedenceViolation extends Error {
  constructor() {
    super('SYSTEM block must be the first component');
    this.name = 'SystemPrecedenceViolation';
  }
}

// ─── assemble ────────────────────────────────────────────────────────────────
export function assemble(components: PromptComponent[], mode: RunMode): AssembledPrompt {
  if (components.length === 0) {
    throw new Error('Cannot assemble an empty component list');
  }

  // S-1: SYSTEM block must be at position 0
  if (components[0]?.kind !== 'SYSTEM') {
    throw new SystemPrecedenceViolation();
  }

  if (mode === 'RAW') {
    // N-1: M6 is never called in RAW mode — enforced as a code path, not a flag
    return {
      text: joinComponents(components),
      manifest: components,
      normalizationApplied: false,
      refusals: [],
    };
  }

  // NORMALIZED mode — invoke M6
  const { ordered, refusals } = normalize(components);

  return {
    text: joinComponents(ordered),
    manifest: ordered,
    normalizationApplied: true,
    refusals,
  };
}

// ─── joinComponents ──────────────────────────────────────────────────────────
// Content is joined verbatim — no rewriting (N-6)
function joinComponents(components: PromptComponent[]): string {
  return components.map((c) => c.content).join('\n\n');
}
