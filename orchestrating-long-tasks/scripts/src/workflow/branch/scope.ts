import { normalizeScopePath } from "../../graph/scope-analyzer.ts";
import { scopeConflict } from "../../scheduler/conflicts.ts";
import { HarnessError } from "../../errors/harness-error.ts";

/**
 * True when every literal path `inner` can name is also named by `outer`. Containment is stricter
 * than the scheduler's overlap test: two scopes can collide without either owning the other, and a
 * sub-agent may only be handed authority its parent already holds.
 */
function segmentContains(outer: string, inner: string): boolean {
  if (outer === inner) return true;
  if (outer === "*" || outer === "**") return true;
  if (!outer.includes("*")) return false;
  // A glob on both sides is only provably contained when the patterns are identical, so anything
  // less obvious is refused rather than approved on a guess.
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
  // A scope owns everything beneath it, so an exhausted outer pattern still covers the deeper inner
  // path; an exhausted inner pattern means the inner scope reaches above the outer one.
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

/**
 * The termination guarantee. A branch may only be handed authority the parent already holds *and*
 * strictly less of it, so every hop down a chain removes at least one path the parent could name.
 * Path sets are finite, so no chain of branches can run forever and no agent can branch sideways
 * into the scope it already holds.
 */
export function scopeStrictlyContains(outer: readonly string[], inner: readonly string[]): boolean {
  return scopeContains(outer, inner) && !scopeContains(inner, outer);
}

export interface ScopedSubTask {
  readonly id: string;
  readonly write_scope: readonly string[];
}

/**
 * Three guarantees the branch ledger depends on: a sub-agent never writes outside the authority its
 * parent holds, it always writes strictly less than its parent, and two siblings never hold the same
 * file. All three are rejections, never repairs.
 */
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
