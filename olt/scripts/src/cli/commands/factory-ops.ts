import { join, resolve } from "node:path";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { auditMindPreplanningStagnation } from "../../mind/auditing/mind-stagnation-auditor.ts";
import { auditSkillConcurrencySaturation } from "../../mind/auditing/skill-concurrency-auditor.ts";
import {
  isPreplanningNeeded,
  runPreplanningTick,
} from "../../mind/preplanning/continuous-preplanner.ts";
import {
  filterEligibleBacklogItems,
  filterEligibleDefects,
  loadBacklogItems,
  loadDefectItems,
} from "../../mind/preplanning/backlog-clusterer.ts";
import { resolveLedgerPath } from "../../mind/preplanning/bridge-state.ts";
import type { PreplanningRunResult, ThematicCluster } from "../../mind/preplanning/types.ts";
import { boolFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface FactoryPreplanCommandResult {
  readonly markdown: string;
  readonly result: PreplanningRunResult;
}

export interface FactoryStatusCommandResult {
  readonly markdown: string;
  readonly status: {
    readonly pending_backlog: number;
    readonly open_defects: number;
    readonly is_stagnant: boolean;
    readonly is_concurrency_saturated: boolean;
    readonly preplanning_needed: boolean;
  };
}

export function formatFactoryPreplanBrief(result: PreplanningRunResult): string {
  const lines: string[] = [
    "### Continuous Pre-Planning Factory Run Summary",
    `- **Started At**: \`${result.started_at}\``,
    `- **Completed At**: \`${result.completed_at}\``,
    `- **Duration**: ${result.duration_ms}ms`,
    `- **Clusters Created**: ${result.clusters.length}`,
    `- **Backlog Items Planned**: ${result.items_planned}`,
    `- **Defects Planned**: ${result.defects_planned}`,
    "",
  ];

  if (result.clusters.length > 0) {
    lines.push("#### Generated Phase 1 Blueprints:");
    for (const c of result.clusters) {
      lines.push(
        `- **[${c.domain.toUpperCase()}]** \`${c.cluster_id}\` (${c.backlog_item_ids.length} items, ${c.defect_ids.length} defects) ──► \`${c.plan_path}\``,
      );
    }
  } else {
    lines.push("Zero-idle pipeline: No eligible backlog items or defects required planning.");
  }

  return lines.join("\n");
}

export function formatFactoryStatusBrief(status: {
  pending_backlog: number;
  open_defects: number;
  is_stagnant: boolean;
  is_concurrency_saturated: boolean;
  preplanning_needed: boolean;
  findings: readonly string[];
}): string {
  const lines: string[] = [
    "### Factory Engine & Assembly Pipeline Status",
    `- **Pending Backlog Items**: ${status.pending_backlog}`,
    `- **Open Defects**: ${status.open_defects}`,
    `- **Pre-Planning Needed**: ${status.preplanning_needed ? "YES" : "NO"}`,
    `- **Mind Auditor Stagnation**: ${status.is_stagnant ? "STAGNANT (MIND_PREPLANNING_STAGNATION)" : "HEALTHY"}`,
    `- **Skill Concurrency Saturation**: ${status.is_concurrency_saturated ? "SATURATED" : "UNDER-SATURATED"}`,
    "",
    "#### Health & Audit Findings:",
  ];

  for (const f of status.findings) {
    lines.push(`- ${f}`);
  }

  return lines.join("\n");
}

export function factoryPreplanCommand(
  flags: Flags,
  _context?: CommandContext | undefined,
): FactoryPreplanCommandResult {
  const repoFlag = textFlag(flags, "repo", false) ?? textFlag(flags, "root", false);
  const repoRoot = repoFlag ? resolve(repoFlag) : findRepoRoot(process.cwd());
  const dryRun = boolFlag(flags, "dry-run");

  const result = runPreplanningTick({
    rootDir: repoRoot,
    dryRun,
  });

  const markdown = formatFactoryPreplanBrief(result);
  return {
    markdown,
    result,
  };
}

export function factoryStatusCommand(
  flags: Flags,
  _context?: CommandContext | undefined,
): FactoryStatusCommandResult {
  const repoFlag = textFlag(flags, "repo", false) ?? textFlag(flags, "root", false);
  const repoRoot = repoFlag ? resolve(repoFlag) : findRepoRoot(process.cwd());

  const backlogPath = resolveLedgerPath(join(".olt", "backlog.jsonl"), undefined, repoRoot);
  const defectsPath = resolveLedgerPath(join(".olt", "defects.jsonl"), undefined, repoRoot);

  const backlog = loadBacklogItems(backlogPath);
  const defects = loadDefectItems(defectsPath);

  const eligibleBacklog = filterEligibleBacklogItems(backlog);
  const eligibleDefects = filterEligibleDefects(defects);

  const stagnationAudit = auditMindPreplanningStagnation({
    rootDir: repoRoot,
    explicitBacklog: backlog,
    explicitDefects: defects,
  });

  const concurrencyAudit = auditSkillConcurrencySaturation({
    totalWorkUnits: eligibleBacklog.length + eligibleDefects.length,
  });

  const preplanningNeeded = isPreplanningNeeded({
    rootDir: repoRoot,
    explicitBacklog: backlog,
    explicitDefects: defects,
  });

  const allFindings = [...stagnationAudit.findings, ...concurrencyAudit.findings];

  const status = {
    pending_backlog: eligibleBacklog.length,
    open_defects: eligibleDefects.length,
    is_stagnant: stagnationAudit.is_stagnant,
    is_concurrency_saturated: concurrencyAudit.is_saturated,
    preplanning_needed: preplanningNeeded,
    findings: Object.freeze(allFindings),
  };

  const markdown = formatFactoryStatusBrief(status);

  return {
    markdown,
    status: {
      pending_backlog: status.pending_backlog,
      open_defects: status.open_defects,
      is_stagnant: status.is_stagnant,
      is_concurrency_saturated: status.is_concurrency_saturated,
      preplanning_needed: status.preplanning_needed,
    },
  };
}
