import type { CircuitBreakerEvaluation } from "./circuit-breaker-evaluator.ts";

export function formatCircuitBreakerMarkdown(
  evaluation: CircuitBreakerEvaluation,
  detailed = false,
): string {
  const lines: string[] = [];

  if (evaluation.isTriggered) {
    const quotaUnknown = evaluation.status === "QUOTA_UNKNOWN_CIRCUIT_BROKEN";
    lines.push(
      "┌──────────────────────────────────────────────────────────────────────────────────────────────────┐",
    );
    lines.push(
      quotaUnknown
        ? "│                    ⚠️ QUOTA AVAILABILITY UNAVAILABLE / UNMEASURED ⚠️                            │"
        : "│                         🚨 CRITICAL QUOTA CIRCUIT-BREAKER ACTIVATED (<10%) 🚨                     │",
    );
    lines.push(
      "├──────────────────────────────┬───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(`│ State Status                 │ ${evaluation.status.padEnd(65).slice(0, 65)} │`);
    if (evaluation.activeHost) {
      lines.push(`│ Active Host                  │ ${evaluation.activeHost.padEnd(65).slice(0, 65)} │`);
    }
    lines.push(
      `│ ${quotaUnknown ? "Lowest Measured Quota" : "Lowest Remaining Quota"}       │ ${(evaluation.lowestRemainingQuota !== null ? `${evaluation.lowestRemainingQuota.toFixed(2)}%` : "Unavailable").padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Trigger Threshold            │ ${`${evaluation.thresholdPercentage.toFixed(2)}%`.padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Constrained Models Count     │ ${String(evaluation.constrainedModels.length).padEnd(65).slice(0, 65)} │`,
    );

    if (evaluation.autoWakeSchedule) {
      lines.push(
        `│ Target Wakeup Time (ISO)     │ ${evaluation.autoWakeSchedule.targetWakeupIso.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Auto-Wake Timer Duration     │ ${`${evaluation.autoWakeSchedule.durationSeconds}s (${Math.floor(evaluation.autoWakeSchedule.durationSeconds / 60)}m ${evaluation.autoWakeSchedule.durationSeconds % 60}s)`.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Scheduler Timer Condition    │ ${evaluation.autoWakeSchedule.timerCondition.padEnd(65).slice(0, 65)} │`,
      );
      lines.push(
        `│ Active Agents Retained       │ ${String(evaluation.autoWakeSchedule.activeAgentsCount).padEnd(65).slice(0, 65)} │`,
      );
    }

    lines.push(
      "├──────────────────────────────┴───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(
      "│                                    AGENT WRAP-UP DIRECTIVES                                       │",
    );
    lines.push(
      "├──────────────────────────────────────────────────────────────────────────────────────────────────┤",
    );
    lines.push(
      "│ • Directives Broadcast: Wrap up current micro-step immediately. Do not claim or start new tasks. │",
    );
    lines.push(
      "│ • Preservation Rule: Keep working tree changes unstaged/stashed safely without destructive actions│",
    );
    lines.push(
      "│ • Non-Destructive Invariant: Do NOT kill active subagents (manage_subagents kill forbidden).     │",
    );
    lines.push(
      "│ • State Action: All active subagents transition to IDLE state in memory.                         │",
    );
    lines.push(
      "└──────────────────────────────────────────────────────────────────────────────────────────────────┘",
    );
    lines.push("");
    lines.push(`> ⚠️ **${evaluation.summary}**`);

    if (evaluation.constrainedModels.length > 0) {
      lines.push("");
      lines.push("### Constrained Models Breakdown");
      for (const m of evaluation.constrainedModels) {
        const resetNote = m.resetTime
          ? `(Resets at \`${m.resetTime}\`)`
          : "(No reset time detected; default safe window applied)";
        lines.push(
          `- **\`${m.platformId}\` / \`${m.modelName}\`**: ${m.remainingPercentage.toFixed(2)}% remaining ${resetNote}`,
        );
      }
    }

    if (evaluation.autoWakeSchedule) {
      lines.push("");
      lines.push("### One-Shot Scheduler Registration Payload");
      lines.push("```json");
      lines.push(JSON.stringify(evaluation.autoWakeSchedule, null, 2));
      lines.push("```");
    }
  } else {
    lines.push(
      "┌──────────────────────────────────────────────────────────────────────────────────────────────────┐",
    );
    lines.push(
      "│                                QUOTA CIRCUIT-BREAKER: STATUS NOMINAL                             │",
    );
    lines.push(
      "├──────────────────────────────┬───────────────────────────────────────────────────────────────────┤",
    );
    lines.push(`│ State Status                 │ ${evaluation.status.padEnd(65).slice(0, 65)} │`);
    if (evaluation.activeHost) {
      lines.push(`│ Active Host                  │ ${evaluation.activeHost.padEnd(65).slice(0, 65)} │`);
    }
    lines.push(
      `│ Lowest Remaining Quota       │ ${(evaluation.lowestRemainingQuota !== null ? `${evaluation.lowestRemainingQuota.toFixed(2)}%` : "None").padEnd(65).slice(0, 65)} │`,
    );
    lines.push(
      `│ Trigger Threshold            │ ${`${evaluation.thresholdPercentage.toFixed(2)}%`.padEnd(65).slice(0, 65)} │`,
    );
    lines.push(`│ Circuit-Breaker Triggered    │ ${"false (Nominal)".padEnd(65).slice(0, 65)} │`);
    lines.push(
      "└──────────────────────────────┴───────────────────────────────────────────────────────────────────┘",
    );
    lines.push("");
    lines.push(`> ✅ **${evaluation.summary}**`);
  }

  if (detailed && evaluation.wrapUpDirectives.length > 0) {
    lines.push("");
    lines.push("### Wrap-Up Directives JSON");
    lines.push("```json");
    lines.push(JSON.stringify(evaluation.wrapUpDirectives, null, 2));
    lines.push("```");
  }

  return lines.join("\n");
}
