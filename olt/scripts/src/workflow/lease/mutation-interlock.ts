import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { readAgentLedger } from "../agents/ledger.ts";
import { tokenMatches } from "./token.ts";

export interface MutationOperation {
  readonly type?: string | undefined;
  readonly targetPath?: string | undefined;
  readonly targetFile?: string | undefined;
  readonly taskId?: string | undefined;
  readonly token?: string | undefined;
  readonly writeScope?: readonly string[] | undefined;
}

export type MutationOpInput = string | MutationOperation | undefined;

export interface MutationInterlockResult {
  readonly allowed: boolean;
  readonly reason?: string | undefined;
  readonly runId: string;
  readonly agentId: string;
  readonly taskId?: string | undefined;
  readonly operation?: string | undefined;
}

function isCognitiveValidatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "validator" ||
    norm === "critic" ||
    norm === "cognitive-validator" ||
    norm === "completeness-critic" ||
    norm === "socratic-validator" ||
    norm === "plan-validator" ||
    norm === "ui-validator" ||
    norm === "mechanic-validator" ||
    norm === "ui-mechanic-validator" ||
    norm === "sub-validator" ||
    norm === "sub-investigator" ||
    norm === "skill-auditor" ||
    norm === "mind-auditor" ||
    norm.includes("validator") ||
    norm.includes("critic") ||
    norm.includes("auditor") ||
    norm.includes("investigator")
  );
}

function resolveStateFile(runId: string): string | null {
  const trimmed = runId.trim();
  const directState = join(trimmed, "state.json");
  if (existsSync(directState)) return directState;

  const candidates = [
    join(process.cwd(), trimmed, "state.json"),
    join(process.cwd(), ".olt", "capsules", trimmed, "state.json"),
    join(process.cwd(), "capsules", trimmed, "state.json"),
  ];
  try {
    const repo = findRepoRoot(trimmed);
    candidates.push(
      join(resolveCapsulesDir(repo), trimmed, "state.json"),
      join(repo, ".olt", "capsules", trimmed, "state.json"),
    );
  } catch {}
  try {
    const defaultRepo = findRepoRoot();
    candidates.push(
      join(resolveCapsulesDir(defaultRepo), trimmed, "state.json"),
      join(defaultRepo, ".olt", "capsules", trimmed, "state.json"),
    );
  } catch {}

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function verifyMutationInterlock(
  runId: string,
  agentId: string,
  operation?: MutationOpInput,
): MutationInterlockResult {
  if (!runId || !runId.trim()) {
    return {
      allowed: false,
      reason: "LEASE_REQUIRED: runId is required",
      runId: runId ?? "",
      agentId: agentId ?? "",
    };
  }
  if (!agentId || !agentId.trim()) {
    return {
      allowed: false,
      reason: "LEASE_REQUIRED: agentId is required",
      runId,
      agentId: agentId ?? "",
    };
  }

  const opObj: MutationOperation =
    typeof operation === "string" ? { type: operation } : (operation ?? {});
  const statePath = resolveStateFile(runId);
  if (!statePath) {
    return {
      allowed: false,
      reason: `LEASE_REQUIRED: capsule state not found on disk for run ${runId}`,
      runId,
      agentId,
      taskId: opObj.taskId,
      operation: opObj.type,
    };
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      allowed: false,
      reason: `LEASE_REQUIRED: failed to read capsule state for run ${runId}: ${msg}`,
      runId,
      agentId,
      taskId: opObj.taskId,
      operation: opObj.type,
    };
  }

  const ledger = readAgentLedger(state as Parameters<typeof readAgentLedger>[0]);
  const agentGrant = ledger.find((g) => g.id === agentId);

  if (agentGrant) {
    if (isCognitiveValidatorRole(agentGrant.role)) {
      return {
        allowed: false,
        reason: `ROLE_CONFINEMENT_VIOLATION: agent ${agentId} (${agentGrant.role}) is confined to read-only audits`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
    if (agentGrant.status === "released") {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: agent ${agentId} grant has been released`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
    if (agentGrant.status !== "active") {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: agent ${agentId} grant status is '${agentGrant.status}', expected 'active'`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
  }

  const tasks =
    state.tasks && typeof state.tasks === "object" ? (state.tasks as Record<string, unknown>) : {};
  if (opObj.taskId) {
    const task = tasks[opObj.taskId] as
      | { lease?: { agent_id?: string; token_digest?: string; expires_at?: string } }
      | undefined;
    if (!task || !task.lease) {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: task ${opObj.taskId} has no active lease`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
    if (task.lease.agent_id !== agentId) {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: task ${opObj.taskId} lease held by '${task.lease.agent_id}', not '${agentId}'`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
    if (
      opObj.token &&
      task.lease.token_digest &&
      !tokenMatches(opObj.token, task.lease.token_digest)
    ) {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: token mismatch for task ${opObj.taskId}`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
    if (task.lease.expires_at && Date.parse(task.lease.expires_at) <= Date.now()) {
      return {
        allowed: false,
        reason: `LEASE_EXPIRED: lease for task ${opObj.taskId} expired at ${task.lease.expires_at}`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
  } else if (!agentGrant) {
    const hasAnyActiveTaskLease = Object.entries(tasks).some(([_, t]) => {
      if (!t || typeof t !== "object") return false;
      const lease = (t as { lease?: { agent_id?: string; expires_at?: string } }).lease;
      return (
        lease?.agent_id === agentId &&
        (!lease.expires_at || Date.parse(lease.expires_at) > Date.now())
      );
    });
    if (!hasAnyActiveTaskLease) {
      return {
        allowed: false,
        reason: `LEASE_REQUIRED: agent ${agentId} holds no active grant or task lease in capsule ${runId}`,
        runId,
        agentId,
        taskId: opObj.taskId,
        operation: opObj.type,
      };
    }
  }

  const targetFile = opObj.targetFile ?? opObj.targetPath;
  if (targetFile) {
    const writeScope = opObj.writeScope;
    if (writeScope && writeScope.length > 0) {
      const withinScope = writeScope.some((s) => targetFile.startsWith(s) || targetFile === s);
      if (!withinScope) {
        return {
          allowed: false,
          reason: `PERMISSION_DENIED: target '${targetFile}' is outside write scope [${writeScope.join(", ")}]`,
          runId,
          agentId,
          taskId: opObj.taskId,
          operation: opObj.type,
        };
      }
    }
  }

  return { allowed: true, runId, agentId, taskId: opObj.taskId, operation: opObj.type };
}

export function assertMutationInterlock(
  runId: string,
  agentId: string,
  operation?: MutationOpInput,
): void {
  const res = verifyMutationInterlock(runId, agentId, operation);
  if (!res.allowed) {
    const isConfine = res.reason?.startsWith("ROLE_CONFINEMENT_VIOLATION");
    const code = isConfine ? "ROLE_CONFINEMENT_VIOLATION" : "PERMISSION_DENIED";
    throw new HarnessError(code, res.reason ?? "PERMISSION_DENIED: mutation interlock failed");
  }
}
