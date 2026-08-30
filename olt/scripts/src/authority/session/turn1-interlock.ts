import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import { findRepoRoot, resolveCapsulesDir } from "../../core/shared/paths.ts";
import type { SessionIdentity } from "./types.ts";

export function requireTurn1Registration(session: SessionIdentity): void {
  if (!session) {
    throw new HarnessError("AUTHENTICATION_FAILURE", "session identity is required");
  }
  if (!session.token || session.token === "unauthenticated") {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent '${session.agent_id}' is unauthenticated: turn 1 registration token required`,
    );
  }
  if (!session.run_id || !session.run_id.trim()) {
    throw new HarnessError(
      "INVALID_STATE",
      `agent '${session.agent_id}' is unanchored: missing run_id in session identity`,
    );
  }
  if (
    !session.mechanisms_detected ||
    session.mechanisms_detected.length === 0 ||
    (session.mechanisms_detected.length === 1 &&
      session.mechanisms_detected[0] === "interactive_terminal_fallback")
  ) {
    throw new HarnessError(
      "AUTHENTICATION_FAILURE",
      `agent '${session.agent_id}' session has no valid durable registration mechanism`,
    );
  }
  const trimmed = session.run_id.trim();
  let statePath = join(trimmed, "state.json");
  let resolved = trimmed;
  if (!existsSync(statePath)) {
    const candidates = [
      join(process.cwd(), ".olt", "capsules", trimmed),
      join(process.cwd(), "capsules", trimmed),
    ];
    try {
      const repoRoot = findRepoRoot(trimmed);
      candidates.push(
        join(resolveCapsulesDir(repoRoot), trimmed),
        join(repoRoot, ".olt", "capsules", trimmed),
      );
    } catch {}
    try {
      const defaultRepo = findRepoRoot();
      candidates.push(
        join(resolveCapsulesDir(defaultRepo), trimmed),
        join(defaultRepo, ".olt", "capsules", trimmed),
      );
    } catch {}
    for (const cand of candidates) {
      if (existsSync(join(cand, "state.json"))) {
        resolved = resolve(cand);
        statePath = join(resolved, "state.json");
        break;
      }
    }
  }
  if (!existsSync(statePath)) {
    throw new HarnessError(
      "INVALID_STATE",
      `capsule state.json not found for run '${session.run_id}' at ${resolved}; execute run:init first`,
    );
  }
}
