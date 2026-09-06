import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { workflowPort } from "../../integration/index.ts";
import type { WorkflowState } from "../types.ts";
import { openValidations } from "../review/validation-state.ts";

export function assertCriticIndependent(state: WorkflowState, criticId: string): void {
  const conflicted = Object.values(state.tasks).some(
    (task) =>
      task.original_implementer === criticId ||
      task.repair_assignee === criticId ||
      task.lease?.agent_id === criticId ||
      task.attempts.some((attempt) => attempt.agent_id === criticId) ||
      openValidations(task).some((attempt) => attempt.validator_id === criticId) ||
      (task.validation_history ?? []).some((attempt) => attempt.validator_id === criticId),
  );
  if (conflicted)
    throw new HarnessError(
      "INVALID_STATE",
      "completeness critic must be independent from implementers, repairers, and validators",
    );
}

export function saveCriticPacket(run: string, data: Record<string, unknown>): void {
  const dirs = new Set<string>([run]);
  try {
    dirs.add(loadRun(run).runRoot);
  } catch {}
  for (const dir of dirs) {
    try {
      writeFileSync(
        join(dir, "critic-packet.json"),
        JSON.stringify({ ...data, created_at: new Date().toISOString() }, null, 2),
        "utf-8",
      );
    } catch {}
  }
}

export function loadCriticRolePacket(run: string): Record<string, unknown> | null {
  const dirs = [run, join(process.cwd(), ".olt", "capsules", run), join(process.cwd(), run)];
  try {
    dirs.push(loadRun(run).runRoot);
  } catch {}
  for (const dir of dirs) {
    const file = join(dir, "critic-packet.json");
    if (existsSync(file)) {
      try {
        const obj = JSON.parse(readFileSync(file, "utf-8")) as unknown;
        if (typeof obj === "object" && obj !== null && !Array.isArray(obj))
          return obj as Record<string, unknown>;
      } catch {}
    }
    const pDir = join(dir, "packets");
    if (existsSync(pDir)) {
      try {
        for (const e of readdirSync(pDir)) {
          for (const f of ["critic-packet.json", "metadata.json"]) {
            const target = join(pDir, e, f);
            if (existsSync(target)) {
              const meta = JSON.parse(readFileSync(target, "utf-8")) as Record<string, unknown>;
              if (meta && (meta.token || meta.critic_token || meta.lease_token)) return meta;
            }
          }
        }
      } catch {}
    }
  }
  return null;
}

export function resolveCriticToken(run: string, _critic?: string, explicitToken?: string): string {
  if (explicitToken && explicitToken.trim()) return explicitToken.trim();
  const packet = loadCriticRolePacket(run);
  const cand = packet?.token ?? packet?.critic_token ?? packet?.lease_token ?? packet?.criticToken;
  if (typeof cand === "string" && cand.trim()) return cand.trim();
  try {
    const state = workflowPort(run).read() as Record<string, unknown>;
    const r = state.completion_review as Record<string, unknown> | undefined;
    const c = state.completion_critic as Record<string, unknown> | undefined;
    const l = (state.critic_lease ?? state.lease) as Record<string, unknown> | undefined;
    for (const val of [
      r?.critic_token,
      r?.token,
      c?.token,
      c?.critic_token,
      c?.lease_token,
      l?.token,
      l?.lease_token,
      state.critic_token,
    ]) {
      if (typeof val === "string" && val.trim()) return val.trim();
    }
  } catch {}
  throw new HarnessError(
    "INVALID_ARGUMENT",
    "--token is required when no active critic session exists",
  );
}
