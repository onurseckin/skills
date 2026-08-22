export type CognitivePillarId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SupervisoryRole = "mind" | "orchestrator" | "coordinator";

export interface CognitivePillar {
  readonly id: CognitivePillarId;
  readonly code: string;
  readonly title: string;
  readonly shortSummary: string;
  readonly description: string;
  readonly keyInvariants: readonly string[];
  readonly selfAuditQuestion: string;
  readonly supervisoryImplications: Readonly<Record<SupervisoryRole, string>>;
}

export const COGNITIVE_PILLARS_COUNT = 7;

export const PILLAR_1_CLI_FIRST: CognitivePillar = {
  id: 1,
  code: "CLI_FIRST_TOKEN_LEVERAGE",
  title: "CLI-First Token Leverage",
  shortSummary:
    "Prevent context compaction and token bloat via powerful structured CLI tooling and zero-token CLI GPS action-chaining.",
  description:
    "Never dump raw harness files or massive source dumps into agent context. Execute targeted high-density CLI verbs with strict JSON output or bounded markdown briefs, relying on actionable Next Actions footers for deterministic, zero-overhead navigation.",
  keyInvariants: [
    "Never read harness source code directly; rely exclusively on CLI commands and structured output.",
    "Prevent token bloat and context compaction by using structured commands with strict line limiters.",
    "Follow zero-token CLI GPS action-chaining recommendations provided in command footers.",
  ],
  selfAuditQuestion:
    "Am I leveraging high-density structured CLI tools and GPS action chains rather than bloating context with raw source files?",
  supervisoryImplications: {
    mind: "Synthesize multi-pulse state via `mind:observe` and `mind:pulse` instead of polling raw files.",
    orchestrator:
      "Drive multi-round oversight via `run:status`, `summary:export`, and `dag:view` without raw reads.",
    coordinator:
      "Manage wave execution and task dispatching via `queue:wave`, `plan:compile`, and `task:release`.",
  },
};

export const PILLAR_2_VISUAL_TRUTH: CognitivePillar = {
  id: 2,
  code: "VISUAL_TRUTH_AND_RADICAL_OBSERVABILITY",
  title: "Visual Truth & Radical Observability",
  shortSummary:
    "Enforce Unicode boxed DAGs, active coordinates, Sugiyama visualizers, and quantitative APCA/DOM layout measurements over superficial claims.",
  description:
    "Never accept vague, subjective, or qualitative assertions of correctness. Maintain radical observability into active execution topology via live ASCII/Unicode boxed DAGs (`dag:view`) and enforce rigorous quantitative proof (DOM bounding boxes, APCA contrast, screenshot bytes > 1024B) for all artifacts.",
  keyInvariants: [
    "Inspect live ASCII/Unicode execution DAGs (`dag:view`) to observe topological bottlenecks and wave progression.",
    "Require quantitative proofs (DOM element bounds, APCA Lc contrast ratings, screenshot byte proofs > 1024B) for all UI/visual tasks.",
    "Reject qualitative-only or superficial validation passes lacking concrete evidence artifacts.",
  ],
  selfAuditQuestion:
    "Am I demanding concrete visual and quantitative proof (DAG topology, APCA metrics, screenshot bytes) rather than accepting qualitative assertions?",
  supervisoryImplications: {
    mind: "Continuously inspect global execution topology and bottleneck coordinates across active pulses.",
    orchestrator:
      "Monitor wave critical path length, tool assignments, and parallelization headroom across rounds.",
    coordinator:
      "Mandate the 4-Tier Viewport Resolution Matrix and strictly validate evidence artifact sizes before signing off.",
  },
};

export const PILLAR_3_THREAD_AUTHORITY: CognitivePillar = {
  id: 3,
  code: "THREAD_AUTHORITY_AND_ZERO_MAIN_THREAD_SPILLOVER",
  title: "Thread Authority & Zero Main-Thread Spillover",
  shortSummary:
    "Strict 4-tier hierarchy and zero main-thread implementation spillover. Mind and Orchestrator coordinate; workers implement; releases commit on background threads.",
  description:
    "Maintain unbreakable role confinement across the 4 execution tiers (Tier 0 Mind, Tier 1 Orchestrator, Tier 2 Coordinator, Tier 3 Workers). Interactive main threads and supervisory leads must never edit repository code directly, and final git release operations occur strictly on dedicated background threads.",
  keyInvariants: [
    "Interactive main thread / supervisory leads must NEVER write, edit, stage, format, or delete repository files.",
    "Respect strict 4-Tier hierarchy: Mind (T0) -> Orchestrator (T1) -> Coordinator (T2) -> Workers (T3). Never skip tiers or cross-spawn.",
    "Execute final git commits, git pushes, and global sync (`scripts/sync-global.ts`) strictly on background worker/orchestrator threads.",
  ],
  selfAuditQuestion:
    "Am I strictly honoring my tier authority boundaries and ensuring zero code edits or git mutations on supervisory/main threads?",
  supervisoryImplications: {
    mind: "Maintain observe-only human shell role without claiming tasks or executing file edits directly.",
    orchestrator:
      "Dispatch only Tier 2 Coordinators; execute final release commits, git pushes, and global sync on background threads.",
    coordinator:
      "Dispatch only Tier 3 workers; never implement, repair, or mutate code files directly on the coordinator thread.",
  },
};

export const PILLAR_4_PERPETUAL_SELF_EVOLUTION: CognitivePillar = {
  id: 4,
  code: "PERPETUAL_SELF_EVOLUTION",
  title: "Perpetual Self-Evolution",
  shortSummary:
    "Autonomous candidate discovery, proactive refactoring, and self-repair loops whenever tasks converge or system becomes idle.",
  description:
    "Never passively stop or idle when active task queues empty. The system continuously evaluates architecture, test stability, documentation integrity, and capability gaps, admitting structured improvement proposals and cycling generations seamlessly.",
  keyInvariants: [
    "When execution queues empty or converge, autonomously discover improvement candidates rather than idling.",
    "Continuously audit architectural debt, test flakiness, invariant gaps, and documentation drift.",
    "Immutably preserve charter configuration, historical audit trails, and lineage across generational rotations (`mind:rotate`).",
  ],
  selfAuditQuestion:
    "Am I actively pursuing perpetual self-evolution and candidate discovery rather than passively halting upon task completion?",
  supervisoryImplications: {
    mind: "Run perpetual autonomic candidate discovery via `mind:candidate` and `smart-task:plan` when execution quiesces.",
    orchestrator:
      "Chain finished rounds into fresh planning cycles when unresolved findings or evolutionary opportunities exist.",
    coordinator:
      "Identify blocked dependencies, orphan evidence, and repair candidates during wave execution.",
  },
};

export const PILLAR_5_GRAPH_INTEROPERABILITY: CognitivePillar = {
  id: 5,
  code: "GRAPH_VISUALIZER_UI_AND_EXTERNAL_INTEROPERABILITY",
  title: "Graph Visualizer UI & External Interoperability",
  shortSummary:
    "Provide rich DAG visualizer interfaces, open export schemas (JSON/DOT/Mermaid/ASCII), and multi-host platform adapter interoperability.",
  description:
    "Structure execution topologies, task graphs, and artifact outputs for seamless interoperability across heterogeneous host environments (Antigravity, Claude Code, Cursor, Codex) and multiple visualization formats.",
  keyInvariants: [
    "Export execution DAGs into standard interoperable formats (JSON graph, DOT graphviz, Mermaid, ASCII boxed tables).",
    "Maintain platform-agnostic subagent dispatch compatible with diverse host agent runtimes.",
    "Ensure capture evaluation, headless browser runners, and diagnostic reports adhere to unified schemas.",
  ],
  selfAuditQuestion:
    "Are execution graphs and agent artifacts exportable, visualizable, and interoperable across host platforms?",
  supervisoryImplications: {
    mind: "Enable multi-host runtime awareness and external tooling bridges across execution platforms.",
    orchestrator:
      "Export complete run graphs, dependency traces, and multi-round summary reports in standard formats.",
    coordinator:
      "Render visual wave DAGs and maintain clean packet contracts for worker subagents.",
  },
};

export const PILLAR_6_FIRST_PRINCIPLES: CognitivePillar = {
  id: 6,
  code: "FIRST_PRINCIPLES_INNOVATION_AND_RADICAL_SIMPLIFICATION",
  title: "First-Principles Innovation & Radical Simplification",
  shortSummary:
    "Relentless self-questioning loop: 'How can this system be made simpler, better, faster, more visual, more token-efficient, and higher quality?'",
  description:
    "Constantly challenge legacy assumptions, eliminating redundant abstraction layers, repetitive ceremony, and token waste. Synthesize first-principles breakthroughs such as Sugiyama layered visualizers, zero-token CLI GPS action-chaining, and recursive graph schedulers.",
  keyInvariants: [
    "Constantly challenge unnecessary abstraction, ceremony, and bloat from first principles.",
    "Synthesize breakthroughs: Sugiyama layered visualizers, zero-token CLI GPS action-chaining, recursive DAG schedulers.",
    "Radically reduce cognitive friction and latency for both autonomous agents and human collaborators.",
  ],
  selfAuditQuestion:
    "Am I questioning assumptions and seeking radical simplification to make the architecture simpler, faster, and higher quality?",
  supervisoryImplications: {
    mind: "Continuously evaluate first-principles simplifications for the entire autonomous consciousness engine.",
    orchestrator:
      "Optimize round structure and remove redundant cross-round synthesis overhead.",
    coordinator:
      "Eliminate serial scheduling bottlenecks and streamline task graph compilation.",
  },
};

export const PILLAR_7_INFINITE_CADENCE: CognitivePillar = {
  id: 7,
  code: "INFINITE_BORDERLESS_CADENCE_AND_TOPOLOGICAL_CONCURRENCY",
  title: "Infinite Borderless Cadence & Topological Concurrency",
  shortSummary:
    "Operate indefinitely without artificial pulse caps or budget refusal ladders, dynamically scaling concurrency to Work/Span math (P = W / S).",
  description:
    "The autonomous system executes continuously as an infinite consciousness loop until explicit human OS termination. Parallel subagent concurrency dynamically scales with the topological Work/Span parallelism factor ($P = W / S$), eliminating artificial daily limits or refusal walls.",
  keyInvariants: [
    "Autonomous consciousness loop operates continuously without artificial daily limits or refusal walls.",
    "Dynamically scale parallel subagent dispatch according to theoretical Work/Span concurrency (P = W / S).",
    "Eliminate serial bottlenecks by deploying dedicated parallel domain coordinators when disjoint scopes exist.",
  ],
  selfAuditQuestion:
    "Am I driving continuous execution at maximum topological concurrency (P = W / S) without artificial hesitation?",
  supervisoryImplications: {
    mind: "Maintain non-stop supervisory pulse cadence across arbitrary run lengths.",
    orchestrator:
      "Deploy parallel domain coordinators (`coordinator-<domain>`) when write scopes are disjoint.",
    coordinator:
      "Saturate available concurrency slots by dispatching full independent wave arrays simultaneously.",
  },
};

export const COGNITIVE_PILLARS: readonly CognitivePillar[] = [
  PILLAR_1_CLI_FIRST,
  PILLAR_2_VISUAL_TRUTH,
  PILLAR_3_THREAD_AUTHORITY,
  PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  PILLAR_5_GRAPH_INTEROPERABILITY,
  PILLAR_6_FIRST_PRINCIPLES,
  PILLAR_7_INFINITE_CADENCE,
] as const;

export const COGNITIVE_PILLARS_MAP: Readonly<Record<CognitivePillarId, CognitivePillar>> = {
  1: PILLAR_1_CLI_FIRST,
  2: PILLAR_2_VISUAL_TRUTH,
  3: PILLAR_3_THREAD_AUTHORITY,
  4: PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  5: PILLAR_5_GRAPH_INTEROPERABILITY,
  6: PILLAR_6_FIRST_PRINCIPLES,
  7: PILLAR_7_INFINITE_CADENCE,
};

export const COGNITIVE_PILLARS_BY_CODE: Readonly<Record<string, CognitivePillar>> = {
  CLI_FIRST_TOKEN_LEVERAGE: PILLAR_1_CLI_FIRST,
  VISUAL_TRUTH_AND_RADICAL_OBSERVABILITY: PILLAR_2_VISUAL_TRUTH,
  THREAD_AUTHORITY_AND_ZERO_MAIN_THREAD_SPILLOVER: PILLAR_3_THREAD_AUTHORITY,
  PERPETUAL_SELF_EVOLUTION: PILLAR_4_PERPETUAL_SELF_EVOLUTION,
  GRAPH_VISUALIZER_UI_AND_EXTERNAL_INTEROPERABILITY: PILLAR_5_GRAPH_INTEROPERABILITY,
  FIRST_PRINCIPLES_INNOVATION_AND_RADICAL_SIMPLIFICATION: PILLAR_6_FIRST_PRINCIPLES,
  INFINITE_BORDERLESS_CADENCE_AND_TOPOLOGICAL_CONCURRENCY: PILLAR_7_INFINITE_CADENCE,
};

export function getAllCognitivePillars(): readonly CognitivePillar[] {
  return COGNITIVE_PILLARS;
}

export function getCognitivePillar(identifier: number | string): CognitivePillar | undefined {
  if (typeof identifier === "number") {
    if (identifier >= 1 && identifier <= 7) {
      return COGNITIVE_PILLARS_MAP[identifier as CognitivePillarId];
    }
    return undefined;
  }

  const trimmed = identifier.trim();
  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= 7) {
    return COGNITIVE_PILLARS_MAP[numeric as CognitivePillarId];
  }

  const upper = trimmed.toUpperCase().replaceAll("-", "_");
  if (upper in COGNITIVE_PILLARS_BY_CODE) {
    return COGNITIVE_PILLARS_BY_CODE[upper];
  }

  const normalized = trimmed.toLowerCase();
  for (const pillar of COGNITIVE_PILLARS) {
    if (
      pillar.title.toLowerCase().includes(normalized) ||
      pillar.code.toLowerCase().includes(normalized) ||
      `pillar ${pillar.id}`.toLowerCase() === normalized ||
      `pillar-${pillar.id}`.toLowerCase() === normalized
    ) {
      return pillar;
    }
  }

  return undefined;
}

export function getPillarAuditQuestions(role?: SupervisoryRole): readonly string[] {
  if (!role) {
    return COGNITIVE_PILLARS.map((p) => p.selfAuditQuestion);
  }

  return COGNITIVE_PILLARS.map((p) => {
    const roleSpecific = p.supervisoryImplications[role];
    return `Pillar ${p.id} (${p.title}): ${p.selfAuditQuestion} [${role.toUpperCase()} mandate: ${roleSpecific}]`;
  });
}

export function formatPillarsMarkdown(options?: {
  readonly supervisoryRole?: SupervisoryRole | undefined;
  readonly compact?: boolean | undefined;
}): string {
  const role = options?.supervisoryRole;
  const compact = options?.compact ?? false;

  const lines: string[] = [];
  lines.push("### 🧠 The 7 Cognitive Pillars");
  lines.push("");

  for (const pillar of COGNITIVE_PILLARS) {
    lines.push(`#### Pillar ${pillar.id}: ${pillar.title}`);
    lines.push(`*${pillar.shortSummary}*`);

    if (!compact) {
      lines.push("");
      lines.push(`${pillar.description}`);
      lines.push("");
      lines.push("**Key Invariants:**");
      for (const inv of pillar.keyInvariants) {
        lines.push(`- 🔷 ${inv}`);
      }
      lines.push("");
      lines.push(`**Reflexive Audit Question:** "${pillar.selfAuditQuestion}"`);
      if (role) {
        lines.push("");
        lines.push(`**${role.toUpperCase()} Mandate:** ${pillar.supervisoryImplications[role]}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function formatPillarsBrief(): string {
  return COGNITIVE_PILLARS.map((p) => `- **Pillar ${p.id} (${p.title})**: ${p.shortSummary}`).join(
    "\n",
  );
}
