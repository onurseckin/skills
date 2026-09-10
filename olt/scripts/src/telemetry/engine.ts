// TelemetryNormalizationEngine - Host-aware live quota telemetry and cache isolation
import type { TelemetryCollector } from "./probe-interface.ts";
import type {
  NormalizedQuotaMetric,
  PlatformProbeResult,
  UnifiedTelemetryReport,
} from "./types.ts";
import {
  createDefaultCollectors,
  detectActiveHost,
  isPlatformMatchingHost,
  type CanonicalHost,
  type HostDetectionOptions,
  type HostDetectionResult,
} from "./collectors/index.ts";
import {
  formatAsciiReport,
  formatPreciseProgressBar,
  formatResetTime,
  formatTierBadge,
  formatTierShort,
  renderProgressBar,
} from "./engine-formatting.ts";
import { TokenReservoir, type ReservoirStatus } from "./token-reservoir.ts";
import { reconcileNormalizedMetrics } from "./reconciliation/index.ts";

export {
  formatAsciiReport,
  formatPreciseProgressBar,
  formatResetTime,
  formatTierBadge,
  formatTierShort,
  renderProgressBar,
  TokenReservoir,
  type ReservoirStatus,
};

export interface TelemetryNormalizationEngineOptions {
  activeHost?: CanonicalHost | string | undefined;
  activeModel?: string | undefined;
  processTree?: readonly string[] | string | undefined;
  isolateActiveHost?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
  tokenReservoir?: TokenReservoir | undefined;
}

export interface ProbeAllOptions {
  activeHost?: CanonicalHost | string | undefined;
  activeModel?: string | undefined;
  processTree?: readonly string[] | string | undefined;
  isolateActiveHost?: boolean | undefined;
  env?: Record<string, string | undefined> | undefined;
  activeAgentsCount?: number | undefined;
}

export class TelemetryNormalizationEngine {
  private readonly collectors: Map<string, TelemetryCollector> = new Map();
  private readonly defaultOptions: TelemetryNormalizationEngineOptions;
  private readonly reservoir: TokenReservoir;

  constructor(
    collectors: TelemetryCollector[] = [],
    options: TelemetryNormalizationEngineOptions = {},
  ) {
    this.defaultOptions = options;
    this.reservoir =
      options.tokenReservoir !== undefined ? options.tokenReservoir : new TokenReservoir();
    if (collectors.length === 0) {
      const defaultIsolate =
        options.isolateActiveHost !== undefined ? options.isolateActiveHost : true;
      for (const collector of createDefaultCollectors({
        env:
          options.env !== undefined
            ? options.env
            : typeof process !== "undefined"
              ? process.env
              : {},
        activeHost: options.activeHost,
        activeModel: options.activeModel,
        processTree: options.processTree,
        isolateExternalCaches: defaultIsolate,
      })) {
        this.registerCollector(collector);
      }
    } else {
      for (const collector of collectors) {
        this.registerCollector(collector);
      }
    }
  }

  public registerCollector(collector: TelemetryCollector): this {
    this.collectors.set(collector.platformId, collector);
    return this;
  }

  public getCollectors(): readonly TelemetryCollector[] {
    return Array.from(this.collectors.values());
  }

  public getReservoir(): TokenReservoir {
    return this.reservoir;
  }

  public detectHost(options?: ProbeAllOptions): HostDetectionResult {
    const processEnv = typeof process !== "undefined" ? process.env : {};
    const defaultEnv =
      this.defaultOptions.env !== undefined ? this.defaultOptions.env : processEnv;
    const mergedEnv =
      options !== undefined && options.env !== undefined ? options.env : defaultEnv;
    const detectionOpts: HostDetectionOptions = {
      env: mergedEnv,
      processTree:
        options !== undefined && options.processTree !== undefined
          ? options.processTree
          : this.defaultOptions.processTree,
      model:
        options !== undefined && options.activeModel !== undefined
          ? options.activeModel
          : this.defaultOptions.activeModel,
      explicitHost:
        options !== undefined && options.activeHost !== undefined
          ? options.activeHost
          : this.defaultOptions.activeHost,
    };
    return detectActiveHost(detectionOpts);
  }

  public async probeAll(options?: ProbeAllOptions): Promise<UnifiedTelemetryReport> {
    const collectorList = Array.from(this.collectors.values());
    const settled = await Promise.allSettled(collectorList.map((c) => c.probe()));

    const results: PlatformProbeResult[] = settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") return outcome.value;
      const error =
        outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
      const collector = collectorList[i];
      const platformId = collector !== undefined ? collector.platformId : "unknown";
      return {
        platformId,
        isDetected: false,
        primaryTierUsed: null,
        metrics: [],
        rawObservations: {},
        errors: [error],
      };
    });

    const hostDetection = this.detectHost(options);
    const activeHost = hostDetection.activeHost;
    const defaultIsolate =
      this.defaultOptions.isolateActiveHost !== undefined
        ? this.defaultOptions.isolateActiveHost
        : true;
    const isolateActiveHost =
      options !== undefined && options.isolateActiveHost !== undefined
        ? options.isolateActiveHost
        : defaultIsolate;

    for (const res of results) {
      const isActiveHost = isPlatformMatchingHost(res.platformId, activeHost);
      res.rawObservations["isActiveHost"] = isActiveHost;
      res.rawObservations["isExternalProvider"] = !isActiveHost && res.isDetected;
      res.rawObservations["activeHostDetected"] = activeHost;
    }

    const {
      activeLowest,
      activeMetric,
      globalLowest,
      globalMetric,
      externalPlatforms,
      isolatedCaches,
    } = this.computeLowestQuotas(results, activeHost);

    let lowestRemainingQuota: number | null = null;
    let lowestMetric: NormalizedQuotaMetric | null = null;
    let externalCachesIsolated = false;

    if (isolateActiveHost) {
      if (activeLowest !== null) {
        if (externalPlatforms.length > 0) externalCachesIsolated = true;
        lowestRemainingQuota = activeLowest;
        lowestMetric = activeMetric;
      } else if (
        !hostDetection.isFallback &&
        results.some((r) => isPlatformMatchingHost(r.platformId, activeHost) && r.isDetected)
      ) {
        lowestRemainingQuota = null;
        lowestMetric = null;
      } else {
        lowestRemainingQuota = globalLowest;
        lowestMetric = globalMetric;
      }
    } else {
      lowestRemainingQuota = globalLowest;
      lowestMetric = globalMetric;
    }

    const activeWarnings: string[] = [];
    if (lowestRemainingQuota !== null && lowestRemainingQuota < 20) {
      const provider =
        lowestMetric !== null && lowestMetric !== undefined && lowestMetric.canonicalProvider !== undefined
          ? lowestMetric.canonicalProvider
          : activeHost;
      const label =
        lowestMetric !== null && lowestMetric !== undefined && lowestMetric.rawMetricName !== undefined
          ? lowestMetric.rawMetricName
          : "quota";
      activeWarnings.push(`Low quota warning: ${provider} (${label}) at ${lowestRemainingQuota}%`);
    }

    const isolatedWarnings: string[] = [];
    const isNominalOrUnmeasured =
      lowestRemainingQuota === null ? true : lowestRemainingQuota >= 20;
    if (isolateActiveHost && isolatedCaches.length > 0 && isNominalOrUnmeasured) {
      for (const ext of isolatedCaches) {
        isolatedWarnings.push(
          `[Isolated External Cache] Provider '${ext.platformId}' (${ext.metricName}) reports ${ext.quota}% (inactive host, isolated from active host '${activeHost}')`,
        );
      }
    }

    const allMetrics = results.flatMap((r) => r.metrics);
    const reconciliation = reconcileNormalizedMetrics(allMetrics);

    const reservoirStatus = this.reservoir.getStatus();
    const agentsCount =
      options !== undefined && options.activeAgentsCount !== undefined
        ? options.activeAgentsCount
        : 0;
    const effectiveQuota = this.reservoir.calculateEffectiveQuota(
      lowestRemainingQuota,
      agentsCount,
    );

    const defaultModel =
      this.defaultOptions.activeModel !== undefined ? this.defaultOptions.activeModel : null;
    const activeModel =
      options !== undefined && options.activeModel !== undefined
        ? options.activeModel
        : defaultModel;

    const summary: Record<string, unknown> = {
      totalCollectors: collectorList.length,
      detectedPlatforms: results.filter((r) => r.isDetected).length,
      lowestRemainingQuota,
      effectiveRemainingQuota: effectiveQuota,
      tokenReservoir: reservoirStatus,
      reconciliation,
      bindingConstraint: reconciliation.bindingConstraint,
      reconciledQuota: reconciliation.effectiveQuota,
      activeHost,
      activePlatformId: hostDetection.primaryPlatformId,
      activeHostSignal: hostDetection.signal,
      activeHostQuotaRemaining: activeLowest,
      activeModel,
      isolateActiveHost,
      externalProviderCachesIsolated: externalCachesIsolated,
      isolatedExternalPlatforms: externalPlatforms,
      activeWarnings,
      isolatedWarnings,
    };

    return { timestamp: new Date().toISOString(), results, summary };
  }

  private computeLowestQuotas(results: PlatformProbeResult[], activeHost: string) {
    let activeLowest: number | null = null;
    let activeMetric: NormalizedQuotaMetric | null = null;
    let globalLowest: number | null = null;
    let globalMetric: NormalizedQuotaMetric | null = null;
    const externalPlatforms: string[] = [];
    const isolatedCaches: { platformId: string; metricName: string; quota: number }[] = [];

    for (const res of results) {
      if (!res.isDetected) continue;
      if (res.metrics.length === 0) continue;
      const isHost = isPlatformMatchingHost(res.platformId, activeHost);
      if (!isHost) externalPlatforms.push(res.platformId);

      for (const m of res.metrics) {
        if (m.remainingPercentage === null) continue;
        const isGlobalLower =
          globalLowest === null ? true : m.remainingPercentage < globalLowest;
        if (isGlobalLower) {
          globalLowest = m.remainingPercentage;
          globalMetric = m;
        }
        const isActiveLower =
          activeLowest === null ? true : m.remainingPercentage < activeLowest;
        if (isHost && isActiveLower) {
          activeLowest = m.remainingPercentage;
          activeMetric = m;
        }
        if (!isHost && m.remainingPercentage < 20) {
          isolatedCaches.push({
            platformId: res.platformId,
            metricName: m.rawMetricName,
            quota: m.remainingPercentage,
          });
        }
      }
    }

    return {
      activeLowest,
      activeMetric,
      globalLowest,
      globalMetric,
      externalPlatforms,
      isolatedCaches,
    };
  }

  public formatAsciiReport(report: UnifiedTelemetryReport, detailed = false): string {
    return formatAsciiReport(report, detailed);
  }
}
