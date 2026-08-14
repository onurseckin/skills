export function scopeConflict(left: readonly string[], right: readonly string[]): boolean {
  for (const leftScope of left) {
    const leftParts = leftScope.split("/");
    for (const rightScope of right) {
      const rightParts = rightScope.split("/");
      const limit = Math.min(leftParts.length, rightParts.length);
      if (leftParts.slice(0, limit).every((part, index) => part === rightParts[index])) return true;
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
