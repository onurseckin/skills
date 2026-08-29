import { existsSync, readFileSync } from "node:fs";
import {
  deserializeDefectRecord,
  parseAndDeduplicateDefectJsonl,
  parseDefectLog,
  resolveDefectRecord,
  serializeAggregatedDefectLog,
  type AggregatedDefect,
  type DefectEntry,
  type DefectResolutionProof,
  type LiveDeduplicationOptions,
} from "../../logging/defects/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export interface DefectRecordResult {
  readonly defects: readonly AggregatedDefect[];
  readonly serialized: string;
  readonly count: number;
}

export interface DefectResolveResult {
  readonly defect: DefectEntry | AggregatedDefect;
  readonly status: "resolved";
}

export interface DefectListResult {
  readonly defects: readonly DefectEntry[];
  readonly count: number;
}

export function defectRecordCommand(
  flags: Flags,
  context?: CommandContext,
): DefectRecordResult {
  const filePath = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const directContent =
    textFlag(flags, "content", false) ??
    textFlag(flags, "json", false) ??
    textFlag(flags, "jsonl", false);
  const windowMs = integerFlag(flags, "window-ms") ?? integerFlag(flags, "dedup-window");
  const maxEntries = integerFlag(flags, "max-entries") ?? integerFlag(flags, "limit");
  const maxOccurrences = integerFlag(flags, "max-occurrences");
  const strategyFlag = textFlag(flags, "strategy", false);
  const strategy = strategyFlag === "exact_dedup" || strategyFlag === "windowed" || strategyFlag === "sliding_window_hash" || strategyFlag === "aggregate_synchronous"
    ? strategyFlag
    : undefined;

  let rawContent = "";
  if (filePath && existsSync(filePath)) {
    rawContent = readFileSync(filePath, "utf-8");
  } else if (directContent) {
    rawContent = directContent;
  } else if (context?.stdin && context.stdin.length > 0) {
    rawContent = new TextDecoder().decode(context.stdin);
  } else if (context?.inlinePrompt) {
    rawContent = context.inlinePrompt;
  }

  const options: LiveDeduplicationOptions = {
    ...(windowMs !== undefined ? { windowMs } : {}),
    ...(maxEntries !== undefined ? { maxEntries } : {}),
    ...(maxOccurrences !== undefined ? { maxOccurrences } : {}),
    ...(strategy !== undefined ? { strategy } : {}),
  };

  const defects = parseAndDeduplicateDefectJsonl(rawContent, options);
  const serialized = serializeAggregatedDefectLog(defects);

  return {
    defects,
    serialized,
    count: defects.length,
  };
}

export function defectResolveCommand(
  flags: Flags,
  _context?: CommandContext,
): DefectResolveResult {
  const defectRaw = textFlag(flags, "defect", false) ?? textFlag(flags, "defect-json", false);
  const filePath = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const taskId = textFlag(flags, "task-id", false) ?? textFlag(flags, "task", true)!;
  const testAssertion =
    textFlag(flags, "test-assertion", false) ?? textFlag(flags, "assertion", true)!;
  const commitSha = textFlag(flags, "commit-sha", false) ?? textFlag(flags, "commit", false);
  const remediationNotes =
    textFlag(flags, "notes", false) ?? textFlag(flags, "remediation-notes", false);
  const verifiedBy = textFlag(flags, "verified-by", false);
  const resolvedAt = textFlag(flags, "resolved-at", false) ?? new Date().toISOString();
  const requireCommitSha = boolFlag(flags, "require-commit-sha");

  let baseDefect: AggregatedDefect | DefectEntry | null = null;
  if (filePath && existsSync(filePath)) {
    const fileContent = readFileSync(filePath, "utf-8");
    baseDefect = deserializeDefectRecord(fileContent);
  } else if (defectRaw) {
    baseDefect = deserializeDefectRecord(defectRaw);
  }

  const targetDefect: DefectEntry = baseDefect ?? {
    id: `defect-${Date.now()}`,
    type: "defect",
    timestamp: new Date().toISOString(),
    status: "open",
    severity: "warning",
    category: "execution",
    observation: "Resolved defect",
    message: "Resolved defect",
  };

  const proof: DefectResolutionProof = {
    task_id: taskId,
    test_assertion: testAssertion,
    resolved_at: resolvedAt,
    ...(commitSha !== undefined ? { commit_sha: commitSha } : {}),
    ...(remediationNotes !== undefined ? { remediation_notes: remediationNotes } : {}),
    ...(verifiedBy !== undefined ? { verified_by: verifiedBy } : {}),
  };

  const resolved = resolveDefectRecord(targetDefect, proof, { requireCommitSha });

  return {
    defect: resolved,
    status: "resolved",
  };
}

export function defectListCommand(
  flags: Flags,
  _context?: CommandContext,
): DefectListResult {
  const filePath = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const directContent = textFlag(flags, "content", false) ?? textFlag(flags, "jsonl", false);
  const capsuleRoot = textFlag(flags, "capsule-root", false) ?? textFlag(flags, "run", false);
  const filterStatus = (textFlag(flags, "filter-status", false) ?? textFlag(flags, "status", false))?.toLowerCase();
  const filterCategory = (textFlag(flags, "filter-category", false) ?? textFlag(flags, "category", false))?.toLowerCase();
  const limit = integerFlag(flags, "limit") ?? integerFlag(flags, "max-entries");

  let rawContent = "";
  if (filePath && existsSync(filePath)) {
    rawContent = readFileSync(filePath, "utf-8");
  } else if (directContent) {
    rawContent = directContent;
  }

  let defects = parseDefectLog(rawContent, {
    capsuleRoot,
  });

  if (filterStatus) {
    defects = defects.filter((d) => String(d.status).toLowerCase() === filterStatus);
  }
  if (filterCategory) {
    defects = defects.filter((d) => String(d.category).toLowerCase() === filterCategory);
  }
  if (limit !== undefined && limit > 0) {
    defects = defects.slice(0, limit);
  }

  return {
    defects,
    count: defects.length,
  };
}
