import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandSpec } from "../cli/registry/types.ts";
import { findCommand } from "../cli/registry/index.ts";
import type { EvidenceClass } from "../contracts/evidence.ts";
import { HarnessError } from "../errors/harness-error.ts";

export type { EvidenceClass } from "../contracts/evidence.ts";

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
  readonly evidenceClass: EvidenceClass;
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
    evidenceClass: "harness_observed",
    aliases: ["intent_drift"],
  },
  {
    id: "unused-code",
    number: 2,
    name: "dead / unreachable / unenforced code",
    description: "Unused exports, unreachable modules, dead or unenforced code",
    registryCommand: "health",
    canonicalInvocation: "health --check unused-code,dead-code,unenforced",
    evidenceClass: "harness_observed",
    aliases: ["unused_code", "dead-code", "dead_code", "unenforced-code", "unenforced"],
  },
  {
    id: "literal-fallbacks",
    number: 3,
    name: "literal fallbacks",
    description: "Fabricated or hardcoded fallback values substituting missing logic",
    registryCommand: "health",
    canonicalInvocation: "health --check literal-fallbacks",
    evidenceClass: "harness_observed",
    aliases: ["literal_fallbacks", "fallbacks"],
  },
  {
    id: "open-findings",
    number: 4,
    name: "open findings from real validators",
    description: "Unresolved findings recorded by task validators or critics",
    registryCommand: "finding:get",
    canonicalInvocation: "finding:get --run <r> --all",
    evidenceClass: "agent_reported",
    aliases: ["open_findings", "findings", "validator-findings", "open-validator-findings"],
  },
  {
    id: "escalated-tasks",
    number: 5,
    name: "escalated tasks awaiting a human",
    description: "Tasks escalated to human owner awaiting intervention",
    registryCommand: "run:status",
    canonicalInvocation: "run:status",
    evidenceClass: "harness_observed",
    aliases: ["escalated_tasks", "escalations", "needs-human", "needs_human", "escalated"],
  },
  {
    id: "failing-gates",
    number: 6,
    name: "gates whose recorded exit ≠ 0",
    description: "Recorded gate executions with non-zero exit codes",
    registryCommand: "evidence:get",
    canonicalInvocation: "evidence:get",
    evidenceClass: "harness_observed",
    aliases: ["failing_gates", "failing-gate-runs", "failingGateRuns", "failing-gates-runs"],
  },
  {
    id: "capsule-integrity",
    number: 7,
    name: "capsule integrity damage",
    description: "Capsule hash chain, projection, or artifact integrity failures",
    registryCommand: "doctor",
    canonicalInvocation: "doctor --run <r>",
    evidenceClass: "harness_observed",
    aliases: ["capsule_integrity", "doctor", "integrity-damage", "doctor-integrity"],
  },
  {
    id: "install-drift",
    number: 8,
    name: "install / runtime drift",
    description: "Mismatch between installed runtime and source release",
    registryCommand: "installation-status",
    canonicalInvocation: "installation-status --home <home> --source <src>",
    evidenceClass: "harness_observed",
    aliases: ["install_drift", "runtime-drift", "runtime_drift", "installation-status"],
  },
  {
    id: "unsealed-capsules",
    number: 9,
    name: "unsealed capsules with live leases",
    description: "Capsules across workspace with active leases or incomplete runs",
    registryCommand: "run:status",
    canonicalInvocation: "run:status",
    evidenceClass: "harness_observed",
    aliases: ["unsealed_capsules", "live-leases", "live_leases", "unsealed"],
  },
  {
    id: "charter-backlog",
    number: 10,
    name: "owner backlog in charter documents",
    description: "Owner backlog, open questions, and requirements in pinned charter",
    registryCommand: "health",
    canonicalInvocation: "health",
    evidenceClass: "harness_observed",
    aliases: ["charter_backlog", "charter-references", "owner-backlog", "charter-drift"],
  },
];

const SOURCE_LOOKUP: ReadonlyMap<string, MindSourceDefinition> = (() => {
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

export interface CommandResolutionResult {
  readonly found: boolean;
  readonly commandId: string;
  readonly location?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly record?: Record<string, unknown> | undefined;
}

export function resolveCommandRecord(
  commandId: string,
  options: {
    readonly runRoot?: string | undefined;
    readonly capsulesDir?: string | undefined;
    readonly repoRoot?: string | undefined;
  } = {},
): CommandResolutionResult {
  if (!commandId || typeof commandId !== "string" || !commandId.trim()) {
    return { found: false, commandId: commandId ?? "" };
  }

  const trimmedId = commandId.trim();

  const checkCapsule = (capPath: string): CommandResolutionResult | undefined => {
    if (!existsSync(capPath)) return undefined;

    // 1. Check commands/<id>/record.json
    const recordPath = join(capPath, "commands", trimmedId, "record.json");
    if (existsSync(recordPath)) {
      try {
        const record = JSON.parse(readFileSync(recordPath, "utf-8")) as Record<string, unknown>;
        return {
          found: true,
          commandId: trimmedId,
          location: recordPath,
          runRoot: capPath,
          record,
        };
      } catch {
        return { found: true, commandId: trimmedId, location: recordPath, runRoot: capPath };
      }
    }

    // 2. Check commands/<id>.json
    const jsonPath = join(capPath, "commands", `${trimmedId}.json`);
    if (existsSync(jsonPath)) {
      try {
        const record = JSON.parse(readFileSync(jsonPath, "utf-8")) as Record<string, unknown>;
        return { found: true, commandId: trimmedId, location: jsonPath, runRoot: capPath, record };
      } catch {
        return { found: true, commandId: trimmedId, location: jsonPath, runRoot: capPath };
      }
    }

    // 3. Check commands/<id> directory
    const dirPath = join(capPath, "commands", trimmedId);
    if (existsSync(dirPath)) {
      return { found: true, commandId: trimmedId, location: dirPath, runRoot: capPath };
    }

    // 4. Check state.json
    const statePath = join(capPath, "state.json");
    if (existsSync(statePath)) {
      try {
        const stateObj = JSON.parse(readFileSync(statePath, "utf-8")) as Record<string, unknown>;
        const commands = stateObj.commands as Record<string, unknown> | undefined;
        if (commands && typeof commands === "object" && Object.hasOwn(commands, trimmedId)) {
          const cmdRecord = commands[trimmedId] as Record<string, unknown> | undefined;
          return {
            found: true,
            commandId: trimmedId,
            location: statePath,
            runRoot: capPath,
            record: cmdRecord,
          };
        }
      } catch {
        // ignore unreadable state
      }
    }

    return undefined;
  };

  // Check in specific runRoot if provided
  if (options.runRoot) {
    const direct = checkCapsule(options.runRoot);
    if (direct) return direct;
  }

  // Find candidate capsules directories
  const candidateDirs: string[] = [];
  if (options.capsulesDir) {
    candidateDirs.push(options.capsulesDir);
  }
  if (options.runRoot) {
    candidateDirs.push(dirname(options.runRoot));
    const parentOfParent = dirname(dirname(options.runRoot));
    candidateDirs.push(join(parentOfParent, ".capsules"));
  }
  if (options.repoRoot) {
    candidateDirs.push(join(options.repoRoot, ".capsules"));
    candidateDirs.push(options.repoRoot);
  }
  candidateDirs.push(join(process.cwd(), ".capsules"));

  const visitedDirs = new Set<string>();

  for (const capDir of candidateDirs) {
    if (!capDir || visitedDirs.has(capDir) || !existsSync(capDir)) continue;
    visitedDirs.add(capDir);

    try {
      const entries = readdirSync(capDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const subPath = join(capDir, entry.name);
        const res = checkCapsule(subPath);
        if (res) return res;
      }
    } catch {
      // ignore unreadable directory
    }
  }

  return { found: false, commandId: trimmedId };
}

export interface QuiescentSourcesCheck {
  readonly ok: boolean;
  readonly totalSources: number;
  readonly missingSources: readonly MindSourceId[];
  readonly nonZeroSources: readonly { readonly source: MindSourceId; readonly count: number }[];
  readonly invalidSources: readonly string[];
  readonly reason?: string | undefined;
}

export function validateQuiescentSources(
  observations: readonly { readonly source: string; readonly count: number }[],
): QuiescentSourcesCheck {
  const missingSources: MindSourceId[] = [];
  const nonZeroSources: { readonly source: MindSourceId; readonly count: number }[] = [];
  const invalidSources: string[] = [];

  const observedMap = new Map<MindSourceId, number>();

  for (const obs of observations) {
    const def = findSourceDefinition(obs.source);
    if (!def) {
      invalidSources.push(obs.source);
      continue;
    }
    observedMap.set(def.id, obs.count);
    if (obs.count !== 0) {
      nonZeroSources.push({ source: def.id, count: obs.count });
    }
  }

  for (const def of MIND_DISCOVERY_SOURCES) {
    if (!observedMap.has(def.id)) {
      missingSources.push(def.id);
    }
  }

  let reason: string | undefined = undefined;
  if (invalidSources.length > 0) {
    reason = `invalid source IDs: ${invalidSources.join(", ")}`;
  } else if (missingSources.length > 0) {
    reason = `missing ${missingSources.length} of 10 sources: ${missingSources.join(", ")}`;
  } else if (nonZeroSources.length > 0) {
    reason = `non-zero counts in sources: ${nonZeroSources.map((s) => `${s.source}=${s.count}`).join(", ")}`;
  }

  const ok =
    invalidSources.length === 0 && missingSources.length === 0 && nonZeroSources.length === 0;

  return {
    ok,
    totalSources: MIND_DISCOVERY_SOURCES.length,
    missingSources,
    nonZeroSources,
    invalidSources,
    reason,
  };
}
