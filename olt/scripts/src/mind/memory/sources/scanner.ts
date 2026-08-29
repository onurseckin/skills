import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CommandSpec } from "../../../cli/registry/types.ts";
import { findCommand } from "../../../cli/registry/index.ts";
import type { EvidenceClass } from "../../../core/contracts/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../../core/shared/paths.ts";
import type { MindObservationRecord, MindSourceDefinition, MindSourceId } from "./types.ts";
import {
  MIND_DISCOVERY_SOURCES,
  SOURCE_LOOKUP,
  findSourceDefinition,
  getSourceDefinition,
  getSourceEmpiricalCommand,
  isMindSourceId,
  resolveSourceToRegistryCommand,
} from "./types.ts";

export function getSourceRevalidationGate(sourceIdOrAlias: string, targetPath?: string): string {
  const def = getSourceDefinition(sourceIdOrAlias);
  if (targetPath && targetPath.endsWith(".test.ts")) {
    return `bun test ${targetPath} && ${def.revalidationGate}`;
  }
  return def.revalidationGate;
}

export function mapDiscoveryCategoryToSourceId(category: string): MindSourceId {
  switch (category.toUpperCase().trim()) {
    case "CODE_QUALITY":
      return "unused-code";
    case "TEST_COVERAGE":
      return "failing-gates";
    case "DORMANT_CRITERIA":
      return "charter-backlog";
    case "COGNITIVE_GAP":
      return "intent-drift";
    case "FEEDBACK_INTAKE":
      return "open-findings";
    case "DEFECT_REMEDIATION":
      return "capsule-integrity";
    case "ARCHITECTURAL_HEALTH":
      return "intent-drift";
    case "CONTINUOUS_HARDENING":
      return "unsealed-capsules";
    default:
      return "intent-drift";
  }
}

export function mapSourceIdToDiscoveryCategory(sourceIdOrAlias: string): string {
  const def = findSourceDefinition(sourceIdOrAlias);
  return def ? def.discoveryCategory : "ARCHITECTURAL_HEALTH";
}

export interface CommandResolutionResult {
  readonly found: boolean;
  readonly commandId: string;
  readonly location?: string | undefined;
  readonly runRoot?: string | undefined;
  readonly record?: Readonly<Record<string, unknown>> | undefined;
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
    return { found: false, commandId: commandId ? commandId : "" };
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
        const commands = stateObj["commands"] as Record<string, unknown> | undefined;
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
    const repoRoot = findRepoRoot(options.runRoot);
    candidateDirs.push(resolveCapsulesDir(repoRoot));
  }
  if (options.repoRoot) {
    candidateDirs.push(resolveCapsulesDir(options.repoRoot));
    candidateDirs.push(options.repoRoot);
  }
  candidateDirs.push(resolveCapsulesDir(process.cwd()));

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

export function resolveCanonicalObservationsPath(customRoot?: string, _useTodo = false): string {
  return require("path").join(customRoot || process.cwd(), ".olt", "telemetry.jsonl");
}

export function resolveObservationsPath(customPath?: string): string {
  if (customPath && customPath.trim()) return require("path").resolve(customPath.trim());
  return require("path").join(process.cwd(), ".olt", "telemetry.jsonl");
}
