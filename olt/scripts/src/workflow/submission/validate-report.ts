import { posix } from "node:path";
import { HarnessError } from "../../core/errors/harness-error.ts";
import type { JsonObject } from "../../core/contracts/json.ts";
import type { TaskRecord } from "../types.ts";
import { requireSubstantiveObjects } from "../evidence.ts";
import { jsonCopy, requireText } from "../task-state.ts";

function safeRelative(path: unknown): string {
  const text = requireText(path, "files_changed entry");
  if (text.startsWith("/") || text.includes("\\")) {
    throw new HarnessError("PATH_SAFETY", `unsafe changed path: ${text}`);
  }
  const normalized = posix.normalize(text);
  if (normalized !== text || normalized === "." || normalized.split("/").includes("..")) {
    throw new HarnessError("PATH_SAFETY", `unsafe changed path: ${text}`);
  }
  return normalized;
}

export function pathAllowed(path: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

export function validateReport(task: TaskRecord, value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HarnessError("INVALID_ARGUMENT", "report must be an object");
  }
  const report = value as Record<string, unknown>;
  requireText(report.summary, "report.summary");
  const requirementIds = report.requirement_ids;
  if (
    !Array.isArray(requirementIds) ||
    requirementIds.length !== task.requirement_ids.length ||
    new Set(requirementIds).size !== task.requirement_ids.length ||
    requirementIds.some((id) => typeof id !== "string" || !task.requirement_ids.includes(id))
  ) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "report requirement_ids must cover valid task requirements",
    );
  }
  const files = report.files_changed;
  if (!Array.isArray(files))
    throw new HarnessError("INVALID_ARGUMENT", "files_changed must be an array");
  const normalized = files.map(safeRelative);
  if (normalized.some((path) => !pathAllowed(path, task.write_scope))) {
    throw new HarnessError("PATH_SAFETY", "report changed a path outside task ownership");
  }
  requireSubstantiveObjects(report.checks, "report checks");
  requireSubstantiveObjects(report.evidence, "report evidence");
  return jsonCopy({ ...report, files_changed: normalized } as JsonObject);
}
