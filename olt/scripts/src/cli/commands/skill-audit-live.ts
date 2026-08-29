import type { JsonObject } from "../../core/contracts/index.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { SkillAuditorEngine } from "../../mind/auditing/cognitive/index.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import type { CommandContext } from "../options.ts";

export async function skillAuditLiveCommand(
  flags: Record<string, unknown>,
  _context: CommandContext = {},
): Promise<JsonObject> {
  const repoRoot = typeof flags["repo"] === "string" ? String(flags["repo"]) : findRepoRoot();
  // The documented default invocation (cli-capabilities.md) carries no --run. `runRoot` staying
  // `undefined` here must not mean "scan nothing": SkillAuditorEngine.auditSkillCompliance treats
  // an absent capsuleRunRoot as "scan every capsule this repo can discover", the same default
  // scope MindAuditorEngine already applies for pulse discovery. Do not default this to a single
  // guessed path -- that would silently narrow the documented default back down to one capsule.
  const runRoot = typeof flags["run"] === "string" ? String(flags["run"]) : undefined;
  const logDefects = flags["log-defects"] !== false;
  const asJson = Boolean(flags["json"]);

  const result = SkillAuditorEngine.auditSkillCompliance(repoRoot, {
    capsuleRunRoot: runRoot,
    logDefects,
  });

  const lines = [
    `# Tier 0 Skill Compliance Live Audit: ${result.compliant ? "COMPLIANT" : "NON_COMPLIANT"}`,
    "",
    `- Status: ${result.compliant ? "✓ COMPLIANT" : `⚠️ ${result.incidents.length} INCIDENTS`}`,
    `- Delta Events Analyzed: ${result.eventsAnalyzed}`,
    `- Defects Logged: ${result.defectsLogged}`,
    `- High-Water Mark Event Seq: ${result.cursor.lastInspectedEventIndex}`,
    `- Cursor Timestamp: ${result.cursor.lastInspectedTimestamp}`,
  ];

  if (result.incidents.length > 0) {
    lines.push("", "## Forensics Incidents Detected:");
    for (const inc of result.incidents.slice(0, 5)) {
      lines.push(`- [${inc.severity}] ${inc.category}: ${inc.description}`);
    }
  }

  const output = enforceLineLimit(lines.join("\n"), 30);

  return {
    compliant: result.compliant,
    incidents_count: result.incidents.length,
    events_analyzed: result.eventsAnalyzed,
    defects_logged: result.defectsLogged,
    cursor: result.cursor as unknown as JsonObject,
    output,
    markdown: output,
    ...(asJson ? { json: true } : {}),
  };
}
