/**
 * Behavioral Audit: Subagent Pulse Termination & Daemon Interference
 */
import type { CommandRecord, JsonObject } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import { inferRole, isSubagentRole } from "./predicates.ts";
import { TERMINAL_PULSE_OUTCOMES, type BehavioralFinding } from "./types.ts";

export function auditSubagentPulseTermination(
  roleMap: Map<string, string>,
  state: JsonObject,
  commands: readonly CommandRecord[],
  findings: BehavioralFinding[],
): void {
  const pulse = state.pulse;
  if (isJsonObject(pulse)) {
    const last = pulse.last;
    if (isJsonObject(last)) {
      const outcome = typeof last.outcome === "string" ? last.outcome : "";
      const terminalReason = typeof last.terminal_reason === "string" ? last.terminal_reason : null;
      const pulseActor = typeof last.actor === "string" ? last.actor : "";

      if (TERMINAL_PULSE_OUTCOMES.has(outcome) || terminalReason !== null) {
        const actorRole =
          roleMap.get(pulseActor) ??
          (isSubagentRole(pulseActor) ? pulseActor : inferRole(pulseActor, roleMap, state));
        if (actorRole && actorRole !== "human" && actorRole !== "user") {
          findings.push({
            agent_id: pulseActor || "unknown-subagent",
            role: actorRole,
            violation_type: "subagent_pulse_termination",
            severity: "critical",
            observation: `Subagent "${pulseActor || "unknown"}" terminated mind pulse loop with outcome "${outcome}" (terminal reason: ${terminalReason ?? "none"})`,
            remediation:
              "Subagents are strictly prohibited from terminating pulse loops or supervisory schedulers. Mind execution must run continuously without agent-driven termination.",
            evidence: {
              ...(typeof last.pulse_id === "string" ? { pulse_id: last.pulse_id } : {}),
              outcome,
              ...(terminalReason !== null ? { terminal_reason: terminalReason } : {}),
            },
          });
        }
      }
    }
  }

  for (const cmd of commands) {
    const actorRole =
      roleMap.get(cmd.actor) ??
      (isSubagentRole(cmd.actor) ? cmd.actor : inferRole(cmd.actor, roleMap, state));
    const argv = cmd.argv ?? [];
    const argvJoined = argv.join(" ").toLowerCase();

    if (argvJoined.includes("mind:pulse-close")) {
      const hasTerminalOutcome =
        argvJoined.includes("--outcome halted") ||
        argvJoined.includes("--outcome unarmed") ||
        argvJoined.includes("--outcome stopped") ||
        argvJoined.includes("--outcome completed");
      const hasTerminalReason =
        argvJoined.includes("--terminal-reason") || argvJoined.includes("--reason");

      if (hasTerminalOutcome || hasTerminalReason) {
        const reportedRole = actorRole ? actorRole : "subagent";
        findings.push({
          agent_id: cmd.actor,
          role: reportedRole,
          violation_type: "subagent_pulse_termination",
          severity: "critical",
          observation: `Subagent "${cmd.actor}" executed mind:pulse-close with terminal arguments: "${argv.join(" ")}"`,
          remediation:
            "Subagents must not terminate mind pulses. Schedulers and mind pulses must run infinitely unless manually halted by the human user.",
          evidence: {
            command_id: cmd.id,
            argv: [...argv],
          },
        });
      }
    }

    const isKillOrStopCommand =
      /^(kill|pkill|killall)\b/.test(argv[0] ?? "") ||
      argvJoined.includes("systemctl stop") ||
      argvJoined.includes("systemctl disable") ||
      argvJoined.includes("launchctl unload");

    const targetsScheduler =
      argvJoined.includes("pulse.sh") ||
      argvJoined.includes("mind.timer") ||
      argvJoined.includes("mind.service") ||
      argvJoined.includes("scheduler") ||
      argvJoined.includes("mind");

    if (isKillOrStopCommand && targetsScheduler) {
      const reportedRole = actorRole ? actorRole : "subagent";
      findings.push({
        agent_id: cmd.actor,
        role: reportedRole,
        violation_type: "subagent_pulse_termination",
        severity: "critical",
        observation: `Subagent "${cmd.actor}" executed command attempting to terminate scheduler/daemon process: "${argv.join(" ")}"`,
        remediation:
          "Supervisory schedulers and pulses are protected invariants. Subagents must never kill or stop supervisory background processes.",
        evidence: {
          command_id: cmd.id,
          argv: [...argv],
        },
      });
    }
  }
}
