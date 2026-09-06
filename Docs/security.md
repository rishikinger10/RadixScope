# RadixScope — Prompt Safety, Privacy and Ordering Invariants

**Scope:** Enforcement reference for the local 48-hour MVP. This is not a threat model or production security program.

## Locked invariants and enforcement points

| ID | Invariant | Primary enforcement | Failure behavior |
|---|---|---|---|
| PS-1 | RAW prompt text is forwarded byte-for-byte unchanged. | Prompt assembler RAW branch; byte equality test before generation. | Refuse the request; never label it RAW. |
| PS-2 | Normalization is off by default and requires explicit `enabled=true` with the accepted policy version. | Express request schema and benchmark preflight. | `NOT_REQUESTED` or visible `SKIPPED`; original prompt returned. |
| PS-3 | Normalization is deterministic and never silent. | Pure normalizer; repeated-evaluation equality; result status and fingerprints. | `SKIPPED`; no benchmark comparison. |
| PS-4 | Only developer-classified eligible `SHARED_STATIC`, `AGENT_RULES` and `DYNAMIC_METADATA` components may move. Classification is never inferred. | Component schema validator and whitelist gate. | `SKIPPED / INVALID_CLASSIFICATION`. |
| PS-5 | `SYSTEM` is unchanged at position 0 and nothing is placed above it. | Assembler plus system-precedence gate before rendering. | `SKIPPED / SYSTEM_PRECEDENCE_UNPROVEN`. |
| PS-6 | Untrusted task, retrieved or tool-result content never moves above trusted instructions. | Trust labels plus before/after order check. | `SKIPPED / UNTRUSTED_BOUNDARY_UNPROVEN`. |
| PS-7 | Conversation turn order is immutable. | Ordered conversation fingerprint and index comparison. | `SKIPPED / CONVERSATION_ORDER_UNPROVEN`. |
| PS-8 | Tool calls/results retain identity, adjacency and relative order. | Tool-pairing fingerprint and causal-group validation. | `SKIPPED / TOOL_PAIRING_UNPROVEN`. |
| PS-9 | Planner → worker1 → worker2 execution and all request dependencies remain sequential. | Frozen workload sequence and awaited benchmark-runner loop. | Terminal invalid run; no comparison. |
| PS-10 | Component wording and meaningful information are not rewritten, summarized or deleted. | Body fingerprints, component-multiset equality and forbidden-operation table. | `SKIPPED / POSTCONDITION_FAILED`; original returned. |
| PS-11 | Strict-JSON key/format stabilization occurs only when explicitly declared safe; arrays and values remain unchanged. | Strict parser, duplicate-key rejection, deep equality and reversal test. | `SKIPPED / JSON_SEMANTICS_UNPROVEN`. |
| PS-12 | Every applied transformation is exactly reversible to the original rendered bytes. | Ephemeral reversal manifest and byte-equality assertion. | `SKIPPED / REVERSAL_FAILED`. |
| PS-13 | The same fixed task meaning, component set and correctness fixture apply to RAW and NORMALIZED. | Task/component fingerprints and comparison validity gate. | `INVALID / CONTENT_MISMATCH` or `TASK_DIVERGENCE`. |
| PS-14 | Every agent output passes the fixed deterministic workload assertion in both modes. Performance cannot override correctness. | Workload-owned pure predicate after each generation; final validity gate. | `INVALID / TASK_DIVERGENCE`; improvement fields suppressed. |
| PP-1 | Prompts, completions and transformation work remain local to Express, local SGLang and local Redis. | Fixed endpoint allowlist and deployment configuration. | Refuse startup/request on unexpected destination. |
| PP-2 | Normalization stores only minimal audit metadata: opaque IDs, keyed fingerprints, counts, policy/status codes and move indices. | Normalizer output schema and Redis adapter allowlist. | Reject the write; invalidate if required run state cannot persist. |
| PP-3 | Default logs redact prompt/component/completion bodies. | Structured logger field allowlist. | Drop/redact forbidden fields before emission. |
| PP-4 | Any explicitly enabled prompt/completion retention has the accepted 24-hour TTL and manual purge path. | Redis adapter on write and the existing manual purge path. | Reject storage without TTL. |
| PP-5 | Raw prompt bodies, token arrays, JSON values, reversal patches and HMAC keys are not retained by normalization. | Type/schema separation and Redis write allowlist. | Reject the write. |
| SS-1 | Run records are isolated under `run:{runId}:*`; cross-run/session joins are not automatic. | Redis key builder and API lookup by opaque `runId`. | Reject malformed/cross-run access. |
| SS-2 | Only the single-flight lock and bounded run index are global. This is minimal local session separation, not multi-tenancy. | Benchmark runner and Redis adapter. | Refuse concurrent benchmark start. |
| OP-1 | React polls Express and never calls SGLang or receives ephemeral reversal data. | Frontend API client allowlist and Express response projection. | Build/test failure for a direct SGLang or forbidden-field dependency. |

## Required enforcement sequence

```text
request schema
  -> RAW exact-byte assembly
  -> normalization opt-in/classification/safety/reversal gates
  -> sequential planner/worker1/worker2 generation
  -> deterministic workload correctness checks
  -> final validity gate
  -> run-scoped persistence
  -> Express projection
  -> React HTTP polling display
```

Any uncertainty in normalization safety or task equivalence preserves the original prompt and returns `SKIPPED`. Any benchmark validity or correctness failure suppresses comparison, speedup, improvement and winner claims.

## Explicit scope limit

This document adds no authentication system, authorization model, TLS design, rate limiter, audit platform, secret-management program, threat model, production multi-tenancy, external security service or generic policy engine.
