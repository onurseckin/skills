export interface SubagentTelemetry {
  readonly agentId: string;
  readonly turnCount: number;
  readonly recentCommands: readonly string[];
}

export interface WatchdogHealthReport {
  readonly isHealthy: boolean;
  readonly detectedAnomalies: readonly string[];
  readonly remediation: string | null;
}

export class SubagentWatchdogTelemetryMonitor {
  public static evaluateHealth(telemetry: SubagentTelemetry): WatchdogHealthReport {
    const anomalies: string[] = [];

    const sleepCount = telemetry.recentCommands.filter((c) => c.includes("sleep")).length;
    if (sleepCount >= 2) {
      anomalies.push("POLLING_WASTE");
    }

    if (telemetry.turnCount > 25) {
      anomalies.push("STRAGGLER");
    }

    return {
      isHealthy: anomalies.length === 0,
      detectedAnomalies: anomalies,
      remediation:
        anomalies.length > 0 ? "Trigger hard reset or inject role reminder prompt" : null,
    };
  }
}
