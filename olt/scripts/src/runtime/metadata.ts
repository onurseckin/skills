import { HarnessError } from "../core/errors/index.ts";
import type { ReviewProtocolPolicy } from "../policy/types/index.ts";
import type { AgentMetadata } from "./contracts.ts";

export function inferTierFromRole(role: string): number {
  const normalized = role.trim().toLowerCase();
  if (normalized === "mind") return 0;
  if (normalized === "orchestrator") return 1;
  if (
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor" ||
    normalized === "mind-auditor" ||
    normalized === "mind_auditor"
  ) {
    return 2;
  }
  return 3;
}

export function inferCanExecuteShell(role: string): boolean {
  const normalized = role.trim().toLowerCase();
  // Cognitive validators are STRICTLY forbidden from shell execution (0 commands)
  if (
    normalized === "validator" ||
    normalized === "cognitive-validator" ||
    normalized === "cognitive_validator" ||
    normalized.startsWith("validator-") ||
    normalized === "critic" ||
    normalized === "completeness-critic" ||
    normalized === "completeness_critic" ||
    normalized === "planner" ||
    normalized === "plan-validator" ||
    normalized === "plan_validator" ||
    normalized === "sub-investigator" ||
    normalized === "sub_investigator" ||
    normalized === "mind" ||
    normalized === "orchestrator" ||
    normalized === "coordinator" ||
    normalized === "meta-auditor" ||
    normalized === "meta_auditor"
  ) {
    return false;
  }

  if (
    normalized === "implementer" ||
    normalized === "repairer" ||
    normalized === "sub-implementer" ||
    normalized === "sub_implementer" ||
    normalized === "mechanic-validator" ||
    normalized === "mechanic_validator" ||
    normalized === "sub-validator" ||
    normalized === "sub_validator" ||
    normalized === "worker" ||
    normalized === "owner"
  ) {
    return true;
  }

  return false;
}

export function createAgentMetadata(params: {
  readonly agent_id: string;
  readonly role: string;
  readonly tier?: number | undefined;
  readonly write_scope?: readonly string[] | undefined;
  readonly allowed_read_scope?: readonly string[] | undefined;
  readonly can_execute_shell?: boolean | undefined;
  readonly run_id?: string | undefined;
  readonly task_id?: string | undefined;
  readonly review_config?: ReviewProtocolPolicy | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}): AgentMetadata {
  const tier = params.tier !== undefined ? params.tier : inferTierFromRole(params.role);
  const roleCanExecute = inferCanExecuteShell(params.role);
  // Zero-shell roles (validators, supervisors, critics) can NEVER be overridden to true
  const canExecuteShell = !roleCanExecute
    ? false
    : params.can_execute_shell !== undefined
      ? params.can_execute_shell
      : true;

  return {
    agent_id: params.agent_id,
    role: params.role,
    tier,
    write_scope: params.write_scope ?? [],
    allowed_read_scope: params.allowed_read_scope ?? [],
    can_execute_shell: canExecuteShell,
    spawned_at: new Date().toISOString(),
    ...(params.run_id ? { run_id: params.run_id } : {}),
    ...(params.task_id ? { task_id: params.task_id } : {}),
    ...(params.review_config ? { review_config: params.review_config } : {}),
    ...(params.metadata ? { metadata: params.metadata } : {}),
  };
}

export function metadataIntegrityError(filePath: string, reason: string): never {
  throw new HarnessError("INTEGRITY", `invalid agent metadata at '${filePath}': ${reason}`);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function assertSafeAgentId(agentId: string): void {
  if (
    !isNonEmptyString(agentId) ||
    agentId === "." ||
    agentId === ".." ||
    /[\\/\0]/.test(agentId)
  ) {
    throw new HarnessError("PATH_SAFETY", "agent_id must be a safe single path component");
  }
}

export function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function parseReviewConfig(value: unknown, filePath: string): ReviewProtocolPolicy {
  if (!isRecord(value)) {
    metadataIntegrityError(filePath, "review_config must be an object");
  }
  const maxAdversarialPushes = value["max_adversarial_pushes"];
  if (
    typeof maxAdversarialPushes !== "number" ||
    !Number.isSafeInteger(maxAdversarialPushes) ||
    maxAdversarialPushes < 1
  ) {
    metadataIntegrityError(
      filePath,
      "review_config.max_adversarial_pushes must be a safe integer greater than zero",
    );
  }
  const cognitivePushes = value["cognitive_pushes"];
  if (
    typeof cognitivePushes !== "number" ||
    !Number.isSafeInteger(cognitivePushes) ||
    cognitivePushes < 0
  ) {
    metadataIntegrityError(
      filePath,
      "review_config.cognitive_pushes must be a nonnegative safe integer",
    );
  }
  const escalation = value["escalate_on_exhausted_adversarial"];
  if (escalation !== undefined && typeof escalation !== "boolean") {
    metadataIntegrityError(
      filePath,
      "review_config.escalate_on_exhausted_adversarial must be a boolean when present",
    );
  }
  return {
    max_adversarial_pushes: maxAdversarialPushes,
    cognitive_pushes: cognitivePushes,
    ...(escalation === undefined ? {} : { escalate_on_exhausted_adversarial: escalation }),
  };
}

export function validateAgentMetadata(
  value: unknown,
  expectedAgentId: string,
  filePath: string,
): AgentMetadata {
  if (!isRecord(value)) metadataIntegrityError(filePath, "expected a JSON object");
  const agentId = value["agent_id"];
  if (!isNonEmptyString(agentId))
    metadataIntegrityError(filePath, "agent_id must be a nonempty string");
  if (agentId !== expectedAgentId) {
    metadataIntegrityError(
      filePath,
      `agent_id '${agentId}' does not match requested '${expectedAgentId}'`,
    );
  }
  const role = value["role"];
  if (!isNonEmptyString(role)) metadataIntegrityError(filePath, "role must be a nonempty string");
  const tier = value["tier"];
  if (typeof tier !== "number" || !Number.isSafeInteger(tier) || tier < 0 || tier > 3) {
    metadataIntegrityError(filePath, "tier must be a safe integer in the range 0 through 3");
  }
  const writeScope = value["write_scope"];
  if (!isStringArray(writeScope))
    metadataIntegrityError(filePath, "write_scope must be an array of strings");
  const allowedReadScope = value["allowed_read_scope"];
  if (!isStringArray(allowedReadScope)) {
    metadataIntegrityError(filePath, "allowed_read_scope must be an array of strings");
  }
  const canExecuteShell = value["can_execute_shell"];
  if (typeof canExecuteShell !== "boolean") {
    metadataIntegrityError(filePath, "can_execute_shell must be a boolean");
  }
  const spawnedAt = value["spawned_at"];
  if (!isNonEmptyString(spawnedAt))
    metadataIntegrityError(filePath, "spawned_at must be a nonempty string");

  const runId = value["run_id"];
  if (runId !== undefined && !isNonEmptyString(runId)) {
    metadataIntegrityError(filePath, "run_id must be a nonempty string when present");
  }
  const taskId = value["task_id"];
  if (taskId !== undefined && !isNonEmptyString(taskId)) {
    metadataIntegrityError(filePath, "task_id must be a nonempty string when present");
  }
  const reviewConfig = value["review_config"];
  const metadata = value["metadata"];
  if (metadata !== undefined && !isRecord(metadata)) {
    metadataIntegrityError(filePath, "metadata must be an object when present");
  }

  return {
    agent_id: agentId,
    role,
    tier,
    write_scope: writeScope,
    allowed_read_scope: allowedReadScope,
    can_execute_shell: canExecuteShell,
    spawned_at: spawnedAt,
    ...(runId === undefined ? {} : { run_id: runId }),
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(reviewConfig === undefined
      ? {}
      : { review_config: parseReviewConfig(reviewConfig, filePath) }),
    ...(metadata === undefined ? {} : { metadata }),
  };
}
