import type { LivenessStatus, LivenessTrendSummary } from "./types.ts";

export function formatLivenessBrief(status: LivenessStatus): string {
  const icon = status.healthy ? "🟢" : status.status === "stale" ? "🔴" : "⚠️";
  const lines = [
    `### Mind Liveness Status: ${icon} ${status.status.toUpperCase()}`,
    `- **Capsule**: \`${status.capsuleDir}\``,
    `- **Pulse File**: \`${status.pulseFile}\``,
    `- **Exit Code**: \`${status.exitCode}\``,
    `- **Reason**: ${status.reason}`,
  ];

  if (status.metrics.pulseId) {
    lines.push(`- **Pulse ID**: \`${status.metrics.pulseId}\``);
  }
  if (status.metrics.outcome) {
    lines.push(`- **Outcome**: \`${status.metrics.outcome}\``);
  }
  if (status.metrics.pulseTimestamp) {
    lines.push(`- **Pulse Timestamp**: \`${status.metrics.pulseTimestamp}\``);
  }
  if (status.metrics.ageMs !== null) {
    lines.push(
      `- **Age**: ${Math.round(status.metrics.ageMs / 1000)}s (threshold: ${Math.round(status.metrics.maxAllowedAgeMs / 1000)}s)`,
    );
  }
  if (status.metrics.nextWakeAt) {
    lines.push(`- **Next Wake At**: \`${status.metrics.nextWakeAt}\``);
  }

  return lines.join("\n");
}
