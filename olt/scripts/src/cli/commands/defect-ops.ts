import { existsSync, readFileSync } from "node:fs";
import {
  deserializeDefectRecord,
  parseAndDeduplicateDefectJsonl,
  parseDefectLog,
  resolveDefect,
  serializeAggregatedDefectLog,
  type DefectEntry,
  type DefectResolutionProof,
} from "../../logging/defects/index.ts";
import { boolFlag, integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";

export function defectRecordCommand(
  flags: Flags,
  context?: CommandContext,
): Record<string, unknown> {
  const filePath = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const directContent =
    textFlag(flags, "content", false) ??
    textFlag(flags, "json", false) ??
    textFlag(flags, "jsonl", false);
  const windowMs = integerFlag(flags, "window-ms") ?? integerFlag(flags, "dedup-window");

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

  const defects = parseAndDeduplicateDefectJsonl(rawContent, {
    windowMs,
  });
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
): Record<string, unknown> {
  const defectRaw = textFlag(flags, "defect", false) ?? textFlag(flags, "defect-json", false);
  const filePath = textFlag(flags, "file", false);
  const taskId = textFlag(flags, "task-id", false) ?? textFlag(flags, "task", true)!;
  const testAssertion =
    textFlag(flags, "test-assertion", false) ?? textFlag(flags, "assertion", true)!;
  const commitSha = textFlag(flags, "commit-sha", false) ?? textFlag(flags, "commit", false);
  const remediationNotes =
    textFlag(flags, "notes", false) ?? textFlag(flags, "remediation-notes", false);
  const verifiedBy = textFlag(flags, "verified-by", false);
  const resolvedAt = textFlag(flags, "resolved-at", false) ?? new Date().toISOString();
  const requireCommitSha = boolFlag(flags, "require-commit-sha");

  let baseDefect: DefectEntry | null = null;
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

  const resolved = resolveDefect(targetDefect, proof, { requireCommitSha });

  return {
    defect: resolved,
    status: "resolved",
  };
}

export function defectListCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const filePath = textFlag(flags, "file", false) ?? textFlag(flags, "path", false);
  const directContent = textFlag(flags, "content", false) ?? textFlag(flags, "jsonl", false);
  const capsuleRoot = textFlag(flags, "capsule-root", false) ?? textFlag(flags, "run", false);

  let rawContent = "";
  if (filePath && existsSync(filePath)) {
    rawContent = readFileSync(filePath, "utf-8");
  } else if (directContent) {
    rawContent = directContent;
  }

  const defects = parseDefectLog(rawContent, {
    capsuleRoot,
  });

  return {
    defects,
    count: defects.length,
  };
}
