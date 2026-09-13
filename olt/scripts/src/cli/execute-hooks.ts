import type { JsonObject } from "../core/contracts/index.ts";
import { HarnessError } from "../core/errors/index.ts";
import type { CommandSpec } from "./registry/index.ts";
import {
  executePostActionHook,
  executePreActionHook,
  getProfileForRole,
  isCanonicalRole,
  type AgentRole,
} from "../sentinel/index.ts";
import { isFileMutationCommand } from "../authority/rbac/index.ts";
import { agentIdToRole } from "../authority/thread/index.ts";

export async function executePreActionHooks(
  spec: CommandSpec,
  flags: Record<string, unknown>,
  remainder: readonly string[],
  checkRole: AgentRole | undefined,
  effectiveActor: string,
): Promise<void> {
  const isDiagnosticCommand =
    spec.name.startsWith("sentinel:") || spec.name.startsWith("doctor:") || spec.name === "doctor";

  if (isDiagnosticCommand) return;

  const isShellCategory =
    spec.name === "run:exec" ||
    spec.name === "shell" ||
    spec.name.startsWith("shell:") ||
    flags["tool-category"] === "shell" ||
    flags["tool-category"] === "test-runner";

  const isFileMutation =
    isFileMutationCommand(remainder) ||
    flags["action"] === "file_write" ||
    flags["action-type"] === "file_write";

  if (checkRole && isShellCategory) {
    const shellTarget =
      remainder.length > 0
        ? remainder.join(" ")
        : typeof flags["command"] === "string"
          ? (flags["command"] as string)
          : spec.name;

    const preAction = executePreActionHook({
      agent_id: effectiveActor,
      role: checkRole,
      action_type: "shell_command",
      target: shellTarget,
      task_id: typeof flags["task"] === "string" ? flags["task"] : undefined,
    });

    if (!preAction.allowed) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        preAction.reason ?? "Prohibited action",
        [],
        3,
        preAction.remediation,
      );
    }
  }

  if (checkRole && isFileMutation) {
    const targetFile =
      (remainder.length > 1
        ? remainder[remainder.length - 1]
        : typeof flags["target"] === "string"
          ? (flags["target"] as string)
          : typeof flags["file"] === "string"
            ? (flags["file"] as string)
            : undefined) ?? "unknown";

    const rawScope = flags["write-scope"] ?? flags["scope"];
    const writeScope =
      typeof rawScope === "string"
        ? rawScope
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : Array.isArray(rawScope)
          ? rawScope.map(String)
          : undefined;

    const filePreAction = executePreActionHook({
      agent_id: effectiveActor,
      role: checkRole,
      action_type: "file_write",
      target: targetFile,
      write_scope: writeScope,
      task_id: typeof flags["task"] === "string" ? flags["task"] : undefined,
    });

    if (!filePreAction.allowed) {
      throw new HarnessError(
        "ROLE_CONFINEMENT_VIOLATION",
        filePreAction.reason ?? "Prohibited action",
        [],
        3,
        filePreAction.remediation,
      );
    }
  }

  if (spec.name === "agent:register") {
    const childRole = typeof flags["role"] === "string" ? flags["role"] : undefined;
    const parentAgentId =
      typeof flags["parent-agent"] === "string" ? flags["parent-agent"] : undefined;

    let ledgerBackedParentRole: string | undefined;
    if (parentAgentId !== undefined) {
      const runForLedger = flags["run"] ?? flags["run-id"];
      if (typeof runForLedger === "string" && runForLedger.trim() !== "") {
        try {
          const { loadRun } = await import("../engine/store/index.ts");
          const { agents } = await import("../workflow/index.ts");
          const { readAgentLedger } = agents;
          const runData = loadRun(runForLedger as string, false);
          if (runData?.state) {
            const ledger = readAgentLedger(runData.state as unknown as JsonObject);
            const parentGrant = ledger.find((e) => e.id === parentAgentId);
            if (parentGrant?.role) {
              ledgerBackedParentRole = parentGrant.role;
            }
          }
        } catch {
          // ignore: a fake or unreadable run falls back to the heuristic below
        }
      }
    }

    if (parentAgentId !== undefined && ledgerBackedParentRole === undefined && childRole) {
      const heuristicParentRole = isCanonicalRole(parentAgentId)
        ? parentAgentId
        : agentIdToRole(parentAgentId);
      if (heuristicParentRole && isCanonicalRole(heuristicParentRole)) {
        const parentProfile = getProfileForRole(heuristicParentRole as AgentRole);
        const spawnViolations = parentProfile.evaluate({
          agent_id: parentAgentId,
          role: heuristicParentRole as AgentRole,
          child_agent_roles: [childRole],
          spawned_agent_roles: [childRole],
          role_target: childRole,
        });
        const crossTier = spawnViolations.find((v) => v.code === "CROSS_TIER_SPAWNING_VIOLATION");
        if (crossTier) {
          throw new HarnessError(
            "ROLE_CONFINEMENT_VIOLATION",
            crossTier.message,
            [],
            3,
            crossTier.remediation_cmd,
          );
        }
      }
    }
  }
}

export function executePostActionHooks(
  spec: CommandSpec,
  result: JsonObject | undefined,
  checkRole: AgentRole | undefined,
  effectiveActor: string,
): void {
  const isDiagnosticCommand =
    spec.name.startsWith("sentinel:") || spec.name.startsWith("doctor:") || spec.name === "doctor";

  if (!isDiagnosticCommand && result && typeof result === "object" && checkRole) {
    const modifiedFiles = Array.isArray(result["modified_files"])
      ? (result["modified_files"] as string[])
      : Array.isArray(result["files"])
        ? (result["files"] as string[])
        : undefined;

    if (modifiedFiles && modifiedFiles.length > 0) {
      const postAction = executePostActionHook({
        agent_id: effectiveActor,
        role: checkRole,
        modified_files: modifiedFiles,
      });
      if (!postAction.allowed) {
        const firstViolation = postAction.violations[0];
        throw new HarnessError(
          "ROLE_CONFINEMENT_VIOLATION",
          firstViolation?.message ?? "AST purity violation detected in modified files",
          firstViolation ? [firstViolation.message] : [],
          3,
          firstViolation?.remediation_cmd,
        );
      }
    }
  }
}
