import {
  authorityRequirements,
  authorizedRequirementIds,
  effectiveRequirementDisposition,
  type AuthorityRequirementRecord,
} from "./authorization.ts";

export type ExecutionState = "executable" | "paused" | "disposed";

export function requirementExecutionState(requirement: Record<string, unknown>): ExecutionState {
  const disposition = effectiveRequirementDisposition(requirement as AuthorityRequirementRecord);
  if (disposition === "needs_authority" || disposition === "invalid") return "paused";
  if (disposition === "out_of_scope") return "disposed";
  return "executable";
}

export function taskExecutionState(
  state: unknown,
  requirementIds: readonly string[],
): ExecutionState {
  const requirements = authorityRequirements(state);
  const authorized = authorizedRequirementIds(state);
  let hasExecutable = false;
  for (const id of requirementIds) {
    const requirement = requirements.get(id);
    if (!requirement) return "paused";
    const execution = requirementExecutionState(requirement);
    if (execution === "paused") return "paused";
    if (execution === "executable") {
      if (!authorized.has(id)) return "paused";
      hasExecutable = true;
    }
  }
  return hasExecutable ? "executable" : "disposed";
}

export function executableTaskRequirementIds(
  state: unknown,
  requirementIds: readonly string[],
): Set<string> {
  const requirements = authorityRequirements(state);
  const authorized = authorizedRequirementIds(state);
  return new Set(
    requirementIds.filter((id) => {
      const requirement = requirements.get(id);
      return (
        requirement !== undefined &&
        requirementExecutionState(requirement) === "executable" &&
        authorized.has(id)
      );
    }),
  );
}

export function taskExecutionBlockers(state: unknown, requirementIds: readonly string[]): string[] {
  const requirements = authorityRequirements(state);
  const authorized = authorizedRequirementIds(state);
  return requirementIds.filter((id) => {
    const requirement = requirements.get(id);
    if (!requirement) return true;
    const execution = requirementExecutionState(requirement);
    return execution === "paused" || (execution === "executable" && !authorized.has(id));
  });
}
