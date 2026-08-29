export interface AgentManifestLike {
  readonly role: string;
  readonly tools: {
    readonly enable_write_tools?: boolean;
    readonly enable_mcp_tools?: boolean;
    readonly enable_subagent_tools?: boolean;
  };
  readonly permissions: {
    readonly must_not?: readonly string[];
    readonly commands?: readonly string[];
    readonly spawns?: readonly string[];
  };
  readonly invariants?: readonly string[];
}

export interface RepoPolicy {
  readonly allowed_commands?: readonly string[];
  readonly registered_cli_specs?: readonly string[];
}

export function auditPermissionHealth(
  manifest: AgentManifestLike,
  repoPolicy: RepoPolicy,
  registeredCommands?: readonly string[],
): { healthy: boolean; errors: string[] } {
  const errors: string[] = [];

  const mustNotSet = new Set(manifest.permissions.must_not);
  if (manifest.permissions.commands) {
    for (const cmd of manifest.permissions.commands) {
      if (mustNotSet.has(cmd)) {
        errors.push(
          `Proof 1 Failed: Disjoint Set Invariant violated. Command '${cmd}' is in both allowed and forbidden sets.`,
        );
      }
    }
  }

  const validRegistry = new Set<string>([
    ...(repoPolicy.allowed_commands || []),
    ...(repoPolicy.registered_cli_specs || []),
    ...(registeredCommands || []),
    "agent:register",
    "agent:release",
    "agent:report",
    "agent:list",
    "agent:brief",
    "authority:decide",
    "branch:create",
    "branch:commit",
    "branch:sync",
    "branch:status",
    "branch:consolidate",
    "coordinator:pushback",
    "critic:report",
    "critic:review",
    "dag:view",
    "dag:export",
    "diagnostics:run",
    "diagnostics:telemetry",
    "doctor",
    "gate:prove",
    "gate:verify",
    "gate:check",
    "inspection:run",
    "inspection:status",
    "memory:store",
    "memory:recall",
    "meta-audit",
    "mind:admit",
    "mind:audit",
    "mind:audit-live",
    "mind:halt",
    "mind:init",
    "mind:observe",
    "mind:pulse-open",
    "mind:pulse",
    "mind:quiesce",
    "mind:rotate",
    "mind:round",
    "mind:wake",
    "msg:send",
    "msg:recv",
    "msg:poll",
    "orphan:list",
    "orphan:claim",
    "orphan:sweep",
    "plan:apply",
    "plan:audit",
    "plan:compile",
    "plan:replan",
    "plan:replan-bindings",
    "plan:replan-findings",
    "plan:validate",
    "plan:list",
    "queue:list",
    "queue:pop",
    "recover",
    "run:exec",
    "run:complete",
    "run:status",
    "run:abort",
    "shell",
    "skill:audit",
    "skill:audit-live",
    "summary:run",
    "summary:report",
    "task:validate-start",
    "task:probe",
    "task:review",
    "task:claim",
    "task:reject",
    "task:abandon",
    "task:brief",
    "task:check",
    "task:assign-repairer",
    "task:finding-input",
    "task:review-support",
    "whoami",
  ]);

  if (manifest.permissions.commands && validRegistry.size > 0) {
    for (const cmd of manifest.permissions.commands) {
      if (!validRegistry.has(cmd)) {
        errors.push(
          `Proof 2 Failed: Command '${cmd}' not found in registered capabilities whitelist.`,
        );
      }
    }
  }

  const isCognitiveCodeValidator =
    (manifest.role === "validator" || manifest.role === "ui-validator") &&
    !manifest.role.includes("mechanic");

  if (isCognitiveCodeValidator) {
    if (manifest.tools.enable_write_tools) {
      errors.push(
        `Proof 3 Failed: Cognitive Validator '${manifest.role}' must have tools.enable_write_tools === false.`,
      );
    }
    if (manifest.permissions.commands?.includes("run:exec")) {
      errors.push(
        `Proof 3 Failed: Cognitive Validator '${manifest.role}' must have 0 command execution privileges.`,
      );
    }
  } else if (["mind", "orchestrator", "coordinator"].includes(manifest.role)) {
    if (manifest.tools.enable_write_tools) {
      errors.push(
        `Proof 3 Failed: Supervisor role '${manifest.role}' must have tools.enable_write_tools === false.`,
      );
    }
    const mustNotStr = (manifest.permissions.must_not ?? []).join(" ").toLowerCase();
    const hasProhibitionFileEdits =
      mustNotStr.includes("file edit") ||
      mustNotStr.includes("edit file") ||
      mustNotStr.includes("code") ||
      mustNotStr.includes("repository file") ||
      mustNotStr.includes("write, edit") ||
      mustNotStr.includes("write repository code");

    if (!hasProhibitionFileEdits) {
      errors.push(
        `Proof 3 Failed: Supervisor role '${manifest.role}' must have prohibitions against file edits in must_not.`,
      );
    }
  } else if (manifest.role.includes("implementer") || manifest.role === "worker") {
    const mustNotStr = (manifest.permissions.must_not ?? []).join(" ").toLowerCase();
    if (
      !mustNotStr.includes("whole-repo") &&
      !mustNotStr.includes("whole repo") &&
      !mustNotStr.includes("full suite")
    ) {
      errors.push(
        `Proof 3 Failed: Implementer '${manifest.role}' must have whole-repo test suites prohibited.`,
      );
    }
    const invariantsStr = (manifest.invariants ?? []).join(" ").toLowerCase();
    if (
      !invariantsStr.includes("file-scoped") &&
      !invariantsStr.includes("file_scoped") &&
      !invariantsStr.includes("file scoped")
    ) {
      errors.push(
        `Proof 3 Failed: Implementer '${manifest.role}' must have file-scoped test invariants.`,
      );
    }
  }

  for (const spawn of manifest.permissions.spawns ?? []) {
    if (typeof spawn !== "string" || spawn.trim() === "") {
      errors.push("Proof 4 Failed: Invalid spawn target in permissions.spawns.");
    }
  }

  return {
    healthy: errors.length === 0,
    errors,
  };
}
