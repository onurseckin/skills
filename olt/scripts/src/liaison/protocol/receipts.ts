import type {
  BindingProof,
  BindingVerificationItem,
  BindingVerificationSummary,
  ReceiptBound,
  ReceiptDelivered,
  ReceiptRefused,
  RefusalReason,
  SatisfyingArtefactProof,
  ScopeLookupFn,
  TaskScopeBindingProof,
  TwoPhaseReceipt,
  WriteScopeRecord,
} from "./types.ts";

export function createReceiptDelivered(
  messageId: string,
  correlationId: string,
  timestamp: string = new Date().toISOString(),
): ReceiptDelivered {
  return {
    type: "RECEIPT_DELIVERED",
    message_id: messageId,
    correlation_id: correlationId,
    timestamp,
  };
}

export function createTaskScopeProof(
  path: string,
  runId: string,
  taskId: string,
): TaskScopeBindingProof {
  return { kind: "task_scope", path, run_id: runId, task_id: taskId };
}

export function createArtefactProof(
  proof: Omit<SatisfyingArtefactProof, "kind">,
): SatisfyingArtefactProof {
  return { kind: "artefact", ...proof };
}

export function createReceiptBound(
  messageId: string,
  correlationId: string,
  bindings: readonly BindingProof[],
  timestamp: string = new Date().toISOString(),
): ReceiptBound {
  return {
    type: "RECEIPT_BOUND",
    message_id: messageId,
    correlation_id: correlationId,
    timestamp,
    bindings,
  };
}

export function createReceiptRefused(
  messageId: string,
  correlationId: string,
  reason: RefusalReason,
  requirementOrPath: string,
  details?: string,
  timestamp: string = new Date().toISOString(),
): ReceiptRefused {
  return {
    type: "RECEIPT_REFUSED",
    message_id: messageId,
    correlation_id: correlationId,
    timestamp,
    reason,
    requirement_or_path: requirementOrPath,
    ...(details !== undefined ? { details } : {}),
  };
}

export function isReceiptDelivered(value: unknown): value is ReceiptDelivered {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c.type === "RECEIPT_DELIVERED" &&
    typeof c.message_id === "string" &&
    typeof c.correlation_id === "string" &&
    typeof c.timestamp === "string"
  );
}

export function isReceiptBound(value: unknown): value is ReceiptBound {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    c.type === "RECEIPT_BOUND" &&
    typeof c.message_id === "string" &&
    typeof c.correlation_id === "string" &&
    typeof c.timestamp === "string" &&
    Array.isArray(c.bindings)
  );
}

export function isReceiptRefused(value: unknown): value is ReceiptRefused {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  const reasons: readonly string[] = ["out_of_scope", "disagreed", "blocked"];
  return (
    c.type === "RECEIPT_REFUSED" &&
    typeof c.message_id === "string" &&
    typeof c.correlation_id === "string" &&
    typeof c.timestamp === "string" &&
    typeof c.requirement_or_path === "string" &&
    typeof c.reason === "string" &&
    reasons.includes(c.reason)
  );
}

export function isTwoPhaseReceipt(value: unknown): value is TwoPhaseReceipt {
  return isReceiptDelivered(value) || isReceiptBound(value) || isReceiptRefused(value);
}

export function normalizePath(inputPath: string): string {
  return inputPath.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function isPathContainedInScope(targetPath: string, scopeEntry: string): boolean {
  const normTarget = normalizePath(targetPath);
  const normScope = normalizePath(scopeEntry);
  return normTarget === normScope || normTarget.startsWith(`${normScope}/`);
}

function verifyScopeContainment(
  proof: TaskScopeBindingProof,
  writeScope: readonly string[] | undefined,
): BindingVerificationItem {
  if (!writeScope || writeScope.length === 0) {
    return {
      proof,
      valid: false,
      reason: `No write scope found for task "${proof.task_id}" in run "${proof.run_id}"`,
    };
  }
  const matched = writeScope.some((entry) => isPathContainedInScope(proof.path, entry));
  if (!matched) {
    return {
      proof,
      valid: false,
      reason: `Path "${proof.path}" not found in write scope [${writeScope.join(", ")}] for task "${proof.task_id}"`,
    };
  }
  return { proof, valid: true };
}

function verifyArtefact(proof: SatisfyingArtefactProof): BindingVerificationItem {
  const hasPath = typeof proof.artefact_path === "string" && proof.artefact_path.trim().length > 0;
  const hasCommit = typeof proof.commit_hash === "string" && proof.commit_hash.trim().length > 0;
  if (!hasPath && !hasCommit) {
    return {
      proof,
      valid: false,
      reason: "Artefact proof requires at least one non-empty artefact_path or commit_hash",
    };
  }
  return { proof, valid: true };
}

export async function verifyBindingProof(
  proof: BindingProof,
  scopes: readonly WriteScopeRecord[] | ScopeLookupFn,
): Promise<BindingVerificationItem> {
  if (proof.kind === "artefact") return verifyArtefact(proof);

  let writeScope: readonly string[] | undefined;
  if (typeof scopes === "function") {
    writeScope = await scopes(proof.run_id, proof.task_id);
  } else {
    const found = scopes.find((s) => s.run_id === proof.run_id && s.task_id === proof.task_id);
    writeScope = found?.write_scope;
  }
  return verifyScopeContainment(proof, writeScope);
}

export function verifyBindingProofSync(
  proof: BindingProof,
  scopes:
    | readonly WriteScopeRecord[]
    | ((runId: string, taskId: string) => readonly string[] | undefined),
): BindingVerificationItem {
  if (proof.kind === "artefact") return verifyArtefact(proof);

  let writeScope: readonly string[] | undefined;
  if (typeof scopes === "function") {
    writeScope = scopes(proof.run_id, proof.task_id);
  } else {
    const found = scopes.find((s) => s.run_id === proof.run_id && s.task_id === proof.task_id);
    writeScope = found?.write_scope;
  }
  return verifyScopeContainment(proof, writeScope);
}

export async function verifyReceiptBound(
  receipt: ReceiptBound,
  scopes: readonly WriteScopeRecord[] | ScopeLookupFn,
): Promise<BindingVerificationSummary> {
  if (!receipt.bindings || receipt.bindings.length === 0) {
    return { valid: false, results: [], errors: ["Receipt bound carries no binding proofs"] };
  }
  const results: BindingVerificationItem[] = [];
  const errors: string[] = [];
  for (const proof of receipt.bindings) {
    const res = await verifyBindingProof(proof, scopes);
    results.push(res);
    if (!res.valid && res.reason) errors.push(res.reason);
  }
  return { valid: errors.length === 0, results, errors };
}

export function verifyReceiptBoundSync(
  receipt: ReceiptBound,
  scopes:
    | readonly WriteScopeRecord[]
    | ((runId: string, taskId: string) => readonly string[] | undefined),
): BindingVerificationSummary {
  if (!receipt.bindings || receipt.bindings.length === 0) {
    return { valid: false, results: [], errors: ["Receipt bound carries no binding proofs"] };
  }
  const results: BindingVerificationItem[] = [];
  const errors: string[] = [];
  for (const proof of receipt.bindings) {
    const res = verifyBindingProofSync(proof, scopes);
    results.push(res);
    if (!res.valid && res.reason) errors.push(res.reason);
  }
  return { valid: errors.length === 0, results, errors };
}
