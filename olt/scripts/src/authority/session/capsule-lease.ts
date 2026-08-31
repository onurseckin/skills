import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, isInsideCapsule, resolveCapsulesDir } from "../../core/shared/paths.ts";
import { readAgentLedger } from "../../workflow/agents/ledger.ts";
import {
  formatSafeErrorCause,
  getInMemorySessionData,
  isInMemorySessionStoreEnabled,
} from "./io.ts";
import { assertSafeSessionComponent } from "./paths.ts";

function resolveCapsuleStateLocation(trimmed: string): { resolved: string; statePath: string } {
  let resolved = trimmed;
  let statePath = join(trimmed, "state.json");
  try {
    const repoRoot = findRepoRoot(trimmed);
    resolved =
      isAbsolute(trimmed) || isInsideCapsule(trimmed)
        ? resolve(trimmed)
        : join(resolveCapsulesDir(repoRoot), trimmed);
    statePath = join(resolved, "state.json");
  } catch {}
  return { resolved, statePath };
}

export function assertActiveCapsuleLease(runRoot: string, agentId: string): void {
  if (!runRoot || !runRoot.trim())
    throw new HarnessError("INVALID_STATE", "capsule runRoot is required");
  const agent = assertSafeSessionComponent(agentId, "agentId");
  const trimmed = runRoot.trim();
  let statePath = join(trimmed, "state.json");
  let resolved = trimmed;
  let raw: string | undefined;

  if (isInMemorySessionStoreEnabled()) {
    raw = getInMemorySessionData(statePath);
    if (!raw) {
      const loc = resolveCapsuleStateLocation(trimmed);
      resolved = loc.resolved;
      statePath = loc.statePath;
      raw = getInMemorySessionData(statePath);
    }
  }

  if (raw === undefined) {
    if (!existsSync(statePath)) {
      const loc = resolveCapsuleStateLocation(trimmed);
      resolved = loc.resolved;
      statePath = loc.statePath;
    }
    if (!existsSync(statePath))
      throw new HarnessError("INVALID_STATE", `capsule state not found at ${resolved}`);
    try {
      raw = readFileSync(statePath, "utf8");
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `failed to load capsule state at ${resolved}: ${formatSafeErrorCause(error)}`,
      );
    }
  }

  let state: Record<string, unknown>;
  try {
    state = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new HarnessError(
      "INTEGRITY",
      `failed to load capsule state at ${resolved}: ${formatSafeErrorCause(error)}`,
    );
  }
  const ledger = readAgentLedger(state as Parameters<typeof readAgentLedger>[0]);
  if (ledger.some((entry) => entry.id === agent && entry.status === "active")) return;
  const tasks = state.tasks;
  if (tasks && typeof tasks === "object") {
    const hasActive = Object.values(tasks).some((t) => {
      if (!t || typeof t !== "object") return false;
      const lease = (t as { lease?: { agent_id?: string; expires_at?: string } }).lease;
      return Boolean(
        lease &&
        lease.agent_id === agent &&
        (!lease.expires_at || Date.parse(lease.expires_at) > Date.now()),
      );
    });
    if (hasActive) return;
  }
  throw new HarnessError(
    "INVALID_STATE",
    `agent '${agent}' does not hold an active lease in capsule '${resolved}'`,
  );
}
