import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import {
  HarnessError,
  durableAppendBytes,
  resolveDefectsPath,
  resolveSkillHomeRepo,
} from "../core/index.ts";

export type DefectDomain = "project" | "skill-framework";

export interface DefectRoutingConfig {
  readonly skill_home_repo_root: string;
  readonly global_skill_dir: string;
  readonly dual_write_enabled: boolean;
}

export interface RouteDefectOptions {
  readonly currentRepoRoot: string;
  readonly domain: DefectDomain;
  readonly defect: {
    readonly id?: string | undefined;
    readonly error_code: string;
    readonly title: string;
    readonly description: string;
    readonly actor?: string | undefined;
    readonly timestamp?: string | undefined;
    readonly context?: Record<string, unknown> | undefined;
  };
  readonly routingPolicy?: Partial<DefectRoutingConfig> | undefined;
  readonly policy?: Partial<DefectRoutingConfig> | undefined;
}

export interface DefectRouteResult {
  readonly targetRepoRoot: string;
  readonly targetDefectsPath: string;
  readonly isMothership: boolean;
  readonly routed: boolean;
  readonly lastError?: string;
  readonly dualWriteEnabled?: boolean;
  readonly forwardedDestinations?: readonly string[];
}

const MAX_CAUSE_LENGTH = 240;

function bounded(value: string): string {
  return value.length <= MAX_CAUSE_LENGTH ? value : `${value.slice(0, MAX_CAUSE_LENGTH - 1)}…`;
}

/**
 * Formats only primitive values or an own data message property safely.
 */
function safeCause(error: unknown): string {
  if (typeof error === "string") return bounded(error);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return bounded(String(error));
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return bounded(descriptor.value);
    }
  } catch {}
  return "unknown error";
}

export function expandHomeDir(pathStr: string): string {
  if (pathStr === "~") return homedir();
  if (pathStr.startsWith(`~${sep}`) || pathStr.startsWith("~/")) {
    return join(homedir(), pathStr.slice(2));
  }
  return pathStr;
}

function toDefectsLedgerPath(dirOrPath: string): string {
  const expanded = expandHomeDir(dirOrPath);
  if (expanded.endsWith("defects.jsonl")) {
    return resolve(expanded);
  }
  return resolve(join(expanded, ".olt", "defects.jsonl"));
}

export function resolveDefectRoutingPolicy(
  currentRepoRoot: string,
  explicitPolicy?: Partial<DefectRoutingConfig>,
): DefectRoutingConfig {
  let filePolicy: Partial<DefectRoutingConfig> | undefined;
  const candidatePaths = [join(currentRepoRoot, ".olt", "policy.json")];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const defectRouting =
          parsed["defect_routing"] && typeof parsed["defect_routing"] === "object"
            ? (parsed["defect_routing"] as Record<string, unknown>)
            : undefined;

        const skillHome =
          (defectRouting && typeof defectRouting["skill_home_repo_root"] === "string"
            ? defectRouting["skill_home_repo_root"]
            : undefined) ??
          (typeof parsed["skill_home_repo_root"] === "string"
            ? parsed["skill_home_repo_root"]
            : undefined);

        const globalDir =
          defectRouting && typeof defectRouting["global_skill_dir"] === "string"
            ? defectRouting["global_skill_dir"]
            : undefined;

        const dualWrite =
          defectRouting && typeof defectRouting["dual_write_enabled"] === "boolean"
            ? defectRouting["dual_write_enabled"]
            : undefined;

        filePolicy = {
          ...(skillHome !== undefined ? { skill_home_repo_root: skillHome } : {}),
          ...(globalDir !== undefined ? { global_skill_dir: globalDir } : {}),
          ...(dualWrite !== undefined ? { dual_write_enabled: dualWrite } : {}),
        };
        break;
      } catch {
        // Continue to next candidate
      }
    }
  }

  const envSkillHome = process.env["OLT_SKILL_HOME_REPO"];
  const envGlobalDir = process.env["OLT_GLOBAL_SKILL_DIR"];
  const envDualWrite = process.env["OLT_DUAL_WRITE_ENABLED"];

  let defaultSkillHome: string;
  try {
    defaultSkillHome = resolveSkillHomeRepo(currentRepoRoot);
  } catch {
    defaultSkillHome = "/Users/onurseckinsenoglu/repos/skills";
  }

  const resolvedSkillHome =
    explicitPolicy?.skill_home_repo_root ??
    envSkillHome ??
    filePolicy?.skill_home_repo_root ??
    defaultSkillHome;

  const resolvedGlobalDir =
    explicitPolicy?.global_skill_dir ??
    envGlobalDir ??
    filePolicy?.global_skill_dir ??
    "~/.agents/skills/olt";

  const resolvedDualWrite =
    explicitPolicy?.dual_write_enabled ??
    (envDualWrite !== undefined
      ? envDualWrite !== "false" && envDualWrite !== "0"
      : (filePolicy?.dual_write_enabled ?? true));

  return {
    skill_home_repo_root: resolvedSkillHome,
    global_skill_dir: resolvedGlobalDir,
    dual_write_enabled: resolvedDualWrite,
  };
}

function forwardDefectRecord(destinationPath: string, lineBytes: Uint8Array): boolean {
  try {
    const parentDir = dirname(destinationPath);
    mkdirSync(parentDir, { recursive: true });
    durableAppendBytes(destinationPath, lineBytes);
    return true;
  } catch {
    return false;
  }
}

export class SplitChannelDefectRouter {
  public static routeDefect(options: RouteDefectOptions): DefectRouteResult {
    let targetDefectsPath = "unresolved defects ledger";
    try {
      const isMothership = options.domain === "skill-framework";
      const targetRepoRoot = isMothership
        ? resolve(resolveSkillHomeRepo(options.currentRepoRoot))
        : resolve(options.currentRepoRoot);
      targetDefectsPath = resolveDefectsPath(targetRepoRoot);
      const contextSupplied = options.defect.context !== undefined;
      const record = {
        id: options.defect.id ?? `defect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        domain: options.domain,
        error_code: options.defect.error_code,
        title: options.defect.title,
        description: options.defect.description,
        actor: options.defect.actor ?? "unknown",
        timestamp: options.defect.timestamp ?? new Date().toISOString(),
        source_repo: resolve(options.currentRepoRoot),
        ...(contextSupplied ? { context: options.defect.context } : {}),
      };

      const serialized = JSON.stringify(record);
      if (contextSupplied && !Object.hasOwn(JSON.parse(serialized) as object, "context")) {
        throw new HarnessError("INTEGRITY", "Supplied defect context was omitted by serialization");
      }
      const line = serialized + "\n";
      const lineBytes = new TextEncoder().encode(line);

      mkdirSync(dirname(targetDefectsPath), { recursive: true });
      durableAppendBytes(targetDefectsPath, lineBytes);

      const feedbackQueuePath = join(targetRepoRoot, ".olt", "feedback-queue.jsonl");
      const feedbackRecord = {
        id: `fb-${record.id}`,
        title: record.title,
        description: record.description,
        source: "skill-auditor",
        category: "defect",
        priority: 100,
        admitted: false,
        created_at: record.timestamp,
      };
      try {
        if (existsSync(dirname(feedbackQueuePath))) {
          durableAppendBytes(
            feedbackQueuePath,
            new TextEncoder().encode(JSON.stringify(feedbackRecord) + "\n"),
          );
        }
      } catch {}

      const routingPolicy = resolveDefectRoutingPolicy(
        options.currentRepoRoot,
        options.routingPolicy ?? options.policy,
      );

      const forwardedDestinations: string[] = [];
      if (routingPolicy.dual_write_enabled) {
        const candidateDests = [
          toDefectsLedgerPath(routingPolicy.skill_home_repo_root),
          toDefectsLedgerPath(routingPolicy.global_skill_dir),
        ];
        const uniqueDests = Array.from(new Set(candidateDests));

        for (const dest of uniqueDests) {
          if (resolve(dest) === resolve(targetDefectsPath)) {
            continue;
          }
          const ok = forwardDefectRecord(dest, lineBytes);
          if (ok) {
            forwardedDestinations.push(dest);
          }
        }
      }

      return {
        targetRepoRoot,
        targetDefectsPath,
        isMothership,
        routed: true,
        dualWriteEnabled: routingPolicy.dual_write_enabled,
        forwardedDestinations,
      };
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `SplitChannelDefectRouter failed to durably route a defect to '${targetDefectsPath}': ${safeCause(error)}`,
      );
    }
  }
}
