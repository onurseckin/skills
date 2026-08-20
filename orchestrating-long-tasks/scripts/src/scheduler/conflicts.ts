/**
 * True when two segment patterns can spell the same literal segment. `*` stands for any run of
 * characters inside the segment, so `*.ts` and `foo.ts` collide. Comparing sub-segment globs as
 * opaque strings misses that collision, and a missed collision hands two agents the same file.
 */
function segmentsIntersect(left: string, right: string): boolean {
  if (!left.includes("*") && !right.includes("*")) return left === right;
  const leftLength = left.length;
  const rightLength = right.length;
  // reachable[i][j]: the suffixes left[i..] and right[j..] can still spell one common remainder.
  const reachable: boolean[][] = Array.from({ length: leftLength + 1 }, () =>
    new Array<boolean>(rightLength + 1).fill(false),
  );
  reachable[leftLength]![rightLength] = true;
  for (let j = rightLength - 1; j >= 0; j--) {
    reachable[leftLength]![j] = right[j] === "*" && reachable[leftLength]![j + 1]!;
  }
  for (let i = leftLength - 1; i >= 0; i--) {
    reachable[i]![rightLength] = left[i] === "*" && reachable[i + 1]![rightLength]!;
    for (let j = rightLength - 1; j >= 0; j--) {
      const leftChar = left[i]!;
      const rightChar = right[j]!;
      // A `*` either stops here or swallows one character of the common remainder, which the other
      // side still has to spell — consecutive stars collapse through the same two branches.
      if (leftChar === "*") {
        reachable[i]![j] = reachable[i + 1]![j]! || reachable[i]![j + 1]!;
      } else if (rightChar === "*") {
        reachable[i]![j] = reachable[i]![j + 1]! || reachable[i + 1]![j]!;
      } else {
        reachable[i]![j] = leftChar === rightChar && reachable[i + 1]![j + 1]!;
      }
    }
  }
  return reachable[0]![0]!;
}

/**
 * True when two scope patterns can name the same path. Exhausting either pattern is a conflict
 * because a scope covers everything beneath it: `src/a` owns `src/a/b`. A whole `**` segment absorbs
 * any number of remaining segments, so `docs/**` conflicts with `docs/concepts/**` — the glob form
 * real capsules actually write. Every other segment pair goes through the sub-segment matcher.
 */
function patternsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const leftCount = left.length;
  const rightCount = right.length;
  // Filled back-to-front: overlap[i][j] only depends on longer suffixes, so a `**` on either side
  // can branch between absorbing a segment and matching nothing without re-entrant recursion.
  const overlap: boolean[][] = Array.from({ length: leftCount + 1 }, () =>
    new Array<boolean>(rightCount + 1).fill(true),
  );
  for (let i = leftCount - 1; i >= 0; i--) {
    for (let j = rightCount - 1; j >= 0; j--) {
      const leftPart = left[i]!;
      const rightPart = right[j]!;
      if (leftPart === "**" || rightPart === "**") {
        overlap[i]![j] = overlap[i + 1]![j]! || overlap[i]![j + 1]!;
      } else if (segmentsIntersect(leftPart, rightPart)) {
        overlap[i]![j] = overlap[i + 1]![j + 1]!;
      } else {
        overlap[i]![j] = false;
      }
    }
  }
  return overlap[0]![0]!;
}

export function scopeConflict(left: readonly string[], right: readonly string[]): boolean {
  for (const leftScope of left) {
    const leftParts = leftScope.split("/");
    for (const rightScope of right) {
      if (patternsOverlap(leftParts, rightScope.split("/"))) return true;
    }
  }
  return false;
}

export function resourceConflict(left: readonly string[], right: readonly string[]): boolean {
  const resources = new Set(left);
  return right.some((resource) => resources.has(resource));
}

export interface OwnershipTask {
  id: string;
  status?: unknown;
  write_scope: string[];
  resource_scope?: string[];
}

export function hasActiveOwnership(status: unknown): boolean {
  return !["proposed", "ready", "done", "cancelled", "blocked", "escalated", "stale"].includes(
    String(status),
  );
}

export function ownershipConflicts(
  candidate: OwnershipTask,
  tasks: readonly OwnershipTask[],
): string[] {
  return tasks
    .filter(
      (other) =>
        other.id !== candidate.id &&
        hasActiveOwnership(other.status) &&
        (scopeConflict(candidate.write_scope, other.write_scope) ||
          resourceConflict(candidate.resource_scope ?? [], other.resource_scope ?? [])),
    )
    .map(({ id }) => id)
    .sort();
}
