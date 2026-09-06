# Feature 3 — Prompt normalizer

## Purpose
Restructure eligible prompt templates so genuinely shared/static sections (system prompt, tool schema, role instructions) come first and dynamic/agent-specific sections come last — without changing instruction precedence, causal history, task correctness, or content. This is what makes the "normalized" run in F4 cache-friendly; RadixScope does not touch SGLang's routing or caching itself.

## Inputs
- The F2 prompt templates, already split into named sections (e.g. `system`, `tool_schema`, `role_instructions`, `task_context`, `agent_dynamic`).
- A manual, explicit classification of each section as `static` (shared, safe to move earlier) or `dynamic` (must stay where causal/semantic correctness requires) — done by a developer, not inferred at runtime.

## Outputs
- A `normalize(sections, classification)` function returning a reordered prompt: all `static`-classified sections first (in a fixed, stable order), all `dynamic` sections after (in their original relative order).
- A record of which section, if any, was **not** normalized because its eligibility was uncertain (bypassed), for F5's diagnostics to reference.

## Minimum implementation needed for the demo
Reordering only — no rewriting, summarizing, or altering of section content. Applies only to the specific section set defined for F2's workload; this is not a general-purpose prompt compiler.

## Implementation steps
1. Enumerate the exact sections used in F2's planner and worker templates.
2. For each section, explicitly mark it `static` or `dynamic` in code (a simple config object), based on whether its content is identical across the raw workload's repeated calls.
3. Implement `normalize()`: concatenate all `static` sections in a fixed order, then all `dynamic` sections in their original relative order, preserving each section's internal content and any instruction precedence markers (e.g. "the following overrides prior instructions" stays attached to the section it governs).
4. If a section's eligibility is uncertain (its "static" status can't be guaranteed across calls, or moving it could change how the model interprets precedence), leave it in its original position and record it as bypassed — do not attempt to move it.
5. Unit-test `normalize()` against the fixed planner and worker templates from F2: assert content is unchanged, only order changes, and any bypassed sections are logged.

## Acceptance check
- `normalize()` applied to F2's raw templates produces a prompt with identical content/tokens, only reordered.
- Running F2's correctness assertion against the normalized prompt output still passes (semantic/task correctness preserved).
- At least one section is confirmed genuinely static and moved first; any section marked uncertain is left untouched and recorded, not silently reordered.

## Skip this
General-purpose or automatic static/dynamic classification (e.g. via heuristics or ML) — classification is explicit and manual for this fixed workload only. Skip supporting arbitrary/unknown prompt templates.

## Fallback if Day 0 verification fails
Not applicable — the normalizer's correctness does not depend on any of the three unverified SGLang capabilities; it operates purely on prompt text before it reaches SGLang.
