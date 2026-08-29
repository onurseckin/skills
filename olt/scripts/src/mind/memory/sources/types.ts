import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CommandSpec } from "../../../cli/registry/types.ts";
import { findCommand } from "../../../cli/registry/index.ts";
import type { EvidenceClass } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../../core/shared/paths.ts";

export type { EvidenceClass } from "../../../core/contracts/index.ts";

export type MindSourceId =
  | "intent-drift"
  | "unused-code"
  | "literal-fallbacks"
  | "open-findings"
  | "escalated-tasks"
  | "failing-gates"
  | "capsule-integrity"
  | "install-drift"
  | "unsealed-capsules"
  | "charter-backlog";

export interface MindSourceDefinition {
  readonly id: MindSourceId;
  readonly number: number;
  readonly name: string;
  readonly description: string;
  readonly registryCommand: string;
  readonly canonicalInvocation: string;
  readonly empiricalEvidenceCommand: string;
  readonly revalidationGate: string;
  readonly evidenceClass: EvidenceClass;
  readonly discoveryCategory: string;
  readonly aliases: readonly string[];
}

export interface MindObservationRecord {
  readonly id: string;
  readonly source: MindSourceId;
  readonly command_id: string;
  readonly count: number;
  readonly observed_at: string;
  readonly evidence_class: EvidenceClass;
  readonly [key: string]: unknown;
}

export const MIND_DISCOVERY_SOURCES: readonly MindSourceDefinition[] = [
  {
    id: "intent-drift",
    number: 1,
    name: "code no longer matching intent",
    description: "Code no longer matching declared intent or requirements",
    registryCommand: "health",
    canonicalInvocation: "health --check intent-drift --all",
    empiricalEvidenceCommand: "bun harness.ts health --check intent-drift --all",
    revalidationGate: "bun harness.ts health --check intent-drift",
    evidenceClass: "harness_observed",
    discoveryCategory: "ARCHITECTURAL_HEALTH",
    aliases: ["intent_drift"],
  },
  {
    id: "unused-code",
    number: 2,
    name: "dead / unreachable / unenforced code",
    description: "Unused exports, unreachable modules, dead or unenforced code",
    registryCommand: "health",
    canonicalInvocation: "health --check unused-code,dead-code,unenforced",
    empiricalEvidenceCommand: "bun harness.ts health --check unused-code,dead-code,unenforced",
    revalidationGate: "bun harness.ts health --check unused-code,dead-code",
    evidenceClass: "harness_observed",
    discoveryCategory: "CODE_QUALITY",
    aliases: ["unused_code", "dead-code", "dead_code", "unenforced-code", "unenforced"],
  },
  {
    id: "literal-fallbacks",
    number: 3,
    name: "literal fallbacks",
    description: "Fabricated or hardcoded fallback values substituting missing logic",
    registryCommand: "health",
    canonicalInvocation: "health --check literal-fallbacks",
    empiricalEvidenceCommand: "bun harness.ts health --check literal-fallbacks",
    revalidationGate: "bun harness.ts health --check literal-fallbacks",
    evidenceClass: "harness_observed",
    discoveryCategory: "CODE_QUALITY",
    aliases: ["literal_fallbacks", "fallbacks"],
  },
  {
    id: "open-findings",
    number: 4,
    name: "open findings from real validators",
    description: "Unresolved findings recorded by task validators or critics",
    registryCommand: "finding:get",
    canonicalInvocation: "finding:get --run <r> --all",
    empiricalEvidenceCommand: "bun harness.ts finding:get --run <r> --all",
    revalidationGate: "bun harness.ts finding:get --run <r>",
    evidenceClass: "agent_reported",
    discoveryCategory: "FEEDBACK_INTAKE",
    aliases: ["open_findings", "findings", "validator-findings", "open-validator-findings"],
  },
  {
    id: "escalated-tasks",
    number: 5,
    name: "escalated tasks awaiting a human",
    description: "Tasks escalated to human owner awaiting intervention",
    registryCommand: "run:status",
    canonicalInvocation: "run:status",
    empiricalEvidenceCommand: "bun harness.ts run:status",
    revalidationGate: "bun harness.ts run:status",
    evidenceClass: "harness_observed",
    discoveryCategory: "FEEDBACK_INTAKE",
    aliases: ["escalated_tasks", "escalations", "needs-human", "needs_human", "escalated"],
  },
  {
    id: "failing-gates",
    number: 6,
    name: "gates whose recorded exit ≠ 0",
    description: "Recorded gate executions with non-zero exit codes",
    registryCommand: "evidence:get",
    canonicalInvocation: "evidence:get",
    empiricalEvidenceCommand: "bun harness.ts evidence:get",
    revalidationGate: "bun harness.ts evidence:get",
    evidenceClass: "harness_observed",
    discoveryCategory: "TEST_COVERAGE",
    aliases: ["failing_gates", "failing-gate-runs", "failingGateRuns", "failing-gates-runs"],
  },
  {
    id: "capsule-integrity",
    number: 7,
    name: "capsule integrity damage",
    description: "Capsule hash chain, projection, or artifact integrity failures",
    registryCommand: "doctor",
    canonicalInvocation: "doctor --run <r>",
    empiricalEvidenceCommand: "bun harness.ts doctor --run <r>",
    revalidationGate: "bun harness.ts doctor --run <r>",
    evidenceClass: "harness_observed",
    discoveryCategory: "ARCHITECTURAL_HEALTH",
    aliases: ["capsule_integrity", "doctor", "integrity-damage", "doctor-integrity"],
  },
  {
    id: "install-drift",
    number: 8,
    name: "install / runtime drift",
    description: "Mismatch between installed runtime and source release",
    registryCommand: "installation-status",
    canonicalInvocation: "installation-status --home <home> --source <src>",
    empiricalEvidenceCommand: "bun harness.ts installation-status --home <home> --source <src>",
    revalidationGate: "bun harness.ts installation-status",
    evidenceClass: "harness_observed",
    discoveryCategory: "ARCHITECTURAL_HEALTH",
    aliases: ["install_drift", "runtime-drift", "runtime_drift", "installation-status"],
  },
  {
    id: "unsealed-capsules",
    number: 9,
    name: "unsealed capsules with live leases",
    description: "Capsules across workspace with active leases or incomplete runs",
    registryCommand: "run:status",
    canonicalInvocation: "run:status",
    empiricalEvidenceCommand: "bun harness.ts run:status",
    revalidationGate: "bun harness.ts run:status",
    evidenceClass: "harness_observed",
    discoveryCategory: "CONTINUOUS_HARDENING",
    aliases: ["unsealed_capsules", "live-leases", "live_leases", "unsealed"],
  },
  {
    id: "charter-backlog",
    number: 10,
    name: "owner backlog in charter documents",
    description: "Owner backlog, open questions, and requirements in pinned charter",
    registryCommand: "health",
    canonicalInvocation: "health",
    empiricalEvidenceCommand: "bun harness.ts health",
    revalidationGate: "bun harness.ts health",
    evidenceClass: "harness_observed",
    discoveryCategory: "DORMANT_CRITERIA",
    aliases: ["charter_backlog", "charter-references", "owner-backlog", "charter-drift"],
  },
];

export const SOURCE_LOOKUP: ReadonlyMap<string, MindSourceDefinition> = (() => {
  const map = new Map<string, MindSourceDefinition>();
  for (const source of MIND_DISCOVERY_SOURCES) {
    map.set(source.id.toLowerCase(), source);
    for (const alias of source.aliases) {
      map.set(alias.toLowerCase(), source);
    }
  }
  return map;
})();

export function findSourceDefinition(sourceIdOrAlias: string): MindSourceDefinition | undefined {
  if (!sourceIdOrAlias || typeof sourceIdOrAlias !== "string") return undefined;
  return SOURCE_LOOKUP.get(sourceIdOrAlias.trim().toLowerCase());
}

export function getSourceDefinition(sourceIdOrAlias: string): MindSourceDefinition {
  const found = findSourceDefinition(sourceIdOrAlias);
  if (!found) {
    const valid = MIND_DISCOVERY_SOURCES.map((s) => s.id).join(", ");
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `unknown discovery source '${sourceIdOrAlias}'; must be one of: ${valid}`,
    );
  }
  return found;
}

export function isMindSourceId(value: string): value is MindSourceId {
  return MIND_DISCOVERY_SOURCES.some((s) => s.id === value);
}

export function resolveSourceToRegistryCommand(sourceIdOrAlias: string): CommandSpec {
  const source = getSourceDefinition(sourceIdOrAlias);
  const command = findCommand(source.registryCommand);
  if (!command) {
    throw new HarnessError(
      "INVALID_STATE",
      `source '${source.id}' maps to command '${source.registryCommand}' which is not in COMMAND_REGISTRY`,
    );
  }
  return command;
}

export function getSourceEmpiricalCommand(
  sourceIdOrAlias: string,
  context?: {
    readonly runRoot?: string | undefined;
    readonly home?: string | undefined;
    readonly source?: string | undefined;
  },
): string {
  const def = getSourceDefinition(sourceIdOrAlias);
  let cmd = def.empiricalEvidenceCommand;
  if (context?.runRoot) {
    cmd = cmd.replace(/<r>/g, context.runRoot).replace(/<run>/g, context.runRoot);
  }
  if (context?.home) {
    cmd = cmd.replace(/<home>/g, context.home);
  }
  if (context?.source) {
    cmd = cmd.replace(/<src>/g, context.source);
  }
  return cmd;
}
