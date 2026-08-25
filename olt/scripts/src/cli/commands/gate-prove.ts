import { resolve } from "node:path";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { isEvidenced } from "../../core/contracts/evidence.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import {
  appendGateProof,
  DEFAULT_BASE_REF,
  latestGateProof,
  proveGateFalsifiable,
  type GateProofRecord,
  type GateProveOutcome,
} from "../../graph/gate-proof.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { loadRun, transact } from "../../engine/store/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { actorFlag, integerFlag, textFlag, type Flags } from "../options.ts";
import { readPlanBindings } from "./plan-replan-bindings.ts";

// A record persisted before this fix has no `outcome` field; derive its equivalent so drift
// comparisons treat "falsifiable: true" the same whether or not the field was ever written.
function recordOutcome(record: Pick<GateProofRecord, "falsifiable" | "outcome">): GateProveOutcome {
  return record.outcome ?? (record.falsifiable ? "falsifiable" : "not_falsifiable");
}

// The machine-readable `outcome` value uses snake_case; this renders the same value the way the
// pre-existing "unchanged" / "REGRESSED" drift prose always has (space-separated words).
function humanOutcome(outcome: GateProveOutcome): string {
  switch (outcome) {
    case "falsifiable":
      return "falsifiable";
    case "not_falsifiable":
      return "not falsifiable";
    case "refused_absent_at_base":
      return "refused (absent at base)";
  }
}

function claimedBaseShaFor(state: JsonObject, taskId: string): string | undefined {
  if (!isJsonObject(state.tasks)) return undefined;
  const task = state.tasks[taskId];
  if (!isJsonObject(task) || !Array.isArray(task.attempts)) return undefined;
  const attempt = task.attempts.at(-1);
  if (!isJsonObject(attempt)) return undefined;
  const sha = attempt.claimed_base_sha;
  return isEvidenced(sha, (candidate): candidate is string => typeof candidate === "string")
    ? sha.value
    : undefined;
}

export function gateProveCommand(flags: Flags): Record<string, unknown> {
  const run = textFlag(flags, "run")!;
  const taskId = textFlag(flags, "task")!;
  const actor = actorFlag(flags);
  const explicitBase = textFlag(flags, "base", false);
  const wallTimeoutMs = integerFlag(flags, "timeout-ms", { minimum: 1_000 });
  const maxFiles = integerFlag(flags, "max-files", { minimum: 1 });

  const loaded = loadRun(run);
  const base = explicitBase ?? claimedBaseShaFor(loaded.state, taskId) ?? DEFAULT_BASE_REF;
  const binding = readPlanBindings(loaded.state).tasks.find((task) => task.id === taskId);
  if (!binding) throw new HarnessError("INVALID_ARGUMENT", `unknown task ${taskId}`);
  if (binding.gate === undefined) {
    throw new HarnessError(
      "INVALID_STATE",
      `task ${taskId} has no compiled task-scope gate to prove; run plan:compile first`,
    );
  }
  if (binding.writeScope.length === 0) {
    throw new HarnessError(
      "INVALID_STATE",
      `task ${taskId} has no write scope to revert; nothing for gate:prove to falsify`,
    );
  }

  const previous = latestGateProof(loaded.state, taskId, binding.gate);

  const repoRoot = findRepoRoot(run);
  const outcome = proveGateFalsifiable({
    repoRoot,
    writeScope: binding.writeScope,
    gateArgv: binding.gate,
    base,
    ...(wallTimeoutMs === undefined ? {} : { wallTimeoutMs }),
    ...(maxFiles === undefined ? {} : { maxFiles }),
  });

  const record: GateProofRecord = {
    task_id: taskId,
    gate_argv: [...binding.gate],
    write_scope: [...binding.writeScope],
    base: outcome.base,
    falsifiable: outcome.falsifiable,
    exit_code: outcome.exitCode,
    timed_out: outcome.timedOut,
    proved_at: new Date().toISOString(),
    actor,
    outcome: outcome.outcome,
    restored_paths: [...outcome.restoredPaths],
    deleted_paths: [...outcome.deletedPaths],
    reverted_scope: [...outcome.revertedScope],
    stdout_tail: outcome.stdoutTail,
    stderr_tail: outcome.stderrTail,
  };
  const state = transact(
    run,
    actor,
    "gate-proved",
    { task_id: taskId, falsifiable: outcome.falsifiable, exit_code: outcome.exitCode },
    (draft) => appendGateProof(draft, record),
  );

  const verdictLine =
    outcome.outcome === "refused_absent_at_base"
      ? `**REFUSED**: \`${taskId}\`'s effective write scope (${outcome.revertedScope.join(", ") || "none"}) has no representation at \`${outcome.base}\` — there is nothing to revert to, so gate:prove will not certify a falsifiability verdict against an absent counterfactual.`
      : outcome.timedOut
        ? "**UNPROVEN**: the gate timed out against the reverted tree; falsifiability could not be established."
        : outcome.falsifiable
          ? `**PROVEN FALSIFIABLE**: exits ${outcome.exitCode} once \`${taskId}\`'s write scope is reverted to \`${outcome.base}\`.`
          : `**NOT FALSIFIABLE**: still exits 0 with \`${taskId}\`'s write scope reverted to \`${outcome.base}\` — this gate cannot fail for this task.`;
  const driftLine =
    previous === undefined
      ? "- **Prior proof**: none recorded for this exact gate."
      : recordOutcome(previous) === outcome.outcome
        ? `- **Prior proof** (${previous.proved_at}): unchanged — also ${humanOutcome(recordOutcome(previous))}.`
        : `- **Prior proof** (${previous.proved_at}): **REGRESSED** — was ${humanOutcome(recordOutcome(previous))}, now ${humanOutcome(outcome.outcome)}.`;

  const markdown = enforceLineLimit(
    [
      `### Gate Proof: \`${taskId}\``,
      verdictLine,
      `- **Gate**: \`${binding.gate.join(" ")}\``,
      `- **Write scope**: ${binding.writeScope.join(", ")}`,
      `- **Reverted in scratch**: ${outcome.restoredPaths.length} restored, ${outcome.deletedPaths.length} removed, of ${outcome.copiedFileCount} files copied`,
      `- **Duration**: ${outcome.durationMs}ms`,
      driftLine,
    ].join("\n"),
    30,
  );

  return {
    markdown,
    run_root: run,
    task_id: taskId,
    outcome: outcome.outcome,
    falsifiable: outcome.falsifiable,
    exit_code: outcome.exitCode,
    timed_out: outcome.timedOut,
    base: outcome.base,
    restored_paths: outcome.restoredPaths,
    deleted_paths: outcome.deletedPaths,
    reverted_scope: outcome.revertedScope,
    previous_falsifiable: previous?.falsifiable ?? null,
    previous_outcome: previous ? recordOutcome(previous) : null,
    gate_proofs: state.gate_proofs,
  };
}
