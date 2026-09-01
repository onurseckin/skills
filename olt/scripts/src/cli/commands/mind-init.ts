import { existsSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import {
  executeAutonomousMindInit,
  type MindInitFlowOptions,
  type MindInitFlowResult,
} from "../../mind/lifecycle/index.ts";
import type { RepoGovernanceStatus } from "../../mind/governance/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { formatMindInitBrief } from "./mind-init-brief.ts";

export type MindInitGovernanceStatus = RepoGovernanceStatus;

export interface MindInitResult {
  readonly markdown: string;
  readonly run_root: string;
  readonly mind_id: string;
  readonly generation: number;
  readonly charter_sha256: string;
  readonly charter: {
    readonly source_path: string;
    readonly goals: readonly string[];
    readonly repo_roots: readonly string[];
  };
  readonly manifest: unknown;
  readonly governance: RepoGovernanceStatus;
  readonly companions?: unknown;
  readonly snapshot?: unknown;
  readonly intent?: unknown;
  readonly p1_deliverable?: unknown;
  readonly deficit_topology?: unknown;
  readonly dashboard?: unknown;
  readonly mobilized_hierarchy?: unknown;
  readonly cadence_initialized?: boolean;
}

export { formatMindInitBrief } from "./mind-init-brief.ts";

export async function mindInitCommand(
  flags: Flags,
  _context: CommandContext = {},
): Promise<Record<string, unknown>> {
  const repoRaw = textFlag(flags, "repo", false) ?? process.cwd();
  if (!existsSync(repoRaw) || !lstatSync(repoRaw).isDirectory()) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `repository root must be an existing directory: ${repoRaw}`,
    );
  }
  const repoRoot = realpathSync(repoRaw);

  const charterPathRaw = textFlag(flags, "charter", false);
  const generationFlag = integerFlag(flags, "generation", { minimum: 1 });
  const mindIdFlag = textFlag(flags, "mind-id", false);
  const actor = textFlag(flags, "actor", false) ?? "owner";
  const simulate =
    boolFlag(flags, "simulate-probes") ||
    boolFlag(flags, "simulate") ||
    !existsSync(join(repoRoot, ".git"));

  let generation: number | undefined = generationFlag;
  let mindId: string | undefined = mindIdFlag;

  if (generation !== undefined && mindId === undefined) {
    mindId = `mind-gen-${generation}`;
  } else if (mindId !== undefined && generation === undefined) {
    const match = /mind-gen-(\d+)/.exec(mindId);
    generation = match && match[1] ? parseInt(match[1], 10) : 1;
  }

  const flowOptions: MindInitFlowOptions = {
    repo: repoRoot,
    ...(charterPathRaw !== undefined ? { charter: charterPathRaw } : {}),
    ...(mindId !== undefined ? { mindId } : {}),
    ...(generation !== undefined ? { generation } : {}),
    ...(simulate ? { simulateProbes: true } : {}),
    actor,
    host: "initialization",
  };

  const result: MindInitFlowResult = await executeAutonomousMindInit(flowOptions);

  return {
    markdown: result.markdown,
    run_root: result.run_root,
    mind_id: result.mind_id,
    generation: result.generation,
    charter_sha256: result.charter_sha256,
    charter: result.charter,
    manifest: result.manifest,
    governance: result.governance,
    companions: result.companions,
    snapshot: result.snapshot,
    intent: result.intent,
    p1_deliverable: result.p1_deliverable,
    deficit_topology: result.deficit_topology,
    dashboard: result.dashboard,
    mobilized_hierarchy: result.mobilized_hierarchy,
    cadence_initialized: result.cadence_initialized,
  };
}
