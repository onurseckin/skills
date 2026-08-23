function segmentsIntersect(left: string, right: string): boolean {
  if (!left.includes("*") && !right.includes("*")) return left === right;
  const leftLength = left.length;
  const rightLength = right.length;
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

function patternsOverlap(left: readonly string[], right: readonly string[]): boolean {
  const leftCount = left.length;
  const rightCount = right.length;
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

interface OwnershipTask {
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
