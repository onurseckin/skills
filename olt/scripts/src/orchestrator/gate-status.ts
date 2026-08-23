import type {
  GateOverallStatus,
  GateRoundStatus,
  RoundGateResult,
  RoundTelemetry,
} from "./types.ts";

export function roundGateStatus(gateResults: readonly RoundGateResult[]): GateRoundStatus {
  if (gateResults.length === 0) return "not_run";
  return gateResults.every((gate) => gate.status === "passed") ? "passed" : "failed";
}

export function loopGateStatus(rounds: readonly RoundTelemetry[]): GateOverallStatus {
  if (rounds.some((round) => round.gateStatus === "failed")) return "failed";
  const proven = rounds.filter((round) => round.gateStatus === "passed");
  if (proven.length === 0) return "not_run";
  return proven.length === rounds.length ? "passed" : "partial";
}

export const GATE_STATUS_LABEL: Readonly<Record<GateOverallStatus, string>> = {
  passed: "✅ every round ran gates and every gate passed",
  failed: "❌ at least one gate failed",
  not_run: "⚠️ no gate ran in any round — nothing was proven",
  partial: "⚠️ some rounds ran no gate — those rounds proved nothing",
};

export function gateStatusLine(status: GateOverallStatus): string {
  return `- **Gate Status:** \`${status}\` — ${GATE_STATUS_LABEL[status]}`;
}
