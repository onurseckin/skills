import { existsSync } from "node:fs";
import type { JsonObject } from "../../core/contracts/index.ts";
import { atomicWriteBytes } from "../../core/durable-write.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { transact } from "../../engine/store/index.ts";
import { runFilePath } from "../../engine/store/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import { textFlag, type CommandContext, type Flags } from "../options.ts";

/**
 * Implements defect 104: `mind:escalate` was declared in the registry and prescribed by
 * `mind:wake`'s halted-mode brief (see mind/brief.ts nextArgv) but the handler threw
 * NOT_IMPLEMENTED, so the recovery sequence mind:wake advises could never actually run.
 *
 * Records an escalation in the hash chain (mind-escalated) and durably appends a
 * human-readable entry to escalation.md in the capsule root, per the documented contract in
 * olt/references/cli-capabilities.md.
 */
export function mindEscalateCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const run = textFlag(flags, "run", true)!;
  const actor = textFlag(flags, "actor", true)!;
  const reason = textFlag(flags, "reason", true)!;
  const severity = textFlag(flags, "severity", false);

  const nowIso = new Date().toISOString();
  const escalationId = `esc-manual-${Date.parse(nowIso)}`;

  transact(
    run,
    actor,
    "mind-escalated",
    {
      escalation_id: escalationId,
      reason,
      ...(severity !== undefined ? { severity } : {}),
    },
    (working) => {
      const workingEscalations = Array.isArray(working.escalations) ? [...working.escalations] : [];
      workingEscalations.push({
        id: escalationId,
        reason,
        ...(severity !== undefined ? { severity } : {}),
        escalated_at: nowIso,
        resolved_at: null,
      } as unknown as JsonObject);
      working.escalations = workingEscalations as unknown as JsonObject[];
    },
  );

  const escalationLogPath = runFilePath(run, "escalation.md");
  const existingContent = existsSync(escalationLogPath)
    ? new TextDecoder().decode(readRegularFileNoFollow(escalationLogPath))
    : "# Mind Escalation Log\n";
  const entry = [
    "",
    `## ${escalationId}`,
    `- **At**: \`${nowIso}\``,
    `- **Actor**: \`${actor}\``,
    `- **Reason**: ${reason}`,
    ...(severity !== undefined ? [`- **Severity**: \`${severity}\``] : []),
    "",
  ].join("\n");
  atomicWriteBytes(escalationLogPath, new TextEncoder().encode(`${existingContent}${entry}`));

  const markdown = enforceLineLimit(
    [
      `### Mind Escalation Recorded: ${escalationId}`,
      `- **Capsule Root**: \`${run}\``,
      `- **Actor**: \`${actor}\``,
      `- **Reason**: ${reason}`,
      ...(severity !== undefined ? [`- **Severity**: \`${severity}\``] : []),
      `- **Escalated At**: \`${nowIso}\``,
      `- **Log**: \`${escalationLogPath}\``,
    ].join("\n"),
    30,
  );

  return {
    markdown,
    run_root: run,
    actor,
    escalation_id: escalationId,
    reason,
    ...(severity !== undefined ? { severity } : {}),
    escalated_at: nowIso,
  };
}
