/**
 * @file plan-injection.ts
 * Autonomous remediation proposal synthesizer and plan auto-injection logic.
 */

import { generateProposalId, REMEDIATION_DIRECTIVES } from "./incident-generator.ts";
import type {
  BehavioralForensicsIncident,
  FeedbackCategory,
  FeedbackPriority,
  PlanInjectionProposal,
  RootCauseCategory,
} from "./types.ts";

export interface ProposalMetadata {
  readonly priority: FeedbackPriority;
  readonly category: FeedbackCategory;
  readonly title: string;
  readonly defaultTargetRole: string;
  readonly contentTemplate: string;
}

export const PROPOSAL_TEMPLATES: Readonly<Record<RootCauseCategory, ProposalMetadata>> = {
  TOKEN_BURNING: {
    priority: "HIGH_ARCHITECTURAL_FEATURE",
    category: "CORE_ENGINE",
    title: "Enforce Zero-Exploration Exact-Anchor Briefings for Task Implementers",
    defaultTargetRole: "coordinator",
    contentTemplate:
      "Forensics identified excessive exploratory reads (>5 browsed files before first edit or high read/write ratio). Enforce exact line ranges, symbol locations, and drop-in code chunks in task briefings to ensure zero-exploration single-turn edits.",
  },
  FALSE_SERIALIZATION: {
    priority: "HIGH_ARCHITECTURAL_FEATURE",
    category: "SCALING",
    title: "Maximize Parallel Wave Concurrency for Disjoint Write Scopes",
    defaultTargetRole: "coordinator",
    contentTemplate:
      "Forensics detected sequential execution of independent tasks that possessed disjoint write scopes. Implement wave-based concurrency to dispatch independent tasks in parallel waves.",
  },
  ROLE_BOUNDARY_DEVIATION: {
    priority: "CRITICAL_USER_FEEDBACK",
    category: "AGENT_CONTRACTS",
    title: "Enforce Supervisory Role Boundary Guardrails & Tool Prohibitions",
    defaultTargetRole: "coordinator",
    contentTemplate:
      "Forensics detected role boundary deviations (such as coordinators editing codebase files directly or cognitive validators executing commands). Enforce strict tool and lease isolation.",
  },
  POLLING_WASTE: {
    priority: "HIGH_ARCHITECTURAL_FEATURE",
    category: "CLI_TOOLING",
    title: "Mandate Standard Async WaitMsBeforeAsync: 10000 to Eliminate Polling Waste",
    defaultTargetRole: "implementer",
    contentTemplate:
      "Forensics detected high-frequency status polling loops. Mandate WaitMsBeforeAsync: 10000 across all tool calls and utilize reactive wakeup notifications instead of active poll loops.",
  },
  CONTEXT_OVERFLOW: {
    priority: "HIGH_ARCHITECTURAL_FEATURE",
    category: "CORE_ENGINE",
    title: "Implement Stream Chunking and Context Truncation for Subagents",
    defaultTargetRole: "orchestrator",
    contentTemplate:
      "Forensics detected token context saturation or oversized event payloads exceeding safety thresholds. Implement rigorous token caps and stream pruning.",
  },
  GHOST_LEASE: {
    priority: "NORMAL",
    category: "WATCHDOG",
    title: "Enforce Automatic Lease Expiration and Idle Task Reclaim",
    defaultTargetRole: "watchdog",
    contentTemplate:
      "Forensics detected ghost leases where tasks were claimed but remained idle without code modifications. Enforce heartbeat deadlines and automated reclamation.",
  },
  STRAGGLER: {
    priority: "NORMAL",
    category: "ARCHITECTURE",
    title: "Enforce Granular Task Decomposition to Eliminate Straggler Spans",
    defaultTargetRole: "orchestrator",
    contentTemplate:
      "Forensics detected straggler tasks that disproportionately dominated the execution span. Enforce strict task decomposition to 1-2 files per work unit.",
  },
};

export function synthesizePlanInjectionProposals(
  incidents: readonly BehavioralForensicsIncident[],
): readonly PlanInjectionProposal[] {
  const proposals: PlanInjectionProposal[] = [];
  const incidentsByCategory = new Map<RootCauseCategory, BehavioralForensicsIncident[]>();

  for (const inc of incidents) {
    const existing = incidentsByCategory.get(inc.category);
    if (existing) {
      existing.push(inc);
    } else {
      incidentsByCategory.set(inc.category, [inc]);
    }
  }

  for (const [category, incidentGroup] of incidentsByCategory.entries()) {
    const template = PROPOSAL_TEMPLATES[category];
    const incidentIds = incidentGroup.map((i) => i.id);
    const targetAgent = incidentGroup.find((i) => Boolean(i.agentId))?.agentId;
    const targetRole = targetAgent ? targetAgent : template.defaultTargetRole;

    proposals.push({
      id: generateProposalId(category, incidentIds[0]),
      title: template.title,
      content: template.contentTemplate,
      priority: template.priority,
      category: template.category,
      rootCause: category,
      targetRole,
      targetAgent,
      remediationDirective: REMEDIATION_DIRECTIVES[category],
      metadata: {
        incidentIds,
        incidentCount: incidentGroup.length,
        severities: incidentGroup.map((i) => i.severity),
      },
    });
  }

  return proposals;
}

export function serializeProposalsToFeedbackJson(
  proposals: readonly PlanInjectionProposal[],
): string {
  return JSON.stringify(
    proposals.map((p) => ({
      id: p.id,
      priority: p.priority,
      category: p.category,
      title: p.title,
      directive: p.remediationDirective,
      target_role: p.targetRole,
      root_cause: p.rootCause,
      metadata: p.metadata,
    })),
    null,
    2,
  );
}
