# RadixScope — Prefix Analysis Engine

**Artifact:** Prompts 07, 08, 09 and 10 output

**Status:** Prefix Analysis, Cache Measurement, Divergence Diagnostics and Normalization designs complete; runtime evidence pending on the target laptop

**Scope:** Deterministic complete-prompt analysis, request-level cache measurement, explainable divergence diagnostics and safe opt-in normalization

**Pinned integration:** SGLang `v0.5.18`

**Primary model:** `Qwen/Qwen2.5-1.5B-Instruct` BF16; `Qwen/Qwen2.5-0.5B-Instruct` only after the accepted fallback trigger

**Companions:** `README.md`, `system-architecture.md`, `technical-design.md`, `sglang-integration.md`

---

## 1. Purpose and boundary

The prefix analysis engine is a small, pure analysis module inside the single Express application. It compares the ordered token-ID arrays of **complete rendered prompts** and produces:

- total token counts;
- pairwise longest-common-prefix (LCP) lengths;
- first divergent token indices;
- the best earlier-prompt candidate within the same post-flush run;
- raw-versus-normalized structural deltas; and
- privacy-safe fingerprints and bounded, explicitly inferential diagnostics.

It does **not** inspect or model SGLang's radix tree, KV blocks, cache nodes, eviction structure, page allocation or scheduler internals. It does not optimize, rewrite, route or schedule prompts. It does not map token indices to named prompt sections.

The engine answers only this question:

> Given the exact token sequences for two complete rendered prompts, how many leading tokens are identical, and where do the sequences first differ?

That answer is `RADIXSCOPE_DERIVED`. It is useful for explaining prefix shape, but it is not interchangeable with SGLang-native `meta_info.cached_tokens`.

### 1.1 Locked invariants

1. The analyzed string is byte-for-byte the same `text` sent to `POST /generate`.
2. Logical components are assembled first; the engine tokenizes the resulting complete prompt once. It never tokenizes sections independently or sums section lengths.
3. Comparisons that represent possible cache predecessors use only prompts issued earlier in the same mode, after that mode's successful flush.
4. Raw and normalized modes are separate cache epochs because a verified flush occurs between them.
5. Raw-versus-normalized comparisons are structural diagnostics only. A normalized prompt is never described as having reused a raw prompt across the flush.
6. All calculations are deterministic, pure and linear in the compared token lengths.
7. Token arrays and raw prompt text are ephemeral by default. Redis receives compact results, counts and keyed fingerprints, not retained token arrays or raw prompt bodies.
8. Missing SGLang cache metadata does not stop prefix analysis. It removes the native-cache claim and leaves a clearly labelled derived diagnostic mode.

---

## 2. Epistemic and provenance contract

The following terms are normative in this document.

| Class | Meaning |
|---|---|
| **OBSERVED** | Supplied by an accepted input boundary without interpretation. Its schema and source are recorded. |
| **CALCULATED** | Produced deterministically by RadixScope from observed inputs. |
| **UNKNOWN** | Not available from accepted inputs and not inferred as fact. |

OBSERVED/CALCULATED/UNKNOWN describes what the engine can know. The system-wide provenance tags describe where a retained value came from.

| Value | Epistemic class | Provenance | Rule |
|---|---|---|---|
| Final rendered prompt text | OBSERVED by this engine | Application input; not retained by default | Must be the exact `/generate.text` value. |
| Token IDs returned by SGLang `/tokenize` | OBSERVED | `SGLANG_NATIVE` | Preferred token source under the pinned contract. |
| `tokens.length`, `/tokenize.count`, `/tokenize.max_model_len` | OBSERVED | `SGLANG_NATIVE` | Validate before analysis. |
| Token IDs from the same-checkpoint local fallback tokenizer | OBSERVED from the fallback boundary | `RADIXSCOPE_MEASURED` | Allowed only when `/tokenize` is unavailable or incompatible; fallback is recorded. |
| `meta_info.prompt_tokens`, `cached_tokens`, `num_retractions` | OBSERVED | `SGLANG_NATIVE` | Parsed by `sglangClient`, not by this engine. |
| LCP length and first divergence index | CALCULATED | `RADIXSCOPE_DERIVED` | Pure arithmetic over complete token arrays. |
| Best earlier-prompt candidate | CALCULATED | `RADIXSCOPE_DERIVED` | Maximum LCP; deterministic tie-break. |
| Reuse ratio and native-versus-LCP delta | CALCULATED | `RADIXSCOPE_DERIVED` | Derived even when every input is native. |
| Prompt/prefix fingerprint | CALCULATED | `RADIXSCOPE_DERIVED` | Keyed HMAC over canonical token bytes and tokenizer identity. |
| Why SGLang matched or did not match a prefix | UNKNOWN | — | Cache internals are not visible. |
| Which radix-tree node held a prefix | UNKNOWN | — | Never guessed or rendered. |
| Which named prompt section contains a divergent token | UNKNOWN by policy | — | Section-boundary mapping is cut. |
| Whether two different outputs are semantically equivalent | UNKNOWN here | — | Requires the separate task-correctness policy. |

### 2.1 Non-equivalence of LCP and `cached_tokens`

For a current prompt `C` and an earlier prompt `P`:

```text
lcp(C, P) = count of identical leading token IDs
```

This is a property of two arrays. SGLang's `cached_tokens` is an observation produced by SGLang for one generation request. The values can differ because of page granularity, cache residency, eviction, retraction, or other SGLang runtime behavior already identified in `sglang-integration.md`.

Therefore:

- LCP is never named `cacheHitTokens`, `cachedTokens`, `radixMatch`, or similar.
- `cached_tokens` is never recomputed or filled from LCP.
- A positive LCP does not prove that SGLang served those tokens from cache.
- A smaller `cached_tokens` value does not prove that the LCP calculation is wrong.
- `num_retractions > 0` is displayed beside native cache data because the accepted integration contract says retraction may make `cached_tokens` understate reuse.
- A native-versus-derived delta is descriptive evidence, not an error verdict.

---

## 3. Inputs and outputs

Names are design contracts and may be mechanically aligned by the later canonical data-contract prompt. Their meaning must not change.

```ts
type RunMode = "RAW" | "NORMALIZED";
type AgentId = "planner" | "worker1" | "worker2";
type TokenId = number;

interface TokenizerIdentity {
  sglangVersion: "v0.5.18";
  modelPath: string;
  tokenizerPath: string;
  weightVersion: string | null;
  tokenizerSource: "SGLANG_TOKENIZE" | "LOCAL_SAME_CHECKPOINT";
  chatTemplateId: string;
  chatTemplateHash: string;
}

interface CompleteRenderedPrompt {
  runId: string;
  mode: RunMode;
  requestIndex: 0 | 1 | 2;
  agentId: AgentId;
  text: string;
  utf8ByteLength: number;
  template: {
    id: string;
    hash: string;
  };
}

interface TokenizedPrompt {
  runId: string;
  mode: RunMode;
  requestIndex: 0 | 1 | 2;
  agentId: AgentId;
  tokenIds: Uint32Array;
  tokenCount: number;
  tokenizer: TokenizerIdentity;
  promptFingerprint: string;
}

interface PairPrefixAnalysis {
  currentRequestIndex: number;
  priorRequestIndex: number;
  lcpTokens: number;
  firstDivergenceIndex: number | null;
  relation: "IDENTICAL" | "STRICT_PREFIX" | "DIVERGED";
  sharedPrefixFingerprint: string | null;
  provenance: "RADIXSCOPE_DERIVED";
}

interface RequestPrefixAnalysis {
  requestIndex: number;
  tokenCount: number;
  candidates: PairPrefixAnalysis[];
  bestPrior: PairPrefixAnalysis | null;
  nativeCache: {
    status: "AVAILABLE" | "UNAVAILABLE";
    cachedTokens?: number;
    numRetractions?: number;
  };
  nativeVsBestLcpDelta: number | null;
  diagnostics: PrefixDiagnostic[];
}

interface ModePrefixAnalysis {
  mode: RunMode;
  requests: RequestPrefixAnalysis[];
  tokenizationStatus: "VERIFIED" | "LOCAL_FALLBACK";
}

interface StructuralModePair {
  requestIndex: number;
  rawTokenCount: number;
  normalizedTokenCount: number;
  rawVsNormalizedLcpTokens: number;
  firstDivergenceIndex: number | null;
  purpose: "STRUCTURE_DELTA";
  provenance: "RADIXSCOPE_DERIVED";
}
```

`tokenIds` is present only during analysis. The persisted projection replaces it with counts and fingerprints.

---

## 4. Obtaining the exact tokenizer

### 4.1 Preferred path: the running SGLang tokenizer

The preferred tokenizer boundary is the verified SGLang `v0.5.18` `POST /tokenize` endpoint described in `sglang-integration.md` C-6 and Part B. For each complete rendered prompt, the SGLang client sends:

```json
{
  "model": "<modelPath reported by /get_model_info>",
  "prompt": "<the exact complete rendered prompt>",
  "add_special_tokens": false
}
```

The client accepts only a response containing a one-dimensional integer `tokens` array, numeric `count`, and the expected model-limit field when supplied by the pinned endpoint. It validates:

```text
count === tokens.length
every token is an integer in [0, 2^32 - 1]
tokens.length <= resolved contextLength
```

The request uses the model identity reported by the running server, not a separately typed model name. This keeps the conditional 0.5B fallback visible and prevents analysis with the 1.5B tokenizer identity when the fallback server is actually running.

The tokenization calls occur outside protected cold-start windows. Because worker prompts depend on earlier completions, they cannot all be constructed during PREFLIGHT. The runner therefore keeps at most the three rendered strings for the current mode in process memory, finishes that mode's three generation requests, tokenizes those exact strings, derives compact results, and releases the strings and token arrays. For RAW this analysis completes before `FLUSH_NORM`; for NORMALIZED it completes after `RUN_NORM`. No tokenization call occurs between a successful flush and that mode's first measured `/generate`.

### 4.2 Local fallback

If `/tokenize` is absent or its schema is incompatible, the only fallback is a local tokenizer loaded from the exact `tokenizerPath` and pinned checkpoint revision reported by the running server. It must use the same tokenizer configuration, including special-token settings. No approximate tokenizer, alternate Qwen checkpoint or generic byte-pair encoder is permitted.

Fallback consequences:

- `tokenizerSource = "LOCAL_SAME_CHECKPOINT"`;
- fallback token IDs are `RADIXSCOPE_MEASURED`, not `SGLANG_NATIVE`;
- all LCP results remain `RADIXSCOPE_DERIVED`;
- the dashboard discloses that server tokenization was unavailable;
- the prompt-token-count consistency check in §5.3 becomes mandatory before derived results are displayed.

If the same-checkpoint local tokenizer cannot be loaded or does not pass the consistency checks, prefix analysis is unavailable. RadixScope does not substitute character, word or byte counts.

### 4.3 Version dependence

The endpoint name, request fields and response fields above are accepted only for SGLang `v0.5.18`, as verified in `sglang-integration.md`. Any SGLang version change invalidates this adapter and requires re-verification before analysis runs. The pure algorithms in §§7–9 are version-independent.

---

## 5. Complete-prompt and chat-template consistency

### 5.1 Single canonical rendering

Prompt assembly and any chat-template rendering happen before this engine. The prefix engine never renders messages and never applies a second template. It receives one `CompleteRenderedPrompt.text`, and that same string is used for both:

```text
GenerateRequest.text === TokenizeRequest.prompt
```

Equality means identical JavaScript string content and identical UTF-8 bytes. Newline normalization, trimming, Unicode normalization and implicit separator insertion are forbidden after this boundary.

Because RadixScope uses SGLang's native `/generate` text path, the final text is already rendered when it crosses the SGLang boundary. No OpenAI-compatible chat-completions endpoint may apply another hidden template.

### 5.2 Template identity

The prompt assembler supplies a stable `chatTemplateId` and a SHA-256 hash of the exact template source or deterministic renderer definition used to create the final text. The engine checks that every request in both modes has the same template identity. This does not reveal the template body and does not claim that SGLang exposes its internal template state.

The check is:

```ts
function assertTemplateIdentity(
  prompts: readonly CompleteRenderedPrompt[],
  expected: Pick<TokenizerIdentity, "chatTemplateId" | "chatTemplateHash">
): AnalysisResult<void>;
```

Different IDs or hashes produce `TEMPLATE_MISMATCH`; no derived cross-request or cross-mode analysis is published.

### 5.3 Runtime token-count consistency

After the corresponding generation result exists, the engine compares:

```text
tokenizedPrompt.tokenCount === meta_info.prompt_tokens
```

This is an empirical consistency gate, not an assumption about implementation internals. It catches a different tokenizer, special-token setting, hidden chat-template application, altered request text, or version-dependent endpoint behavior.

On mismatch:

- preserve the observed values as evidence;
- return `TOKENIZATION_MISMATCH` for that request;
- suppress LCP, divergence and fingerprint results involving that request;
- do not relabel either count or invent an offset; and
- leave the native `cached_tokens` record untouched.

Whether a tokenization mismatch invalidates the whole benchmark is owned by the later validity/data contracts. This engine's output is unambiguous: derived prefix analysis is unavailable for the affected request.

### 5.4 No section arithmetic

Only this operation is allowed:

```text
tokenize(completeRenderedPrompt)
```

These are forbidden:

```text
tokenize(system) + tokenize(shared) + tokenize(task)
tokenize(each component) then concatenate token IDs
infer component boundaries from token counts
map firstDivergenceIndex to a component name
```

Tokenization is context-sensitive at text boundaries. Even if independently tokenized arrays appear to concatenate correctly in one example, the engine never relies on that property.

---

## 6. Comparison set and ordering

### 6.1 Cache-relevance candidates

For a current request at index `i`, the candidate set is:

```text
all successfully tokenized requests j where
  j < i
  and mode[j] === mode[i]
  and both requests occurred after the same successful flush
```

With the locked three-agent workload:

| Current request | Candidates |
|---|---|
| planner, index 0 | none |
| worker1, index 1 | planner, index 0 |
| worker2, index 2 | planner index 0 and worker1 index 1 |

The engine compares the current prompt with every candidate because either earlier complete prefix may still be relevant. It then selects `bestPrior` by:

1. greatest `lcpTokens`;
2. if tied, greatest `priorRequestIndex` (the most recent earlier request);
3. if still tied, lexical `prior.agentId` as a total-order safeguard.

The candidate list itself is retained in ascending `priorRequestIndex` order. The tie-break affects only `bestPrior`.

The engine never searches older benchmark runs, the opposite mode, Redis history or a prompt library for a better-looking match. This bounds work and prevents a diagnostic comparison from being mistaken for actual cache opportunity.

### 6.2 Raw-versus-normalized structural pairs

After both validly assembled modes finish, request `i` in RAW may be compared with request `i` in NORMALIZED. This produces `StructuralModePair` with `purpose: "STRUCTURE_DELTA"`.

It answers how early the two equivalent workloads' token sequences diverge. It does not represent cache reuse because `FLUSH_NORM` separates the two modes. Structural pairs never participate in `bestPrior` selection.

### 6.3 Causality

The engine receives requests in the already fixed planner → worker1 → worker2 order. It does not reorder them. An input with duplicate, missing or non-monotonic request indices produces `INVALID_SEQUENCE` before comparison.

---

## 7. Pure algorithm contracts

All functions below are synchronous, have no I/O, read no clock or environment variable, and mutate no input.

```ts
type AnalysisErrorCode =
  | "EMPTY_PROMPT"
  | "PROMPT_TOO_LARGE"
  | "INVALID_TOKEN_ID"
  | "TOKEN_COUNT_MISMATCH"
  | "TOKENIZATION_MISMATCH"
  | "TOKENIZER_IDENTITY_MISMATCH"
  | "TEMPLATE_MISMATCH"
  | "INVALID_SEQUENCE"
  | "FINGERPRINT_KEY_INVALID";

type AnalysisResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: AnalysisErrorCode; evidence: Record<string, unknown> } };

function validateTokenIds(
  tokenIds: readonly number[],
  reportedCount: number,
  contextLength: number
): AnalysisResult<Uint32Array>;

function longestCommonPrefix(
  left: Uint32Array,
  right: Uint32Array
): number;

function firstDivergenceIndex(
  left: Uint32Array,
  right: Uint32Array
): number | null;

function comparePromptPair(
  current: TokenizedPrompt,
  prior: TokenizedPrompt,
  fingerprintKey: Uint8Array
): AnalysisResult<PairPrefixAnalysis>;

function analyzeMode(
  prompts: readonly TokenizedPrompt[],
  nativeCacheByRequest: ReadonlyMap<number, NativeCacheObservation | null>,
  fingerprintKey: Uint8Array
): AnalysisResult<ModePrefixAnalysis>;

function compareModesStructurally(
  raw: readonly TokenizedPrompt[],
  normalized: readonly TokenizedPrompt[],
  fingerprintKey: Uint8Array
): AnalysisResult<StructuralModePair[]>;

function selectBestPrior(
  candidates: readonly PairPrefixAnalysis[]
): PairPrefixAnalysis | null;

function diagnosePrefixShape(
  request: RequestPrefixAnalysis,
  coarseMetadata: CoarseConstructionMetadata | null
): readonly PrefixDiagnostic[];
```

### 7.1 LCP

```ts
function longestCommonPrefix(left: Uint32Array, right: Uint32Array): number {
  const limit = Math.min(left.length, right.length);
  let i = 0;
  while (i < limit && left[i] === right[i]) i += 1;
  return i;
}
```

### 7.2 First divergence

Let `lcp = longestCommonPrefix(left, right)`.

```text
if lcp === left.length && lcp === right.length:
    firstDivergenceIndex = null       // sequences are identical
else:
    firstDivergenceIndex = lcp        // token differs here, or one sequence ends here
```

Indices are zero-based. For a strict-prefix relation, the first divergence index is the shorter sequence's length because that is the first position at which one sequence has no token while the other does.

### 7.3 Pair relation

```text
IDENTICAL     left.length === right.length === lcp
STRICT_PREFIX lcp === min(left.length, right.length), lengths differ
DIVERGED      lcp < min(left.length, right.length)
```

The relation is descriptive. `STRICT_PREFIX` does not mean the shorter prompt is cached.

### 7.4 Native-versus-derived delta

When `cached_tokens` and `bestPrior` are both available:

```text
nativeVsBestLcpDelta = cached_tokens - bestPrior.lcpTokens
```

Otherwise the field is `null`, not zero. The sign is preserved. No tolerance is applied inside this engine, and the delta never changes the native value.

---

## 8. Privacy-safe stable fingerprints

### 8.1 Construction

A plain hash of a short or predictable prompt permits offline guessing. RadixScope therefore uses keyed HMAC-SHA-256, with a 32-byte local key generated once for the installation. This is a small local configuration value, not a production secret-management system. The key never enters Redis or the dashboard.

```ts
function fingerprintTokens(
  key: Uint8Array,
  tokenizer: TokenizerIdentity,
  tokenIds: Uint32Array
): AnalysisResult<string>;
```

The canonical HMAC input is:

```text
UTF8("radixscope-prefix-v1\0")
|| uint32be(length(UTF8(tokenizerIdentity)))
|| UTF8(canonicalTokenizerIdentity)
|| uint32be(tokenIds.length)
|| tokenIds encoded one-by-one as uint32be
```

`canonicalTokenizerIdentity` contains, in fixed key order:

```text
sglangVersion | modelPath | tokenizerPath | weightVersion-or-empty |
tokenizerSource | chatTemplateId | chatTemplateHash
```

Output is the complete 32-byte digest encoded as unpadded base64url. It is not truncated.

### 8.2 Fingerprint rules

- The full prompt fingerprint covers the full token array.
- A shared-prefix fingerprint covers exactly `tokenIds.slice(0, lcpTokens)`.
- `lcpTokens === 0` produces `null`, not a fingerprint of an empty sequence.
- The same token sequence and tokenizer identity produce the same fingerprint within an installation while the local key is unchanged.
- Changing model, tokenizer, template, fallback source or key changes the fingerprint namespace.
- Fingerprints establish token-sequence equality only. They do not establish semantic equivalence, cache residence or ownership.
- The persisted record includes a non-secret `fingerprintKeyId` so results made under different local keys are never compared as equal.

### 8.3 Retained state

Redis may retain:

```text
runId, mode, requestIndex, agentId
tokenCount
promptFingerprint
candidate prior index, lcpTokens, firstDivergenceIndex, relation
sharedPrefixFingerprint
bestPrior index
nativeVsBestLcpDelta
diagnostic codes and provenance
tokenizer identity and fingerprintKeyId
```

Redis does not retain by default:

```text
raw prompt text
complete token-ID arrays
decoded divergent tokens
template source text
HMAC key
```

The later canonical data contract may permit raw bodies under the already accepted explicit debug/TTL policy, but the prefix engine neither requires nor requests that storage.

---

## 9. Diagnostics

Diagnostics are bounded explanations of observed structure. Every diagnostic has `provenance: "RADIXSCOPE_DERIVED"` and `certainty: "INFERENCE"`.

```ts
interface PrefixDiagnostic {
  code:
    | "NO_PRIOR_IN_CACHE_EPOCH"
    | "NO_SHARED_PREFIX"
    | "PARTIAL_SHARED_PREFIX"
    | "IDENTICAL_TOKEN_SEQUENCE"
    | "CURRENT_IS_STRICT_EXTENSION"
    | "PRIOR_IS_STRICT_EXTENSION"
    | "NATIVE_METADATA_UNAVAILABLE"
    | "NATIVE_BELOW_LCP"
    | "NATIVE_ABOVE_SELECTED_LCP"
    | "RETRACTION_OBSERVED"
    | "COARSE_CONSTRUCTION_VARIABILITY";
  certainty: "INFERENCE";
  message: string;
  evidence: Record<string, number | string | boolean | null>;
  provenance: "RADIXSCOPE_DERIVED";
}
```

Allowed diagnostic evidence includes request indices, token counts, LCP lengths, native `cached_tokens`, retraction counts and coarse metadata already supplied by the prompt assembler, such as "the ordered component-kind sequence changed." It may cite a developer-supplied component identity only as existing construction metadata.

Forbidden diagnostic behavior:

- deriving a component boundary from token offsets;
- stating that divergence index `n` falls inside a named component;
- decoding or showing the divergent token by default;
- claiming an eviction, cache node, page allocation or scheduler decision occurred;
- asking another LLM, embedding model or vector database to explain the difference.

Example acceptable message:

> The complete prompts share 412 leading tokens and diverge at token index 412. The construction manifest reports a different coarse component order; this is an inference, not a mapping of token 412 to a component.

Example forbidden message:

> Token 412 is inside `DYNAMIC_METADATA`, so that section caused SGLang's radix-cache miss.

---

## 10. Error and degraded-mode behavior

| Condition | Engine result | Native benchmark effect |
|---|---|---|
| Empty rendered prompt | `EMPTY_PROMPT`; no analysis | Generation contract decides whether request exists. |
| UTF-8 byte cap exceeded | `PROMPT_TOO_LARGE`; no analysis | No truncation. |
| Non-integer, negative or >32-bit token ID | `INVALID_TOKEN_ID`; no analysis | Native fields remain unchanged. |
| `/tokenize.count !== tokens.length` | `TOKEN_COUNT_MISMATCH`; no analysis | Record both observed values. |
| Token count exceeds resolved context length | `PROMPT_TOO_LARGE`; no analysis | No clipping or partial comparison. |
| Tokenizer/model/template identity differs within benchmark | identity-specific error; suppress affected comparisons | Never compare across token namespaces. |
| Derived token count differs from `meta_info.prompt_tokens` | `TOKENIZATION_MISMATCH`; suppress affected analysis | Preserve native telemetry. No guessed offset. |
| SGLang `/tokenize` unavailable, local exact tokenizer passes checks | `LOCAL_FALLBACK`; continue | Disclose fallback provenance. |
| Both tokenizer paths unavailable or inconsistent | Prefix analysis unavailable | Do not use characters/words as a proxy. |
| `cached_tokens` absent or unusable | `NATIVE_METADATA_UNAVAILABLE`; derived analysis continues | Product states it cannot prove native cache reuse. |
| No prior prompt in current cache epoch | valid result with `bestPrior = null` | Expected for planner/index 0. |
| HMAC key absent or wrong length | `FINGERPRINT_KEY_INVALID`; do not persist fingerprints | LCP can remain in memory; persistence waits for a valid key. |

Degraded diagnostic mode is successful when exact tokenization remains available but native cache metadata does not. It returns token counts, LCPs, divergence indices, structural pairs and fingerprints, all accurately labelled. It must not expose an improvement percentage based on cache reuse.

---

## 11. Complexity and resource bounds

Let `L` be the smaller length of two compared token arrays and `K` the number of prompts in one mode.

| Operation | Time | Additional space |
|---|---:|---:|
| Validate one token array | `O(n)` | `O(n)` for normalized `Uint32Array` |
| Pair LCP/divergence | `O(L)` | `O(1)` excluding optional prefix bytes fed incrementally to HMAC |
| Analyze one mode | `O(K² × L)` worst case | `O(K × contextLength)` ephemeral |
| Raw↔normalized structural pairs | `O(K × L)` | `O(1)` per pair |
| Fingerprint one sequence | `O(n)` | `O(1)` streaming HMAC state |

`K` is locked to `3`, so the engine performs at most three within-mode pairs per mode and three raw-versus-normalized pairs: nine pair comparisons total.

With six maximum-length arrays at 8,192 tokens stored as `Uint32Array`, token storage is:

```text
6 × 8,192 × 4 bytes = 196,608 bytes = 192 KiB
```

The implementation additionally enforces:

- `maxPromptsPerMode = 3`;
- `maxTokensPerPrompt = resolved contextLength` (8,192 in the locked launch);
- `maxRenderedPromptBytes = 256 KiB` as an analysis input guard;
- no quadratic matrix allocation;
- streaming HMAC updates rather than constructing a second full byte buffer; and
- release of prompt strings and token arrays immediately after compact results are built.

No GPU work is performed by this module. Its CPU and memory cost is negligible relative to one generation request.

---

## 12. Test vectors

The pure functions use synthetic token IDs; they do not require SGLang.

### 12.1 Pairwise vectors

| ID | Left | Right | LCP | First divergence | Relation |
|---|---|---|---:|---:|---|
| T-1 | `[1,2,3]` | `[1,2,3]` | 3 | `null` | `IDENTICAL` |
| T-2 | `[1,2,3]` | `[9,2,3]` | 0 | 0 | `DIVERGED` |
| T-3 | `[10,20,30,40]` | `[10,20,99,40]` | 2 | 2 | `DIVERGED` |
| T-4 | `[1,2]` | `[1,2,3]` | 2 | 2 | `STRICT_PREFIX` |
| T-5 | `[1,2,3]` | `[1,2]` | 2 | 2 | `STRICT_PREFIX` |
| T-6 | `[]` | `[1]` | 0 | 0 | `STRICT_PREFIX` at primitive level; complete-prompt validation rejects the empty prompt |
| T-7 | `[]` | `[]` | 0 | `null` | `IDENTICAL` at primitive level; complete-prompt validation rejects both |

### 12.2 Candidate selection

```text
planner tokens = [1,2,3,4,5]
worker1 tokens = [1,2,9,9]
worker2 tokens = [1,2,3,8]

worker1 candidates:
  planner -> LCP 2
  bestPrior = planner

worker2 candidates:
  planner -> LCP 3
  worker1 -> LCP 2
  bestPrior = planner
```

Tie-break vector:

```text
planner tokens = [7,8,1]
worker1 tokens = [7,8,2]
worker2 tokens = [7,8,3]

both candidates have LCP 2
bestPrior = worker1 because request index 1 is more recent than 0
```

### 12.3 Namespace protection

- Same token IDs, different `tokenizerPath` → `TOKENIZER_IDENTITY_MISMATCH`.
- Same token IDs, different `chatTemplateHash` → `TEMPLATE_MISMATCH`.
- Same token IDs and identity, same HMAC key → identical fingerprint.
- Same token IDs and identity, different HMAC key → different fingerprint and different `fingerprintKeyId`.

### 12.4 Native metadata vectors

| Native input | Derived input | Expected result |
|---|---|---|
| `cached_tokens=120`, best LCP `128` | both available | delta `-8`; diagnostic may say native is below selected LCP, as inference |
| `cached_tokens=144`, best LCP `128` | both available | delta `16`; report both without claiming cause |
| `cached_tokens` absent, best LCP `128` | derived available | delta `null`; `NATIVE_METADATA_UNAVAILABLE`; derived analysis retained |
| `num_retractions=1` | any | add `RETRACTION_OBSERVED`; do not change LCP or native value |

---

## 13. Acceptance examples

### A-PE-1 — Complete-prompt tokenization

Given a rendered prompt containing system instructions, shared static text, agent rules, dynamic metadata and task text, the engine makes exactly one tokenization call for the entire final string. No component token counts are added together.

### A-PE-2 — Correct predecessor scope

For worker2 in RAW, candidates are RAW planner and RAW worker1 from the same post-flush epoch. NORMALIZED requests and earlier benchmark runs are excluded. The inverse holds for worker2 in NORMALIZED.

### A-PE-3 — First request

Planner/index 0 returns a valid analysis with `candidates=[]`, `bestPrior=null`, and `NO_PRIOR_IN_CACHE_EPOCH`. Zero is not fabricated as a cache-reuse observation.

### A-PE-4 — Structural comparison remains separate

RAW worker1 and NORMALIZED worker1 may produce a structural LCP and divergence index, but the result is marked `purpose=STRUCTURE_DELTA` and never enters a native-cache comparison.

### A-PE-5 — Tokenization consistency failure

If `/tokenize` returns 300 IDs but `/generate.meta_info.prompt_tokens` reports 301, the engine records both numbers, returns `TOKENIZATION_MISMATCH`, and emits no LCP or fingerprint involving that request. It does not subtract one or assume a BOS token.

### A-PE-6 — Missing SGLang cache metadata

If exact token arrays are available but `meta_info.cached_tokens` is persistently missing, the engine still emits token counts, LCPs, divergence indices and fingerprints as `RADIXSCOPE_DERIVED`. The cache-reuse field is unavailable, the native-versus-LCP delta is `null`, and the product cannot claim native cache reuse.

### A-PE-7 — Privacy

After analysis, Redis contains compact counts, indices, diagnostics and HMAC fingerprints. It does not contain prompt text, token arrays, decoded divergence text or the fingerprint key.

### A-PE-8 — Bounded execution

Six maximum-length 8,192-token prompts complete all nine possible comparisons without allocating a pairwise matrix, invoking an LLM, using a GPU, or exceeding the declared bounds.

### A-PE-9 — No section mapping

Given `firstDivergenceIndex=412` and a component manifest, the engine may report that the manifest's coarse component ordering differs. It must not state which component contains token 412 or produce component token boundaries.

---

## 14. Integration with the accepted architecture

The engine implements M9/C7 inside `server/src/analysis/`. It is called by `benchmarkRunner` after exact token arrays are available and before a valid comparison document is persisted.

```text
promptAssembler -> exact complete text -> sglangClient.generate
                     |                         |
                     | retained in memory     | native meta_info
                     v                         v
               sglangClient.tokenize     cache observation
                     |                         |
                     +----------+--------------+
                                v
                         prefix analysis
                                |
                         compact derived result
                                v
                         store -> polling API
```

The arrow from `sglangClient.tokenize` is an input boundary, not a new service. The frontend receives already computed results through ordinary HTTP polling and performs no analysis.

No new process, endpoint, database, queue, gateway, router, scheduler, model, embedding system or visualization is introduced.

---

## 15. Implementation checklist

- [ ] Analyze the exact UTF-8 bytes sent as `/generate.text`.
- [ ] Tokenize each complete rendered prompt exactly once.
- [ ] Keep `/tokenize` outside both protected cold-start windows.
- [ ] Validate token integers, count, context bound, tokenizer identity and template identity.
- [ ] Compare derived token count against native `meta_info.prompt_tokens` without guessing an offset.
- [ ] Compute LCP and divergence with the pure linear functions.
- [ ] Restrict cache candidates to earlier requests in the same post-flush mode.
- [ ] Keep raw-versus-normalized structural pairs out of cache-candidate selection.
- [ ] Use keyed full-length HMAC-SHA-256 fingerprints with canonical token encoding.
- [ ] Persist compact results; release prompt strings and token arrays.
- [ ] Continue in clearly labelled derived-only mode when native cache metadata is unavailable.
- [ ] Never label LCP as cache hits, cached tokens, radix matches or cache state.
- [ ] Never map a token index to a prompt section.
- [ ] Never invoke embeddings, another LLM, a vector database or an analysis service.

---

## 16. Open runtime evidence

These items remain `RUNTIME_PENDING` and are resolved by the accepted Day-0 verification rather than by changing this design:

| ID | Evidence required | Effect |
|---|---|---|
| PE-R1 | Actual `/tokenize` response keys and token array for a complete rendered Qwen prompt | Confirms the preferred adapter. |
| PE-R2 | Equality of `/tokenize.count`, `tokens.length` and `/generate.meta_info.prompt_tokens` for the same exact text | Gates derived analysis. |
| PE-R3 | Running model and tokenizer paths from server inspection | Fixes the tokenizer namespace and fallback identity. |
| PE-R4 | Cold, repeated and partial-prefix `cached_tokens` observations | Determines whether native cache claims remain available; does not alter LCP. |
| PE-R5 | Effective page size and any native-versus-LCP granularity | Interpreted by benchmark validity/cache-measurement work, not by this engine. |

If PE-R2 fails, the result is evidence of a boundary mismatch. The permitted response is to correct the adapter or disable derived analysis—not to tune the algorithm until two unlike tokenizations happen to agree.

---

# Part B — Cache Measurement

## 17. Measurement purpose and authority

The Cache Measurement section defines how RadixScope captures, validates, aggregates, persists and presents cache and timing observations for the controlled RAW-versus-NORMALIZED benchmark.

The only primary request-level cache signal is:

```text
/generate.meta_info.cached_tokens
```

For SGLang `v0.5.18`, the accepted integration contract defines this narrowly as the number of prompt tokens SGLang reports as reused from its radix cache for that request. It is `SGLANG_NATIVE`, version-dependent, subject to the effective page size and the retraction limitation described in `sglang-integration.md` C-2/C-3, and still requires Day-0 runtime verification.

RadixScope does not infer cache nodes, cache events, radix-tree shape, page ownership, eviction events or scheduler decisions from this field. The locally calculated LCP from Part A remains a separate `RADIXSCOPE_DERIVED` diagnostic.

### 17.1 Measurement invariants

1. RAW and NORMALIZED use the same model, task, component content, agent sequence, sampling configuration, SGLang worker and measurement code. Prompt structure is the only permitted difference.
2. The immutable generation settings are `temperature=0`, `n=1`, `max_new_tokens=256`, `concurrency=1`, with speculative decoding and MTP disabled.
3. A verified `POST /flush_cache?timeout=30` immediately precedes each mode.
4. No SGLang request occurs between a successful flush and that mode's first measured `/generate`.
5. The first request's `cached_tokens` must be within the runtime-resolved cold tolerance.
6. Every `/generate` is executed once. No generation or flush is retried.
7. Every request record keeps native, measured and derived values in separate objects.
8. A comparison is computed only when both modes are valid, comparable and native cache measurement is available.
9. Invalidity and unavailability are stored and displayed; neither is converted to zero.

---

## 18. Measurement states

Cache measurement has two axes: execution validity and native-signal availability.

```ts
type ExecutionValidity =
  | { status: "VALID" }
  | {
      status: "INVALID";
      reason: BenchmarkInvalidReason;
      evidence: readonly MeasurementEvidence[];
    };

type NativeCacheCapability =
  | { status: "AVAILABLE"; verifiedAt: string; sglangVersion: "v0.5.18" }
  | { status: "UNAVAILABLE"; reason: string; verificationEvidence: readonly MeasurementEvidence[] };

type CacheComparisonState =
  | { status: "AVAILABLE"; comparison: CacheComparison }
  | { status: "INVALID"; reason: BenchmarkInvalidReason; evidence: readonly MeasurementEvidence[] }
  | { status: "UNAVAILABLE"; reason: string; diagnosticOnly: true };
```

### 18.1 `VALID`

Both modes completed with successful flushes, cold first requests, well-formed and plausible metadata, matching request IDs, identical locked settings, identical model/server fingerprint and identical component content. Native cache aggregates may be compared.

### 18.2 `INVALID`

This benchmark execution violated a mandatory precondition. `INVALID` is terminal and absorbing. Evidence and request records remain visible, but native cache comparison, percentage improvement and timing speedup claims are absent.

### 18.3 `UNAVAILABLE`

Day-0 verification established that `cached_tokens` is persistently absent, incompatible or does not behave as the verified request-level prefix-reuse signal. The failing verification run itself is `INVALID`. Subsequent explicitly diagnostic runs may use `NativeCacheCapability.status = "UNAVAILABLE"`.

In diagnostic-only mode RadixScope may retain:

- request timings;
- completion and prompt counts that remain well formed;
- exact-tokenizer LCP and first-divergence results from Part A; and
- derived structural diagnostics.

It must not create native cache totals, reuse ratios, native-cache differences or percentage improvement. The UI states that native request-level cache comparison is unavailable and that the benchmark cannot prove native cache reuse.

---

## 19. Capture sequence

The benchmark runner remains the sole sequencer.

```text
PREFLIGHT
  capture server/model fingerprint
  resolve effective page size and cold tolerance
  assert locked settings and native-cache capability state

FLUSH_RAW
  POST /flush_cache?timeout=30 once
  record status, body and measured timestamps
  require HTTP 200

PROTECTED WINDOW RAW
  no SGLang request
  issue RAW planner request immediately
  parse and correlate terminal meta_info
  assert first cached_tokens <= cold tolerance

RUN_RAW
  issue worker1, then worker2, sequentially
  capture one immutable record per request
  aggregate only after all three records validate

FLUSH_NORM
  POST /flush_cache?timeout=30 once
  record and require HTTP 200

PROTECTED WINDOW NORMALIZED
  no SGLang request
  issue NORMALIZED planner request immediately
  parse, correlate and assert coldness

RUN_NORM
  issue worker1, then worker2, sequentially
  capture and validate

COMPARE
  re-check comparability gates
  compute cache comparison only if both modes are VALID
  persist terminal state
```

The raw and normalized prefix-analysis tokenization described in Part A occurs only outside the two protected windows. It does not alter the cache-measurement sequence above.

### 19.1 Flush evidence

```ts
interface FlushEvidence {
  mode: RunMode;
  endpoint: "/flush_cache?timeout=30";
  httpStatus: number;             // SGLANG_NATIVE
  responseBody: string;           // SGLANG_NATIVE; bounded and stored as evidence
  requestedAtMonotonicMs: number; // RADIXSCOPE_MEASURED; in-memory only
  completedAtMonotonicMs: number; // RADIXSCOPE_MEASURED; in-memory only
  durationMs: number;             // RADIXSCOPE_DERIVED
  succeeded: boolean;             // RADIXSCOPE_DERIVED from status === 200
}
```

The HTTP status is authoritative. Only `200` opens the protected window. The body is retained for bounded evidence and is never pattern-matched to override the status. A non-200 yields terminal `INVALID / FLUSH_FAILED`; the mode issues no measured generation.

---

## 20. Per-request capture contract

### 20.1 Correlation identity

Each request receives one RadixScope-generated `rid` before dispatch:

```text
rs-{runId}-{raw|norm}-{requestIndex}
```

The same `rid` is sent on `/generate`, stored in the pending request context, and required in terminal `meta_info.id`. A response whose ID is missing or differs from the pending request is not attributed by timing, order, prompt hash or agent identity. It produces `INVALID / RUNTIME_ERROR` with evidence code `RID_MISMATCH`.

### 20.2 Native fields

```ts
interface NativeRequestMeasurement {
  rid: string;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  finishReason: unknown;
  numRetractions: number;
  weightVersion: string | null;
}
```

Every field above comes from the terminal `/generate` response's `meta_info` and is `SGLANG_NATIVE`. `cachedTokens` is never defaulted to zero. Unknown additional fields are ignored.

### 20.3 Measured timing fields

```ts
interface MeasuredRequestTiming {
  totalLatencyMs: number;
  ttftMs?: number;
  timingMode: "STREAMING" | "NON_STREAMING";
}
```

Timing points use one monotonic clock:

```text
t0 = immediately before issuing fetch
t1 = first parsed streaming data frame whose cumulative generated text is non-empty
t2 = terminal [DONE] frame for streaming, or completed valid body for non-streaming

ttft_ms          = t1 - t0
total_latency_ms = t2 - t0
```

Both durations are `RADIXSCOPE_MEASURED`. `ttft_ms` is present only when streaming is enabled and `t1` is observed. It includes loopback HTTP and framing overhead and is not SGLang-internal TTFT. If streaming is unavailable or unreliable, the run uses the accepted non-streaming path and omits `ttft_ms`; it does not write zero or substitute `prefill_finished_time`.

### 20.4 Derived request fields

```ts
interface DerivedRequestMeasurement {
  reuseRatio?: number;
  reusePercent?: number;
  endToEndOutputTokensPerSecond?: number;
  postFirstTokenOutputTokensPerSecond?: number;
}

interface RequestMeasurementRecord {
  runId: string;
  mode: RunMode;
  requestIndex: 0 | 1 | 2;
  agentId: AgentId;
  native: NativeRequestMeasurement;
  measured: MeasuredRequestTiming;
  derived: DerivedRequestMeasurement;
  validity: ExecutionValidity;
}
```

The schema separation is normative. A serializer must not flatten these objects into an unlabelled metrics bag.

---

## 21. Parsing and plausibility validation

`parseMetaInfo` performs structural parsing at the SGLang boundary. Cache measurement then performs semantic plausibility checks without modifying the values.

### 21.1 Required validation

| Field/check | Valid condition | Failure |
|---|---|---|
| `meta_info` | object | `INVALID / META_MISSING` |
| `id` | non-empty string equal to dispatched `rid` | `INVALID / RUNTIME_ERROR`, evidence `RID_MISMATCH` |
| `prompt_tokens` | finite integer, `> 0`, `<= contextLength` | `INVALID / META_MISSING`, evidence `PROMPT_TOKENS_INVALID` |
| `cached_tokens` | finite integer, `>= 0`, `<= prompt_tokens` | `INVALID / META_MISSING`, evidence `CACHED_TOKENS_INVALID` |
| `completion_tokens` | finite integer, `>= 0`, `<= 256` | `INVALID / META_MISSING`, evidence `COMPLETION_TOKENS_INVALID` |
| `num_retractions` | finite integer, `>= 0` | `INVALID / META_MISSING`, evidence `RETRACTIONS_INVALID` |
| `weight_version` | string or `null` | `INVALID / META_MISSING`, evidence `WEIGHT_VERSION_INVALID` |
| terminal response | exactly one completion for the pending `rid` | `INVALID / RUNTIME_ERROR` |
| `total_latency_ms` | finite and `> 0` | `INVALID / RUNTIME_ERROR`, evidence `CLOCK_INVALID` |
| `ttft_ms`, when present | finite, `>= 0`, `<= total_latency_ms` | omit if never observed; invalidate if internally inconsistent |

Page alignment does not permit `cached_tokens > prompt_tokens`. It affects expected granularity and the cold tolerance, not the physical upper bound of a request's prompt.

No field is clamped, rounded into range or repaired. The exact offending value, expected condition, `rid`, mode and request index are retained as evidence.

### 21.2 Cold-first-request validation

The tolerance is resolved during PREFLIGHT from the observed effective page size already required by the accepted architecture:

```text
if page_size === 1:
    cold_tolerance_tokens = 0
else if page_size > 1:
    cold_tolerance_tokens = page_size
else:
    refuse benchmark start
```

For request index `0` of each mode:

```text
cached_tokens <= cold_tolerance_tokens  -> cold gate passes
cached_tokens >  cold_tolerance_tokens  -> INVALID / WARM_START
```

The comparison does not begin if either cold gate fails. The observed first value, tolerance, page size, flush evidence and request ID are stored even for an invalid mode.

### 21.3 Retractions

`num_retractions > 0` is not, by itself, an invalidation in the accepted architecture. It is attached prominently to that request's native `cached_tokens` because the verified implementation can understate accumulated reuse after retraction.

Aggregates may still be calculated for an otherwise valid run, but the comparison carries `hasRetractions=true`, the affected request indices, and a visible caution. No diagnostic claims how many tokens were lost.

---

## 22. Formula contract

All token counts use **tokens**. All durations use **milliseconds** in records and are converted to **seconds** only inside throughput formulas. Ratios are stored as fractions in `[0,1]`; percentages are derived for display.

Let one mode contain `N=3` valid request records. For request `i`:

```text
P_i = prompt_tokens
C_i = cached_tokens
G_i = completion_tokens
L_i = total_latency_ms
F_i = ttft_ms, when available
```

### 22.1 Per-request reuse ratio

Compute only when `P_i` and `C_i` are native fields from the same correlated `/generate` response and validation established `P_i > 0` and `0 <= C_i <= P_i`:

```text
reuse_ratio_i   = C_i / P_i                    // unitless fraction [0,1]
reuse_percent_i = reuse_ratio_i × 100          // percent
```

If either field is absent, malformed, uncorrelated or comes from different semantics, both values are undefined. LCP tokens are never used as the numerator and a tokenizer count is never silently substituted for native `prompt_tokens`.

### 22.2 Total cached tokens

For a valid mode with all `N` native observations:

```text
total_cached_tokens = Σ C_i                    // tokens
```

Missing values do not count as zero. If any required native value is missing in an ordinary measurement run, that mode is invalid and the total is absent.

### 22.3 Average cached tokens

```text
average_cached_tokens = total_cached_tokens / N // tokens/request
```

The value may be fractional and is stored without integer rounding. The UI may format to at most two decimal places while retaining the unrounded value in the API payload.

### 22.4 Median cached tokens

Let `S` be the ascending sort of `[C_0 ... C_(N-1)]`.

```text
N odd:  median_cached_tokens = S[(N - 1) / 2]
N even: median_cached_tokens = (S[N/2 - 1] + S[N/2]) / 2
```

For the locked `N=3`, the median is the middle of the three sorted values. The general definition is retained for unit testing, not to introduce variable workloads.

### 22.5 Raw-versus-normalized absolute difference

```text
absolute_cached_token_difference =
    normalized.total_cached_tokens - raw.total_cached_tokens // tokens
```

Positive means NORMALIZED reported more cached tokens; negative means fewer; zero means no change. The value is absent unless both mode totals exist and the comparison is valid.

### 22.6 Percentage improvement

When `raw.total_cached_tokens > 0`:

```text
percentage_improvement =
    ((normalized.total_cached_tokens - raw.total_cached_tokens)
      / raw.total_cached_tokens) × 100                        // percent
```

The signed result is retained:

- `> 0`: UI label **improvement**;
- `< 0`: UI label **regression** using the absolute displayed magnitude;
- `= 0`: UI label **no change**.

When the RAW denominator is zero:

| RAW total | NORMALIZED total | Absolute difference | Percentage improvement |
|---:|---:|---:|---|
| 0 | 0 | 0 tokens | undefined — no non-zero baseline |
| 0 | `> 0` | NORMALIZED total | undefined — never `Infinity` or `100%` |

The API omits `percentageImprovement` and supplies `percentageImprovementUnavailableReason = "ZERO_BASELINE"`. The absolute token difference remains available.

### 22.7 Available throughput

Two client-observed throughput measures are permitted. Both are `RADIXSCOPE_DERIVED`; neither is SGLang server throughput.

End-to-end output rate, when `G_i > 0` and `L_i > 0`:

```text
end_to_end_output_tokens_per_second_i = G_i / (L_i / 1000)
```

This includes prefill, queueing, loopback HTTP, framing and decoding. It must be labelled **end-to-end output tokens/s**, not decode throughput.

Post-first-token client-observed output rate, only when `F_i` exists, `G_i > 1`, and `L_i > F_i`:

```text
post_first_token_output_tokens_per_second_i =
    (G_i - 1) / ((L_i - F_i) / 1000)
```

Subtracting one accounts for the first observed output token. If the first qualifying frame can contain multiple tokens, Day-0 streaming verification must record that behavior; this second measure is then omitted unless the emitted-token count at `t1` is captured exactly. It is never estimated.

Mode-level end-to-end output rate for sequential concurrency `1`, when every request has compatible counts and timing:

```text
mode_end_to_end_output_tokens_per_second =
    Σ G_i / (Σ L_i / 1000)
```

RadixScope does not average per-request rates. A ratio of sums preserves the actual sequential work/time basis.

The SGLang `/metrics` throughput series is server-wide aggregate data. It may be displayed separately under its documented name, but it is not correlated to an individual request and never replaces either formula above or `cached_tokens`.

---

## 23. Aggregation and comparison contract

```ts
interface ModeCacheAggregate {
  mode: RunMode;
  requestCount: 3;
  totalPromptTokens: number;
  totalCachedTokens: number;
  averageCachedTokens: number;
  medianCachedTokens: number;
  totalCompletionTokens: number;
  modeEndToEndOutputTokensPerSecond?: number;
  hasRetractions: boolean;
  retractedRequestIndices: readonly number[];
  provenance: "RADIXSCOPE_DERIVED";
}

interface CacheComparison {
  raw: ModeCacheAggregate;
  normalized: ModeCacheAggregate;
  absoluteCachedTokenDifference: number;
  percentageImprovement?: number;
  percentageImprovementUnavailableReason?: "ZERO_BASELINE";
  modelPath: string;
  serverFingerprint: string;
  coldToleranceTokens: number;
  provenance: "RADIXSCOPE_DERIVED";
}
```

Before constructing `CacheComparison`, the comparison gate asserts:

- both mode verdicts are `VALID`;
- native cache capability is `AVAILABLE`;
- each mode has exactly three correlated records in planner → worker1 → worker2 order;
- both first requests passed the cold gate;
- settings equal the locked immutable values in both modes;
- model, tokenizer, weight version, server fingerprint and context configuration are unchanged;
- task and component content are identical, with only the approved structure change;
- no required native or measured value is missing; and
- all bounds in §21 hold.

If any assertion fails, no partial comparison is returned.

---

## 24. Invalidity reasons and evidence

The terminal reasons remain aligned with `system-architecture.md`. Fine-grained evidence codes explain the exact measurement failure without inventing a parallel state machine.

| Terminal reason | Evidence code examples | Trigger |
|---|---|---|
| `FLUSH_FAILED` | `RAW_FLUSH_NON_200`, `NORM_FLUSH_NON_200` | Required flush did not return 200. |
| `WARM_START` | `RAW_FIRST_REQUEST_WARM`, `NORM_FIRST_REQUEST_WARM` | First native cached count exceeded tolerance. |
| `META_MISSING` | `META_OBJECT_MISSING`, `CACHED_TOKENS_MISSING`, `CACHED_TOKENS_INVALID`, `PROMPT_TOKENS_INVALID`, `COMPLETION_TOKENS_INVALID`, `RETRACTIONS_INVALID` | Required native metadata absent, malformed or implausible. |
| `SETTINGS_MISMATCH` | `TEMPERATURE_DRIFT`, `N_DRIFT`, `MAX_NEW_TOKENS_DRIFT`, `CONCURRENCY_DRIFT`, `SPECULATIVE_ENABLED`, `MTP_ENABLED` | Locked parameters differ. |
| `CONTENT_MISMATCH` | `TASK_CHANGED`, `COMPONENT_CONTENT_CHANGED` | Workloads are not equivalent. |
| `SERVER_CHANGED` | `MODEL_CHANGED`, `WEIGHT_VERSION_CHANGED`, `TOKENIZER_CHANGED`, `FINGERPRINT_CHANGED` | Runtime differs between modes. |
| `RUNTIME_ERROR` | `RID_MISMATCH`, `CLOCK_INVALID`, `DUPLICATE_RESPONSE`, `REQUEST_TIMEOUT`, `STORE_FAILURE` | Correlation, timing, transport or persistence failed. |

```ts
interface MeasurementEvidence {
  code: string;
  mode?: RunMode;
  requestIndex?: number;
  rid?: string;
  field?: string;
  observed?: unknown;
  expected?: unknown;
  provenance: "SGLANG_NATIVE" | "RADIXSCOPE_MEASURED" | "RADIXSCOPE_DERIVED";
}
```

Evidence must not include raw prompt or completion bodies. Response-body evidence is bounded by the existing SGLang client cap and redacted if it contains unexpected prompt material.

### 24.1 Suppression rule

For `INVALID` or `UNAVAILABLE`, the persisted/API object contains no fields named:

```text
comparison
absoluteCachedTokenDifference
percentageImprovement
speedup
winner
```

An invalid response does not serialize these fields with `null` or zero. Absence prevents a frontend bug from rendering a claim that the backend never authorized.

---

## 25. Persistence

The Redis adapter remains the only Redis caller. Measurement records are written under the existing `run:{runId}:*` namespace and inherit the accepted retention policy.

### 25.1 Persisted data

```text
run:{runId}
  mode phases and terminal status
  locked sampling settings
  model/server/tokenizer fingerprint
  cold tolerance and resolved page size
  native-cache capability status

run:{runId}:flush:{raw|normalized}
  status, bounded body, duration, success flag

run:{runId}:req:{raw|normalized}:{0|1|2}
  identity and correlation fields
  native { promptTokens, cachedTokens, completionTokens,
           finishReason, numRetractions, weightVersion }
  measured { ttftMs?, totalLatencyMs, timingMode }
  derived { reuseRatio?, reusePercent?, throughput fields? }
  validity and evidence

run:{runId}:aggregate:{raw|normalized}
  present only for a valid mode with complete compatible records

run:{runId}:comparison
  present only when the final comparison state is AVAILABLE

run:{runId}:verdict
  VALID, INVALID or diagnostic UNAVAILABLE state plus bounded evidence
```

Invalid request and flush evidence is persisted before the run becomes terminal whenever Redis remains available. If Redis itself fails, the in-memory runner still stops and returns/records `INVALID / RUNTIME_ERROR` as far as the surviving API boundary permits; it never continues measuring without durable run state.

### 25.2 Not persisted by cache measurement

- SGLang cache contents or a mirror of cache state;
- inferred cache events;
- raw token arrays;
- raw prompts or completions by default;
- unbounded response bodies;
- Prometheus samples as request-level facts; or
- intermediate floating-point display strings.

Numeric API values retain full JavaScript number precision. Formatting and rounding occur only in the dashboard.

---

## 26. API and dashboard presentation

The frontend polls the existing Express projection. It does not calculate ratios, aggregates, validity or improvement.

### 26.1 `VALID` presentation

Display:

- a green **Valid comparison** status;
- flush status and first-request cold evidence for both modes;
- one row per request with `prompt_tokens`, `cached_tokens`, reuse percentage, `completion_tokens`, `ttft_ms` when available, `total_latency_ms`, and permitted throughput;
- provenance beside every numeric;
- raw and normalized totals, average and median cached tokens;
- absolute cached-token difference;
- percentage improvement/regression, or a zero-baseline explanation;
- retraction cautions beside affected native values; and
- LCP values in a separately labelled **Derived prefix diagnostics** area.

Chart.js receives final backend-computed values only. A useful minimal chart is grouped RAW/NORMALIZED `cached_tokens` by agent plus a totals summary. It must not render a radix tree or turn LCP into a native-cache series.

### 26.2 `INVALID` presentation

Display a prominent red **Invalid benchmark — no comparison** banner before any metric table. Show the terminal reason, evidence code, mode, request index, observed value and expected bound. Native request records and timings may remain visible as evidence, but:

- no improvement or speedup card appears;
- no winner language appears;
- no comparison chart appears; and
- no derived diagnostic is phrased as a substitute result.

### 26.3 `UNAVAILABLE` presentation

Display a prominent neutral/amber **Native cache comparison unavailable** banner with the Day-0 verification reason. Timing and Part A prefix diagnostics may be shown in separate panels. The UI states that LCP is calculated by RadixScope and cannot prove SGLang cache reuse.

### 26.4 Formatting

- Token counts: integers with `tokens` in labels.
- Averages: at most two decimals, labelled `tokens/request`.
- Ratios: at most two percentage decimals; the raw fraction remains in the payload.
- Durations: milliseconds; seconds only if the label changes explicitly.
- Throughput: at most two decimals, labelled `output tokens/s` with `end-to-end` or `post-first-token` qualifier.
- Undefined: em dash plus a reason, never `0`, `NaN`, `Infinity` or an empty cell.

---

## 27. Calculation examples

### 27.1 Valid cold-then-warm sequences

Assume the verified effective page size is `1`, so `cold_tolerance_tokens = 0`. Both first requests are cold; later requests may legitimately report reuse.

| Mode | Agent | Prompt tokens | Cached tokens | Reuse ratio | Completion tokens | TTFT | Total latency |
|---|---|---:|---:|---:|---:|---:|---:|
| RAW | planner | 500 | 0 | 0.00% | 60 | 200 ms | 1,200 ms |
| RAW | worker1 | 600 | 100 | 16.67% | 50 | 160 ms | 1,000 ms |
| RAW | worker2 | 750 | 200 | 26.67% | 40 | 140 ms | 800 ms |
| NORMALIZED | planner | 500 | 0 | 0.00% | 60 | 195 ms | 1,180 ms |
| NORMALIZED | worker1 | 600 | 300 | 50.00% | 50 | 110 ms | 800 ms |
| NORMALIZED | worker2 | 750 | 450 | 60.00% | 40 | 90 ms | 650 ms |

Mode aggregates:

| Metric | RAW | NORMALIZED | Calculation |
|---|---:|---:|---|
| Total cached tokens | 300 | 750 | sum of three native values |
| Average cached tokens | 100.00 | 250.00 | total / 3 |
| Median cached tokens | 100 | 300 | middle sorted value |
| Total completion tokens | 150 | 150 | sum |
| Mode end-to-end output rate | 50.00 tokens/s | 57.03 tokens/s | completions / summed request seconds |

Comparison:

```text
absolute difference = 750 - 300 = 450 tokens
percentage improvement = (450 / 300) × 100 = 150%
```

This is a valid native cache comparison because both first requests are within tolerance and every other gate passed. The timing differences may be displayed, but causal wording remains limited: the benchmark observes the differences under controlled inputs; it does not expose the internal mechanism.

### 27.2 Valid non-zero page tolerance

Assume `page_size = 16`, so `cold_tolerance_tokens = 16`:

```text
flush RAW -> 200
RAW cached_tokens sequence -> [8, 192, 240]          valid
flush NORMALIZED -> 200
NORMALIZED cached_tokens sequence -> [16, 336, 464] valid
```

The first values are not literal zero, but both are within the verified tolerance. They are retained verbatim and included in totals; RadixScope does not subtract the tolerance from later values.

### 27.3 Invalid warm start

Assume `page_size = 16`:

```text
flush RAW -> 200
RAW first cached_tokens -> 48
48 > 16 -> INVALID / WARM_START
```

The RAW mode stops. The record stores `observed=48`, `expected="<= 16"`, the flush evidence and `rid`. NORMALIZED is not run merely to obtain a comparison, and all comparison/improvement fields are absent.

### 27.4 Invalid metadata bounds

```text
prompt_tokens = 600
cached_tokens = 640
```

Because `cached_tokens > prompt_tokens`, the response is implausible for the accepted field semantics. The run becomes `INVALID / META_MISSING` with evidence `CACHED_TOKENS_INVALID`. RadixScope does not clamp the value to 600.

### 27.5 Invalid second mode

```text
RAW:        flush 200, first cached_tokens 0, mode valid
NORMALIZED: flush 400, no measured request
```

The complete benchmark is `INVALID / FLUSH_FAILED`. RAW evidence remains visible, but there is no one-sided comparison and no improvement claim.

### 27.6 Zero baseline

```text
RAW total cached tokens = 0
NORMALIZED total cached tokens = 420
absolute difference = 420 tokens
percentage improvement = undefined (ZERO_BASELINE)
```

The UI does not show infinity, 100%, or an invented denominator.

### 27.7 Native signal unavailable

```text
Day-0 cold/repeat/partial-prefix probes fail to establish usable cached_tokens
native capability = UNAVAILABLE
timings = retained
exact-tokenizer LCP = retained as RADIXSCOPE_DERIVED
native cache totals/ratios/improvement = absent
```

Prometheus cache-hit-rate or throughput metrics do not fill the missing request-level field because the accepted interface does not provide equivalent per-request correlation.

---

## 28. Acceptance tests

### CM-A1 — Two independent verified flushes

The call trace contains exactly one successful `POST /flush_cache?timeout=30` immediately before RAW and exactly one immediately before NORMALIZED. A non-200 on either call yields `INVALID / FLUSH_FAILED` and no comparison.

### CM-A2 — Protected windows

The mock SGLang client records no call of any kind between each successful flush and the corresponding first `/generate`. A tokenization, health or introspection call in that interval fails the test.

### CM-A3 — Cold-first-request gate

For `page_size=16`, first values `0`, `8` and `16` pass; `17` fails with `WARM_START`. The observed value and tolerance are preserved.

### CM-A4 — Strict native parsing

Missing, fractional, negative, non-finite or string-valued required numeric fields invalidate the run. `cached_tokens=prompt_tokens+1` invalidates the run. No invalid value is coerced or clamped.

### CM-A5 — Request correlation

A terminal response with `meta_info.id !== dispatched rid` yields `INVALID / RUNTIME_ERROR` and `RID_MISMATCH`; it is never assigned by response order.

### CM-A6 — Per-request ratio semantics

`cached_tokens=150`, `prompt_tokens=600` produces fraction `0.25` and display `25.00%`. Missing native data or a denominator of zero produces undefined, not zero.

### CM-A7 — Aggregates

For cached values `[0,100,200]`, total is `300`, average is `100`, median is `100`. For `[0,100,200,400]` in the general median unit test, median is `150`; this does not authorize a four-request workload.

### CM-A8 — Percentage improvement and zero handling

RAW `300`, NORMALIZED `750` produces `450` tokens and `150%`. RAW `0`, NORMALIZED `420` produces `420` tokens and an omitted percentage with `ZERO_BASELINE`. Neither path emits `Infinity` or `NaN`.

### CM-A9 — Regression labelling

RAW `600`, NORMALIZED `450` produces absolute difference `-150` and signed percentage `-25%`. The UI labels this a 25% regression, not a negative improvement or a win.

### CM-A10 — Throughput basis

`completion_tokens=60`, `total_latency_ms=1200` produces `50` end-to-end output tokens/s. With `ttft_ms=200`, post-first-token rate is `59` tokens/s. Missing TTFT omits the second rate without affecting the first.

### CM-A11 — First-frame batching guard

If Day-0 evidence shows that the first timed stream frame can contain more than one token and the client does not capture that count, post-first-token throughput is absent. It is not calculated with the one-token formula.

### CM-A12 — Invalid comparison suppression

If either mode is invalid, the API projection contains verdict and evidence but no comparison, cached-token difference, percentage improvement, speedup or winner field. The dashboard shows the invalid banner before request evidence.

### CM-A13 — Unavailable native signal

When the capability state is `UNAVAILABLE`, timings and Part A derived prefix diagnostics remain accessible. Native reuse ratios, totals and improvement fields are absent, and the dashboard states that native cache reuse cannot be proven.

### CM-A14 — Retraction visibility

A request with `num_retractions=1` remains measurable if all required gates pass, but its row and aggregate show the retraction caution. No code adjusts its `cached_tokens`.

### CM-A15 — Provenance separation

Every numeric API field appears under `native`, `measured` or `derived`, and every displayed numeric carries the corresponding label. LCP never appears under native cache fields.

### CM-A16 — Prometheus non-substitution

Removing `cached_tokens` while leaving `/metrics` available does not produce request-level cache values. The current measurement run is invalid; persistent verified unavailability enters diagnostic-only mode.

### CM-A17 — Locked settings equality

Changing temperature, `n`, `max_new_tokens`, concurrency, model, worker, speculative state or MTP state in either mode fails comparability and suppresses the comparison.

### CM-A18 — Locality and bounded persistence

The complete test runs with one local worker and no non-local call. Redis contains bounded run/request/evidence records and no SGLang cache mirror, prompt library, raw token arrays or inferred cache events.

---

## 29. Cache-measurement implementation checklist

- [ ] Treat `meta_info.cached_tokens` as the only primary request-level native cache signal.
- [ ] Record and verify one flush immediately before each mode.
- [ ] Enforce both protected windows inside the benchmark runner.
- [ ] Send and assert one `rid` per request.
- [ ] Parse required native fields strictly; never default, coerce, clamp or repair.
- [ ] Enforce `0 <= cached_tokens <= prompt_tokens` and cold-first-request tolerance.
- [ ] Keep timing points on one monotonic clock.
- [ ] Omit TTFT and post-first-token throughput when their timing basis is unsound.
- [ ] Compute ratios only from compatible native numerator and denominator fields.
- [ ] Use a ratio of sums for mode throughput; never average request rates.
- [ ] Handle a zero RAW baseline without infinity or a fabricated percentage.
- [ ] Persist invalid evidence before terminal transition when storage is available.
- [ ] Omit all comparison and improvement fields for invalid or unavailable states.
- [ ] Display provenance beside every numeric.
- [ ] Keep LCP and divergence in a separate derived-diagnostics surface.
- [ ] Never substitute Prometheus aggregates for request-correlated cache truth.
- [ ] Never infer cache nodes, events, page ownership, eviction or scheduler behavior.

---

## 30. Open runtime evidence for cache measurement

| ID | Evidence required | Decision controlled |
|---|---|---|
| CM-R1 | Effective `page_size` from `/get_server_info` or startup log | Numeric cold tolerance; benchmark cannot start without it. |
| CM-R2 | Cold, identical-repeat and partial-prefix `cached_tokens` observations | Whether native cache capability becomes `AVAILABLE`. |
| CM-R3 | Terminal streaming frame contains complete `meta_info` | Whether streaming is the default measurement path. |
| CM-R4 | First qualifying stream frame output-token count | Whether post-first-token throughput is computable. |
| CM-R5 | Worst observed cold prefill and complete-generation wall times | Confirmation of timing budgets; formulas do not change. |
| CM-R6 | `num_retractions` behavior under the accepted 8 GB configuration | Whether retraction cautions appear in demonstration data. |

All six remain `RUNTIME_PENDING`. A runtime result may disable an optional timing or demote native cache comparison to `UNAVAILABLE`; it must not widen plausibility bounds, weaken the cold gate or replace native cache truth with a derived proxy.

---

# Part C — Divergence Diagnostics

## 31. Purpose and hard boundary

The divergence diagnostic engine is a deterministic module inside the existing Express application. It combines complete-prompt prefix calculations with privacy-safe construction evidence to explain **likely** sources of prompt variability. It does not add a service, model, rules platform or inference-path hop.

The engine may answer:

- whether two complete prompts are identical, strict-prefix related or divergent;
- whether the calculated divergence is early under the fixed rule in §34;
- which developer-supplied component facts changed independently of token position;
- whether transient pattern detection found changed timestamp-, identifier- or formatting-shaped values; and
- whether verified native `cached_tokens` agrees or disagrees with the calculated prefix evidence.

It may not answer:

- which prompt section contains token index `d`;
- which semantic concept a divergent token represents;
- which internal SGLang radix node, cache page, eviction or scheduler event explains reuse;
- whether two arbitrary natural-language strings mean the same thing; or
- how to reorder system instructions, conversation turns, tool calls/results or causal requests.

**Normative rule:** a divergence index alone never selects a cause code. Cause-specific diagnostics require an independent rule predicate over construction metadata or deterministic pattern evidence. If that evidence is absent, the engine emits `UNEXPLAINED_TOKEN_DIVERGENCE` rather than guessing.

All SGLang-dependent wording in this part is limited to the `v0.5.18` contract already verified in `sglang-integration.md`. The only native cache input is terminal `/generate.meta_info.cached_tokens`, subject to the page-size and retraction limitations in Parts A and B. A version change requires re-verification before native evidence is used.

Part C is the normative user-facing projection for divergence diagnosis. The compact `PrefixDiagnostic` values in §9 remain valid structural inputs, but they must be wrapped in this part's labelled statement and confidence contract before reaching the API or UI.

---

## 32. Statement labels and provenance

Every diagnostic returned by the API or rendered by the dashboard contains statements with one of exactly three labels:

| Label | Meaning |
|---|---|
| `OBSERVED` | A direct input fact or a deterministic equality/count result, phrased without a semantic cause. |
| `INFERRED` | A bounded likely explanation produced by a named deterministic rule. It is never presented as fact. |
| `RECOMMENDED` | A safe action constrained by the existing normalization and causality policy. |

The labels do not replace system provenance:

| Example value | Statement label | Provenance |
|---|---|---|
| SGLang-reported `cached_tokens` | `OBSERVED` | `SGLANG_NATIVE` |
| Workload-supplied component kind/order/hash | `OBSERVED` | application input |
| LCP, divergence index, early/late classification | `OBSERVED` | `RADIXSCOPE_DERIVED` |
| “A changed request-shaped identifier likely caused early variability” | `INFERRED` | `RADIXSCOPE_DERIVED` |
| “Keep this eligible dynamic field after static content” | `RECOMMENDED` | `RADIXSCOPE_DERIVED` |

An output must not use unlabelled prose in its `statements` array. UI headings, units and status labels are not diagnostic statements; all explanatory sentences are.

`OBSERVED` is a presentation label, not a reclassification of §2's epistemic taxonomy. For example, an LCP remains **CALCULATED** and `RADIXSCOPE_DERIVED`; its fixed diagnostic sentence is labelled `OBSERVED` because it reports the calculation without interpreting a cause.

---

## 33. Inputs and outputs

### 33.1 Input contract

```ts
type DiagnosticConfidence = "HIGH" | "MEDIUM" | "LOW";

type DiagnosticStatement = {
  label: "OBSERVED" | "INFERRED" | "RECOMMENDED";
  text: string;
};

type DeclaredComponentRole =
  | "SYSTEM_INSTRUCTIONS"
  | "TOOL_DEFINITIONS"
  | "CONVERSATION"
  | "TOOL_CALL"
  | "TOOL_RESULT"
  | "TASK"
  | "OTHER";

interface DiagnosticComponentFact {
  componentRef: string; // opaque workload-supplied ID or keyed-HMAC surrogate
  kind: "SYSTEM" | "SHARED_STATIC" | "AGENT_RULES" | "DYNAMIC_METADATA" | "TASK";
  declaredRole?: DeclaredComponentRole;
  contentFingerprint: string;
  orderIndex: number;
  eligibleForNormalization: boolean;
  causalGroupRef?: string; // opaque ID linking a call/result or ordered turn group
  formatKind?: "JSON" | "YAML" | "TEXT" | "OTHER";
}

interface PatternSummary {
  componentRef: string;
  category:
    | "TIMESTAMP"
    | "UUID"
    | "REQUEST_ID"
    | "WHITESPACE_FORMAT"
    | "OBJECT_KEY_ORDER";
  matchCount: number;
  ephemeralMatchFingerprints: readonly string[];
}

interface CompletePromptEvidence {
  promptFingerprint: string;
  tokenCount?: number;
  tokenIds?: Uint32Array; // ephemeral; complete rendered prompt only
  components: readonly DiagnosticComponentFact[];
  patternSummaries: readonly PatternSummary[]; // created ephemerally by §35
}

interface NativeDiagnosticEvidence {
  cachedTokens: number;
  promptTokens: number;
  numRetractions: number;
  effectivePageSize: number;
  requestId: string;
  capability: "AVAILABLE";
  runValidity: "VALID";
}

interface DivergenceDiagnosticInput {
  left: CompletePromptEvidence;
  right: CompletePromptEvidence;
  pairKind: "CACHE_PREDECESSOR" | "RAW_NORMALIZED_STRUCTURAL";
  lcpTokens?: number;
  firstDivergenceIndex?: number | null;
  nativeForRight?: NativeDiagnosticEvidence;
  tokenizerState: "AVAILABLE" | "UNAVAILABLE";
}
```

`tokenIds`, transient component values and `ephemeralMatchFingerprints` exist only during one analysis call. They are zero-referenced/released after compact results are built and never written to Redis or sent to the browser.

`componentRef`, `kind`, `declaredRole`, `eligibleForNormalization`, `causalGroupRef` and `formatKind` are workload-supplied construction metadata. The diagnostic engine never assigns these values by examining token positions or natural-language meaning. If the workload did not supply a role, a role-dependent rule cannot fire.

For `CACHE_PREDECESSOR`, `nativeForRight` is accepted only for the same correlated current request, a valid post-flush cache epoch and the selected earlier prompt set described in §6. For `RAW_NORMALIZED_STRUCTURAL`, native cache evidence cannot corroborate the pair because the mandatory flush separates the modes; it is omitted.

### 33.2 Output contract

```ts
type DiagnosticCode =
  | "SYSTEM_INSTRUCTIONS_CHANGED"
  | "TOOL_DEFINITIONS_CHANGED"
  | "CONVERSATION_CHANGED"
  | "TASK_CHANGED"
  | "TIMESTAMP_VARIABILITY"
  | "UUID_OR_REQUEST_ID_VARIABILITY"
  | "OBJECT_KEY_ORDER_VARIABILITY"
  | "FORMATTING_VARIABILITY"
  | "DYNAMIC_METADATA_VARIABILITY"
  | "CACHE_PREFIX_AGREEMENT"
  | "CACHE_PREFIX_DISAGREEMENT"
  | "UNEXPLAINED_TOKEN_DIVERGENCE"
  | "TOKENIZATION_UNAVAILABLE"
  | "NATIVE_CACHE_UNAVAILABLE";

interface DivergenceDiagnostic {
  code: DiagnosticCode;
  confidence: DiagnosticConfidence;
  statements: readonly DiagnosticStatement[];
  evidence: {
    lcpTokens?: number;
    firstDivergenceIndex?: number | null;
    minPromptTokens?: number;
    earlyWindowTokens?: number;
    componentRefs?: readonly string[];
    componentKinds?: readonly string[];
    patternCategory?: PatternSummary["category"];
    changedPatternCount?: number;
    cachedTokens?: number;
    effectivePageSize?: number;
    nativeVsLcpDelta?: number;
    retractionObserved?: boolean;
  };
  provenance: "RADIXSCOPE_DERIVED";
  deduplicationGroup: string;
  precedence: number;
}

interface DivergenceDiagnosticResult {
  pairRelation?: "IDENTICAL" | "STRICT_PREFIX" | "DIVERGED";
  diagnostics: readonly DivergenceDiagnostic[]; // zero to three
  omittedDiagnosticCount: number;
  tokenEvidenceStatus: "AVAILABLE" | "UNAVAILABLE";
  nativeCacheEvidenceStatus: "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE";
}
```

Each cause diagnostic normally contains one statement of each label in this order: `OBSERVED`, `INFERRED`, `RECOMMENDED`. Availability and disagreement diagnostics may omit a recommendation when no safe action follows, but their explanatory statements remain labelled.

### 33.3 Pure entry points

```ts
function scanEphemeralPatterns(
  componentRef: string,
  value: string,
  metadata: DiagnosticComponentFact,
  hmacKey: Uint8Array
): readonly PatternSummary[];

function classifyEarlyDivergence(
  firstDivergenceIndex: number,
  leftTokenCount: number,
  rightTokenCount: number
): { early: boolean; earlyWindowTokens: number };

function compareConstructionFacts(
  left: readonly DiagnosticComponentFact[],
  right: readonly DiagnosticComponentFact[]
): ConstructionDelta;

function evaluateDiagnosticRules(
  input: DivergenceDiagnosticInput
): readonly DivergenceDiagnostic[];

function rankAndDeduplicateDiagnostics(
  diagnostics: readonly DivergenceDiagnostic[],
  maximum: 3
): { displayed: readonly DivergenceDiagnostic[]; omittedCount: number };

function diagnoseDivergence(
  input: DivergenceDiagnosticInput
): AnalysisResult<DivergenceDiagnosticResult>;
```

All functions are deterministic and side-effect free. Pattern scanning receives the HMAC key only to compare matches without retaining their text; the output never contains the key or raw matches.

### 33.4 Validation and errors

```ts
type DiagnosticErrorCode =
  | "PAIR_IDENTITY_MISMATCH"
  | "TOKEN_EVIDENCE_INCOMPLETE"
  | "PREFIX_RESULT_INCONSISTENT"
  | "CONSTRUCTION_METADATA_INVALID"
  | "PATTERN_EVIDENCE_INVALID"
  | "NATIVE_EVIDENCE_INVALID"
  | "DIAGNOSTIC_INPUT_TOO_LARGE";
```

The engine rejects rather than repairs:

- token arrays whose fingerprints/token counts/identity do not match the Part A analysis;
- an LCP outside `[0, min(leftTokens, rightTokens)]`;
- a divergence index inconsistent with the supplied LCP and pair relation;
- duplicate component references, negative order indices or unknown kinds/roles;
- a pattern summary referring to a component absent from that side's manifest;
- native counts outside the Part B bounds or evidence not correlated to the right/current request; and
- prompts, component counts or match counts above the §42 limits.

An error yields no partial cause list. The caller records the bounded code, makes diagnostics unavailable for that pair and preserves the underlying accepted prefix/cache records unchanged.

---

## 34. Structural predicates

### 34.1 Early divergence

For two non-empty complete token arrays, let:

```text
M = min(left.tokenCount, right.tokenCount)
earlyWindowTokens = min(M, 128, max(16, ceil(0.10 × M)))
early = firstDivergenceIndex !== null
        and firstDivergenceIndex < earlyWindowTokens
```

This is a RadixScope policy threshold, not an SGLang cache boundary. The API returns both the index and threshold so the classification is reproducible. Changing the constants is a versioned application-policy change.

If tokenization is unavailable, `early` is undefined. Character or byte offsets are not substituted.

### 34.2 Construction deltas

Component comparisons use `componentRef`, kind, declared role, exact content fingerprint, order and causal group. They may establish facts such as:

- a workload-declared `SYSTEM_INSTRUCTIONS` component fingerprint changed;
- the ordered list of conversation component fingerprints changed;
- the same JSON component has an identical canonical data fingerprint but a different emitted key order; or
- a `DYNAMIC_METADATA` component contains different timestamp-shaped matches.

They do not establish that the calculated divergence token lies in any component. Diagnostic evidence may list changed component references because those references were supplied by the constructor; it must not attach token ranges to them.

### 34.3 Comparable pattern change

A pattern category is “changed” only when the same `componentRef` exists on both sides and its sorted ephemeral match-fingerprint multiset differs. A match that exists on only one side also counts as changed. The retained result contains category and counts only.

Pattern detection cannot create or change `kind`, `declaredRole` or `eligibleForNormalization`. Those remain developer-supplied.

---

## 35. Deterministic pattern detection

Scanning occurs on transient component values during prompt construction, before those values are discarded. It is bounded to `256 KiB` per complete prompt and uses fixed patterns only.

### 35.1 Recognized patterns

| Category | Deterministic recognizer | Guard |
|---|---|---|
| `TIMESTAMP` | RFC 3339/ISO-8601 date-time with timezone, or a metadata field whose developer-supplied name is in `{timestamp, created_at, updated_at, request_time}` and whose value parses strictly | Date-only strings and free-form natural-language dates do not match. |
| `UUID` | Canonical hyphenated UUID `8-4-4-4-12`, hexadecimal, case-insensitive | Word boundaries required; matched text never retained. |
| `REQUEST_ID` | Value of a developer-declared metadata field role `REQUEST_ID`, or strict key name `{request_id, requestId, trace_id, traceId, rid}` with a bounded `[A-Za-z0-9_-]{8,128}` value inside declared structured metadata | The engine does not scan arbitrary prose for generic alphanumeric IDs. |
| `OBJECT_KEY_ORDER` | Component is declared `formatKind="JSON"`; both sides parse under strict JSON; recursive canonical values are equal, but the captured object-key traversal order differs | Duplicate JSON keys, non-object roots or parse failures disable the rule. |
| `WHITESPACE_FORMAT` | For strict JSON, canonical values are equal but emitted bytes differ and key order is equal; otherwise only developer-declared formatting metadata may report a change | Whitespace stripping over arbitrary natural language is forbidden. |

Every match is immediately converted to:

```text
HMAC-SHA-256(localKey,
  "radixscope-diagnostic-pattern-v1\0" ||
  componentRef || "\0" || category || "\0" || canonicalMatchedValue)
```

The raw match and canonical matched value are discarded. Match fingerprints are used only inside the analysis call and are not retained.

### 35.2 Parser failures

Malformed structured data produces no key-order or whitespace diagnosis. It may produce a bounded `OBSERVED` evidence flag for developer logs, but the user-facing engine does not call malformed data a formatting cause. No tolerant repair, YAML-to-JSON conversion or semantic parser is introduced.

---

## 36. Confidence scale

| Confidence | Required basis | Meaning |
|---|---|---|
| `HIGH` | Exact component-role/hash/order evidence or strict structured-data equivalence, plus token divergence when tokenization is available | Strong deterministic association; still an inference about cause. |
| `MEDIUM` | Specific pattern change in the same component, or a broad component change with early divergence; may be promoted once by compatible native cache evidence | Plausible cause with a material false-positive path. |
| `LOW` | Broad metadata/format change, degraded evidence, or unexplained token divergence | Useful lead only; wording must emphasize uncertainty. |

No rule returns “certain.” Native cache agreement may raise `LOW` to `MEDIUM` or `MEDIUM` to `HIGH`, but never above `HIGH` and never without independent cause evidence. Native disagreement prevents promotion.

---

## 37. Cause-rule catalogue

The following rules are evaluated against the complete pair. “Changed component” always means a manifest comparison independent of token position.

### DD-R1 — Timestamp variability

- **Required evidence:** token divergence; the same component has a changed `TIMESTAMP` pattern multiset; preferably `kind=DYNAMIC_METADATA`.
- **Confidence:** `MEDIUM` when the changed match is in `DYNAMIC_METADATA`; otherwise `LOW`. Compatible early/native evidence may promote once.
- **False-positive risk:** an intentionally changed deadline, historical date or task parameter can look like incidental time metadata.
- **User-facing statements:**
  - `OBSERVED` — “The prompts diverge at token index {d}; transient scanning found {n} changed timestamp-shaped value(s) in component {ref}.”
  - `INFERRED` — “Changing time metadata is a likely contributor to prompt variability; the token index is not mapped to that component.”
  - `RECOMMENDED` — “If this field is already approved as normalization-eligible and is not causally required earlier, keep stable content first and place the changing metadata later.”
- **Safety:** no recommendation is emitted when the component is ineligible or causally constrained; the fallback recommendation is to verify whether the change is intentional.

### DD-R2 — UUID or request-ID variability

- **Required evidence:** token divergence and a changed `UUID` or `REQUEST_ID` pattern multiset in the same component.
- **Confidence:** `MEDIUM` for strict UUID; `HIGH` for a workload-declared request-ID field in eligible `DYNAMIC_METADATA`; otherwise `LOW`.
- **False-positive risk:** an identifier may be task identity, a tool correlation key or a required causal reference rather than disposable metadata.
- **User-facing statements:**
  - `OBSERVED` — “The prompts diverge at token index {d}; component {ref} contains changed {patternCategory} value(s).”
  - `INFERRED` — “A changing identifier is a likely source of prefix variability, but its semantic role is supplied by the workload rather than derived from token position.”
  - `RECOMMENDED` — “Only if the field is already eligible and not a causal correlation key, place it after stable eligible content; otherwise preserve its authored position.”

### DD-R3 — Dynamic-metadata variability

- **Required evidence:** token divergence and a changed fingerprint for a workload-classified `DYNAMIC_METADATA` component; no more-specific pattern rule is required.
- **Confidence:** `MEDIUM` when divergence is early, otherwise `LOW`.
- **False-positive risk:** the metadata may intentionally alter the task or be causally required even though its kind is dynamic.
- **User-facing statements:**
  - `OBSERVED` — “The construction manifest reports changed dynamic metadata and the complete prompts diverge at token index {d}.”
  - `INFERRED` — “Dynamic metadata may contribute to the divergence; RadixScope has not mapped token {d} to that component.”
  - `RECOMMENDED` — “For fields already classified eligible and safe to move, prefer stable eligible content before dynamic metadata; preserve all causal dependencies.”

### DD-R4 — Object-key ordering

- **Required evidence:** strict JSON parsing succeeds on the same component, canonical recursive data fingerprints are equal, captured key-order signatures differ, and complete prompts diverge.
- **Confidence:** `HIGH`.
- **False-positive risk:** consumers may intentionally rely on serialized order even when JSON data values are equal; eligibility remains mandatory.
- **User-facing statements:**
  - `OBSERVED` — “The JSON values are canonically equal, but object-key order differs in component {ref}; the complete prompts diverge at token index {d}.”
  - `INFERRED` — “Serialization key order is a likely source of token variability.”
  - `RECOMMENDED` — “If this component is already normalization-eligible, serialize its object keys with the approved deterministic order; do not reorder arrays, turns or tool events.”

### DD-R5 — Formatting variability

- **Required evidence:** strict JSON canonical values and key order are equal while emitted bytes differ, or developer-supplied formatting metadata differs; complete prompts diverge.
- **Confidence:** `HIGH` for strict JSON equivalence; `LOW` for metadata-only format evidence.
- **False-positive risk:** whitespace can be meaningful in natural language, code, YAML, Markdown or tool payloads.
- **User-facing statements:**
  - `OBSERVED` — “Equivalent strict-JSON data was emitted with different formatting in component {ref}; the complete prompts diverge at token index {d}.”
  - `INFERRED` — “Formatting is a likely source of token variability for this declared structured component.”
  - `RECOMMENDED` — “Use the approved deterministic serializer only when the component is already eligible; do not normalize arbitrary text or code whitespace.”

### DD-R6 — Changed system instructions

- **Required evidence:** a component explicitly declared `SYSTEM_INSTRUCTIONS` or `kind=SYSTEM` has a different exact content fingerprint; complete prompts differ.
- **Confidence:** `HIGH`.
- **False-positive risk:** the change may be intentional, versioned and necessary; it explains structural difference but not whether the change is wrong.
- **User-facing statements:**
  - `OBSERVED` — “The workload-supplied system-instruction component fingerprint changed between the prompts.”
  - `INFERRED` — “Changed system instructions are a likely source of the prompt difference; no token-to-section mapping was performed.”
  - `RECOMMENDED` — “Review whether the system-instruction change is intentional and version it if needed. Keep system instructions first and never move them below untrusted content.”

### DD-R7 — Changed tool definitions

- **Required evidence:** a component explicitly declared `TOOL_DEFINITIONS` has a different exact content fingerprint or deterministic ordered definition fingerprint; complete prompts differ.
- **Confidence:** `HIGH`.
- **False-positive risk:** a legitimate tool capability or schema update naturally changes the prompt.
- **User-facing statements:**
  - `OBSERVED` — “The workload-declared tool-definition fingerprint changed between the prompts.”
  - `INFERRED` — “Changed tool definitions are a likely source of the prompt difference.”
  - `RECOMMENDED` — “Keep tool definitions deterministic and versioned; preserve trust order and do not move definitions across dependent requests or results.”

### DD-R8 — Conversation or tool-result difference

- **Required evidence:** the ordered fingerprints, declared roles or causal-group references for `CONVERSATION`, `TOOL_CALL` or `TOOL_RESULT` components differ.
- **Confidence:** `HIGH` for an order/addition/removal difference; `MEDIUM` for content-fingerprint change alone.
- **False-positive risk:** conversation growth and tool results are expected causal inputs, not necessarily unwanted variability.
- **User-facing statements:**
  - `OBSERVED` — “The workload manifest reports a change in ordered conversation/tool evidence between the prompts.”
  - `INFERRED` — “Conversation or tool-result differences are a likely source of the prompt difference; this may be expected causal evolution.”
  - `RECOMMENDED` — “Preserve authored turn order, tool-call/result pairing and causality. Compare like-for-like workload states rather than reordering history.”

### DD-R9 — Genuinely different task

- **Required evidence:** the workload-declared `TASK` component fingerprint, opaque task identity or declared task version differs.
- **Confidence:** `HIGH`.
- **False-positive risk:** equivalent tasks expressed differently have different fingerprints; RadixScope does not judge semantic equivalence.
- **User-facing statements:**
  - `OBSERVED` — “The workload-supplied task fingerprint or task identity differs between the prompts.”
  - `INFERRED` — “The prompts likely represent different task inputs, so prefix divergence may be expected.”
  - `RECOMMENDED` — “Compare identical task inputs when measuring structural normalization; do not rewrite or relocate a causal task merely to increase prefix reuse.”

### DD-R10 — Unexplained token divergence

- **Required evidence:** valid calculated divergence exists and no cause rule has independent supporting evidence.
- **Confidence:** `LOW`.
- **False-positive risk:** none for the structural observation; any semantic explanation would be speculative, so none is supplied.
- **User-facing statements:**
  - `OBSERVED` — “The complete prompts share {lcp} leading tokens and first diverge at token index {d}.”
  - `INFERRED` — “The available evidence does not identify a likely semantic cause.”
  - `RECOMMENDED` — “Inspect the developer-supplied construction manifest and authored input differences without treating token {d} as a section boundary.”

---

## 38. Cache-evidence wording

Native cache evidence modifies confidence and wording only for `pairKind="CACHE_PREDECESSOR"`, when `nativeForRight` is valid and correlated. It never selects a semantic cause.

Let:

```text
d = firstDivergenceIndex
L = lcpTokens
C = native cachedTokens for the current/right request
G = effectivePageSize
agreementTolerance = max(1, G)
lowNative = C < earlyWindowTokens
earlyCalculated = d !== null and d < earlyWindowTokens
nearCalculatedPrefix = abs(C - L) <= agreementTolerance
```

### 38.1 Stronger compatible inference

If a cause rule already fired, `earlyCalculated`, `lowNative` and `nearCalculatedPrefix` are all true, and `numRetractions === 0`:

1. promote its confidence by one level, capped at `HIGH`;
2. append `OBSERVED` — “SGLang reported {C} cached prompt tokens for this request, and RadixScope calculated an early {L}-token common prefix with the selected prior prompt.”; and
3. append `INFERRED` — “The native and calculated evidence are consistent with limited prefix reuse, strengthening—but not proving—the rule’s likely-cause explanation.”

The wording does not say that the detected field caused a cache miss. `cached_tokens` can reflect SGLang cache entries beyond the selected application prompt, and page alignment still applies.

### 38.2 Agreement without a cause

If early/native agreement exists but no cause rule has independent evidence, emit `CACHE_PREFIX_AGREEMENT` plus `UNEXPLAINED_TOKEN_DIVERGENCE`. The cache diagnostic says only that the two numeric observations are consistent. It does not invent a cause or promote the unexplained diagnostic.

### 38.3 Disagreement

If `abs(C - L) > agreementTolerance`, emit `CACHE_PREFIX_DISAGREEMENT`:

- `OBSERVED` — “SGLang reported {C} cached prompt tokens; RadixScope calculated {L} common-prefix tokens against the selected prior prompt; the delta is {C-L} tokens.”
- `INFERRED` — “The native and selected-pair measurements disagree beyond the verified page tolerance. They describe different evidence and neither replaces the other.”

No recommendation names eviction, another cache entry, page ownership or scheduling as the cause. If `numRetractions > 0`, append an `OBSERVED` retraction statement and state in the inference that the pinned implementation may understate accumulated reuse; do not adjust `C`.

For `RAW_NORMALIZED_STRUCTURAL`, the result uses `nativeCacheEvidenceStatus="NOT_APPLICABLE"` because the two prompts occur in separate flushed cache epochs. Per-mode native observations may be displayed elsewhere, but they cannot corroborate that structural pair.

---

## 39. Precedence, deduplication and display bound

The engine evaluates all applicable rules, then applies this stable ordering:

| Precedence | Code/group | Reason |
|---:|---|---|
| 10 | `SYSTEM_INSTRUCTIONS_CHANGED` | Trust and precedence risk. |
| 20 | `TASK_CHANGED` | Workload comparability risk. |
| 30 | `CONVERSATION_CHANGED` | Causality and history comparability. |
| 40 | `TOOL_DEFINITIONS_CHANGED` | Capability/schema comparability. |
| 50 | `UUID_OR_REQUEST_ID_VARIABILITY` | Specific dynamic cause. |
| 60 | `TIMESTAMP_VARIABILITY` | Specific dynamic cause. |
| 70 | `OBJECT_KEY_ORDER_VARIABILITY` | Strong serialization evidence. |
| 80 | `FORMATTING_VARIABILITY` | Broader serialization evidence. |
| 90 | `DYNAMIC_METADATA_VARIABILITY` | Broad fallback. |
| 100 | cache agreement/disagreement | Numeric relationship, not semantic cause. |
| 110 | unavailable evidence | Capability disclosure. |
| 120 | `UNEXPLAINED_TOKEN_DIVERGENCE` | Last-resort structural explanation. |

Deduplication rules:

1. Keep at most one diagnostic per `(deduplicationGroup, componentRef)`.
2. A UUID/request-ID or timestamp diagnostic suppresses `DYNAMIC_METADATA_VARIABILITY` for the same component.
3. `OBJECT_KEY_ORDER_VARIABILITY` suppresses `FORMATTING_VARIABILITY` for the same component when both arise from the same strict-JSON comparison.
4. Any cause-specific rule suppresses `UNEXPLAINED_TOKEN_DIVERGENCE`; cache-only agreement does not.
5. `CACHE_PREFIX_DISAGREEMENT` suppresses `CACHE_PREFIX_AGREEMENT`.
6. Exact duplicates retain the lower numeric precedence; remaining ties sort by code, then opaque component reference.

The backend returns and the frontend displays at most **three** diagnostics per prompt pair. `omittedDiagnosticCount` reports how many deduplicated diagnostics were not displayed. The UI does not independently rerank, expand or recompute them.

---

## 40. Safe recommendation policy

`static-first/dynamic-last` is recommended only when every affected component:

- was already classified by the workload;
- has `eligibleForNormalization=true` under the accepted whitelist;
- is not `SYSTEM` or unclassified content;
- is not a conversation turn, tool call, tool result or causal task/request;
- remains reversible under the normalization manifest; and
- can move without changing system precedence, trust order or meaning.

If any condition is unknown or false, the recommendation becomes “review whether the change is intentional” or “preserve authored order.” The diagnostic engine never changes the prompt itself and never overrides a normalizer refusal.

Forbidden recommendations include:

- moving system instructions below user, tool or other untrusted content;
- moving tool definitions across instructions or calls that depend on them;
- sorting, dropping or summarizing conversation history;
- reordering a tool call and its result;
- moving a request before information it causally depends on;
- rewriting values, removing identifiers or timestamps required by the task; and
- changing raw-mode pass-through behavior.

---

## 41. Degraded and unavailable evidence

| Available evidence | Permitted diagnostics | Required disclosure |
|---|---|---|
| Tokens + construction metadata + valid native cache | All cause rules; compatible native evidence may promote confidence once. | Show native and derived values separately. |
| Tokens + construction metadata, native cache unavailable | Cause rules from token/metadata evidence; no cache promotion. Add `NATIVE_CACHE_UNAVAILABLE`. | “Native cache evidence is unavailable; this diagnosis is derived and cannot prove cache reuse.” |
| Tokens only | Pair relation, early classification and `UNEXPLAINED_TOKEN_DIVERGENCE`; cache agreement only if valid native input exists. | “No construction evidence identifies a semantic cause.” |
| Construction metadata only | System/tool/conversation/task and strict pattern rules may fire, capped at `MEDIUM`; no early/late or token-index wording. Add `TOKENIZATION_UNAVAILABLE`. | “Tokenization is unavailable; no LCP or divergence index was calculated.” |
| Native cache only | `NATIVE_CACHE_UNAVAILABLE` is not applicable; show the native count outside semantic diagnostics. No cause rule and no comparison to LCP. | “A native count alone does not identify a prompt difference.” |
| Neither tokens nor construction metadata | Availability statements only; zero cause diagnostics. | “Insufficient evidence for divergence diagnosis.” |

Missing native `cached_tokens` never becomes zero. Missing tokenization never falls back to characters, words, independent section token counts or decoded native fields. A cache-measurement run remains `INVALID`/`UNAVAILABLE` under Part B even when metadata-only diagnostics can still run.

---

## 42. Privacy, retention and resource bounds

### 42.1 Retained result

Redis may retain only:

```text
runId, mode, request pair indices
prompt fingerprints and token lengths
LCP and first divergence index when available
opaque/HMAC component references, component kinds and declared roles
diagnostic code, confidence, precedence and labelled template ID
numeric/count evidence and availability status
native cached_tokens/request ID only under the existing request record
omittedDiagnosticCount
```

Rendered statement text is produced from fixed templates and numeric/opaque evidence at the API projection boundary. Redis need not retain prose.

All retained records use the existing `run:{runId}:*` namespace and pair indices. Diagnostics compare only the explicitly supplied pair inside one run/session context; there is no global prompt catalogue, cross-session matching or tenant-wide pattern aggregation.

It does not retain:

- raw prompts, component values or completions;
- decoded divergent tokens or surrounding text;
- timestamp, UUID or request-ID matches;
- ephemeral match fingerprints;
- reconstructed JSON/YAML objects;
- token arrays; or
- inferred section ranges.

The dashboard must not reveal `componentRef` if the workload supplied a human-readable sensitive name. The assembler provides an approved display label or the engine uses a keyed opaque surrogate.

### 42.2 Bounds and complexity

The implementation enforces `maxComponentsPerPrompt=64`, `maxPatternMatchesPerCategoryPerComponent=32`, the existing six-prompt benchmark bound and the accepted `256 KiB` prompt byte cap. Exceeding a diagnostic guard disables diagnosis for that pair; values are never truncated into a misleading result.

Under those bounds:

- pattern scanning is `O(B)` time over prompt bytes with a fixed number of recognizers;
- manifest comparison is `O(C log C)` time using stable maps/sorts;
- rule evaluation is `O(C + R)`, where `R` is the fixed rule count;
- ranking is `O(R log R)` over at most 14 candidates;
- retained output is at most three diagnostics per pair; and
- ephemeral space is `O(B + C)` while retained diagnostic space is constant under the locked bounds.

Regexes are precompiled, linear/bounded and exclude nested unbounded quantifiers. Strict JSON parsing uses the existing prompt-size cap. No GPU, network request, secondary LLM, embedding, vector index or external analysis process is used.

---

## 43. Unit and acceptance tests

### DD-A1 — Divergence alone does not name a cause

Token arrays `[1,2,3]` and `[1,9,3]` produce LCP `1` and divergence index `1`. With no construction or pattern difference, the only cause result is `UNEXPLAINED_TOKEN_DIVERGENCE`; timestamp, ID, system, task and formatting codes are absent.

### DD-A2 — Early threshold is reproducible

For token lengths `600` and `700`, the early window is `60`. Divergence `59` is early; divergence `60` is not. For lengths `8` and `10`, the window is `8` and the result remains bounded by the shorter prompt.

### DD-A3 — Timestamp rule

The same eligible `DYNAMIC_METADATA` component contains strict RFC-3339 values `2026-09-06T10:00:00Z` and `2026-09-06T10:01:00Z`, and the prompts diverge. Emit `TIMESTAMP_VARIABILITY`, `MEDIUM`, with no raw timestamp in the output.

### DD-A4 — Natural-language date does not match

Text “meet next Friday” in an arbitrary `TASK` component does not satisfy the timestamp recognizer. No timestamp diagnostic is emitted.

### DD-A5 — UUID/request-ID safety

A changed canonical UUID in eligible dynamic metadata emits the identifier rule. The same UUID used in a `TOOL_CALL` causal group produces a preserve-order recommendation, never a dynamic-last recommendation.

### DD-A6 — Strict JSON key order

`{"a":1,"b":2}` and `{"b":2,"a":1}` in the same eligible JSON component produce `OBJECT_KEY_ORDER_VARIABILITY`, `HIGH`. Arrays `[1,2]` and `[2,1]` are not canonically equal and do not trigger the rule.

### DD-A7 — JSON whitespace

Two strict JSON values with equal canonical data and key order but different indentation produce `FORMATTING_VARIABILITY`. Equivalent-looking YAML or arbitrary prose does not use this rule without developer-supplied formatting metadata.

### DD-A8 — System change safety

A changed `SYSTEM` fingerprint emits `SYSTEM_INSTRUCTIONS_CHANGED`, `HIGH`. Its recommendation says to preserve system-first precedence and never suggests moving it.

### DD-A9 — Tool-definition role is supplied, not guessed

A changed component fires `TOOL_DEFINITIONS_CHANGED` only when `declaredRole="TOOL_DEFINITIONS"`. Keyword “tool” in raw text is insufficient.

### DD-A10 — Conversation causality

Changing ordered tool-call/result fingerprints emits `CONVERSATION_CHANGED`. The recommendation preserves the pair and authored history; it never proposes sorting or relocation.

### DD-A11 — Different task

A changed workload-declared TASK fingerprint emits `TASK_CHANGED`, `HIGH`, and recommends like-for-like inputs. It does not claim the tasks are semantically unequal.

### DD-A12 — Native agreement promotes once

With early window `60`, LCP `32`, native cached tokens `32`, page size `1`, no retraction and a `MEDIUM` timestamp rule, confidence becomes `HIGH`. The statements still use “consistent with” and “likely,” never “caused.”

### DD-A13 — Native agreement cannot create a cause

The same numeric evidence without construction/pattern evidence emits `CACHE_PREFIX_AGREEMENT` and `UNEXPLAINED_TOKEN_DIVERGENCE`; it does not emit a timestamp, ID or metadata cause.

### DD-A14 — Native disagreement is preserved

LCP `32`, native cached tokens `160`, page size `16` yields delta `128`, exceeding tolerance. Emit both numbers and `CACHE_PREFIX_DISAGREEMENT`; do not resolve the difference or name an internal cache event.

### DD-A15 — Retraction caution

When `num_retractions=1`, native evidence never promotes confidence. The output records the retraction and says the pinned native value may understate reuse; it does not change `cached_tokens`.

### DD-A16 — Cross-flush native evidence is not used

For `RAW_NORMALIZED_STRUCTURAL`, native evidence status is `NOT_APPLICABLE` even if both request records contain cached counts. Diagnostics rely on structural and construction evidence only.

### DD-A17 — Deduplication

A dynamic component with both a changed UUID and a generic fingerprint change returns the UUID diagnostic and suppresses generic dynamic metadata. JSON key-order evidence suppresses formatting for the same comparison.

### DD-A18 — Stable maximum

Given five deduplicated applicable diagnostics, exactly the first three by precedence/code/component sort are returned and `omittedDiagnosticCount=2`.

### DD-A19 — Tokenization unavailable

With construction evidence but no exact tokenizer, role/hash rules may run at no more than `MEDIUM`. The result includes `TOKENIZATION_UNAVAILABLE`, contains no LCP/index/early wording and does not use character offsets.

### DD-A20 — Native cache unavailable

With valid token and construction evidence but missing/unusable `cached_tokens`, cause diagnostics remain derived, no confidence promotion occurs, and `NATIVE_CACHE_UNAVAILABLE` states that native reuse cannot be proven.

### DD-A21 — Privacy

Timestamp, UUID and request-ID strings appear in neither persisted output nor API JSON. Token arrays, raw prompts and decoded divergent tokens are absent from Redis.

### DD-A22 — Label completeness

Every sentence in every returned diagnostic statement has an explicit `OBSERVED`, `INFERRED` or `RECOMMENDED` label. Serialization rejects an unknown or missing label.

### DD-A23 — Normalization eligibility

An ineligible dynamic component can receive a likely-cause diagnostic, but its recommendation is review/preserve only. `static-first/dynamic-last` appears only for an eligible, non-causal component.

### DD-A24 — Locked architecture

The implementation imports into the existing Express prefix-analysis module, performs no external request, and introduces no AI model, embeddings, vector search, section mapper, cache tree, router, generic rules platform, WebSocket or SSE path.

---

## 44. Divergence-diagnostics implementation checklist

- [ ] Keep the engine as pure functions inside the single Express application.
- [ ] Require independent metadata/pattern evidence before emitting a cause code.
- [ ] Label every explanatory statement `OBSERVED`, `INFERRED` or `RECOMMENDED`.
- [ ] Use only complete-prompt token arrays; never tokenize sections independently.
- [ ] Never map a divergence index to a component or decode retained divergent tokens.
- [ ] Treat component roles and normalization eligibility as developer-supplied facts.
- [ ] Run only bounded deterministic pattern recognizers over transient values.
- [ ] Drop raw matches and ephemeral match fingerprints before persistence.
- [ ] Use valid correlated `v0.5.18` `cached_tokens` only for cache-pair wording.
- [ ] Display native/calculated disagreement without inventing a resolution.
- [ ] Never use cross-flush cached counts to corroborate RAW↔NORMALIZED structural pairs.
- [ ] Promote confidence at most once and only after a cause rule already fired.
- [ ] Apply stable precedence/deduplication and return no more than three diagnostics.
- [ ] Recommend static-first/dynamic-last only for already eligible, non-causal fields.
- [ ] Preserve system precedence, conversation/tool order and causal requests.
- [ ] Keep exact-token and native-cache degraded modes explicit.
- [ ] Persist compact codes/counts/fingerprints, not raw sensitive content.
- [ ] Add no LLM, embeddings, vector search, external service or generic rules framework.

---

## 45. Open runtime evidence for divergence diagnostics

Only the native-cache corroboration path depends on SGLang runtime evidence:

| ID | Evidence required | Effect |
|---|---|---|
| DD-RUNTIME-1 | Part B confirms usable correlated `meta_info.cached_tokens` on `v0.5.18` | Enables cache agreement/disagreement statements. |
| DD-RUNTIME-2 | Effective page size resolved by accepted preflight | Sets `agreementTolerance`; unresolved size disables native corroboration. |
| DD-RUNTIME-3 | Retraction field behavior from the accepted integration probe | Enables the no-promotion caution when retraction is observed. |

The cause rules, pattern recognizers, precedence and privacy behavior are application-local and require no SGLang claim. If any native runtime item remains unresolved, diagnostics continue with `RADIXSCOPE_DERIVED` token/construction evidence and an explicit native-evidence-unavailable statement.

---

# Part D — Normalization

## 46. Purpose and boundary

Normalization is a deterministic, explicit, opt-in transformation for the single controlled RadixScope workload. Its only goal is to render already developer-classified prompt components in a stable, safety-preserving structure so raw-versus-normalized prefix reuse can be measured honestly.

It is not:

- an LLM rewrite or prompt optimizer;
- automatic component classification;
- semantic paraphrasing, summarization or content deletion;
- a production prompt-mutation feature;
- a generic transformation/rules/plugin platform; or
- a reason to weaken system precedence, trust boundaries, history order, tool pairing or agent causality.

`RAW` means the original assembled prompt is sent byte-for-byte unchanged as the verified `/generate.text` value. The RAW branch never calls the normalizer.

`NORMALIZED` means only developer-classified eligible components are processed by policy `radixscope-normalization-v1`. The same canonical Qwen chat-template path from §5 renders the final complete prompt for both modes. The normalizer does not call SGLang and makes no claim about SGLang internals.

If any precondition, safety check, reversibility check or equivalence check is false or unknown, the result is `SKIPPED`, the returned text is exactly the original text, and the reason is visible. There is no “best effort” or silent fallback that reports normalization as applied.

---

## 47. Transformation classes

```ts
type TransformationSafety = "SAFE" | "CONDITIONALLY_SAFE" | "FORBIDDEN";
```

| Transformation | Class | MVP decision |
|---|---|---|
| Preserve an eligible component body byte-for-byte | `SAFE` | Required for every move. |
| Render assembler-owned boundaries with the fixed separator policy | `SAFE` | Allowed; separators are not component content. |
| Stable placement of eligible shared/static instructions before eligible dynamic metadata inside one movable window | `CONDITIONALLY_SAFE` | Allowed only after all §51 checks pass. |
| Stable placement of eligible agent rules before eligible dynamic metadata inside one movable window | `CONDITIONALLY_SAFE` | Allowed only after all §51 checks pass. |
| Deterministic key ordering for developer-declared strict JSON objects | `CONDITIONALLY_SAFE` | Allowed only when object semantics, reversibility and equality checks pass. Arrays never reorder. |
| Deterministic formatting of developer-declared strict JSON | `CONDITIONALLY_SAFE` | Allowed only under the fixed serializer and reversible manifest. |
| Remove an explicitly declared “non-semantic” timestamp, UUID, request ID or metadata field | `FORBIDDEN` | Declaration alone cannot prove task irrelevance; removal also violates the accepted component-content equality rule. Relocation may be considered if separately eligible. |
| Normalize whitespace, Unicode or line endings inside arbitrary text/code/YAML/Markdown | `FORBIDDEN` | These changes may alter meaning. |
| Rewrite, paraphrase, summarize, translate or redact component wording | `FORBIDDEN` | Arbitrary prompt rewriting is outside RadixScope. |
| Move/split `SYSTEM`, raise untrusted content, cross an immutable anchor, reorder history/tool pairs/requests | `FORBIDDEN` | Violates locked precedence or causality. |
| Infer eligibility or semantic role from content | `FORBIDDEN` | Classification is developer-supplied only. |

`SAFE` means the operation is permitted whenever its typed input is valid. `CONDITIONALLY_SAFE` requires every listed precondition and postcondition. `FORBIDDEN` operations have no override flag in the MVP.

---

## 48. Component contract

```ts
type PromptComponentKind =
  | "SYSTEM"
  | "SHARED_STATIC"
  | "AGENT_RULES"
  | "DYNAMIC_METADATA"
  | "TASK";

type TrustClass = "TRUSTED_INSTRUCTION" | "UNTRUSTED_CONTENT";
type MovementPolicy = "IMMUTABLE" | "ELIGIBLE";
type FormatPolicy = "PRESERVE_BYTES" | "STRICT_JSON_STABLE_V1";

interface NormalizablePromptComponent {
  id: string;
  kind: PromptComponentKind;
  body: string;
  trust: TrustClass;
  movement: MovementPolicy;
  format: FormatPolicy;
  authoredIndex: number;
  conversationIndex?: number;
  causalGroupId?: string;
  causalPredecessorIds: readonly string[];
  declaredRole?:
    | "SYSTEM_INSTRUCTIONS"
    | "TOOL_DEFINITIONS"
    | "CONVERSATION"
    | "TOOL_CALL"
    | "TOOL_RESULT"
    | "TASK"
    | "OTHER";
}
```

### 48.1 Classification rules

- Exactly one `SYSTEM` component exists, at authored index `0`. It is always trusted and immutable.
- `TASK` is always immutable and treated as untrusted content unless the fixed workload contract proves a narrower classification; it never moves in v1.
- Only `SHARED_STATIC`, `AGENT_RULES` and `DYNAMIC_METADATA` may have `movement="ELIGIBLE"`.
- A conversation turn, tool call or tool result is immutable regardless of its outer kind.
- Any component with a causal predecessor, or referenced by a later causal component, is immutable unless the workload supplies and validates an unchanged causal group whose internal order is preserved. v1 takes the conservative path and treats the whole group as an anchor.
- Missing, duplicate or contradictory classification causes `SKIPPED`; the normalizer never guesses.
- Eligibility means “may be considered,” not “will be moved.” Every safety check still applies.

Component bodies remain opaque strings except for `STRICT_JSON_STABLE_V1`, whose developer declaration authorizes strict parsing and deterministic serialization. Natural-language inspection never changes classification.

---

## 49. Explicit opt-in and outcomes

### 49.1 Request contract

```ts
interface NormalizationOption {
  enabled: boolean;
  policyVersion: "radixscope-normalization-v1";
}

interface StartBenchmarkRequest {
  normalization: NormalizationOption;
}
```

There is no server default of `true`. A missing object, missing boolean, unknown policy version or `enabled=false` does not normalize.

The one-click demo remains possible because the action is explicitly labelled **Run RAW + opt-in NORMALIZED benchmark** and sends `enabled=true`. Any generic/raw caller sends `enabled=false`. The API records the exact option; the button label and result make the opt-in visible rather than implicit.

### 49.2 Result contract

```ts
type NormalizationSkipCode =
  | "NOT_OPTED_IN"
  | "UNKNOWN_POLICY_VERSION"
  | "INVALID_CLASSIFICATION"
  | "SYSTEM_PRECEDENCE_UNPROVEN"
  | "UNTRUSTED_BOUNDARY_UNPROVEN"
  | "CONVERSATION_ORDER_UNPROVEN"
  | "TOOL_PAIRING_UNPROVEN"
  | "CAUSALITY_UNPROVEN"
  | "JSON_SEMANTICS_UNPROVEN"
  | "REVERSAL_FAILED"
  | "POSTCONDITION_FAILED"
  | "NO_SAFE_CHANGE"
  | "FORBIDDEN_TRANSFORMATION_REQUESTED"
  | "CORRECTNESS_ORACLE_UNAVAILABLE";

type NormalizationResult =
  | {
      status: "NOT_REQUESTED";
      text: string; // exact original
      policyVersion: null;
      beforeFingerprint: string;
      afterFingerprint: string; // equals before
    }
  | {
      status: "SKIPPED";
      text: string; // exact original
      policyVersion: "radixscope-normalization-v1";
      code: Exclude<NormalizationSkipCode, "NOT_OPTED_IN">;
      evidence: readonly SafeAuditEvidence[];
      beforeFingerprint: string;
      afterFingerprint: string; // equals before
    }
  | {
      status: "APPLIED";
      text: string;
      policyVersion: "radixscope-normalization-v1";
      manifest: NormalizationManifest;
      beforeFingerprint: string;
      afterFingerprint: string;
    };
```

`SKIPPED` is a successful safety decision, not an exception. If a normalized benchmark was requested and preflight returns `SKIPPED`, Express persists the outcome, does not begin the RAW/NORMALIZED flush sequence, and exposes no cache or performance comparison. The original prompt remains available to the caller for unchanged execution outside that comparison.

---

## 50. Normalized prompt-template contract

### 50.1 Movable windows

The input is first partitioned into:

- immutable anchors; and
- maximal contiguous windows containing only components whose kind is whitelisted and whose movement policy is `ELIGIBLE`.

No component crosses an immutable anchor. Within each eligible window, v1 applies a stable rank:

```text
SHARED_STATIC   -> 0
AGENT_RULES     -> 1
DYNAMIC_METADATA -> 2
```

Equal-rank components retain authored order. The proposed order is rejected if it raises untrusted content above trusted instructions or violates any declared dependency.

This yields a deterministic layout while preserving system position, task position, conversation/tool anchors and all causal request boundaries.

### 50.2 Rendering

The normalized renderer operates on complete component bodies, never token slices:

```text
output = render(component[0])
for each subsequent component:
  output += NORMALIZED_SEPARATOR
  output += render(component)

NORMALIZED_SEPARATOR = UTF8("\n\n")
```

Rules:

1. `component[0]` is the unchanged `SYSTEM` body.
2. `PRESERVE_BYTES` returns the component body exactly.
3. `STRICT_JSON_STABLE_V1` parses strict JSON, recursively sorts object keys by Unicode code-point order, preserves array order and scalar values, and emits compact UTF-8 JSON with no insignificant whitespace.
4. No trimming, Unicode normalization, case folding, newline rewriting inside preserved bodies or implicit content repair occurs.
5. The separator is assembler-owned metadata from a finite policy, not part of a component body.
6. The resulting complete string is passed once through the same verified Qwen chat-template/tokenizer path used by RAW; logical section lengths are never tokenized and added.

The RAW renderer bypasses every rule above and returns the authored complete prompt bytes unchanged.

---

## 51. Allowed transformation specifications

### NORM-T1 — Fixed assembler-owned separators

| Item | Contract |
|---|---|
| Safety | `SAFE` for boundaries already owned by the assembler; forbidden inside component bodies. |
| Preconditions | Normalization opted in; every boundary is represented separately from body text; policy version is exact. |
| Exact operation | Render one `LF LF` sequence between adjacent normalized components; no leading/trailing separator. |
| Reversal/audit | Manifest stores original boundary-policy IDs and normalized policy ID, not prompt content. |
| Safety checks | Component body fingerprints before and after rendering are identical. |
| Postconditions | Same component count and bodies; deterministic output; system remains first. |
| Failure | `SKIPPED / POSTCONDITION_FAILED`; return original bytes. |

### NORM-T2 — Stable eligible component placement

| Item | Contract |
|---|---|
| Safety | `CONDITIONALLY_SAFE`. |
| Preconditions | All components classified; the movable window contains only eligible whitelisted kinds; no history/tool/causal role; trust and dependency graph complete. |
| Exact operation | Stable-sort each window by `SHARED_STATIC`, `AGENT_RULES`, `DYNAMIC_METADATA`, then `authoredIndex`. Never sort requests or windows. |
| Reversal/audit | Manifest records original and normalized component-ID order plus explicit `MOVE` entries. Bodies are not copied into retained audit data. |
| Safety checks | No anchor crossed; no untrusted component rises above trusted instruction content; causal topological order unchanged; component multiset fingerprint unchanged. |
| Postconditions | `SYSTEM` remains index 0; immutable subsequence identical; equal-kind relative order identical; inverse order reproduces the original component sequence. |
| Failure | `SKIPPED` with the first stable safety code; return original bytes and no partial moves. |

### NORM-T3 — Stable strict-JSON rendering

| Item | Contract |
|---|---|
| Safety | `CONDITIONALLY_SAFE`. |
| Preconditions | Developer set `format=STRICT_JSON_STABLE_V1`; body parses as strict JSON; duplicate keys are rejected; fixed workload declares object-key order non-semantic. |
| Exact operation | Recursively sort object keys; preserve array order, numbers, booleans, null and string values; emit compact JSON. |
| Reversal/audit | Ephemeral reversal data records original recursive key order and the finite original formatting-policy ID. Retained audit records only fingerprints, policy ID and changed-key-order counts. |
| Safety checks | Deep parsed-value equality before/after; no numeric coercion; no duplicate key; reparse normalized output; inverse renderer reproduces the exact original structured rendering. |
| Postconditions | Parsed values are deeply equal; array sequence unchanged; deterministic normalized bytes. |
| Failure | `SKIPPED / JSON_SEMANTICS_UNPROVEN` or `REVERSAL_FAILED`; return original bytes. |

### NORM-T4 — Declared non-semantic variability removal

| Item | Contract |
|---|---|
| Safety | `FORBIDDEN` in v1, including timestamps, UUIDs and request IDs. |
| Reason | A developer label does not prove irrelevance; removal changes the component multiset/content and may break correlation or causality. |
| Safe alternative | Preserve the field. If the containing component is independently eligible and non-causal, NORM-T2 may place it after stable eligible content. |
| Failure | Any requested removal returns `SKIPPED / FORBIDDEN_TRANSFORMATION_REQUESTED`; nothing is deleted. |

### NORM-T5 — Text/content rewriting

| Item | Contract |
|---|---|
| Safety | `FORBIDDEN`. |
| Includes | Paraphrase, summarization, arbitrary whitespace cleanup, Unicode normalization, content merging/splitting, omission and LLM rewriting. |
| Failure | `SKIPPED / FORBIDDEN_TRANSFORMATION_REQUESTED`; return the original prompt unchanged. |

---

## 52. Reversal and audit representation

```ts
interface MoveAudit {
  componentId: string;
  fromIndex: number;
  toIndex: number;
  operation: "MOVE";
}

interface JsonAudit {
  componentId: string;
  policy: "STRICT_JSON_STABLE_V1";
  changedObjectCount: number;
  beforeBodyFingerprint: string;
  afterBodyFingerprint: string;
}

interface NormalizationManifest {
  version: "radixscope-normalization-manifest-v1";
  policyVersion: "radixscope-normalization-v1";
  originalOrder: readonly string[];
  normalizedOrder: readonly string[];
  moves: readonly MoveAudit[];
  jsonChanges: readonly JsonAudit[];
  originalSeparatorPolicyIds: readonly string[];
  normalizedSeparatorPolicy: "LF_LF";
  componentMultisetFingerprint: string;
  taskMeaningFingerprint: string;
  systemFingerprint: string;
  conversationOrderFingerprint: string;
  toolPairingFingerprint: string;
  causalOrderFingerprint: string;
}
```

The full reversal manifest is ephemeral while safety is proved. Redis receives the compact audit fields above; it does not receive component bodies, raw JSON, separators containing content or reverse patches containing values.

Reversal is mandatory before `APPLIED`:

```text
invert(normalizedComponents, ephemeralManifest)
  -> renderRaw(recoveredComponents)
  -> exact UTF-8 byte equality with original RAW prompt
```

If exact recovery fails, normalization is `SKIPPED`. The retained manifest is an audit summary, not a substitute for the ephemeral proof.

Fingerprints use the keyed HMAC construction from §8 with distinct domains:

```text
radixscope-normalization-prompt-v1
radixscope-normalization-component-set-v1
radixscope-normalization-task-meaning-v1
radixscope-normalization-order-v1
```

`beforeFingerprint === afterFingerprint` is expected for `NOT_REQUESTED` and `SKIPPED`. For `APPLIED`, they may differ; the component-multiset, task-meaning, system, conversation, tool-pairing and causal fingerprints must remain equal across the transformation.

`taskMeaningFingerprint` is not a semantic model. It is a keyed HMAC over the fixed workload/fixture version, unchanged TASK component bytes and ordered causal-input fingerprints. Equality proves that these declared inputs are identical; the deterministic correctness assertion in §55 provides the separate behavioral gate.

---

## 53. Safety and equivalence gates

The normalizer evaluates all gates in order and stops at the first failure:

| Order | Gate | Required assertion | Failure result |
|---:|---|---|---|
| 1 | Opt-in | `enabled === true` and exact policy version | `NOT_REQUESTED` or `SKIPPED / UNKNOWN_POLICY_VERSION` |
| 2 | Classification | IDs unique; kinds/trust/movement/format valid; only whitelist eligible | `SKIPPED / INVALID_CLASSIFICATION` |
| 3 | System | Exactly one unchanged SYSTEM at index 0 | `SKIPPED / SYSTEM_PRECEDENCE_UNPROVEN` |
| 4 | Trust | No proposed move raises untrusted content above trusted instruction content | `SKIPPED / UNTRUSTED_BOUNDARY_UNPROVEN` |
| 5 | Conversation | Ordered turn subsequence and indices unchanged | `SKIPPED / CONVERSATION_ORDER_UNPROVEN` |
| 6 | Tool pairing | Call/result identity, adjacency and relative order unchanged | `SKIPPED / TOOL_PAIRING_UNPROVEN` |
| 7 | Causality | Dependency graph identical; proposed order is the same valid topological order for immutable causal groups | `SKIPPED / CAUSALITY_UNPROVEN` |
| 8 | Content | Component IDs and content/value fingerprints form the same multiset; only approved strict-JSON representation may differ | `SKIPPED / POSTCONDITION_FAILED` |
| 9 | Reversal | Inverse reconstructs exact RAW bytes | `SKIPPED / REVERSAL_FAILED` |
| 10 | Determinism | Two independent pure evaluations produce identical text and manifest | `SKIPPED / POSTCONDITION_FAILED` |
| 11 | Workload oracle | Fixed deterministic correctness assertion is installed for the controlled task | `SKIPPED / CORRECTNESS_ORACLE_UNAVAILABLE` |

No gate mutates the input. A proposed transformation exists only in local ephemeral memory until every gate passes; therefore failure cannot leave a partially normalized prompt.

---

## 54. Pure function contracts

```ts
function validateClassification(
  components: readonly NormalizablePromptComponent[]
): AnalysisResult<ValidatedComponents>;

function partitionMovableWindows(
  components: readonly NormalizablePromptComponent[]
): readonly (ImmutableAnchor | MovableWindow)[];

function proposeStableOrder(
  validated: ValidatedComponents
): AnalysisResult<readonly NormalizablePromptComponent[]>;

function stableSerializeJson(
  component: NormalizablePromptComponent
): AnalysisResult<{ body: string; reversal: EphemeralJsonReversal }>;

function verifySafetyInvariants(
  before: ValidatedComponents,
  after: readonly NormalizablePromptComponent[]
): AnalysisResult<SafetyProof>;

function buildNormalizationManifest(
  before: ValidatedComponents,
  after: readonly NormalizablePromptComponent[],
  proof: SafetyProof,
  hmacKey: Uint8Array
): AnalysisResult<{ retained: NormalizationManifest; ephemeral: EphemeralReversalManifest }>;

function invertNormalization(
  normalized: readonly NormalizablePromptComponent[],
  manifest: EphemeralReversalManifest
): AnalysisResult<readonly NormalizablePromptComponent[]>;

function normalizePrompt(
  originalText: string,
  components: readonly NormalizablePromptComponent[],
  option: NormalizationOption,
  hmacKey: Uint8Array
): AnalysisResult<NormalizationResult>;
```

The functions have no clock, randomness, filesystem, Redis, network, SGLang or LLM dependency. Express invokes them during benchmark preflight, outside both post-flush protected windows.

---

## 55. Controlled workload correctness assertion

Structural safety is necessary but not sufficient: a normalized output must still satisfy the same fixed task.

The single workload package owns one non-extensible deterministic predicate:

```ts
type CorrectnessVerdict =
  | { status: "PASS"; checks: readonly CorrectnessCheck[] }
  | { status: "FAIL"; failedCheckIds: readonly string[] }
  | { status: "UNDECIDABLE"; reason: string };

function assertControlledWorkloadCorrectness(
  agentId: "planner" | "worker1" | "worker2",
  outputText: string,
  fixture: ControlledWorkloadFixture,
  priorAcceptedOutputs: readonly string[]
): CorrectnessVerdict;
```

The predicate is ordinary code for the one fixed demo, not a plugin or generic policy engine. Its fixture is versioned and identical for RAW and NORMALIZED. It may check only objective workload facts, for example:

- required output envelope parses;
- fixed task/fixture identifier matches;
- required fields and enumerated values are present;
- deterministic task-specific constraints pass; and
- worker references to required prior-agent artifacts match the expected causal IDs.

It does not compare RAW and NORMALIZED strings for equality, call an LLM, use embeddings or judge open-ended semantic similarity.

### 55.1 Benchmark validity rule

Every one of the six outputs must independently return `PASS` against the same fixture and appropriate prior outputs. Then the comparison gate additionally asserts:

```text
raw.taskMeaningFingerprint === normalized.taskMeaningFingerprint
raw.componentMultisetFingerprint === normalized.componentMultisetFingerprint
locked generation settings are equal
model/server fingerprint is equal
```

If either mode returns `FAIL` or `UNDECIDABLE`, the complete comparison is `INVALID / TASK_DIVERGENCE` with mode, agent and failed check IDs. This includes both modes failing: no performance improvement, speedup or winner is shown. If the deterministic predicate is unavailable before execution, normalization is `SKIPPED / CORRECTNESS_ORACLE_UNAVAILABLE` and the benchmark does not start.

Performance never overrides correctness. Higher `cached_tokens`, lower TTFT or lower latency from an incorrect normalized output is retained only as invalid-run evidence.

---

## 56. Benchmark integration

```text
PREFLIGHT
  assemble RAW once
  capture exact original bytes and safe fingerprints
  evaluate opt-in normalization in memory
  require APPLIED and all safety/reversal gates
  tokenize complete RAW and NORMALIZED prompts outside protected windows

FLUSH_RAW -> RAW planner -> worker1 -> worker2
  locked settings: temperature=0, n=1, max_new_tokens=256, concurrency=1
  no speculative decoding or MTP
  require cold first-request cached_tokens validation
  assert each output with fixed workload predicate

FLUSH_NORMALIZED -> NORMALIZED planner -> worker1 -> worker2
  identical task fixture, model, settings, sequence and correctness predicate
  require independent cold first-request validation
  assert each output

COMPARE
  only if cache validity, structural equality and all correctness verdicts pass
```

Normalization never runs between a successful flush and the first measured request. The normalizer does not retry generation, change agent order or produce a request itself.

---

## 57. Privacy and minimal separation

- Normalization executes locally inside Express; prompt/component content is not sent to any external model or service.
- The normalizer writes no prompt bodies, JSON values, reverse patches or HMAC key to Redis.
- Retained audit data consists of run-scoped opaque IDs, keyed fingerprints, counts, policy/status/skip codes and move indices.
- Existing prompt/completion retention, if explicitly enabled elsewhere, keeps the accepted 24-hour TTL and manual purge path; normalization does not expand it.
- Logs contain status, codes and keyed component fingerprints by default, never bodies or removed-field values.
- Every record remains under the existing `run:{runId}:*` namespace. No component, manifest or fingerprint from one run/session is automatically joined to another.
- Only the single-flight lock and bounded run index are global. This is minimal local session separation, not production multi-tenancy.
- The React dashboard receives the audit projection from Express by HTTP polling and never receives ephemeral reversal data or calls SGLang directly.

---

## 58. Decision examples

### 58.1 Applied: eligible window

```text
Authored:
  SYSTEM [immutable]
  DYNAMIC_METADATA [eligible, non-causal]
  SHARED_STATIC [eligible]
  AGENT_RULES [eligible]
  TASK [immutable]

Normalized:
  SYSTEM
  SHARED_STATIC
  AGENT_RULES
  DYNAMIC_METADATA
  TASK
```

All three moved components are in one eligible window, no anchor is crossed, bodies are unchanged, system/task remain fixed and reversal succeeds. Result: `APPLIED`.

### 58.2 Skipped: immutable conversation anchor

```text
SYSTEM
DYNAMIC_METADATA [eligible]
TOOL_RESULT [immutable causal anchor]
SHARED_STATIC [eligible]
TASK
```

The static component cannot cross the tool result. Each one-element window remains unchanged. If no approved representation-only change applies, result: `SKIPPED / NO_SAFE_CHANGE` with explanation “no safe normalization change,” and original bytes are returned.

### 58.3 Skipped: trust inversion

A proposed order would place untrusted retrieved text above trusted agent rules. Result: `SKIPPED / UNTRUSTED_BOUNDARY_UNPROVEN`; no partial move.

### 58.4 Applied: strict JSON key order

Input component is developer-declared strict JSON object with order `{"z":1,"a":2}`. Deep value equality, duplicate-key rejection and reversal pass. Normalized representation is `{"a":2,"z":1}`. Arrays, strings and numbers are unchanged. Result: `APPLIED`.

### 58.5 Forbidden: “non-semantic” deletion

A timestamp field is developer-labelled non-semantic. v1 still preserves it because deletion would change component content. If its component is eligible and non-causal, it may move later under NORM-T2; otherwise it stays authored. A request to delete it returns `SKIPPED / FORBIDDEN_TRANSFORMATION_REQUESTED`.

### 58.6 Invalid despite faster metrics

NORMALIZED reports more cached tokens and lower latency, but worker2 fails the fixed task assertion. The comparison is `INVALID / TASK_DIVERGENCE`; metrics remain evidence and no improvement claim is rendered.

---

## 59. Tests and acceptance criteria

### NORM-A1 — RAW bypass

With normalization absent or disabled, M6 is not called and `/generate.text` is byte-identical to the original prompt.

### NORM-A2 — Explicit opt-in

Only the explicitly labelled benchmark action sends `enabled=true`. Missing/false returns `NOT_REQUESTED`; an unknown version returns visible `SKIPPED`.

### NORM-A3 — Determinism

Two calls with identical input, key and policy produce identical text, fingerprints and manifests.

### NORM-A4 — System precedence

Moving, splitting, changing or prefixing content above SYSTEM yields `SKIPPED`. SYSTEM remains exact at index 0 in every applied case.

### NORM-A5 — Eligibility whitelist

Only eligible `SHARED_STATIC`, `AGENT_RULES` and `DYNAMIC_METADATA` enter movable windows. Marking SYSTEM, TASK, conversation or tool content eligible is invalid classification.

### NORM-A6 — Stable order

Within one eligible window, kinds sort by the fixed rank and equal-kind components preserve authored order.

### NORM-A7 — Anchor boundary

No component crosses TASK, conversation, tool or other immutable anchor, even if crossing would create a longer prefix.

### NORM-A8 — Trust boundary

Any proposal that raises untrusted content above trusted instructions is skipped and returns original bytes.

### NORM-A9 — Conversation and tool order

Ordered conversation indices, call/result adjacency and causal-group fingerprints are identical before and after.

### NORM-A10 — Component content

Every `PRESERVE_BYTES` body fingerprint remains identical. Adding, deleting, merging or splitting a component fails the postcondition.

### NORM-A11 — Strict JSON

Object keys sort recursively; arrays retain order; duplicate keys, non-strict JSON, numeric coercion or deep-value inequality skip normalization.

### NORM-A12 — Removal forbidden

An explicitly non-semantic timestamp/UUID/request-ID deletion request is skipped; the original value remains in the prompt.

### NORM-A13 — Reversal

For every applied transformation, inverse rendering reproduces the exact original UTF-8 bytes. A one-byte mismatch yields `REVERSAL_FAILED`.

### NORM-A14 — Skip atomicity

Every failed gate returns the exact original prompt, `beforeFingerprint === afterFingerprint`, no move manifest and one visible skip code.

### NORM-A15 — Complete-prompt tokenization

RAW and NORMALIZED final prompts are each tokenized once as complete strings through the same verified tokenizer/template identity. No logical section token lengths are summed.

### NORM-A16 — Locked benchmark settings

Both modes record `temperature=0`, `n=1`, `max_new_tokens=256`, `concurrency=1`, speculative decoding/MTP off. Any drift invalidates comparison.

### NORM-A17 — Independent cold starts

Each mode is immediately preceded by a successful verified flush and first-request `cached_tokens` tolerance check. A warm first request invalidates the benchmark.

### NORM-A18 — Correctness oracle required

No deterministic workload predicate means normalization is skipped before execution. No string-equality, LLM or embedding fallback is used.

### NORM-A19 — Task failure suppresses performance claim

If any RAW or NORMALIZED agent output is `FAIL`/`UNDECIDABLE`, comparison is invalid and speedup/improvement/winner fields are absent even when normalized metrics are better.

### NORM-A20 — Privacy

Redis and default logs contain no component bodies, JSON values, reversal patches or HMAC key; retained audit data is run-scoped and bounded.

### NORM-A21 — No silent normalization

Every response has `NOT_REQUESTED`, `SKIPPED` or `APPLIED`, a policy version where applicable, and before/after fingerprints. The dashboard shows the status and skip reason.

### NORM-A22 — Architecture scope

The implementation is pure code inside the existing Express application. It adds no LLM, embeddings, external service, gateway, router, WebSocket/SSE, section mapper, cache tree or automatic production mutation path.

---

## 60. Normalization implementation checklist

- [ ] RAW bypasses the normalizer and preserves exact authored bytes.
- [ ] Normalization requires the explicit v1 opt-in and always reports its outcome.
- [ ] Only developer-classified eligible whitelist components may move.
- [ ] Partition by immutable anchors; never move across a boundary.
- [ ] Preserve SYSTEM at index 0 and prevent trust inversion.
- [ ] Preserve conversation, tool-call/result, request and causal order.
- [ ] Keep component wording and meaningful information unchanged.
- [ ] Forbid removal of timestamps, UUIDs, request IDs and metadata in v1.
- [ ] Limit format stabilization to strict declared JSON and assembler separators.
- [ ] Prove deep value equality, determinism and exact reversal before `APPLIED`.
- [ ] Retain only compact run-scoped audit evidence and keyed fingerprints.
- [ ] Run normalization/tokenization before protected cache windows.
- [ ] Require identical model, task fixture and locked generation settings.
- [ ] Require all deterministic workload correctness checks to pass.
- [ ] Suppress performance claims for skipped, invalid or incorrect comparisons.
- [ ] Add no generic framework or non-MVP infrastructure.
