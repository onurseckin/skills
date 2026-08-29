import type { JsonObject } from "../../core/contracts/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { transact } from "../../engine/store/index.ts";
import { writeLastPulse } from "../../mind/lifecycle/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

/**
 * Implements defect 105: `mind:halt` was declared in the registry and is the second half of
 * the recovery sequence `mind:wake` prescribes when mode is "halted" (mind/brief.ts thenArgv),
 * but the handler threw NOT_IMPLEMENTED. Durably records the halt (mirrors the mind-halted
 * shape already used by the rescue lane's Rung 0), suppresses successor arming by writing
 * last_pulse.json with next_wake_at: null, per the documented contract in
 * olt/references/cli-capabilities.md.
 *
 * This does not clear state.mind.halted -- CLOSING_FORBIDDEN_FOR_MIND-style invariants mean a
 * generation that reaches halted stays halted; mind:rotate is the sanctioned way out (see
 * mind/rotate.ts's agent-grant carry-over fixed alongside this command).
 */
export function mindHaltCommand(flags: Flags, _context?: CommandContext): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const reason = textFlag(flags, "reason", true)!;

  const nowIso = new Date().toISOString();
  const loaded = loadRun(run, false);
  const pulseState = (loaded.state.pulse ?? {}) as Record<string, unknown>;
  const openPulse = pulseState.open as Record<string, unknown> | null | undefined;
  const openPulseId = typeof openPulse?.pulse_id === "string" ? openPulse.pulse_id : null;

  transact(run, actor, "mind-halted", { reason }, (working) => {
    const workingMind = (working.mind ?? {}) as Record<string, unknown>;
    workingMind.halted = true;
    workingMind.halt_reason = reason;
    working.mind = workingMind as unknown as JsonObject;

    const workingEscalations = Array.isArray(working.escalations) ? [...working.escalations] : [];
    workingEscalations.push({
      id: `esc-halt-${Date.parse(nowIso)}`,
      reason: "mind_halt_requested",
      detail: reason,
      escalated_at: nowIso,
      resolved_at: null,
    } as unknown as JsonObject);
    working.escalations = workingEscalations as unknown as JsonObject[];
  });

  writeLastPulse(run, {
    at: nowIso,
    pulse_id: openPulseId,
    outcome: "halted",
    next_wake_at: null,
  });

  const markdown = enforceLineLimit(
    [
      "### Mind Halted",
      `- **Capsule Root**: \`${run}\``,
      `- **Actor**: \`${actor}\``,
      `- **Reason**: ${reason}`,
      `- **Halted At**: \`${nowIso}\``,
      "- **Next Wake**: suppressed (`next_wake_at` set to `null`)",
      `- **Recovery**: \`mind:rotate --run ${run} --next-run ${run}-next --actor ${actor}\``,
    ].join("\n"),
    30,
  );

  return {
    markdown,
    run_root: run,
    actor,
    reason,
    halted: true,
    halted_at: nowIso,
  };
}
