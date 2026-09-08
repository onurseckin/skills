import type { TelemetryCollector } from "./probe-interface.ts";
import type { PlatformProbeResult, TierType, NormalizedQuotaMetric } from "./types.ts";
import { allowlistRecord, redactRecord } from "./redact.ts";

function projectRawRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactRecord(allowlistRecord(value));
}

export interface TierResult {
  sourceTier: TierType;
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
  reason?: string | undefined;
}

export abstract class BaseTieredCollector implements TelemetryCollector {
  public abstract readonly platformId: string;
  private lastResult?: PlatformProbeResult | undefined;

  public get latestResult(): PlatformProbeResult | undefined {
    return this.lastResult;
  }

  public readCurrentQuota(): number | undefined {
    if (this.lastResult) {
      for (const m of this.lastResult.metrics) {
        if (typeof m.remainingPercentage === "number") {
          return m.remainingPercentage;
        }
      }
    }
    return undefined;
  }

  public async probe(): Promise<PlatformProbeResult> {
    const errors: Error[] = [];

    const attemptTier = async (
      probeFn: () => Promise<TierResult | null>,
    ): Promise<TierResult | null> => {
      try {
        return await probeFn();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        return null;
      }
    };

    let result = await attemptTier(() => this.probeTier1Cli());
    if (!result) {
      result = await attemptTier(() => this.probeTier2Storage());
    }
    if (!result) {
      result = await attemptTier(() => this.probeTier3Runtime());
    }

    if (result) {
      const redactedMetrics: NormalizedQuotaMetric[] = result.metrics.map((metric) => ({
        ...metric,
        rawPayload: projectRawRecord(metric.rawPayload),
      }));
      const probeRes: PlatformProbeResult = {
        platformId: this.platformId,
        isDetected: true,
        primaryTierUsed: result.sourceTier,
        metrics: redactedMetrics,
        rawObservations: projectRawRecord(result.rawObservations),
        errors,
        reason: result.reason,
      };
      this.lastResult = probeRes;
      return probeRes;
    }

    const terminalReason = this.getTerminalReason ? await this.getTerminalReason() : undefined;
    const probeRes: PlatformProbeResult = {
      platformId: this.platformId,
      isDetected: false,
      primaryTierUsed: null,
      metrics: [],
      rawObservations: {},
      errors,
      reason: terminalReason,
    };
    this.lastResult = probeRes;
    return probeRes;
  }

  protected getTerminalReason?(): Promise<string | undefined> | string | undefined;
  protected abstract probeTier1Cli(): Promise<TierResult | null>;
  protected abstract probeTier2Storage(): Promise<TierResult | null>;
  protected abstract probeTier3Runtime(): Promise<TierResult | null>;
}
