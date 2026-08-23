import type { CommandRecord } from "../core/contracts/commands.ts";
import { sameCommandJson } from "../engine/runner/command-shape.ts";

export function sameOptionalJson(left: unknown, right: unknown): boolean {
  if (left == null && right == null) return true;
  if (left === undefined || right === undefined) return left === right;
  return sameCommandJson(left, right);
}

export function sameRepositoryTransition(intent: CommandRecord, terminal: CommandRecord): boolean {
  if (intent.gate_id === null)
    return sameOptionalJson(intent.repository_after, terminal.repository_after);
  return (
    intent.repository_after === null &&
    (terminal.repository_after != null || terminal.preflight_failure !== undefined)
  );
}

export function sameIntent(left: CommandRecord, right: CommandRecord): boolean {
  return (
    left.id === right.id &&
    left.fingerprint === right.fingerprint &&
    left.attempt_signing_public_key === right.attempt_signing_public_key &&
    left.cwd === right.cwd &&
    left.cwd_relative === right.cwd_relative &&
    left.repository_root === right.repository_root &&
    left.started_at === right.started_at &&
    left.task_id === right.task_id &&
    left.gate_id === right.gate_id &&
    left.record_path === right.record_path &&
    left.actor === right.actor &&
    left.assurance === right.assurance &&
    sameOptionalJson(left.repository_before, right.repository_before) &&
    sameRepositoryTransition(left, right) &&
    sameCommandJson(left.policy, right.policy) &&
    sameCommandJson(left.path_bindings ?? [], right.path_bindings ?? []) &&
    sameCommandJson(left.environment ?? {}, right.environment ?? {})
  );
}
