import type { TelemetryCollector } from "./probe-interface.ts";
import type { PlatformProbeResult, TierType, NormalizedQuotaMetric } from "./types.ts";
import { redactRecord } from "./redact.ts";

export interface TierResult {
  sourceTier: TierType;
  metrics: NormalizedQuotaMetric[];
  rawObservations: Record<string, unknown>;
  reason?: string | undefined;
}

export abstract class BaseTieredCollector implements TelemetryCollector {
  public abstract readonly platformId: string;

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
        rawPayload: redactRecord(metric.rawPayload),
      }));
      return {
        platformId: this.platformId,
        isDetected: true,
        primaryTierUsed: result.sourceTier,
        metrics: redactedMetrics,
        rawObservations: redactRecord(result.rawObservations),
        errors,
        reason: result.reason,
      };
    }

    const terminalReason = this.getTerminalReason ? await this.getTerminalReason() : undefined;
    return {
      platformId: this.platformId,
      isDetected: false,
      primaryTierUsed: null,
      metrics: [],
      rawObservations: {},
      errors,
      reason: terminalReason,
    };
  }

  protected getTerminalReason?(): Promise<string | undefined> | string | undefined;
  protected abstract probeTier1Cli(): Promise<TierResult | null>;
  protected abstract probeTier2Storage(): Promise<TierResult | null>;
  protected abstract probeTier3Runtime(): Promise<TierResult | null>;
}
