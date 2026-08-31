/**
 * @file incident-generator.ts
 * Deterministic ID generation and incident constructor helpers.
 */

import { createHash, randomBytes } from "node:crypto";
import type { BehavioralForensicsIncident, ForensicsSeverity, RootCauseCategory } from "./types.ts";

export const REMEDIATION_DIRECTIVES: Readonly<Record<RootCauseCategory, string>> = {
  TOKEN_BURNING:
    "Generate Exact-Anchor task briefings with explicit file targets, line ranges, and drop-in replacement chunks prior to dispatching implementers.",
  FALSE_SERIALIZATION:
    "Batch all ready tasks with disjoint write scopes into concurrent execution waves rather than serializing them.",
  ROLE_BOUNDARY_DEVIATION:
    "Prohibit supervisory and validator roles from executing unauthorized commands or direct code modifications.",
  POLLING_WASTE:
    "Configure WaitMsBeforeAsync: 10000 on command calls and end turns to receive automatic reactive resume notifications.",
  CONTEXT_OVERFLOW:
    "Quiesce saturated agents, truncate verbose outputs, and rotate context windows before token limits are breached.",
  GHOST_LEASE:
    "Enforce automatic lease reclamation and heartbeat expiration to reset orphaned tasks to ready status.",
  STRAGGLER:
    "Decompose complex, long-running tasks into smaller, granular work units targeting 1-2 files.",
} as const;

export function generateIncidentId(category: RootCauseCategory, target: string): string {
  const hash = createHash("sha256").update(`${category}:${target}`).digest("hex").slice(0, 8);
  return `inc-${category.toLowerCase().replace(/_/g, "-")}-${hash}`;
}

export function generateProposalId(category: RootCauseCategory, discriminator?: string): string {
  const seed = discriminator
    ? `${category}:${discriminator}`
    : `${category}:${randomBytes(4).toString("hex")}`;
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 8);
  return `prop-${category.toLowerCase().replace(/_/g, "-")}-${hash}`;
}

export function createIncident(options: {
  readonly category: RootCauseCategory;
  readonly target: string;
  readonly title: string;
  readonly observation: string;
  readonly severity?: ForensicsSeverity | undefined;
  readonly remediation?: string | undefined;
  readonly agentId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly toolCallsCount?: number | undefined;
  readonly metricsSnapshot?: Readonly<Record<string, number | string>> | undefined;
}): BehavioralForensicsIncident {
  const {
    category,
    target,
    title,
    observation,
    severity = "MEDIUM",
    remediation = REMEDIATION_DIRECTIVES[category],
    agentId,
    taskId,
    toolCallsCount,
    metricsSnapshot,
  } = options;

  return {
    id: generateIncidentId(category, target),
    category,
    severity,
    title,
    observation,
    description: observation,
    remediation,
    recommendation: remediation,
    agentId,
    taskId,
    toolCallsCount,
    metricsSnapshot,
  };
}
