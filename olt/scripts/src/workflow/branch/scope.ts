import { normalizeScopePath } from "../../graph/scope-analyzer.ts";
import { scopeConflict } from "../../scheduler/conflicts.ts";
import { HarnessError } from "../../errors/harness-error.ts";

function segmentContains(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  if (outer === "*" || outer === "**") return true;
  if (!outer.includes("*")) return false;
  if (inner.includes("*")) return false;
  const pattern = new RegExp(
    `^${outer
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
      .join("[^/]*")}$`,
    "u",
  );
  return pattern.test(inner);
}

function patternContains(outer: readonly string[], inner: readonly string[]): boolean {
  if (outer.length === 0) return true;
  if (inner.length === 0) return false;
  const [outerHead, ...outerTail] = outer;
  const [innerHead, ...innerTail] = inner;
  if (outerHead === "**") {
    return patternContains(outer, innerTail) || patternContains(outerTail, inner);
  }
  if (!segmentContains(outerHead!, innerHead!)) return false;
  return patternContains(outerTail, innerTail);
}

export function scopeContains(outer: readonly string[], inner: readonly string[]): boolean {
  return inner.every((candidate) =>
    outer.some((owner) =>
      patternContains(
        normalizeScopePath(owner).split("/"),
        normalizeScopePath(candidate).split("/"),
      ),
    ),
  );
}

export function scopeStrictlyContains(outer: readonly string[], inner: readonly string[]): boolean {
  return scopeContains(outer, inner) && !scopeContains(inner, outer);
}

export interface ScopedSubTask {
  readonly id: string;
  readonly write_scope: readonly string[];
}

export function assertSubScopes(
  parentScope: readonly string[],
  subTasks: readonly ScopedSubTask[],
): void {
  for (const subTask of subTasks) {
    if (!scopeContains(parentScope, subTask.write_scope)) {
      throw new HarnessError(
        "INVALID_STATE",
        `sub-task ${subTask.id} write scope escapes the parent scope: ${subTask.write_scope.join(", ")} is not within ${parentScope.join(", ")}`,
      );
    }
    if (!scopeStrictlyContains(parentScope, subTask.write_scope)) {
      throw new HarnessError(
        "INVALID_STATE",
        `sub-task ${subTask.id} write scope ${subTask.write_scope.join(", ")} is not a proper subset of the parent scope ${parentScope.join(", ")}: a branch must hand down strictly less than it holds`,
      );
    }
  }
  for (let left = 0; left < subTasks.length; left += 1) {
    for (let right = left + 1; right < subTasks.length; right += 1) {
      const first = subTasks[left]!;
      const second = subTasks[right]!;
      if (scopeConflict(first.write_scope, second.write_scope)) {
        throw new HarnessError(
          "INVALID_STATE",
          `sub-tasks ${first.id} and ${second.id} claim overlapping write scope`,
        );
      }
    }
  }
}
