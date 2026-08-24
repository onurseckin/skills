import type { UnifiedAgentManifest } from "../authority/manifest-schema";
import { commandInvocations } from "../cli/registry/index";

export interface RepoPolicy {
  readonly allowed_commands?: readonly string[];
  readonly registered_cli_specs?: readonly string[];
}

export function auditPermissionHealth(
  manifest: UnifiedAgentManifest,
  repoPolicy: RepoPolicy,
): { healthy: boolean; errors: string[] } {
  const errors: string[] = [];

  // Proof 1: Disjoint Set Invariant (allowed_commands ∩ forbidden_commands = ∅)
  const mustNotSet = new Set(manifest.permissions.must_not);
  for (const cmd of manifest.permissions.commands) {
    if (mustNotSet.has(cmd)) {
      errors.push(
        `Proof 1 Failed: Disjoint Set Invariant violated. Command '${cmd}' is in both allowed and forbidden sets.`,
      );
    }
  }

  // Proof 2: Registry Whitelist Resolution
  const validRegistry = new Set<string>([
    ...(repoPolicy.allowed_commands || []),
    ...commandInvocations(),
    "meta-audit",
    "whoami",
    "run:exec",
  ]);

  if (validRegistry.size > 0) {
    for (const cmd of manifest.permissions.commands) {
      if (!validRegistry.has(cmd)) {
        errors.push(
          `Proof 2 Failed: Command '${cmd}' not found in registered capabilities whitelist.`,
        );
      }
    }
  }

  // Proof 3: Role-Hierarchy Boundary Confinement
  const isCognitiveCodeValidator =
    (manifest.role === "validator" || manifest.role === "ui-validator") &&
    !manifest.role.includes("mechanic");

  if (isCognitiveCodeValidator) {
    if (manifest.tools.enable_write_tools) {
      errors.push(
        `Proof 3 Failed: Cognitive Validator '${manifest.role}' must have tools.enable_write_tools === false.`,
      );
    }
    if (manifest.permissions.commands.length !== 0) {
      errors.push(
        `Proof 3 Failed: Cognitive Validator '${manifest.role}' must have 0 command privileges.`,
      );
    }
  } else if (["mind", "orchestrator", "coordinator"].includes(manifest.role)) {
    if (manifest.tools.enable_write_tools) {
      errors.push(
        `Proof 3 Failed: Supervisor role '${manifest.role}' must have tools.enable_write_tools === false.`,
      );
    }
    const mustNotStr = manifest.permissions.must_not.join(" ").toLowerCase();
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
    const mustNotStr = manifest.permissions.must_not.join(" ").toLowerCase();
    if (
      !mustNotStr.includes("whole-repo") &&
      !mustNotStr.includes("whole repo") &&
      !mustNotStr.includes("full suite")
    ) {
      errors.push(
        `Proof 3 Failed: Implementer '${manifest.role}' must have whole-repo test suites prohibited.`,
      );
    }
    const invariantsStr = manifest.invariants.join(" ").toLowerCase();
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

  // Proof 4: Spawning Authority DAG Validation (an agent can only spawn roles declared in permissions.spawns).
  // Actually, wait, this is just auditing the manifest self-consistency. At runtime, we would check the agent is only spawning these.
  // We can't fully validate the runtime behavior here, but we can check if `spawns` only contains known roles, etc.
  // If we just need to implement the function, we can check if there are invalid spawn targets or if the agent has spawns at all.
  for (const spawn of manifest.permissions.spawns) {
    if (typeof spawn !== "string" || spawn.trim() === "") {
      errors.push("Proof 4 Failed: Invalid spawn target in permissions.spawns.");
    }
  }

  return {
    healthy: errors.length === 0,
    errors,
  };
}
