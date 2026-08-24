import type { JsonObject } from "../../core/contracts/json.ts";
import { findRepoRoot } from "../../core/shared/paths.ts";
import { MindAuditorEngine } from "../../mind/cognitive-auditors.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import type { CommandContext } from "../options.ts";

export async function mindAuditLiveCommand(
  flags: Record<string, unknown>,
  context: CommandContext = {},
): Promise<JsonObject> {
  const repoRoot = typeof flags["repo"] === "string" ? String(flags["repo"]) : findRepoRoot();
  const threshold = typeof flags["threshold"] === "number" ? Number(flags["threshold"]) : 120;
  const conversationId =
    typeof flags["conversation-id"] === "string" ? String(flags["conversation-id"]) : undefined;
  const asJson = Boolean(flags["json"]);

  const result = MindAuditorEngine.auditMindPulse(repoRoot, {
    stagnationThresholdSeconds: threshold,
    conversationId,
  });

  const lines = [
    `# Tier 0 Mind Live Audit: ${result.stagnant ? "STAGNANT" : "HEALTHY"}`,
    "",
    `- Idle Duration: ${result.idleDurationSeconds}s (Threshold: ${threshold}s)`,
    `- Status: ${result.stagnant ? "⚠️ STAGNANT (>120s)" : "✓ ACTIVE"}`,
    `- Pending Backlog Items: ${result.telemetry.pendingBacklogCount}`,
    `- Unresolved Defects: ${result.telemetry.unresolvedDefectCount}`,
    `- Defect Logged: ${result.defectCreated ? "YES" : "NO"}`,
    `- Cursor Timestamp: ${result.cursor.lastInspectedTimestamp}`,
  ];

  if (result.injectionPrompt) {
    lines.push(
      "",
      "## Verbatim Injection Prompt Generated:",
      "```text",
      result.injectionPrompt.slice(0, 500) + "...",
      "```",
    );
  }

  const output = enforceLineLimit(lines.join("\n"), 30);
  const suppressStdout =
    "suppressStdout" in context
      ? Boolean((context as Record<string, unknown>)["suppressStdout"])
      : false;
  if (!asJson && !suppressStdout) {
    console.log(output);
  }

  return {
    stagnant: result.stagnant,
    idle_duration_seconds: result.idleDurationSeconds,
    pending_backlog_count: result.telemetry.pendingBacklogCount,
    unresolved_defect_count: result.telemetry.unresolvedDefectCount,
    defect_created: Boolean(result.defectCreated),
    injection_prompt: result.injectionPrompt ?? null,
    cursor: result.cursor as unknown as JsonObject,
    output,
  };
}
