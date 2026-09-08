import type { PlatformProbeResult } from "./types.ts";

export interface TelemetryCollector {
  readonly platformId: string;
  probe(): Promise<PlatformProbeResult>;
  readonly currentQuota?: number | null | undefined;
  readonly latestResult?: PlatformProbeResult | undefined;
  readCurrentQuota?(): number | null | undefined;
}

