/**
 * M4 — Workload generator
 *
 * Produces the fixed planner → worker1 → worker2 agent sequence.
 * Deterministic. Owns agent causality.
 * F-2, F-6, S-5.
 *
 * NOTE: Prompt content here is a placeholder scaffold.
 * Full task content will be defined per docs/spec/workload.md (incoming).
 */

import type { AgentId, PromptComponent } from '../contracts';

// F-2: Exactly three agents in this fixed order
export const AGENT_SEQUENCE: readonly AgentId[] = Object.freeze([
  'planner',
  'worker1',
  'worker2',
] as const);

export function agentSequence(): readonly AgentId[] {
  return AGENT_SEQUENCE;
}

// ─── Fixed task definition ────────────────────────────────────────────────────
// SYSTEM block is always first and never moves (S-1)
const SYSTEM_BLOCK = `You are a helpful AI assistant participating in a multi-agent workflow. Follow instructions precisely and maintain consistency across agents.`;

// Shared across all agents — eligible for normalization (SHARED_STATIC)
const SHARED_STATIC_BLOCK = `## Workflow Rules
- Agents communicate sequentially. Earlier agent outputs are available as context.
- Be concise and precise in your responses.
- Do not repeat information already provided by previous agents.`;

// Per-agent rules — eligible for normalization (AGENT_RULES)
const AGENT_RULES: Record<AgentId, string> = {
  planner: `## Planner Agent Rules
- Decompose the task into clear sub-tasks.
- Identify dependencies between sub-tasks.
- Output a structured plan that worker agents can follow.`,

  worker1: `## Worker 1 Agent Rules
- Execute the first sub-task from the planner's plan.
- Be thorough and self-contained in your output.
- Reference the planner's output explicitly.`,

  worker2: `## Worker 2 Agent Rules
- Execute the second sub-task from the planner's plan.
- Build upon Worker 1's output where relevant.
- Provide a final synthesis or conclusion.`,
};

// The fixed task — TASK kind, never movable (S-2)
const TASK_BLOCK = `## Task
Analyse the following scenario and produce a structured response:

A software team is experiencing a 30% increase in bug reports following their latest deployment. 
The deployment included 47 commits across 12 files, a database schema migration, and a third-party 
library upgrade. Customers report intermittent failures in the checkout flow.

Planner: identify the most likely root causes and create a 3-step investigation plan.
Worker 1: execute investigation step 1 (examine the most likely cause).
Worker 2: execute investigation step 2 and synthesize findings into a remediation recommendation.`;

// ─── componentsFor ────────────────────────────────────────────────────────────
// Produces the component list for a given agent, including conversation history.
// F-6: Worker agents receive previous outputs as DYNAMIC_METADATA.
export function componentsFor(
  agentId: AgentId,
  conversation: ConversationState
): PromptComponent[] {
  const components: PromptComponent[] = [];

  // S-1: SYSTEM always first
  components.push({
    id: `system`,
    kind: 'SYSTEM',
    content: SYSTEM_BLOCK,
  });

  // SHARED_STATIC — eligible for normalization
  components.push({
    id: `shared_static`,
    kind: 'SHARED_STATIC',
    content: SHARED_STATIC_BLOCK,
  });

  // AGENT_RULES for this agent — eligible for normalization
  components.push({
    id: `agent_rules_${agentId}`,
    kind: 'AGENT_RULES',
    content: AGENT_RULES[agentId],
  });

  // DYNAMIC_METADATA: previous agent outputs — eligible for normalization
  // F-6: Agent causality — previous completions injected here
  if (agentId === 'worker1' && conversation.plannerOutput) {
    components.push({
      id: `dynamic_planner_output`,
      kind: 'DYNAMIC_METADATA',
      content: `## Planner Output\n${conversation.plannerOutput}`,
    });
  }

  if (agentId === 'worker2') {
    if (conversation.plannerOutput) {
      components.push({
        id: `dynamic_planner_output`,
        kind: 'DYNAMIC_METADATA',
        content: `## Planner Output\n${conversation.plannerOutput}`,
      });
    }
    if (conversation.worker1Output) {
      components.push({
        id: `dynamic_worker1_output`,
        kind: 'DYNAMIC_METADATA',
        content: `## Worker 1 Output\n${conversation.worker1Output}`,
      });
    }
  }

  // TASK — never movable (S-2)
  components.push({
    id: `task`,
    kind: 'TASK',
    content: TASK_BLOCK,
  });

  return components;
}

// ─── Conversation state ────────────────────────────────────────────────────────
// Runner passes this to maintain agent causality (F-6, S-5)
export interface ConversationState {
  plannerOutput?: string;
  worker1Output?: string;
}

export function initialConversationState(): ConversationState {
  return {};
}

export function updateConversation(
  state: ConversationState,
  agentId: AgentId,
  output: string
): ConversationState {
  return {
    ...state,
    ...(agentId === 'planner' ? { plannerOutput: output } : {}),
    ...(agentId === 'worker1' ? { worker1Output: output } : {}),
  };
}
