import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { agentIdToRole, agentIdToTier, roleToTier } from "../../authority/thread/index.ts";

export function enforceTurn1OrchestratorInit(runRoot: string, orchId: string): void {
  if (typeof runRoot !== "string" || !runRoot.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "runRoot must be a non-empty string");
  }
  if (typeof orchId !== "string" || !orchId.trim()) {
    throw new HarnessError("INVALID_ARGUMENT", "orchId must be a non-empty string");
  }

  const normalizedOrchId = orchId.trim();
  const role = agentIdToRole(normalizedOrchId);
  const tier = role !== null ? roleToTier(role) : agentIdToTier(normalizedOrchId);

  const isOrchRole = role === "orchestrator" || role === "mind";
  const isOrchTier = tier === 1 || tier === 0;

  if (!isOrchRole && !isOrchTier) {
    throw new HarnessError(
      "ROLE_CONFINEMENT_VIOLATION",
      `Role '${role ?? "unknown"}' (${normalizedOrchId}) is not authorized for Orchestrator Turn 1 initialization`,
    );
  }

  const resolvedPath = resolve(runRoot.trim());
  if (!existsSync(resolvedPath)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Orchestrator Turn 1 capsule initialization required: runRoot does not exist at '${resolvedPath}'`,
    );
  }

  const statePath = join(resolvedPath, "state.json");
  if (!existsSync(statePath)) {
    throw new HarnessError(
      "INVALID_STATE",
      `Orchestrator Turn 1 capsule initialization required: missing state.json at '${resolvedPath}'. Must execute run:init first.`,
    );
  }

  try {
    const rawState = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(rawState);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("state.json root must be a JSON object");
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessError(
      "INTEGRITY",
      `Orchestrator Turn 1 verification failed: corrupted state.json at '${statePath}': ${message}`,
    );
  }
}
