# Feature 2 — Multi-agent workload

## Purpose
Provide a small, realistic multi-agent workload (one planner, 2–3 workers) that repeatedly sends shared context — system prompt, tool schema, role instructions — so there is something concrete for the normalizer (F3) to restructure and for the comparison runner (F4) to execute twice.

## Inputs
- SGLang endpoint base URL from F1.
- One concrete, quick task definition (fixed inputs, fixed generation settings) that the planner decomposes and workers complete — chosen to be checkable for correctness in under a few seconds of generation time.
- A shared template: system prompt, tool schema, role instructions (static/shared across agents) plus per-agent/per-task content (dynamic).

## Outputs
- An Express module that, given "raw order" or "normalized order" mode, constructs and sends the planner prompt, then the 2–3 worker prompts, to SGLang, and returns each agent's response plus per-request timing metadata (start time, first-token time, end time, token counts) for F5 to consume.
- The task's final combined result, for the correctness check required by F4.

## Minimum implementation needed for the demo
One planner call that produces a short plan, and 2–3 worker calls that each complete one step of that plan using the same shared system prompt / tool schema / role instructions. No branching logic, no retries beyond what F1 already provides, no dynamic agent count.

## Implementation steps
1. Pick one concrete, quick task (e.g., a short multi-step text/data task) whose correctness can be checked with a simple assertion (contains expected substrings/values).
2. Write the shared template pieces (system prompt, tool schema description, role instructions) once; these are the candidate "static" sections F3 will move.
3. Write the per-agent dynamic pieces (planner's task framing, each worker's assigned sub-task and prior-step output it depends on).
4. Implement a `runWorkload(promptOrder)` function: builds the planner prompt in the given order, calls SGLang, feeds the plan into worker prompt construction (same order mode), calls SGLang for each worker sequentially, and returns all responses + timing.
5. Ensure the dynamic worker content that depends on the planner's output (causal history) is correctly threaded through regardless of prompt order — order changes formatting/position only, never the causal dependency.
6. Add a single correctness assertion on the combined output usable by both raw and normalized runs.

## Acceptance check
- `runWorkload('raw')` and `runWorkload('normalized')` both complete against SGLang and pass the correctness assertion.
- Worker prompts correctly incorporate the planner's actual output (not a stub) in both modes.
- Total wall time for one full workload run (planner + all workers) is quick enough that two back-to-back runs fit inside the 90-second demo budget.

## Skip this
Any branching planner logic, dynamic worker count, or task complexity beyond what's needed to demonstrate a shared-context, cache-relevant prompt structure.

## Fallback if Day 0 verification fails
None specific to this feature — F2 only depends on F1's generation endpoint working (confirmed capability), not on any of the three unverified capabilities.
