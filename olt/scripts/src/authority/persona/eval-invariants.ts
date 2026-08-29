import type {
  DriftFinding,
  ReflexiveAuditContext,
  RoleBoundaryProfile,
  SupervisoryRole,
} from "./types.ts";

export function evaluateRoleInvariants(
  supervisoryRole: SupervisoryRole,
  roleBoundaries: RoleBoundaryProfile,
  context: ReflexiveAuditContext,
  invariantCompliance: Record<string, boolean>,
  findings: DriftFinding[],
  recommendedActions: string[],
): void {
  // Invariant 1.1: Zero file mutations on supervisory thread
  const modifiedFiles = [
    ...(context.fileModificationsOnSupervisoryThread ?? []),
    ...(context.recentActions
      ?.filter(
        (a) => a.action === "edit_file" || a.action === "write_file" || a.action === "delete_file",
      )
      .map((a) => a.targetFile ?? "unknown_file") ?? []),
  ];

  if (modifiedFiles.length > 0) {
    invariantCompliance.zero_file_mutation = false;
    findings.push({
      code: "SUPERVISORY_FILE_MUTATION_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Direct File Mutation on Supervisory Thread",
      description: `The ${supervisoryRole} supervisory thread attempted or executed direct modifications to ${modifiedFiles.length} file(s): ${modifiedFiles.slice(0, 3).join(", ")}${modifiedFiles.length > 3 ? "..." : ""}. Supervisory threads must maintain zero code mutation.`,
      recommendation:
        "Cease all direct file edits immediately. Delegate all file modifications and implementations to Tier 3 Implementers via host subagent dispatch.",
      evidence: { modifiedFiles },
    });
    recommendedActions.push(
      "Revert any direct file modifications made on the supervisory thread and dispatch a Tier 3 Implementer subagent.",
    );
  }

  // Invariant 1.2: Task Self-Implementation Attempts
  const directExecutionAttempts = [
    ...(context.directExecutionAttempts ?? []),
    ...(context.recentActions
      ?.filter(
        (a) =>
          a.action === "claim_task" || a.action === "implement_task" || a.action === "repair_task",
      )
      .map((a) => a.action) ?? []),
  ];

  if (directExecutionAttempts.length > 0) {
    invariantCompliance.delegated_execution_only = false;
    findings.push({
      code: "TASK_SELF_IMPLEMENTATION_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Task Self-Implementation on Supervisory Role",
      description: `${supervisoryRole.toUpperCase()} attempted self-implementation actions: ${directExecutionAttempts.join(", ")}. Supervisory leads coordinate and supervise; they never claim or implement tasks directly.`,
      recommendation:
        "Release any self-claimed tasks and dispatch dedicated Tier 3 Implementers or Repairers.",
      evidence: { directExecutionAttempts },
    });
    recommendedActions.push(
      "Release self-claimed tasks with `task:release` and reassign to Tier 3 subagents.",
    );
  }

  // Invariant 1.3: Cross-Tier Hierarchy & Spawning
  const invalidSpawns = [
    ...(context.crossTierSpawns ?? []),
    ...(context.recentActions
      ?.filter((a) => {
        if (!a.spawnedRole) return false;
        return !roleBoundaries.permittedSpawns.includes(a.spawnedRole.toLowerCase());
      })
      .map((a) => a.spawnedRole!) ?? []),
  ];

  if (invalidSpawns.length > 0) {
    invariantCompliance.strict_tier_hierarchy = false;
    findings.push({
      code: "CROSS_TIER_SPAWNING_VIOLATION",
      type: "role_invariants",
      severity: "critical",
      title: "Cross-Tier Subagent Spawning Violation",
      description: `${supervisoryRole.toUpperCase()} (Tier ${roleBoundaries.tier}) attempted to spawn unauthorized role(s): ${invalidSpawns.join(", ")}. Permitted spawns are strictly limited to: [${roleBoundaries.permittedSpawns.join(", ")}].`,
      recommendation:
        "Adhere strictly to the 4-Tier spawning hierarchy. Tier 0 Mind spawns Tier 1 Orchestrator; Tier 1 Orchestrator spawns Tier 2 Coordinators; Tier 2 Coordinators spawn Tier 3 Workers.",
      evidence: { invalidSpawns, permittedSpawns: roleBoundaries.permittedSpawns },
    });
    recommendedActions.push(
      `Terminate unauthorized subagent dispatches and route spawning through proper tier hierarchy ([${roleBoundaries.permittedSpawns.join(", ")}]).`,
    );
  }

  // Invariant 1.4: Main-Thread Release Spillover
  if (context.isMainThreadExecution && context.role === "orchestrator") {
    const hasReleaseAction = context.recentActions?.some(
      (a) => a.action === "git_commit" || a.action === "git_push" || a.action === "sync_global",
    );
    if (hasReleaseAction) {
      invariantCompliance.background_finalization_confinement = false;
      findings.push({
        code: "MAIN_THREAD_RELEASE_SPILLOVER_VIOLATION",
        type: "role_invariants",
        severity: "high",
        title: "Main-Thread Release Spillover",
        description:
          "Release operations (git commit, git push, global sync) were executed on the main interactive thread rather than dedicated background worker threads.",
        recommendation:
          "Confine all final release packaging, git commits, and sync scripts to background execution threads.",
      });
      recommendedActions.push(
        "Execute final release commits and sync scripts strictly within background Orchestrator threads.",
      );
    }
  }
}
